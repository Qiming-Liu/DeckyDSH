import type { CSSProperties } from "react";

export const colors = {
  text: "#ffffff", soft: "#dcdedf", muted: "#8b929a", dim: "#6b7480",
  accent: "#1a9fff", accentText: "#7cc4ff", success: "#8ee06f", warning: "#f5b942", danger: "#e35b5b",
  row: "rgba(255,255,255,.04)", button: "#3d4450", card: "#1b2838", line: "rgba(255,255,255,.08)",
} as const;

export const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, Consolas, monospace" };

// Big Picture draws its 40 px status bar and its button-hint footer over routed pages.
export const STATUS_BAR = 40;
export const FOOTER = 44;

// Inline backgrounds hide Steam's focus colour, so buttons and rows that set one
// get their own focus style.
export const FOCUS_CSS = `
.dsh-btn.gpfocus { background: #dcdedf !important; color: #0e141b !important; }
.dsh-row.gpfocus, .dsh-row.gpfocuswithin { background: rgba(255,255,255,.1) !important; }
`;

export const buttonStyle = (primary = false): CSSProperties => ({
  width: "auto", minWidth: 0, height: 44, padding: "0 22px", fontSize: 16,
  background: primary ? colors.soft : colors.button, color: primary ? "#0e141b" : colors.text,
});

// The settings page marks its root with [data-dsh-root], so these rules touch no other Steam page.
export const PAGE_CSS = `
[data-dsh-root] { background: linear-gradient(180deg, #0e141b 0%, #151c24 100%) !important; }
[data-dsh-root] > .PageListColumn { background: rgba(0,0,0,.18) !important; }
[data-dsh-root] > .DialogContentTransition { background: transparent !important; }
[data-dsh-root] .DialogContent:has([data-dsh-about]) { overflow-y: hidden !important; padding-bottom: 0 !important; }
.DialogContent.dsh-dialog { width: 640px; max-width: 100%; box-sizing: border-box; padding: 28px 32px 24px !important; border-radius: 6px; background: #1f2126 !important; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
`;
