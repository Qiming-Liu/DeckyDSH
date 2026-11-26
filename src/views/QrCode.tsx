import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code as one SVG path, drawn locally. */
export default function QrCode({ text, label, size }: { text: string; label: string; size: number }) {
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
  return <div role="img" aria-label={label} style={{ padding: 8, borderRadius: 4, background: "#fff", lineHeight: 0, flex: "0 0 auto" }}>
    <svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" aria-hidden="true"><path d={path} fill="#0e141b" /></svg>
  </div>;
}
