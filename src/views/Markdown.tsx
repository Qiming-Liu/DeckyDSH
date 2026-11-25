import { Focusable } from "@decky/ui";
import { ReactNode } from "react";
import { colors, mono } from "../utils/theme";

// A small Markdown subset for model replies: fenced code, headings, lists,
// paragraphs, inline code and bold. Built as React elements, never HTML.

const codeChip = { ...mono, fontSize: "0.9em", background: "rgba(255,255,255,.08)", borderRadius: 3, padding: "0 4px" };

/** `code` and **bold** inside one line. */
export function inline(text: string, key = 0): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let index = key * 1000;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const token = match[0];
    parts.push(token.startsWith("`")
      ? <code key={index++} style={codeChip}>{token.slice(1, -1)}</code>
      : <strong key={index++}>{token.slice(2, -2)}</strong>);
    last = at + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type Block =
  | { type: "code"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

export function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push({ type: "heading", text: heading[1] }); continue; }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "list" && previous.ordered === ordered) previous.items.push(item[3]);
      else blocks.push({ type: "list", ordered, items: [item[3]] });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** With `focusable`, every block is its own gamepad focus stop, so the D-pad scrolls through long replies. */
export default function Markdown({ text, focusable }: { text: string; focusable?: boolean }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {parse(text).map((block, index) => focusable
      ? <Focusable key={index} className="dsh-msg" onActivate={() => undefined}>{renderBlock(block, index)}</Focusable>
      : renderBlock(block, index))}
  </div>;
}

function renderBlock(block: Block, index: number) {
  switch (block.type) {
    case "code":
      return <pre key={index} style={{ ...mono, fontSize: 12, margin: 0, padding: "6px 8px", borderRadius: 3, background: "rgba(0,0,0,.35)", color: colors.soft, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{block.text}</pre>;
    case "heading":
      return <div key={index} style={{ fontWeight: 700 }}>{inline(block.text, index)}</div>;
    case "list":
      return <div key={index} style={{ display: "flex", flexDirection: "column", gap: 2, color: colors.soft }}>
        {block.items.map((entry, n) => <div key={n} style={{ display: "flex", gap: 6 }}>
          <span style={{ flexShrink: 0 }}>{block.ordered ? `${n + 1}.` : "•"}</span>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{inline(entry, index * 100 + n)}</span>
        </div>)}
      </div>;
    default:
      return <div key={index} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{inline(block.text, index)}</div>;
  }
}
