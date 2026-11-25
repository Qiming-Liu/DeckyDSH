import { callable } from "@decky/api";

/** Mirrors Plugin.get_status() in main.py. */
export interface RuntimeStatus {
  dsh: string;
  platform: string;
  supported: boolean;
  reason: "unsupported_cpu" | "old_glibc" | null;
  glibc: string | null;
  required_glibc: string;
  download_size: number | null;
  installed: boolean;
  has_api_key: boolean;
  plugin_version: string;
}

export type InstallPhase = "idle" | "downloading" | "verifying" | "unpacking" | "testing" | "done" | "cancelled" | "error";
export type InstallError = "unsupported_cpu" | "disk_space" | "network" | "checksum" | "extract" | "smoke" | "unexpected";

/** Mirrors installer.Installer.snapshot(). */
export interface InstallState {
  phase: InstallPhase;
  done: number;
  total: number;
  error: InstallError | null;
}

export type KeyCheck = "ok" | "invalid" | "network";
export type Permission = "workspace-write" | "danger-full-access";

/** Mirrors settings.DEFAULTS. */
export interface Settings {
  default_permission: Permission;
  workspace: string;
  risk_accepted: boolean;
  show_text_input: boolean;
  /** Show the words while still recording; off waits until X is pressed again. */
  live_voice_text: boolean;
}

export const getStatus = callable<[], RuntimeStatus>("get_status");
export const startInstall = callable<[], InstallState>("start_install");
export const cancelInstall = callable<[], void>("cancel_install");
export const getInstallState = callable<[], InstallState>("get_install_state");
export const checkApiKey = callable<[key: string], KeyCheck>("check_api_key");
export const saveApiKey = callable<[key: string], boolean>("save_api_key");
export const getSettings = callable<[], Settings>("get_settings");
export const saveSettings = callable<[changes: Partial<Settings>], Settings>("save_settings");

/** Chat RPCs answer `{ok, value}` or a refusal the frontend translates. */
export type ChatResult<T> = { ok: true; value: T } | { ok: false; error: string; detail: string };

export interface ChatMeta {
  id: string;
  title: string;
  cwd: string;
  created: number;
  updated: number;
  busy?: boolean;
  starred?: boolean;
  archived?: boolean;
  preset?: Permission;
  model?: string;
}

/** One entry of a chat transcript; mirrors the items in py_modules/chat.py. */
export type ChatItem =
  | { kind: "user"; text: string; files?: string[] }
  | { kind: "assistant" | "thought"; id: string | null; text: string }
  | { kind: "tool"; id: string; title: string; input: string; status: string; output: string; background?: boolean }
  | { kind: "permission"; request: string; tool: string | null; state: "pending" | "allowed" | "rejected" | "cancelled" }
  | { kind: "notice"; code: string; text: string };

export type ChatSnapshot =
  | { version: number; unchanged: true }
  | { version: number; unchanged?: false; busy: boolean; title: string; items: ChatItem[]; usage: { used: number; size: number } | null; model: string; preset: Permission; starred: boolean };

export const chatList = callable<[], ChatResult<ChatMeta[]>>("chat_list");
export const chatNew = callable<[], ChatResult<ChatMeta>>("chat_new");
export const chatSnapshot = callable<[sessionId: string, version: number], ChatResult<ChatSnapshot>>("chat_snapshot");
export const chatSend = callable<[sessionId: string, text: string, files: string[]], ChatResult<{ version: number }>>("chat_send");
export const chatUpdate = callable<[sessionId: string, changes: { title?: string; starred?: boolean; archived?: boolean }], ChatResult<ChatMeta>>("chat_update");
export const chatDelete = callable<[sessionId: string], ChatResult<null>>("chat_delete");
export const chatCancel = callable<[sessionId: string], ChatResult<null>>("chat_cancel");
export const chatAnswer = callable<[sessionId: string, requestId: string, allow: boolean], ChatResult<null>>("chat_answer");

/** Mirrors main.Plugin.voice_status(). */
export interface VoiceStatus {
  supported: boolean;
  installed: boolean;
  download_size: number | null;
  recording: boolean;
}

/** Longest recording; the backend stops pw-record itself at the same limit (voice.MAX_SECONDS). */
export const VOICE_MAX_SECONDS = 120;
export const voiceStatus = callable<[], VoiceStatus>("voice_status");
export const voiceInstallStart = callable<[], InstallState>("voice_install_start");
export const voiceInstallCancel = callable<[], void>("voice_install_cancel");
export const voiceInstallState = callable<[], InstallState>("voice_install_state");
/** Voice RPCs answer like the chat ones; `error` is a VoiceError code. */
export const voiceStart = callable<[], ChatResult<null>>("voice_start");
/** Ends the recording and resolves to what was said ("" for silence). */
export const voiceStop = callable<[], ChatResult<string>>("voice_stop");
/** What has been said so far, while still recording ("" before any speech). */
export const voicePreview = callable<[], ChatResult<string>>("voice_preview");
export const voiceCancel = callable<[], void>("voice_cancel");

export interface LogLine { time: string; level: string; message: string }
/** The newest log entries, oldest first. */
export const getLog = callable<[limit?: number], LogLine[]>("get_log");
export const clearLog = callable<[], void>("clear_log");
/** Where the export folder picker opens: ~/Downloads, or home without it. */
export const getLogExportDirectory = callable<[], string>("get_log_export_directory");
/** Writes the whole log into `directory` and resolves to the file, with ~ for home. */
export const exportLog = callable<[directory: string], string>("export_log");
