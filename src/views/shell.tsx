import { DialogButton, Focusable } from "@decky/ui";
import type { CSSProperties, ReactNode } from "react";
import { colors } from "../utils/theme";

// Building blocks of the full-screen settings page: one row style, one
// section heading and the page's buttons.

export const buttonBase: CSSProperties = {
  width: "auto", minWidth: 0, height: 40, padding: "0 16px", fontSize: 14, whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
};

/** A button; `selected` paints it light, as Steam does for the current choice. */
export function Button({ selected, style, ...props }: Parameters<typeof DialogButton>[0] & { selected?: boolean }) {
  return <DialogButton {...props} className="dsh-btn"
    style={{ ...buttonBase, background: selected ? colors.soft : colors.button, color: selected ? "#0e141b" : colors.text, ...style }} />;
}

/** A square icon-only button. */
export function IconButton({ label, style, children, ...props }: Parameters<typeof DialogButton>[0] & { label: string }) {
  return <DialogButton {...props} aria-label={label} className="dsh-btn" style={{
    width: 40, minWidth: 40, height: 40, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: colors.button, color: colors.text, ...style,
  }}>{children}</DialogButton>;
}

/** A section's small heading; `top` overrides the space above it. */
export function SectionTitle({ children, first, top }: { children: ReactNode; first?: boolean; top?: number }) {
  return <div style={{ fontSize: 12, color: colors.muted, fontWeight: 500, padding: `${top ?? (first ? 2 : 16)}px 4px 6px` }}>{children}</div>;
}

/**
 * One list row: icon, title and description, then its controls. A pressable row
 * keeps its text in its own focusable part, because a controller cannot move
 * from a focused element into its children.
 */
export function Row({ icon, title, description, children, aside, onActivate }: {
  icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode; aside?: ReactNode; onActivate?: () => void;
}) {
  const main = <>
    {icon && <span aria-hidden style={{ display: "inline-flex", flex: "0 0 auto", color: colors.muted }}>{icon}</span>}
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 16, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: colors.muted, overflowWrap: "anywhere" }}>{description}</div>}
    </div>
    {aside}
  </>;
  const mainStyle: CSSProperties = { flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 14, padding: "clamp(4px, 1.2vh, 11px) 14px" };
  return <Focusable flow-children="row" className="dsh-row" style={{ borderTop: `1px solid ${colors.line}`, borderRadius: 3, display: "flex", alignItems: "center", gap: 14, paddingRight: children ? 14 : 0 }}>
    {onActivate ? <Focusable onActivate={onActivate} style={mainStyle}>{main}</Focusable> : <div style={mainStyle}>{main}</div>}
    {children && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>{children}</Focusable>}
  </Focusable>;
}

/** Rows end with a line under the last one. */
export const RowGroup = ({ children }: { children: ReactNode }) =>
  <div style={{ borderBottom: `1px solid ${colors.line}` }}>{children}</div>;
