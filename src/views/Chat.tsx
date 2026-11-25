import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import {
  ConfirmModal, DialogButton, Focusable, GamepadButton, Navigation, quickAccessMenuClasses, showModal, TextField,
} from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  chatAnswer, chatCancel, chatDelete, chatList, chatNew, ChatItem, ChatMeta, ChatResult, ChatSnapshot, chatSend,
  chatSnapshot, chatUpdate, getSettings, Permission, saveSettings, Settings,
} from "../utils/backend";
import { PLUGIN_NAME, useT } from "../utils/i18n";
import { SETTINGS_ROUTE } from "../utils/routes";
import { colors, mono } from "../utils/theme";
import Markdown from "./Markdown";

type T = ReturnType<typeof useT>;
type Full = Extract<ChatSnapshot, { busy: boolean }>;
type Tool = Extract<ChatItem, { kind: "tool" }>;
const POLL_BUSY_MS = 400;
// Room left under the panel so Steam's own bottom edge never hides the composer.
const BOTTOM_GAP = 6;
// Decky pads the top of a panel; the chat title sits right under the plugin name instead.
const TITLE_PULL = 12;

// Steam hides its focus colour under inline backgrounds, so every control
// that sets one has a focus rule here. Sizes are compact: Big Picture is often
// scaled up, and the space is better spent on text.
const CSS = `
.dsh-btn.gpfocus, .dsh-item.gpfocus { background: #dcdedf !important; color: #0e141b !important; }
.dsh-round.gpfocus, .dsh-pill.gpfocus { box-shadow: 0 0 0 2px #1a9fff !important; }
.dsh-msg.gpfocus { background: rgba(255,255,255,.06); border-radius: 4px; }
.dsh-list { overflow-y: auto !important; scrollbar-width: none; }
.dsh-list::-webkit-scrollbar { display: none !important; }
.dsh-composer .DialogInput, .dsh-composer input { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 2px !important; height: 28px !important; min-height: 0 !important; font-size: 14px !important; }
.dsh-composer .gamepaddialog_Field_S-_La, .dsh-composer [class*="Field"] { padding: 0 !important; margin: 0 !important; }
`;

// Decky's Quick Access title casts a shadow over whatever sits under it; the
// chat title sits right there, so the shadow goes while the chat is open.
const TITLE_CSS = quickAccessMenuClasses?.Title ? `.${quickAccessMenuClasses.Title} { box-shadow: none !important; }` : "";

function capitalize(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

function errorText(t: T, result: Extract<ChatResult<unknown>, { ok: false }>) {
  const key = `chatError${capitalize(result.error)}` as Parameters<T>[0];
  const text = t(key, { detail: result.detail });
  return text === key ? result.detail : text;
}

// Anchored in the panel and without hiding Big Picture, a modal opens in the Quick Access window.
const MODAL_IN_PANEL = { bHideMainWindowForPopouts: false };

function confirm(title: string, body: string, t: T, parent?: EventTarget): Promise<boolean> {
  return new Promise(resolve => {
    showModal(<ConfirmModal strTitle={title} strDescription={body} strOKButtonText={t("confirm")}
      strCancelButtonText={t("cancel")} onOK={() => resolve(true)} onCancel={() => resolve(false)} />, parent, MODAL_IN_PANEL);
  });
}

function RenameModal({ t, initial, onSave, closeModal }: { t: T; initial: string; onSave: (title: string) => void; closeModal?: () => void }) {
  const [value, setValue] = useState(initial);
  return <ConfirmModal strTitle={t("renameTitle")} strOKButtonText={t("confirm")} strCancelButtonText={t("cancel")}
    closeModal={closeModal} onOK={() => { if (value.trim()) onSave(value.trim()); }}>
    <TextField value={value} onChange={event => setValue(event.currentTarget.value)} />
  </ConfirmModal>;
}

/** The Quick Access chat, laid out like the design: fixed header and composer, scrolling messages. */
export default function Chat() {
  const t = useT();
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Full | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [height, setHeight] = useState<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<"session" | "history" | "permission" | "add" | null>(null);
  const version = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Steam draws its own scrollbar with arrow buttons and hides it when idle, so the panel draws one that is always there.
  const [bar, setBar] = useState<{ top: number; size: number } | null>(null);
  const updateBar = () => {
    const element = list.current;
    if (!element) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    setBar(scrollHeight > clientHeight + 1
      ? { size: clientHeight / scrollHeight * 100, top: scrollTop / scrollHeight * 100 }
      : null);
  };

  // The panel fills the Quick Access window below Decky's title, so only the messages scroll.
  // The menu mounts while it is still sliding in, before the window has its
  // final size, so the height is checked again until it settles.
  useLayoutEffect(() => {
    // The panel renders into the Quick Access window, not the window this code runs in.
    const measure = () => {
      const element = root.current;
      const view = element?.ownerDocument.defaultView;
      if (!element || !view) return;
      // Decky keeps some space under every panel; whatever still makes its
      // scroller scroll comes off the panel, so focus changes never shift it.
      let scroller = element.parentElement;
      while (scroller && view.getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
      const overflow = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
      if (scroller) scroller.scrollTop = 0;
      if (overflow > 0) setPull(previous => Math.min(previous + overflow, 160));
      const next = Math.round(view.innerHeight - element.getBoundingClientRect().top - BOTTOM_GAP);
      if (next > 200) setHeight(previous => previous === next ? previous : next);
    };
    measure();
    const timer = setInterval(measure, 500);
    return () => clearInterval(timer);
  }, []);

  const loadList = async () => {
    const result = await chatList();
    if (result.ok) setChats(result.value);
    return result.ok ? result.value : [];
  };

  const refresh = async (id: string, force = false) => {
    const result = await chatSnapshot(id, force ? 0 : version.current);
    if (!result.ok) { setError(errorText(t, result)); return; }
    if (result.value.unchanged) return;
    version.current = result.value.version;
    setSnapshot(result.value);
  };

  useEffect(() => {
    void getSettings().then(setSettings);
    void loadList().then(list => {
      const first = list.find(chat => !chat.archived);
      if (first) setCurrent(first.id);
    });
  }, []);

  useEffect(() => {
    version.current = 0;
    setSnapshot(null);
    setOpen({});
    if (current) void refresh(current, true);
  }, [current]);

  useEffect(() => {
    if (!snapshot?.busy) { setBusySince(null); return; }
    setBusySince(previous => previous ?? Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [snapshot?.busy]);

  useEffect(() => {
    if (!current || !snapshot?.busy) return;
    const timer = setInterval(() => { void refresh(current); }, POLL_BUSY_MS);
    return () => clearInterval(timer);
  }, [current, snapshot?.busy]);

  // Scroll the message list only: scrollIntoView would also scroll Decky's panel under its title.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    updateBar();
  }, [snapshot?.version, height, error]);

  const startChat = async () => {
    setError(null);
    const result = await chatNew();
    if (!result.ok) { setError(errorText(t, result)); return null; }
    await loadList();
    setCurrent(result.value.id);
    return result.value.id;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text && !files.length) return;
    setError(null);
    const id = current ?? await startChat();
    if (!id) return;
    const result = await chatSend(id, text, files);
    if (!result.ok) { setError(errorText(t, result)); return; }
    setDraft("");
    setFiles([]);
    await refresh(id, true);
    void loadList();
  };

  const choosePreset = async (preset: Permission) => {
    const values = settings ?? await getSettings();
    if (preset === "danger-full-access" && !values.risk_accepted
      && !await confirm(t("riskConfirmTitle"), t("safetyWarning"), t, root.current ?? undefined)) return;
    const saved = await saveSettings({ default_permission: preset, risk_accepted: values.risk_accepted || preset === "danger-full-access" });
    setSettings(saved);
    if (current && snapshot && !snapshot.items.length && !snapshot.busy) {
      // An empty chat has nothing to keep: start it again with the new mode.
      await chatDelete(current);
      await startChat();
    } else if (current) {
      toaster.toast({ title: PLUGIN_NAME, body: t("permissionNextChat") });
    }
  };

  const meta = chats.find(chat => chat.id === current);
  const busy = snapshot?.busy ?? false;
  const preset: Permission = snapshot?.preset ?? settings?.default_permission ?? "workspace-write";
  const full = preset === "danger-full-access";
  const usage = snapshot?.usage;

  const anchor = () => root.current ?? undefined;
  const close = () => setMenu(null);

  const sessionItems = (): MenuEntry[] => {
    if (!current) return [];
    const id = current;
    return [
      { label: t("menuSchedule"), icon: ICONS.clock, disabled: true },
      { label: t("menuSkill"), icon: ICONS.book, disabled: true },
      "-",
      { label: t("menuCopyId"), icon: ICONS.copy, onSelect: () => { void copyText(id).then(() => toaster.toast({ title: PLUGIN_NAME, body: t("copied") })); } },
      "-",
      { label: meta?.starred ? t("menuUnstar") : t("menuStar"), icon: ICONS.star, onSelect: () => { void chatUpdate(id, { starred: !meta?.starred }).then(loadList); } },
      { label: t("menuRename"), icon: ICONS.pencil, onSelect: () => {
        showModal(<RenameModal t={t} initial={meta?.title ?? ""} onSave={title => { void chatUpdate(id, { title }).then(loadList); }} />, anchor(), MODAL_IN_PANEL);
      } },
      "-",
      { label: t("menuArchive"), icon: ICONS.archive, onSelect: () => { void chatUpdate(id, { archived: true }).then(async () => { const list = await loadList(); setCurrent(list.find(chat => !chat.archived && chat.id !== id)?.id ?? null); }); } },
      { label: t("menuDelete"), icon: ICONS.trash, danger: true, onSelect: () => {
        void confirm(t("deleteTitle"), t("deleteBody"), t, anchor()).then(async ok => {
          if (!ok) return;
          const result = await chatDelete(id);
          if (!result.ok) { setError(errorText(t, result)); return; }
          const list = await loadList();
          setCurrent(list.find(chat => !chat.archived)?.id ?? null);
        });
      } },
    ];
  };

  const historyItems = (): MenuEntry[] => {
    const others = chats.filter(chat => !chat.archived && chat.id !== current)
      .sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
    return others.length
      ? others.map(chat => ({ label: (chat.starred ? "★ " : "") + (chat.title || t("chatUntitled")), onSelect: () => setCurrent(chat.id) }))
      : [{ label: t("chatNoHistory"), disabled: true }];
  };

  const permissionItems = (): MenuEntry[] => [
    { label: t("permissionLabelAsk"), icon: ICONS.hand, selected: preset === "workspace-write", onSelect: () => { void choosePreset("workspace-write"); } },
    { label: t("permissionLabelFull"), icon: ICONS.ban, selected: full, onSelect: () => { void choosePreset("danger-full-access"); } },
  ];

  const addItems = (): MenuEntry[] => [
    { label: t("addFile"), icon: ICONS.file, onSelect: () => {
      void openFilePicker(FileSelectionType.FILE, settings?.workspace ?? "/home").then(picked => {
        if (picked?.realpath) setFiles(previous => [...new Set([...previous, picked.realpath])]);
      }).catch(() => undefined);
    } },
    { label: t("addScreenshot"), icon: ICONS.camera, disabled: true },
    "-",
    { label: t("addSkill"), icon: ICONS.book, disabled: true },
    { label: t("addConnector"), icon: ICONS.plug, disabled: true },
  ];

  const talk = () => setError(t("voiceUnavailable"));
  const textInput = settings?.show_text_input ?? false;
  const pending = snapshot?.items.find((item): item is Extract<ChatItem, { kind: "permission" }> =>
    item.kind === "permission" && item.state === "pending");
  const answer = (allow: boolean) => {
    if (current && pending) void chatAnswer(current, pending.request, allow).then(() => refresh(current));
  };
  const stop = () => { if (current) void chatCancel(current); };
  const page = (direction: number) => {
    const element = list.current;
    if (element) element.scrollTop += direction * element.clientHeight * 0.85;
  };
  // X answers yes or talks; Y answers no, stops a running turn, or starts a chat.
  // B stays Steam's Back, so a running turn never traps the player in the panel.
  const xAction = pending ? () => answer(true) : talk;
  const yAction = pending ? () => answer(false) : busy ? stop : () => { void startChat(); };
  const xLabel = pending ? t("chatAllow") : t("voiceTalk");
  const yLabel = pending ? t("chatReject") : busy ? t("chatStop") : t("padNewChat");
  const elapsed = busySince ? Math.max(0, Math.floor((now - busySince) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const contextUsed = usage && usage.size > 0 ? `${Math.round(usage.used / usage.size * 100)}%` : "";
  const model = shortModel(snapshot?.model ?? meta?.model ?? "");
  const modelLine = [contextUsed, model].filter(Boolean).join(" · ");

  return <Focusable ref={root} onSecondaryButton={xAction} onSecondaryActionDescription={xLabel}
    onOptionsButton={yAction} onOptionsActionDescription={yLabel}
    onMenuButton={() => setMenu(current ? "session" : null)} onMenuActionDescription={t("padMenu")}
    onButtonDown={event => {
      if (event.detail.button === GamepadButton.TRIGGER_LEFT) page(-1);
      else if (event.detail.button === GamepadButton.TRIGGER_RIGHT) page(1);
    }}
    style={{ position: "relative", height: height ?? undefined, marginTop: -TITLE_PULL, marginBottom: -pull, boxSizing: "border-box", padding: "0 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.5, color: colors.text }}>
    <style>{CSS + TITLE_CSS}</style>

    <Focusable flow-children="horizontal" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2 }}>
      <DialogButton className="dsh-btn" onClick={() => setMenu(current ? "session" : null)}
        style={{ flex: 1, minWidth: 0, height: 32, padding: "0 4px", background: "transparent", display: "flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 500, textAlign: "left" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta?.starred ? "★ " : ""}{meta?.title || t("chatUntitled")}</span>
        <Icon size={14} color={colors.muted}><path d="m6 9 6 6 6-6" /></Icon>
      </DialogButton>
      <IconButton label={t("chatNew")} onClick={() => { void startChat(); }}><path d="M12 5v14M5 12h14" /></IconButton>
      <IconButton label={t("chatHistory")} onClick={() => setMenu("history")}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></IconButton>
      <IconButton label={t("settings")} onClick={() => { Navigation.Navigate(SETTINGS_ROUTE); Navigation.CloseSideMenus(); }}>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
      </IconButton>
    </Focusable>

    {/* The conversation sits in its own frame, so where it starts and ends is clear. */}
    <div style={{ flex: 1, minHeight: 0, position: "relative", border: "1px solid rgba(255,255,255,.1)", borderRadius: 6, background: "rgba(0,0,0,.18)", padding: "6px 12px 6px 8px" }}>
      <div aria-hidden="true" style={{ position: "absolute", top: 6, bottom: 6, right: 3, width: 4, borderRadius: 2, background: "rgba(255,255,255,.06)" }}>
        {bar && <div style={{ position: "absolute", left: 0, right: 0, top: `${bar.top}%`, height: `${bar.size}%`, borderRadius: 2, background: "rgba(255,255,255,.45)" }} />}
      </div>
      <Focusable ref={list} className="dsh-list" onScroll={updateBar} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        {!snapshot || snapshot.items.length === 0
          ? <div style={{ color: colors.muted, fontSize: 13 }}>{t("chatEmpty")}</div>
          : blocks(snapshot.items).map(block => block.type === "work"
            ? <WorkBlock key={block.index} t={t} block={block} live={busy && block.last}
              open={open[block.index] ?? (busy && block.last)} onToggle={() => setOpen(previous => ({ ...previous, [block.index]: !(previous[block.index] ?? (busy && block.last)) }))} />
            : <Item key={block.index} t={t} item={block.item} items={snapshot.items}
              onAnswer={allow => { if (current && block.item.kind === "permission") void chatAnswer(current, block.item.request, allow).then(() => refresh(current)); }} />)}
        {busy && <div style={{ color: colors.accentText, fontSize: 13 }}>{t("chatThinking")}</div>}
        {error && <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div>}
      </Focusable>
    </div>

    <div className="dsh-composer" style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {files.length > 0 && <Focusable flow-children="horizontal" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {files.map(path => <DialogButton key={path} className="dsh-btn" aria-label={t("removeFile", { name: basename(path) })}
          onClick={() => setFiles(previous => previous.filter(entry => entry !== path))}
          style={{ width: "auto", minWidth: 0, height: 24, padding: "0 8px", fontSize: 12, background: colors.button }}>{basename(path)} ✕</DialogButton>)}
      </Focusable>}
      {textInput && modelLine && <div style={{ ...mono, textAlign: "right", fontSize: 11, color: colors.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{modelLine}</div>}
      <Focusable flow-children="horizontal" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* The two small buttons sit close together, apart from the talk button. */}
        <div style={{ display: "flex", flexShrink: 0 }}>
          <IconButton label={t("add")} onClick={() => setMenu("add")} height={40}><path d="M12 5v14M5 12h14" /></IconButton>
          <IconButton label={full ? t("permissionLabelFull") : t("permissionLabelAsk")} onClick={() => setMenu("permission")} height={40} color={full ? colors.warning : colors.soft}>
            {full ? ICONS.ban : ICONS.hand}
          </IconButton>
        </div>
        {busy
          ? <div role="status" style={{ flex: 1, minWidth: 0, height: 40, boxSizing: "border-box", borderRadius: 20, background: "rgba(255,255,255,.06)", padding: "0 5px 0 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.muted }}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pending ? t("chatWaiting") : t("chatRunning")} · {clock}</span>
            {!pending && <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: colors.soft }}><Glyph letter="Y" /> {t("chatStop")}</span>}
            <RoundButton label={t("chatStop")} background={colors.danger} color={colors.text} size={30} onClick={stop}>
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
            </RoundButton>
          </div>
          : textInput
            ? <>
              <div style={{ flex: 1, minWidth: 0, border: "1px solid rgba(255,255,255,.14)", borderRadius: 4, background: "rgba(0,0,0,.35)", padding: "4px 8px" }}>
                <TextField {...{ placeholder: t("chatPlaceholder") }} value={draft} onChange={event => setDraft(event.currentTarget.value)} />
              </div>
              {draft.trim() || files.length
                ? <RoundButton label={t("chatSend")} background={colors.soft} color="#0e141b" onClick={() => { void send(); }}><path d="M12 19V5M6 11l6-6 6 6" /></RoundButton>
                : <RoundButton label={t("voiceTalk")} background={colors.soft} color="#0e141b" onClick={talk}>{ICONS.mic}</RoundButton>}
            </>
            : <DialogButton className="dsh-pill" onClick={talk}
              style={{ flex: "0 0 auto", width: "auto", minWidth: 0, height: 40, padding: "0 18px", borderRadius: 20, background: colors.soft, color: "#0e141b", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap" }}>
              <Icon size={17}>{ICONS.mic}</Icon>{t("voiceBefore")}<Glyph letter="X" dark size={18} />{t("voiceAfter")}
            </DialogButton>}
        {/* Voice mode keeps the model on the button row; the shorter talk button leaves it room. */}
        {!textInput && modelLine && <div style={{ ...mono, flex: busy ? "0 0 auto" : 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 11, lineHeight: 1.3, color: colors.dim, whiteSpace: "nowrap" }}>
          {model && <span>{model}</span>}
          {contextUsed && <span>{contextUsed}</span>}
        </div>}
      </Focusable>
    </div>
    {menu && <Popover entries={menu === "session" ? sessionItems() : menu === "history" ? historyItems() : menu === "permission" ? permissionItems() : addItems()}
      position={menu === "session" || menu === "history" ? { top: 36 } : { bottom: 84 }} onClose={close} />}
  </Focusable>;
}

type MenuEntry = "-" | { label: string; desc?: string; icon?: ReactNode; selected?: boolean; disabled?: boolean; danger?: boolean; onSelect?: () => void };

/**
 * A menu drawn inside the panel, as in the design. Steam's own context menus
 * open in Big Picture's window and close the Quick Access menu.
 */
function Popover({ entries, position, onClose }: { entries: MenuEntry[]; position: CSSProperties; onClose: () => void }) {
  let first = true;
  return <>
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 9 }} />
    <Focusable onCancelButton={onClose} style={{ position: "absolute", left: 14, right: 14, ...position, zIndex: 10, background: "#1f2126", border: "1px solid rgba(255,255,255,.08)", borderRadius: 4, boxShadow: "0 16px 40px rgba(0,0,0,.6)", padding: 4, display: "flex", flexDirection: "column", maxHeight: "70%", overflowY: "auto" }}>
      {entries.map((entry, index) => {
        if (entry === "-") return <div key={index} style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "3px 0" }} />;
        const focus = first && !entry.disabled;
        if (focus) first = false;
        return <DialogButton key={index} className="dsh-item" disabled={entry.disabled} focusable={!entry.disabled}
          {...(focus ? { autoFocus: true, preferredFocus: true } : {})}
          onClick={() => { onClose(); entry.onSelect?.(); }}
          style={{ width: "100%", minWidth: 0, minHeight: 34, padding: "4px 8px", background: "transparent", textAlign: "left", display: "flex", alignItems: "center", gap: 8, fontSize: 14, opacity: entry.disabled ? 0.45 : 1, color: entry.danger ? "#ff9b9b" : colors.text }}>
          {entry.icon && <Icon size={16}>{entry.icon}</Icon>}
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label}</span>
            {entry.desc && <span style={{ fontSize: 11, color: colors.muted, whiteSpace: "normal" }}>{entry.desc}</span>}
          </span>
          {entry.selected && <Icon size={15} color={colors.accent}><path d="m5 12 5 5 9-10" /></Icon>}
        </DialogButton>;
      })}
    </Focusable>
  </>;
}

const ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  star: <path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  hand: <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.5V11a1.5 1.5 0 0 1 3 0v3" />,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
  camera: <><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M8 6l1.5-2h5L16 6" /></>,
  plug: <path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
};

function basename(path: string) { return path.split("/").pop() || path; }

/** "deepseek-v4-flash" → "v4-flash": the provider is always DeepSeek here. */
function shortModel(name: string) { return name.replace(/^deepseek-/, ""); }

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Fall back below. */ }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function Icon({ size = 18, color, children }: { size?: number; color?: string; children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>{children}</svg>;
}

function IconButton({ label, onClick, height = 32, color, children }: { label: string; onClick: (target: EventTarget | null) => void; height?: number; color?: string; children: ReactNode }) {
  return <DialogButton className="dsh-btn" aria-label={label} onClick={event => onClick(event.currentTarget)}
    style={{ width: 32, minWidth: 32, height, padding: 0, background: "transparent", color: color ?? colors.soft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <Icon size={17}>{children}</Icon>
  </DialogButton>;
}

/** A controller button as Steam draws it: a light disc with the letter. */
function Glyph({ letter, dark, size = 15 }: { letter: string; dark?: boolean; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.6), fontWeight: 700, background: dark ? "#0e141b" : "#dcdedf", color: dark ? "#dcdedf" : "#0e141b" }}>{letter}</span>;
}

function RoundButton({ label, background, color, disabled, size = 40, onClick, children }: { label: string; background: string; color: string; disabled?: boolean; size?: number; onClick: () => void; children: ReactNode }) {
  return <DialogButton className="dsh-round" aria-label={label} disabled={disabled} onClick={onClick}
    style={{ width: size, minWidth: size, height: size, padding: 0, borderRadius: "50%", background, color, opacity: disabled ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <Icon size={16}>{children}</Icon>
  </DialogButton>;
}

type Block =
  | { type: "item"; index: number; item: ChatItem }
  | { type: "work"; index: number; tools: Tool[]; thoughts: string[]; last: boolean };

/** Runs of tool calls and thoughts fold into one "ran N commands" line, as in the design. */
function blocks(items: ChatItem[]): Block[] {
  const result: Block[] = [];
  items.forEach((item, index) => {
    if (item.kind === "tool" || item.kind === "thought") {
      const previous = result[result.length - 1];
      const work = previous?.type === "work" ? previous : { type: "work" as const, index, tools: [], thoughts: [], last: false };
      if (work !== previous) result.push(work);
      if (item.kind === "tool") work.tools.push(item); else work.thoughts.push(item.text);
    } else {
      result.push({ type: "item", index, item });
    }
  });
  const lastWork = [...result].reverse().find(block => block.type === "work");
  if (lastWork?.type === "work") lastWork.last = result[result.length - 1] === lastWork
    || result.slice(result.indexOf(lastWork) + 1).every(block => block.type === "item" && block.item.kind === "permission");
  return result;
}

function WorkBlock({ t, block, live, open, onToggle }: { t: T; block: Extract<Block, { type: "work" }>; live: boolean; open: boolean; onToggle: () => void }) {
  const failed = block.tools.some(tool => tool.status === "failed");
  const label = block.tools.length ? t("chatRanCommands", { count: String(block.tools.length) }) : t("chatThought");
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <DialogButton className="dsh-btn" onClick={onToggle}
      style={{ width: "auto", minWidth: 0, alignSelf: "flex-start", height: 26, padding: "0 6px", background: "transparent", color: failed ? colors.danger : colors.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
      <Icon size={14}><path d="m4 7 5 5-5 5M12 19h8" /></Icon>{label}
      <Icon size={13}>{open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 6 6 6-6 6" />}</Icon>
    </DialogButton>
    {open && <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 6 }}>
      {block.thoughts.map((text, index) => <div key={`t${index}`} style={{ fontSize: 12, color: colors.dim, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: live ? undefined : 54, overflow: "hidden" }}>{text}</div>)}
      {block.tools.map(tool => <ToolRow key={tool.id} tool={tool} />)}
    </div>}
  </div>;
}

function ToolRow({ tool }: { tool: Tool }) {
  const running = tool.status !== "completed" && tool.status !== "failed";
  const style: CSSProperties = { ...mono, fontSize: 12, color: colors.muted, display: "flex", gap: 6, overflowWrap: "anywhere" };
  return <Focusable className="dsh-msg" onActivate={() => undefined} style={style}>
    <span style={{ color: tool.status === "failed" ? colors.danger : running ? colors.warning : colors.success, flexShrink: 0 }}>{running ? "…" : tool.status === "failed" ? "✗" : "✓"}</span>
    <span><span style={{ color: colors.soft }}>{tool.title}</span> {tool.input}</span>
  </Focusable>;
}

function Item({ t, item, items, onAnswer }: { t: T; item: ChatItem; items: ChatItem[]; onAnswer: (allow: boolean) => void }) {
  switch (item.kind) {
    case "user":
      return <Focusable className="dsh-msg" onActivate={() => undefined} style={{ alignSelf: "flex-end", maxWidth: "88%", background: "rgba(26,159,255,.18)", border: "1px solid rgba(124,196,255,.25)", borderRadius: 10, padding: "6px 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {item.text}
        {item.files?.length ? <div style={{ fontSize: 12, color: colors.accentText }}>{item.files.join(" · ")}</div> : null}
      </Focusable>;
    case "assistant":
      return <div style={{ fontSize: 14, lineHeight: 1.6 }}><Markdown text={item.text} focusable /></div>;
    case "permission": {
      const tool = items.find((entry): entry is Tool => entry.kind === "tool" && entry.id === item.tool);
      if (item.state !== "pending") {
        const label = item.state === "allowed" ? t("chatAllowed") : item.state === "rejected" ? t("chatRejected") : t("chatExpired");
        return <div style={{ fontSize: 12, color: colors.muted }}>{t("chatApprove")} · {label}</div>;
      }
      return <div style={{ border: "1px solid rgba(245,185,66,.45)", background: "rgba(245,185,66,.08)", borderRadius: 4, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ color: colors.warning, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon size={15}><path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.5V11a1.5 1.5 0 0 1 3 0v3" /></Icon>
          {t("chatApprove")}
        </div>
        {tool && <code style={{ ...mono, fontSize: 12, background: "rgba(0,0,0,.35)", borderRadius: 3, padding: "4px 6px", color: colors.soft, overflowWrap: "anywhere" }}>{tool.input || tool.title}</code>}
        <Focusable flow-children="horizontal" style={{ display: "flex", gap: 6 }}>
          <DialogButton className="dsh-btn" style={{ flex: 1, minWidth: 0, height: 34, padding: 0, background: colors.soft, color: "#0e141b", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => onAnswer(true)}><Glyph letter="X" dark size={16} />{t("chatAllow")}</DialogButton>
          <DialogButton className="dsh-btn" style={{ flex: 1, minWidth: 0, height: 34, padding: 0, background: colors.button, color: colors.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => onAnswer(false)}><Glyph letter="Y" size={16} />{t("chatReject")}</DialogButton>
        </Focusable>
      </div>;
    }
    case "notice": {
      const key = `chatNotice${capitalize(item.code)}` as Parameters<T>[0];
      const text = t(key, { detail: item.text });
      return <div style={{ fontSize: 12, color: item.code === "error" || item.code === "exited" ? colors.danger : colors.muted, overflowWrap: "anywhere" }}>{text === key ? item.code : text}</div>;
    }
    default:
      return null;
  }
}
