"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { getDrawnZoneBounds, isValidZoneBounds, zonesOverlap, type GraphZone, type ZoneBounds } from "@/lib/graph-zones";

export function GraphZoneDrawing({ viewport, size, zones, isEnglish, onComplete, onCancel }: {
  viewport: { x: number; y: number; scale: number }; size: { width: number; height: number }; zones: GraphZone[];
  isEnglish: boolean; onComplete: (bounds: ZoneBounds) => void; onCancel: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState<ZoneBounds | null>(null);
  const [error, setError] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef<ZoneBounds | null>(null);
  useEffect(() => { surface.current?.focus(); return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }; }, []);
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left - size.width / 2 - viewport.x) / viewport.scale + 1500) / 30,
      y: ((event.clientY - rect.top - size.height / 2 - viewport.y) / viewport.scale + 1500) / 30 };
  }
  const invalid = bounds && (!isValidZoneBounds(bounds) || zones.some((z) => zonesOverlap(z, bounds)));
  return <div ref={surface} data-graph-control data-zone-drawing tabIndex={-1}
    className="absolute inset-0 z-[60] cursor-crosshair outline-none" style={{ touchAction: "none" }}
    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
    onWheel={(e) => e.stopPropagation()}
    onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); setError(""); start.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => {
      if (!start.current) return;
      latest.current = getDrawnZoneBounds(start.current, point(e));
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setBounds(latest.current); });
    }}
    onPointerUp={(e) => {
      if (!start.current) return;
      const result = getDrawnZoneBounds(start.current, point(e)); start.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setBounds(null);
      if (!isValidZoneBounds(result)) { setError(isEnglish ? "Draw a larger area." : "Desenha uma área maior."); return; }
      if (zones.some((z) => zonesOverlap(z, result))) { setError(isEnglish ? "Zones cannot overlap. Draw in a free area." : "As zonas não podem sobrepor-se. Desenha numa área livre."); return; }
      onComplete(result);
    }}
    onPointerCancel={() => { start.current = null; onCancel(); }}>
    <div className="pointer-events-auto absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-xs text-[var(--foreground)]" onPointerDown={(e) => e.stopPropagation()}>
      <span role="status">{error || (isEnglish ? "Drag to draw a zone, then release." : "Arrasta para desenhar uma zona e larga o rato.")}</span>
      <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-[var(--accent)] focus-visible:outline-2">{isEnglish ? "Cancel" : "Cancelar"}</button>
    </div>
    {bounds && <div className="pointer-events-none absolute rounded-2xl border-2 border-dashed" style={{
      left: size.width / 2 + viewport.x + (bounds.x * 30 - 1500) * viewport.scale,
      top: size.height / 2 + viewport.y + (bounds.y * 30 - 1500) * viewport.scale,
      width: bounds.width * 30 * viewport.scale, height: bounds.height * 30 * viewport.scale,
      borderColor: invalid ? "#ef4444" : "var(--accent)", background: "var(--accent-soft)",
    }} />}
  </div>;
}
