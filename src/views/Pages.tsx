import { Focusable, ModalRoot, Navigation, showModal, SidebarNavigation, Toggle } from "@decky/ui";
import qrcode from "qrcode-generator";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AUTHOR_AVATAR } from "../data/avatar";
import { getSettings, getStatus, Permission, RuntimeStatus, saveSettings, Settings } from "../utils/backend";
import { getLanguage, PLUGIN_NAME, useT } from "../utils/i18n";
import { SETUP_ROUTE } from "../utils/routes";
import { colors, FOCUS_CSS, FOOTER, mono, PAGE_CSS, STATUS_BAR } from "../utils/theme";
import {
  BanIcon, BilibiliIcon, ChevronRightIcon, ChipIcon, FolderIcon, GitlabIcon, HandIcon, InfoIcon, KeyboardIcon, KeyIcon,
  PluginMark, ShieldIcon, SlidersIcon, UploadIcon,
} from "./icons";
import LogPanel from "./LogPanel";
import { Button, IconButton, Row, RowGroup, SectionTitle } from "./shell";

type T = ReturnType<typeof useT>;

const AUTHOR = "ProSS及时行乐";
const BILIBILI_URL = "https://space.bilibili.com/23706122";
const REPOSITORY_URL = "https://gitlab.com/alan-liu/DeckyDSH";
const DSH_URL = "https://github.com/deepseek-ai/deepseek-harness";
const DECKY_URL = "https://github.com/SteamDeckHomebrew/decky-loader";

function openExternal(url: string) {
  Navigation.NavigateToExternalWeb(url);
  Navigation.CloseSideMenus();
}

/** The one full-screen page besides setup: every setting the plugin has. */
export function SettingsPage() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
    void getStatus().then(setStatus);
  }, []);

  // Marks the page's root so PAGE_CSS applies here and nowhere else. An
  // attribute, not a class: Steam rewrites the root's class list. Steam may
  // attach the sidebar title before the sidebar is in the document, so look a
  // few times.
  const marked = useRef(new Set<Element>());
  const titleRef = useCallback((title: HTMLDivElement | null) => {
    if (!title) return;
    let attempts = 0;
    const mark = () => {
      const root = title.isConnected ? title.closest(".PageListColumn")?.parentElement : undefined;
      if (root) { root.setAttribute("data-dsh-root", ""); marked.current.add(root); }
      else if (++attempts < 30) (title.ownerDocument.defaultView || window).setTimeout(mark, 50);
    };
    mark();
  }, []);
  useEffect(() => () => {
    marked.current.forEach(root => root.removeAttribute("data-dsh-root"));
    marked.current.clear();
  }, []);

  const change = async (changes: Partial<Settings>) => setSettings(await saveSettings(changes));

  const title = <div ref={titleRef} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <span style={{ fontSize: 12, fontWeight: 400, color: colors.muted, letterSpacing: .5 }}>{PLUGIN_NAME}</span>
    <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25, color: colors.text }}>{t("settings")}</span>
  </div>;

  return <div style={{ paddingTop: STATUS_BAR, paddingBottom: FOOTER, height: "100%", boxSizing: "border-box" }}>
    <style>{FOCUS_CSS + PAGE_CSS}</style>
    <SidebarNavigation title={title as unknown as string} showTitle pages={[
      { identifier: "general", title: t("settingsGeneral"), hideTitle: true, icon: <SlidersIcon />,
        content: settings ? <General t={t} settings={settings} status={status} onChange={change} /> : null },
      { identifier: "about", title: t("settingsAbout"), hideTitle: true, icon: <InfoIcon />, content: <About t={t} status={status} /> },
    ]} />
  </div>;
}

function General({ t, settings, status, onChange }: { t: T; settings: Settings; status: RuntimeStatus | null; onChange: (changes: Partial<Settings>) => void }) {
  const choose = (preset: Permission) => {
    // Skipping every approval needs the same acknowledgement as in setup.
    if (preset === "danger-full-access" && !settings.risk_accepted) { Navigation.Navigate(SETUP_ROUTE); return; }
    onChange({ default_permission: preset });
  };
  const option = (preset: Permission, label: string, icon: ReactNode) =>
    <Button selected={settings.default_permission === preset} onClick={() => choose(preset)}>{icon}{label}</Button>;
  return <div style={{ padding: "0 8px 16px 0" }}>
    <SectionTitle first>{t("sectionInput")}</SectionTitle>
    <RowGroup>
      <Row icon={<KeyboardIcon />} title={t("settingTextInput")} description={t("settingTextInputDesc")}>
        <Toggle value={settings.show_text_input} onChange={value => onChange({ show_text_input: value })} />
      </Row>
    </RowGroup>

    <SectionTitle>{t("sectionApproval")}</SectionTitle>
    <RowGroup>
      <Row icon={<ShieldIcon />} title={t("settingApproval")}>
        {option("workspace-write", t("permissionLabelAsk"), <HandIcon size={16} />)}
        {option("danger-full-access", t("permissionLabelFull"), <BanIcon size={16} />)}
      </Row>
    </RowGroup>

    <SectionTitle>{t("sectionData")}</SectionTitle>
    <RowGroup>
      <Row icon={<KeyIcon />} title={t("settingKey")}
        description={<span style={{ color: status?.has_api_key ? colors.success : colors.warning }}>{status?.has_api_key ? t("saved") : t("notSet")}</span>}>
        <Button onClick={() => Navigation.Navigate(SETUP_ROUTE)}>{t("settingKeyChange")}</Button>
      </Row>
      <Row icon={<FolderIcon />} title={t("workspace")} description={<span style={mono}>{settings.workspace}</span>} />
      <Row icon={<UploadIcon />} title={t("uploadLog")} description={t("uploadLogDesc")}>
        <Toggle value={settings.upload_session_log} onChange={value => onChange({ upload_session_log: value })} />
      </Row>
    </RowGroup>
  </div>;
}

/** A new GitLab issue with the details a report needs already filled in. */
function feedbackUrl(version: string, system: string) {
  const body = [`**Version:** ${version || "?"}`, `**System:** ${system || "?"}`, "", "**What happened:**", "", ""].join("\n");
  return `${REPOSITORY_URL}/-/issues/new?${encodeURIComponent("issue[description]")}=${encodeURIComponent(body)}`;
}

/** The QR code as one SVG path, drawn locally. */
function QrCode({ text, label, size }: { text: string; label: string; size: number }) {
  const { count, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text, "Byte");
    code.make();
    const count = code.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row++)
      for (let column = 0; column < count; column++)
        if (code.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
    return { count, path };
  }, [text]);
  return <div role="img" aria-label={label} style={{ padding: 8, borderRadius: 4, background: "#fff", lineHeight: 0 }}>
    <svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" aria-hidden="true"><path d={path} fill="#0e141b" /></svg>
  </div>;
}

function FeedbackModal({ t, url, closeModal }: { t: T; url: string; closeModal?: () => void }) {
  return <ModalRoot closeModal={closeModal} className="dsh-dialog">
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{t("feedbackIssue")}</div>
      <QrCode text={url} label={t("feedbackQr")} size={220} />
      <div style={{ fontSize: 13, color: colors.muted }}>{t("feedbackScan")} · {t("feedbackHint")}</div>
      <Focusable flow-children="row" style={{ display: "flex", gap: 8, paddingTop: 4 }}>
        <Button onClick={() => { openExternal(url); closeModal?.(); }}>{t("openInBrowser")}</Button>
        <Button selected style={{ padding: "0 22px" }} onClick={closeModal}>{t("close")}</Button>
      </Focusable>
    </div>
  </ModalRoot>;
}

function LinkRow({ title, note, url }: { title: string; note?: string; url: string }) {
  return <Row title={title} onActivate={() => openExternal(url)} aside={<>
    {note && <span style={{ flex: "0 0 auto", fontSize: 12, color: colors.muted }}>{note}</span>}
    <ChevronRightIcon size={14} color={colors.muted} />
  </>} />;
}

function About({ t, status }: { t: T; status: RuntimeStatus | null }) {
  const version = status?.plugin_version ?? "";
  const feedback = feedbackUrl(version, status?.platform ?? "");
  // Two columns as one row, so right from the author links reaches the log.
  return <Focusable flow-children="row" style={{ padding: "0 8px 16px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
    <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Focusable flow-children="row" aria-label={AUTHOR} style={{ padding: "8px 12px", borderRadius: 4, background: "rgba(0,0,0,.28)", display: "flex", alignItems: "center", gap: 12 }}>
        <img src={AUTHOR_AVATAR} alt="" width={44} height={44} style={{ flex: "0 0 44px", borderRadius: 22, objectFit: "cover", background: colors.button }} />
        <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 18, fontWeight: 700, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{AUTHOR}</div>
        {getLanguage() !== "en" && <IconButton label={t("bilibili")} onClick={() => openExternal(BILIBILI_URL)}><BilibiliIcon size={16} /></IconButton>}
        <IconButton label="GitLab" onClick={() => openExternal(REPOSITORY_URL)}><GitlabIcon size={16} /></IconButton>
      </Focusable>

      <RowGroup>
        <Row icon={<PluginMark />} title={PLUGIN_NAME} description={t("deckyPlugin")}
          aside={version && <span aria-label={t("aboutVersion")} style={{ fontSize: 12, color: colors.muted }}>v{version}</span>} />
        <Row icon={<ChipIcon size={20} />} title={t("settingRuntime")}
          description={<span style={{ ...mono, color: status?.installed ? colors.success : colors.warning }}>{status ? `${status.dsh} · ${status.platform}` : ""}</span>} />
        <Row title={t("feedback")} description={t("feedbackHint")}>
          <Button onClick={() => showModal(<FeedbackModal t={t} url={feedback} />)}><GitlabIcon size={16} />{t("feedbackIssue")}</Button>
        </Row>
      </RowGroup>

      <SectionTitle top={6}>{t("thanks")}</SectionTitle>
      <RowGroup>
        <LinkRow title="DeepSeek Harness" note="deepseek-ai" url={DSH_URL} />
        <LinkRow title="Decky Loader" note="SteamDeckHomebrew" url={DECKY_URL} />
      </RowGroup>
    </Focusable>

    {/* The log gets the whole right half, down to the button hints. */}
    <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <SectionTitle first>{t("log")}</SectionTitle>
      <LogPanel height="calc(100vh - 190px)" />
    </Focusable>
  </Focusable>;
}
