import { DialogButton, Focusable, Navigation, TextField, ToggleField } from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import {
  cancelInstall, checkApiKey, getInstallState, getSettings, getStatus, InstallState, KeyCheck, Permission,
  RuntimeStatus, saveApiKey, saveSettings, Settings, startInstall, voiceInstallCancel, voiceInstallStart, voiceInstallState,
  keyHandoffStart, keyHandoffState, KeyHandoffState, keyHandoffStop,
} from "../utils/backend";
import { megabytes } from "../utils/format";
import { getLanguage, PLUGIN_NAME, useT } from "../utils/i18n";
import { takeSetupStartOver } from "../utils/routes";
import QrCode from "./QrCode";
import { buttonStyle, colors, FOCUS_CSS, FOOTER, mono, STATUS_BAR } from "../utils/theme";
import {
  BanIcon, CheckIcon, ChipIcon, DownloadIcon, FlagIcon, FolderIcon, GlobeIcon, HandIcon, KeyIcon, LockIcon, MicIcon,
  PackageIcon, PhoneIcon, ShieldIcon, TerminalIcon,
} from "./icons";

type Step = "key" | "download" | "voice" | "safety" | "done";
type T = ReturnType<typeof useT>;
const STEPS: Step[] = ["key", "download", "voice", "safety", "done"];
const RUNNING = new Set(["downloading", "verifying", "unpacking", "testing"]);
const POLL_MS = 500;
// bIsPassword alone leaves the key readable on screen; the input type hides it.
const PASSWORD = { type: "password" } as object;

const STEP_ICONS: Record<Step, typeof KeyIcon> = {
  key: KeyIcon, download: DownloadIcon, voice: MicIcon, safety: ShieldIcon, done: FlagIcon,
};

/** Voice is the only input, so it is required wherever this CPU can run it. */
const voiceReady = (status: RuntimeStatus) => status.voice_installed || !status.voice_supported;

/** The first step after the key that still needs doing. */
function stepAfterKey(status: RuntimeStatus): Step {
  if (!status.installed) return "download";
  return voiceReady(status) ? "safety" : "voice";
}

function firstStep(status: RuntimeStatus): Step {
  return status.has_api_key ? stepAfterKey(status) : "key";
}

/** The full-screen first-run wizard: API key, runtime, speech recognition, approval defaults. */
export default function SetupPage() {
  const t = useT();
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [step, setStep] = useState<Step>("key");
  // Settings' "first-time setup" button starts at the key even when everything is done.
  const [startOver] = useState(takeSetupStartOver);

  const refresh = async (advance: boolean) => {
    const next = await getStatus();
    setStatus(next);
    if (advance) setStep(startOver ? "key" : firstStep(next));
    return next;
  };
  useEffect(() => { void refresh(true); }, []);

  return <div style={{
    height: "100%", boxSizing: "border-box", paddingTop: STATUS_BAR, display: "flex",
    background: "linear-gradient(180deg, #0e141b 0%, #151c24 100%)", color: colors.text,
  }}>
    <style>{FOCUS_CSS}</style>
    <StepList t={t} step={step} status={status} onSelect={setStep} />
    <div style={{ flex: 1, minWidth: 0, padding: `26px 36px ${FOOTER + 16}px`, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
      {!status ? <div>{t("checking")}</div>
        : step === "key" ? <KeyStep t={t} hasKey={status.has_api_key}
          onNext={async () => setStep(stepAfterKey(await refresh(false)))} />
        : step === "download" ? <DownloadStep t={t} status={status} onBack={() => setStep("key")}
          onDone={async () => { await refresh(false); setStep("voice"); }} />
        : step === "voice" ? <VoiceStep t={t} status={status} onBack={() => setStep("download")}
          onDone={async () => { await refresh(false); setStep("safety"); }} />
        : step === "safety" ? <SafetyStep t={t} onBack={() => setStep("voice")} onNext={() => setStep("done")} />
        : <DoneStep t={t} status={status} />}
    </div>
  </div>;
}

/**
 * The steps on the left. Once setup is complete every step can be opened again from
 * here; before that, the finished steps and the first unfinished one can.
 */
function StepList({ t, step, status, onSelect }: { t: T; step: Step; status: RuntimeStatus | null; onSelect: (step: Step) => void }) {
  const labels: Record<Step, string> = { key: t("stepKey"), download: t("stepDownload"), voice: t("stepVoice"), safety: t("stepSafety"), done: t("stepDone") };
  const current = STEPS.indexOf(step);
  const complete = !!status && status.has_api_key && status.installed && voiceReady(status);
  const reachable = status ? (complete ? STEPS.length - 1 : STEPS.indexOf(firstStep(status))) : -1;
  return <div style={{ width: 296, flexShrink: 0, background: "rgba(0,0,0,.18)", paddingTop: 22 }}>
    <div style={{ padding: "0 32px", fontSize: 14, color: colors.muted }}>{PLUGIN_NAME}</div>
    <div style={{ padding: "0 32px", marginTop: 4, fontSize: 24, fontWeight: 700 }}>{t("setupPageTitle")}</div>
    <div style={{ padding: "0 32px", fontSize: 14, color: colors.muted }}>{t("setupDuration")}</div>
    <Focusable flow-children="column" style={{ margin: "22px 0 0", display: "flex", flexDirection: "column" }}>
      {STEPS.map((id, index) => {
        const active = index === current;
        // A skipped key step is not done; the runtime and key are checked, not assumed.
        const done = id === "download" ? !!status?.installed : id === "key" ? !!status?.has_api_key
          : id === "voice" ? !!status && voiceReady(status) : complete ? id === "safety" || step === "done" : index < current;
        const open = index <= reachable;
        const StepIcon = STEP_ICONS[id];
        return <DialogButton key={id} className="dsh-row" disabled={!open} focusable={open} onClick={() => onSelect(id)} style={{
          width: "100%", minWidth: 0, height: 52, padding: 0, borderRadius: 0, textAlign: "left",
          display: "flex", alignItems: "center", gap: 16, fontSize: 19,
          paddingLeft: active ? 29 : 32, borderLeft: active ? `3px solid ${colors.accent}` : "none",
          background: active ? "linear-gradient(90deg, rgba(26,159,255,.32), rgba(26,159,255,0))" : "transparent",
          color: active || done ? colors.text : colors.muted, opacity: 1,
        }}>
          <span style={{
            width: 30, height: 30, borderRadius: "50%", boxSizing: "border-box", flex: "0 0 auto",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px solid ${done || active ? colors.accent : colors.dim}`,
            background: done ? colors.accent : "transparent", color: done ? "#0e141b" : active ? colors.accentText : colors.muted,
          }}>{done ? <CheckIcon size={16} /> : <StepIcon size={15} />}</span>{labels[id]}
        </DialogButton>;
      })}
    </Focusable>
  </div>;
}

/**
 * A download step moves on by itself only when a download finishes while it is open;
 * opened again after installing, it shows Next instead of bouncing forward.
 */
function useFinished(running: boolean, phase: string | undefined, onDone: () => void) {
  const ran = useRef(false);
  useEffect(() => { if (running) ran.current = true; }, [running]);
  useEffect(() => { if (phase === "done" && ran.current) onDone(); }, [phase]);
}

const h1: CSSProperties = { margin: 0, fontSize: 28, fontWeight: 700 };
const lead: CSSProperties = { margin: 0, color: colors.muted, maxWidth: 820 };
const rowStyle: CSSProperties = { minHeight: 48, background: colors.row, padding: "6px 18px", display: "flex", alignItems: "center", gap: 12 };

function Row({ icon, label, value, color, desc }: { icon?: ReactNode; label: string; value?: ReactNode; color?: string; desc?: string }) {
  return <div style={rowStyle}>
    {icon && <span style={{ display: "inline-flex", color: colors.muted }}>{icon}</span>}
    <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <span>{label}</span>{desc && <span style={{ fontSize: 13, color: colors.muted }}>{desc}</span>}
    </span>
    {value !== undefined && <span style={{ ...mono, fontSize: 14, color: color ?? colors.soft }}>{value}</span>}
  </div>;
}

/** Step title with its actions on the right, so they never scroll under Steam's footer. */
function Header({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: 900 }}>
    <span style={{ width: 44, height: 44, flex: "0 0 auto", borderRadius: 10, background: "rgba(26,159,255,.16)", color: colors.accentText, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
    <h1 style={{ ...h1, flex: 1, minWidth: 0 }}>{title}</h1>
    <Focusable flow-children="horizontal" style={{ display: "flex", gap: 10, flexShrink: 0 }}>{children}</Focusable>
  </div>;
}

function Button({ primary, onClick, disabled, children }: { primary?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <DialogButton className="dsh-btn" style={buttonStyle(primary)} disabled={disabled} onClick={onClick}>{children}</DialogButton>;
}

function DownloadStep({ t, status, onBack, onDone }: { t: T; status: RuntimeStatus; onBack: () => void; onDone: () => void }) {
  const [state, setState] = useState<InstallState | null>(null);
  const running = state !== null && RUNNING.has(state.phase);

  useEffect(() => { void getInstallState().then(setState); }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void getInstallState().then(setState); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);
  useFinished(running, state?.phase, onDone);
  const installed = status.installed && !running && state?.phase !== "error";

  const size = megabytes(status.download_size ?? 0);
  const total = megabytes(state?.total || status.download_size || 0);
  const done = megabytes(state?.done ?? 0);
  const percent = state?.total ? Math.min(100, Math.round(state.done / state.total * 100)) : 0;
  const phaseText = installed ? t("phaseDone")
    : !state || state.phase === "idle" ? t("phaseIdle")
    : state.phase === "downloading" ? t("phaseDownloading", { done, total })
    : state.phase === "verifying" ? t("phaseVerifying")
    : state.phase === "unpacking" ? t("phaseUnpacking")
    : state.phase === "testing" ? t("phaseTesting")
    : state.phase === "done" ? t("phaseDone")
    : state.phase === "cancelled" ? t("phaseCancelled", { done, total })
    : t(`error${capitalize(state.error ?? "unexpected")}` as Parameters<T>[0], { size: megabytes((status.download_size ?? 0) * 3) });

  return <>
    <Header icon={<DownloadIcon size={24} />} title={t("downloadTitle")}>
      {running
        ? <Button onClick={() => { void cancelInstall(); }}>{t("pause")}</Button>
        : installed ? <Button primary onClick={onDone}>{t("next")}</Button>
        : <Button primary onClick={() => { void startInstall().then(setState); }}>
          {state?.phase === "error" || state?.phase === "cancelled" ? t("retry") : t("download")}
        </Button>}
      <Button disabled={running} onClick={onBack}>{t("back")}</Button>
    </Header>
    <p style={lead}>{t("downloadBody")}</p>
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ margin: "4px 0 4px 4px", fontSize: 14, color: colors.muted }}>{t("checksTitle")}</div>
      <Row icon={<ChipIcon size={18} />} label={t("checkCpu")} value={status.platform} />
      <Row icon={<TerminalIcon size={18} />} label={t("checkGlibc", { required: status.required_glibc })} value={status.glibc ?? "?"} />
      <Row icon={<PackageIcon size={18} />} label={t("checkSize")} value={size} />
    </div>
    <div style={{ maxWidth: 900, boxSizing: "border-box", background: colors.card, border: "1px solid rgba(124,196,255,.25)", borderRadius: 4, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PackageIcon size={18} color={colors.accentText} />
        <span style={{ fontSize: 18, fontWeight: 700 }}>deepseek-harness-runtime · {status.platform}</span>
        <span style={{ ...mono, fontSize: 13, color: colors.muted }}>{status.dsh}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,.35)", overflow: "hidden" }}>
        <div style={{ width: `${installed || state?.phase === "done" ? 100 : percent}%`, height: 8, background: colors.accent }} />
      </div>
      <div style={{ fontSize: 14, color: state?.phase === "error" ? colors.danger : installed ? colors.success : colors.accentText }}>{phaseText}</div>
    </div>
      </>;
}

/** Required: voice is the only way to talk to dsh. Skipped only where this CPU can't run it. */
function VoiceStep({ t, status, onBack, onDone }: { t: T; status: RuntimeStatus; onBack: () => void; onDone: () => void }) {
  const [state, setState] = useState<InstallState | null>(null);
  const running = state !== null && RUNNING.has(state.phase);

  useEffect(() => { void voiceInstallState().then(setState); }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void voiceInstallState().then(setState); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);
  useFinished(running, state?.phase, onDone);
  const installed = status.voice_installed && !running && state?.phase !== "error";

  if (!status.voice_supported) return <>
    <Header icon={<MicIcon size={24} />} title={t("voiceTitle")}>
      <Button primary onClick={onDone}>{t("next")}</Button>
      <Button onClick={onBack}>{t("back")}</Button>
    </Header>
    <p style={lead}>{t("voiceSetupUnsupported")}</p>
  </>;

  const size = megabytes(status.voice_download_size ?? 0);
  const total = megabytes(state?.total || status.voice_download_size || 0);
  const done = megabytes(state?.done ?? 0);
  const percent = state?.total ? Math.min(100, Math.round(state.done / state.total * 100)) : 0;
  const error = state?.error ?? "unexpected";
  const phaseText = installed ? t("phaseDone")
    : !state || state.phase === "idle" ? t("phaseIdle")
    : state.phase === "downloading" ? t("phaseDownloading", { done, total })
    : state.phase === "verifying" ? t("phaseVerifying")
    : state.phase === "unpacking" ? t("phaseUnpacking")
    : state.phase === "testing" ? t("voicePhaseTesting")
    : state.phase === "done" ? t("phaseDone")
    : state.phase === "cancelled" ? t("phaseCancelled", { done, total })
    : error === "smoke" ? t("voiceErrorSmoke")
    : t(`error${capitalize(error)}` as Parameters<T>[0], { size: megabytes((status.voice_download_size ?? 0) * 2) });

  return <>
    <Header icon={<MicIcon size={24} />} title={t("voiceTitle")}>
      {running
        ? <Button onClick={() => { void voiceInstallCancel(); }}>{t("pause")}</Button>
        : installed ? <Button primary onClick={onDone}>{t("next")}</Button>
        : <Button primary onClick={() => { void voiceInstallStart().then(setState); }}>
          {state?.phase === "error" || state?.phase === "cancelled" ? t("retry") : t("download")}
        </Button>}
      <Button disabled={running} onClick={onBack}>{t("back")}</Button>
    </Header>
    <p style={lead}>{t("voiceBody")}</p>
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      <Row icon={<GlobeIcon size={18} />} label={t("checkLanguages")} value={t("voiceLanguages")} />
      <Row icon={<LockIcon size={18} />} label={t("checkPrivacy")} value={t("voicePrivacy")} />
      <Row icon={<PackageIcon size={18} />} label={t("checkSize")} value={size} />
    </div>
    <div style={{ maxWidth: 900, boxSizing: "border-box", background: colors.card, border: "1px solid rgba(124,196,255,.25)", borderRadius: 4, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <MicIcon size={18} color={colors.accentText} />
        <span style={{ fontSize: 18, fontWeight: 700 }}>{t("voiceCardTitle")}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,.35)", overflow: "hidden" }}>
        <div style={{ width: `${installed || state?.phase === "done" ? 100 : percent}%`, height: 8, background: colors.accent }} />
      </div>
      <div style={{ fontSize: 14, color: state?.phase === "error" ? colors.danger : installed ? colors.success : colors.accentText }}>{phaseText}</div>
    </div>
  </>;
}

function capitalize(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

function KeyStep({ t, hasKey, onNext }: { t: T; hasKey: boolean; onNext: () => void }) {
  const [key, setKey] = useState("");
  const [result, setResult] = useState<KeyCheck | "checking" | null>(null);

  const submit = async () => {
    setResult("checking");
    const check = await checkApiKey(key);
    setResult(check);
    if (check === "ok" && await saveApiKey(key)) onNext();
  };
  const message = result === "checking" ? t("keyChecking") : result === "ok" ? t("keyOk")
    : result === "invalid" ? t("keyInvalid") : result === "network" ? t("keyNetwork") : hasKey ? t("keySaved") : t("keyWhere");
  const color = result === "ok" ? colors.success : result === "invalid" || result === "network" ? colors.danger : colors.muted;

  return <>
    <Header icon={<KeyIcon size={24} />} title={t("keyTitle")}>
      <Button primary disabled={!key.trim() || result === "checking"} onClick={() => { void submit(); }}>{t("keyCheck")}</Button>
      <Button onClick={onNext}>{t("keyLater")}</Button>
    </Header>
    <p style={lead}>{t("keyBody")}</p>
    <PhoneHandoff t={t} onSaved={onNext} />
    <div className="dsh-key-field" style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Steam's field adds a bottom margin that leaves a gap above the message. */}
      <style>{".dsh-key-field .DialogInputLabelGroup { margin-bottom: 0 !important; }"}</style>
      <div style={{ margin: "4px 0 0 4px", fontSize: 14, color: colors.muted }}>{t("keyManual")}</div>
      <TextField label={t("keyLabel")} bIsPassword spellCheck={false} {...PASSWORD} value={key} onChange={event => { setKey(event.currentTarget.value); setResult(null); }} />
      <div style={{ fontSize: 15, color }}>{message}</div>
    </div>
      </>;
}

const HANDOFF_POLL_MS = 1000;

/** A QR code a phone on the same network scans to send the key here, so nobody types it on the handheld. */
function PhoneHandoff({ t, onSaved }: { t: T; onSaved: () => void }) {
  const [state, setState] = useState<KeyHandoffState | null>(null);

  useEffect(() => {
    let live = true;
    void keyHandoffStart(getLanguage()).then(next => { if (live) setState(next); });
    return () => { live = false; void keyHandoffStop(); };
  }, []);
  const waiting = state?.phase === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { void keyHandoffState().then(setState); }, HANDOFF_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  useEffect(() => { if (state?.phase === "saved") onSaved(); }, [state?.phase]);

  const card: CSSProperties = {
    maxWidth: 900, boxSizing: "border-box", background: colors.card, border: "1px solid rgba(124,196,255,.25)",
    borderRadius: 4, padding: "16px 18px", display: "flex", alignItems: "center", gap: 20,
  };
  if (!state) return <div style={card}>{t("checking")}</div>;
  if (state.phase === "unavailable" || state.phase === "off" || !state.url)
    return <div style={{ ...card, color: colors.muted }}><PhoneIcon size={22} />{t("phoneUnavailable")}</div>;
  return <div style={card}>
    <QrCode text={state.url} label={t("phoneQr")} size={150} />
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 700 }}>
        <PhoneIcon size={20} color={colors.accentText} />{t("phoneTitle")}
      </div>
      <div style={{ color: colors.muted, fontSize: 14 }}>{t("phoneBody")}</div>
      <div style={{ ...mono, fontSize: 13, color: colors.soft, overflowWrap: "anywhere" }}>{state.url}</div>
      <div style={{ fontSize: 14, color: colors.accentText }}>{t("phoneWaiting")}</div>
    </div>
  </div>;
}

function SafetyStep({ t, onBack, onNext }: { t: T; onBack: () => void; onNext: () => void }) {
  const [values, setValues] = useState<Settings | null>(null);
  const [permission, setPermission] = useState<Permission>("danger-full-access");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    void getSettings().then(loaded => {
      setValues(loaded);
      setAccepted(loaded.risk_accepted);
      if (loaded.risk_accepted) setPermission(loaded.default_permission);
    });
  }, []);

  const save = async () => {
    await saveSettings({ default_permission: permission, risk_accepted: accepted });
    onNext();
  };
  const option = (id: Permission, title: string, desc: string, Glyph: typeof HandIcon) => {
    const selected = permission === id;
    const tint = id === "danger-full-access" ? colors.warning : colors.accent;
    return <DialogButton key={id} className="dsh-row" onClick={() => setPermission(id)} style={{
      minHeight: 60, padding: "8px 18px", textAlign: "left", display: "flex", alignItems: "center", gap: 14,
      border: `1px solid ${selected ? tint : "transparent"}`, background: selected ? "rgba(255,255,255,.06)" : colors.row,
    }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", boxSizing: "border-box", border: `2px solid ${selected ? tint : colors.dim}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <span style={{ width: 10, height: 10, borderRadius: "50%", background: tint }} />}
      </span>
      <Glyph size={22} color={selected ? tint : colors.muted} />
      <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 17, color: selected ? tint : colors.text }}>{title}</span>
        <span style={{ fontSize: 13, color: colors.muted }}>{desc}</span>
      </span>
    </DialogButton>;
  };

  return <>
    <Header icon={<ShieldIcon size={24} />} title={t("safetyTitle")}>
      <Button primary disabled={!values || (permission === "danger-full-access" && !accepted)} onClick={() => { void save(); }}>{t("next")}</Button>
      <Button onClick={onBack}>{t("back")}</Button>
    </Header>
    <div style={{ maxWidth: 900, boxSizing: "border-box", border: "1px solid rgba(245,185,66,.45)", background: "rgba(245,185,66,.08)", borderRadius: 4, padding: "12px 16px", color: colors.warning, fontSize: 15 }}>{t("safetyWarning")}</div>
    <div style={{ margin: "4px 0 0 4px", fontSize: 14, color: colors.muted }}>{t("safetyDefault")}</div>
    <Focusable style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      {option("workspace-write", t("permissionAsk"), t("permissionAskDesc"), HandIcon)}
      {option("danger-full-access", t("permissionFull"), t("permissionFullDesc"), BanIcon)}
    </Focusable>
    <div style={{ maxWidth: 900 }}>
      {permission === "danger-full-access" && <ToggleField label={t("riskConfirm")} checked={accepted} onChange={setAccepted} />}
    </div>
    {values && <div style={{ maxWidth: 900 }}><Row icon={<FolderIcon size={18} />} label={t("workspace")} value={values.workspace} /></div>}
      </>;
}

function DoneStep({ t, status }: { t: T; status: RuntimeStatus }) {
  const [values, setValues] = useState<Settings | null>(null);
  useEffect(() => { void getSettings().then(setValues); }, []);
  const full = values?.default_permission === "danger-full-access";
  return <>
    <Header icon={<FlagIcon size={24} />} title={t("doneTitle")}>
      <Button primary onClick={() => Navigation.NavigateBack()}>{t("finish")}</Button>
    </Header>
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      <Row icon={<KeyIcon size={18} />} label={t("doneKey")} value={status.has_api_key ? t("saved") : t("notSet")} color={status.has_api_key ? colors.success : colors.warning} />
      <Row icon={<PackageIcon size={18} />} label={t("doneRuntime")} value={status.installed ? `${status.dsh}` : t("notSet")} color={status.installed ? colors.success : colors.warning} />
      {status.voice_supported && <Row icon={<MicIcon size={18} />} label={t("settingVoice")} value={status.voice_installed ? t("phaseDone") : t("notSet")} color={status.voice_installed ? colors.success : colors.warning} />}
      {values && <Row icon={full ? <BanIcon size={18} /> : <HandIcon size={18} />} label={t("donePermission")} value={full ? t("permissionFull") : t("permissionAsk")} color={full ? colors.warning : colors.soft} />}
      {values && <Row icon={<FolderIcon size={18} />} label={t("doneWorkspace")} value={values.workspace} />}
    </div>
      </>;
}
