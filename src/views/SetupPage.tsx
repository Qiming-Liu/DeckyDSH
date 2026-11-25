import { DialogButton, Focusable, Navigation, TextField, ToggleField } from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useState } from "react";
import {
  cancelInstall, checkApiKey, getInstallState, getSettings, getStatus, InstallState, KeyCheck, Permission,
  RuntimeStatus, saveApiKey, saveSettings, Settings, startInstall,
} from "../utils/backend";
import { megabytes } from "../utils/format";
import { PLUGIN_NAME, useT } from "../utils/i18n";
import { buttonStyle, colors, FOCUS_CSS, FOOTER, mono, STATUS_BAR } from "../utils/theme";

type Step = "download" | "key" | "safety" | "done";
type T = ReturnType<typeof useT>;
const STEPS: Step[] = ["download", "key", "safety", "done"];
const RUNNING = new Set(["downloading", "verifying", "unpacking", "testing"]);
const POLL_MS = 500;
// bIsPassword alone leaves the key readable on screen; the input type hides it.
const PASSWORD = { type: "password" } as object;

function firstStep(status: RuntimeStatus): Step {
  if (!status.installed) return "download";
  return status.has_api_key ? "safety" : "key";
}

/** The full-screen first-run wizard: runtime, API key, approval defaults. */
export default function SetupPage() {
  const t = useT();
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [step, setStep] = useState<Step>("download");

  const refresh = async (advance: boolean) => {
    const next = await getStatus();
    setStatus(next);
    if (advance) setStep(firstStep(next));
    return next;
  };
  useEffect(() => { void refresh(true); }, []);

  return <div style={{
    height: "100%", boxSizing: "border-box", paddingTop: STATUS_BAR, display: "flex",
    background: "linear-gradient(180deg, #0e141b 0%, #151c24 100%)", color: colors.text,
  }}>
    <style>{FOCUS_CSS}</style>
    <StepList t={t} step={step} status={status} />
    <div style={{ flex: 1, minWidth: 0, padding: `26px 36px ${FOOTER + 16}px`, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
      {!status ? <div>{t("checking")}</div>
        : step === "download" ? <DownloadStep t={t} status={status} onDone={async () => { await refresh(false); setStep("key"); }} />
        : step === "key" ? <KeyStep t={t} hasKey={status.has_api_key} onBack={() => setStep("download")}
          onNext={async () => { await refresh(false); setStep("safety"); }} />
        : step === "safety" ? <SafetyStep t={t} onBack={() => setStep("key")} onNext={() => setStep("done")} />
        : <DoneStep t={t} status={status} />}
    </div>
  </div>;
}

function StepList({ t, step, status }: { t: T; step: Step; status: RuntimeStatus | null }) {
  const labels: Record<Step, string> = { download: t("stepDownload"), key: t("stepKey"), safety: t("stepSafety"), done: t("stepDone") };
  const current = STEPS.indexOf(step);
  return <div style={{ width: 296, flexShrink: 0, background: "rgba(0,0,0,.18)", paddingTop: 22 }}>
    <div style={{ padding: "0 32px", fontSize: 14, color: colors.muted }}>{PLUGIN_NAME}</div>
    <div style={{ padding: "0 32px", marginTop: 4, fontSize: 24, fontWeight: 700 }}>{t("setupPageTitle")}</div>
    <div style={{ padding: "0 32px", fontSize: 14, color: colors.muted }}>{t("setupDuration")}</div>
    <ol style={{ listStyle: "none", margin: "22px 0 0", padding: 0 }}>
      {STEPS.map((id, index) => {
        const active = index === current && step !== "done";
        // A skipped key step is not done; the runtime and key are checked, not assumed.
        const done = id === "download" ? !!status?.installed : id === "key" ? !!status?.has_api_key
          : index < current || step === "done";
        return <li key={id} style={{
          height: 52, display: "flex", alignItems: "center", gap: 16, fontSize: 19,
          paddingLeft: active ? 29 : 32, borderLeft: active ? `3px solid ${colors.accent}` : "none",
          background: active ? "linear-gradient(90deg, rgba(26,159,255,.32), rgba(26,159,255,0))" : "transparent",
          color: active || done ? colors.text : colors.muted,
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: "50%", boxSizing: "border-box", fontSize: 13, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px solid ${done || active ? colors.accent : colors.dim}`,
            background: done ? colors.accent : "transparent", color: done ? "#0e141b" : active ? colors.accentText : colors.muted,
          }}>{done ? "✓" : index + 1}</span>{labels[id]}
        </li>;
      })}
    </ol>
  </div>;
}

const h1: CSSProperties = { margin: 0, fontSize: 28, fontWeight: 700 };
const lead: CSSProperties = { margin: 0, color: colors.muted, maxWidth: 820 };
const rowStyle: CSSProperties = { minHeight: 48, background: colors.row, padding: "6px 18px", display: "flex", alignItems: "center", gap: 12 };

function Row({ label, value, color, desc }: { label: string; value?: ReactNode; color?: string; desc?: string }) {
  return <div style={rowStyle}>
    <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <span>{label}</span>{desc && <span style={{ fontSize: 13, color: colors.muted }}>{desc}</span>}
    </span>
    {value !== undefined && <span style={{ ...mono, fontSize: 14, color: color ?? colors.soft }}>{value}</span>}
  </div>;
}

/** Step title with its actions on the right, so they never scroll under Steam's footer. */
function Header({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 900 }}>
    <h1 style={{ ...h1, flex: 1, minWidth: 0 }}>{title}</h1>
    <Focusable flow-children="horizontal" style={{ display: "flex", gap: 10, flexShrink: 0 }}>{children}</Focusable>
  </div>;
}

function Button({ primary, onClick, disabled, children }: { primary?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <DialogButton className="dsh-btn" style={buttonStyle(primary)} disabled={disabled} onClick={onClick}>{children}</DialogButton>;
}

function DownloadStep({ t, status, onDone }: { t: T; status: RuntimeStatus; onDone: () => void }) {
  const [state, setState] = useState<InstallState | null>(null);
  const running = state !== null && RUNNING.has(state.phase);

  useEffect(() => { void getInstallState().then(setState); }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void getInstallState().then(setState); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => { if (state?.phase === "done") onDone(); }, [state?.phase]);

  const size = megabytes(status.download_size ?? 0);
  const total = megabytes(state?.total || status.download_size || 0);
  const done = megabytes(state?.done ?? 0);
  const percent = state?.total ? Math.min(100, Math.round(state.done / state.total * 100)) : 0;
  const phaseText = !state || state.phase === "idle" ? t("phaseIdle")
    : state.phase === "downloading" ? t("phaseDownloading", { done, total })
    : state.phase === "verifying" ? t("phaseVerifying")
    : state.phase === "unpacking" ? t("phaseUnpacking")
    : state.phase === "testing" ? t("phaseTesting")
    : state.phase === "done" ? t("phaseDone")
    : state.phase === "cancelled" ? t("phaseCancelled", { done, total })
    : t(`error${capitalize(state.error ?? "unexpected")}` as Parameters<T>[0], { size: megabytes((status.download_size ?? 0) * 3) });

  return <>
    <Header title={t("downloadTitle")}>
      {running
        ? <Button onClick={() => { void cancelInstall(); }}>{t("pause")}</Button>
        : <Button primary onClick={() => { void startInstall().then(setState); }}>
          {state?.phase === "error" || state?.phase === "cancelled" ? t("retry") : t("download")}
        </Button>}
    </Header>
    <p style={lead}>{t("downloadBody")}</p>
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ margin: "4px 0 4px 4px", fontSize: 14, color: colors.muted }}>{t("checksTitle")}</div>
      <Row label={t("checkCpu")} value={status.platform} />
      <Row label={t("checkGlibc", { required: status.required_glibc })} value={status.glibc ?? "?"} />
      <Row label={t("checkSize")} value={size} />
    </div>
    <div style={{ maxWidth: 900, boxSizing: "border-box", background: colors.card, border: "1px solid rgba(124,196,255,.25)", borderRadius: 4, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>deepseek-harness-runtime · {status.platform}</span>
        <span style={{ ...mono, fontSize: 13, color: colors.muted }}>{status.dsh}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,.35)", overflow: "hidden" }}>
        <div style={{ width: `${state?.phase === "done" ? 100 : percent}%`, height: 8, background: colors.accent }} />
      </div>
      <div style={{ fontSize: 14, color: state?.phase === "error" ? colors.danger : colors.accentText }}>{phaseText}</div>
    </div>
      </>;
}

function capitalize(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

function KeyStep({ t, hasKey, onBack, onNext }: { t: T; hasKey: boolean; onBack: () => void; onNext: () => void }) {
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
    <Header title={t("keyTitle")}>
      <Button primary disabled={!key.trim() || result === "checking"} onClick={() => { void submit(); }}>{t("keyCheck")}</Button>
      <Button onClick={onNext}>{t("keyLater")}</Button>
      <Button onClick={onBack}>{t("back")}</Button>
    </Header>
    <p style={lead}>{t("keyBody")}</p>
    <div style={{ maxWidth: 900 }}>
      <TextField label={t("keyLabel")} bIsPassword spellCheck={false} {...PASSWORD} value={key} onChange={event => { setKey(event.currentTarget.value); setResult(null); }} />
    </div>
    <div style={{ maxWidth: 900, fontSize: 15, color }}>{message}</div>
      </>;
}

function SafetyStep({ t, onBack, onNext }: { t: T; onBack: () => void; onNext: () => void }) {
  const [values, setValues] = useState<Settings | null>(null);
  const [permission, setPermission] = useState<Permission>("danger-full-access");
  const [accepted, setAccepted] = useState(false);
  const [uploadLog, setUploadLog] = useState(false);

  useEffect(() => {
    void getSettings().then(loaded => {
      setValues(loaded);
      setAccepted(loaded.risk_accepted);
      setUploadLog(loaded.upload_session_log);
      if (loaded.risk_accepted) setPermission(loaded.default_permission);
    });
  }, []);

  const save = async () => {
    await saveSettings({ default_permission: permission, risk_accepted: accepted, upload_session_log: uploadLog });
    onNext();
  };
  const option = (id: Permission, title: string, desc: string) => {
    const selected = permission === id;
    const tint = id === "danger-full-access" ? colors.warning : colors.accent;
    return <DialogButton key={id} className="dsh-row" onClick={() => setPermission(id)} style={{
      minHeight: 60, padding: "8px 18px", textAlign: "left", display: "flex", alignItems: "center", gap: 14,
      border: `1px solid ${selected ? tint : "transparent"}`, background: selected ? "rgba(255,255,255,.06)" : colors.row,
    }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", boxSizing: "border-box", border: `2px solid ${selected ? tint : colors.dim}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <span style={{ width: 10, height: 10, borderRadius: "50%", background: tint }} />}
      </span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 17, color: selected ? tint : colors.text }}>{title}</span>
        <span style={{ fontSize: 13, color: colors.muted }}>{desc}</span>
      </span>
    </DialogButton>;
  };

  return <>
    <Header title={t("safetyTitle")}>
      <Button primary disabled={!values || (permission === "danger-full-access" && !accepted)} onClick={() => { void save(); }}>{t("next")}</Button>
      <Button onClick={onBack}>{t("back")}</Button>
    </Header>
    <div style={{ maxWidth: 900, boxSizing: "border-box", border: "1px solid rgba(245,185,66,.45)", background: "rgba(245,185,66,.08)", borderRadius: 4, padding: "12px 16px", color: colors.warning, fontSize: 15 }}>{t("safetyWarning")}</div>
    <div style={{ margin: "4px 0 0 4px", fontSize: 14, color: colors.muted }}>{t("safetyDefault")}</div>
    <Focusable style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      {option("workspace-write", t("permissionAsk"), t("permissionAskDesc"))}
      {option("danger-full-access", t("permissionFull"), t("permissionFullDesc"))}
    </Focusable>
    <div style={{ maxWidth: 900 }}>
      {permission === "danger-full-access" && <ToggleField label={t("riskConfirm")} checked={accepted} onChange={setAccepted} />}
      <ToggleField label={t("uploadLog")} description={t("uploadLogDesc")} checked={uploadLog} onChange={setUploadLog} />
    </div>
    {values && <div style={{ maxWidth: 900 }}><Row label={t("workspace")} value={values.workspace} /></div>}
      </>;
}

function DoneStep({ t, status }: { t: T; status: RuntimeStatus }) {
  const [values, setValues] = useState<Settings | null>(null);
  useEffect(() => { void getSettings().then(setValues); }, []);
  const full = values?.default_permission === "danger-full-access";
  return <>
    <Header title={t("doneTitle")}>
      <Button primary onClick={() => Navigation.NavigateBack()}>{t("finish")}</Button>
    </Header>
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      <Row label={t("doneRuntime")} value={status.installed ? `${status.dsh}` : t("notSet")} color={status.installed ? colors.success : colors.warning} />
      <Row label={t("doneKey")} value={status.has_api_key ? t("saved") : t("notSet")} color={status.has_api_key ? colors.success : colors.warning} />
      {values && <Row label={t("donePermission")} value={full ? t("permissionFull") : t("permissionAsk")} color={full ? colors.warning : colors.soft} />}
      {values && <Row label={t("doneWorkspace")} value={values.workspace} />}
    </div>
      </>;
}
