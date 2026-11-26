import { ReactNode } from "react";

// Outline icons on a 24px grid, sized and coloured by the caller.

interface IconProps { size?: number; color?: string }

function icon(paths: ReactNode, width = 2) {
  return ({ size = 18, color = "currentColor" }: IconProps) =>
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" style={{ flex: "0 0 auto" }}
      fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>;
}

export const SlidersIcon = icon(<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />);
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>);
export const ChevronRightIcon = icon(<path d="M9 5l7 7-7 7" />, 2.2);
export const KeyboardIcon = icon(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
export const HandIcon = icon(<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.5V11a1.5 1.5 0 0 1 3 0v3" />);
export const BanIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>);
export const ShieldIcon = icon(<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />);
export const KeyIcon = icon(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></>);
export const FolderIcon = icon(<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />);
export const ChipIcon = icon(<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>);
export const GithubIcon = icon(<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1-.3-3.3 1.3a11.4 11.4 0 00-6 0C7 2.8 6 3.1 6 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004.6 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />);
export const BilibiliIcon = icon(<><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M8 3l3 3M16 3l-3 3M9 12v2M15 12v2" /></>);

/** The plugin's glyph: a speech bubble with a sound wave, in the current colour. */
export function PluginGlyph({ size = "1em" }: { size?: number | string }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 10v4M12 8.5v7M15 10v4" />
  </svg>;
}

/** The plugin's mark: the glyph on a dark tile, as in the project avatar. */
export function PluginMark({ size = 40 }: { size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, flex: "0 0 auto", borderRadius: size / 5, background: "#1b2838", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#7cc4ff" }}>
    <PluginGlyph size={size * 0.6} />
  </span>;
}
export const MicIcon = icon(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const WaveIcon = icon(<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2" />);
export const DownloadIcon = icon(<path d="M12 4v12M7 11l5 5 5-5M4 20h16" />, 2.2);
export const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const CheckIcon = icon(<path d="M5 12.5l4.5 4.5L19 7.5" />, 2.4);
export const GlobeIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></>);
export const LockIcon = icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const PackageIcon = icon(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>);
export const TerminalIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></>);
export const RestartIcon = icon(<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />);
export const PhoneIcon =icon(<><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>);
export const FlagIcon =icon(<path d="M5 21V4M5 4h11l-2 4 2 4H5" />);
