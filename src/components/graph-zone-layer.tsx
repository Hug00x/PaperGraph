"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { isValidZoneBounds, getZoneForNodePosition, moveZoneMembers, resizeZone, zonesOverlap,
  ZONE_COLORS, ZONE_CONFIG, type GraphZone, type Positions, type ZoneBounds, type ZoneColor } from "@/lib/graph-zones";

import { GraphZoneDrawing } from "@/components/graph-zone-drawing";

type Props = {
  zones: GraphZone[]; positions: Positions;
  selectedId: string | null; onSelect: (id: string | null) => void;
  viewport: { x: number; y: number; scale: number }; size: { width: number; height: number };
  canEdit: boolean; isEnglish: boolean; candidateId: string | null;
  creating: boolean; onFinishDrawing: () => void; onOpenNotes: (id: string) => void;
  onPreview: (zones: GraphZone[] | null, positions: Positions | null) => void;
  onCommit: (zones: GraphZone[], positions: Positions) => void;
};
type Gesture = { zone: GraphZone; zones: GraphZone[]; positions: Positions; clientX: number; clientY: number;
  scale: number; corner: string | null; nextZone: GraphZone; nextPositions: Positions; invalid: boolean };
const colorNames = {
  en: ["Red", "Orange", "Amber", "Green", "Teal", "Blue", "Violet", "Pink"],
  pt: ["Vermelho", "Laranja", "Âmbar", "Verde", "Verde-azulado", "Azul", "Violeta", "Rosa"],
};
const controlClass = "rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40";

export function GraphZoneLayer(props: Props) {
  const { zones, positions, selectedId, onSelect, viewport, size, canEdit, isEnglish, candidateId,
    onPreview, onCommit, creating, onFinishDrawing, onOpenNotes } = props;
  const [dialog, setDialog] = useState<{ id: string | null; delete?: boolean } | null>(null);
  const [drawnBounds, setDrawnBounds] = useState<ZoneBounds | null>(null);
  const suppressClick = useRef(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ZoneColor>("teal");
  const [error, setError] = useState("");
  const [invalidId, setInvalidId] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    if (!dialog) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>("input, button")?.focus();
    return () => triggerRef.current?.focus();
  }, [dialog]);

  function open(zone?: GraphZone, remove = false) {
    setError(""); setName(zone?.name ?? ""); setColor(zone?.color ?? "teal");
    setDialog({ id: zone?.id ?? null, delete: remove });
  }
  function submit() {
    if (!canEdit || !dialog) return;
    if (dialog.delete) {
      onCommit(zones.filter((z) => z.id !== dialog.id), positions); onSelect(null); setDialog(null); return;
    }
    if (!name.trim()) return;
    if (dialog.id) {
      onCommit(zones.map((z) => z.id === dialog.id ? { ...z, name: name.trim(), color } : z), positions);
    } else {
      if (!drawnBounds || !isValidZoneBounds(drawnBounds) || zones.some((z) => zonesOverlap(z, drawnBounds))) {
        setError(isEnglish ? "This area overlaps another zone. Cancel and draw a free area." : "Esta ?rea sobrep?e outra zona. Cancela e desenha numa ?rea livre."); return;
      }
      const zone = { ...drawnBounds, id: crypto.randomUUID(), name: name.trim(), color, notes: "" };
      onCommit([...zones, zone], positions); onSelect(zone.id);
    }
    setDialog(null);
  }
  function begin(event: ReactPointerEvent<HTMLButtonElement>, zone: GraphZone, corner: string | null) {
    if (event.button !== 0) return;
    event.stopPropagation(); onSelect(zone.id); suppressClick.current = false;
    if (!canEdit) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { zone: { ...zone }, zones: zones.map((item) => ({ ...item })), positions: { ...positions }, clientX: event.clientX, clientY: event.clientY, scale: viewport.scale,
      corner, nextZone: { ...zone }, nextPositions: { ...positions }, invalid: false };
  }
  function calculate(clientX: number, clientY: number) {
    const g = gesture.current; if (!g) return;
    let dx = (clientX - g.clientX) / (30 * g.scale), dy = (clientY - g.clientY) / (30 * g.scale);
    if (!g.corner) {
      const members = Object.values(g.positions).filter((p) => getZoneForNodePosition(p, g.zones)?.id === g.zone.id);
      dx = Math.max(-g.zone.x, ...members.map((p) => 2 - p.x), Math.min(dx, 100 - g.zone.x - g.zone.width, ...members.map((p) => 98 - p.x)));
      dy = Math.max(-g.zone.y, ...members.map((p) => 2 - p.y), Math.min(dy, 100 - g.zone.y - g.zone.height, ...members.map((p) => 98 - p.y)));
    }
    g.nextZone = { ...g.zone, ...(g.corner ? resizeZone(g.zone, g.corner, dx, dy) : { x: g.zone.x + dx, y: g.zone.y + dy }) };
    g.nextPositions = g.corner ? g.positions : moveZoneMembers(g.zone, g.zones, g.positions, dx, dy);
    g.invalid = g.zones.some((z) => z.id !== g.zone.id && zonesOverlap(z, g.nextZone));
  }
  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!gesture.current) return;
    calculate(event.clientX, event.clientY);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const g = gesture.current; if (!g) return;
      setInvalidId(g.invalid ? g.zone.id : null);
      onPreview(g.zones.map((z) => z.id === g.zone.id ? g.nextZone : z), g.nextPositions);
    });
  }
  function end(event: ReactPointerEvent<HTMLButtonElement>, cancel = false) {
    const g = gesture.current; if (!g) return;
    calculate(event.clientX, event.clientY);
    suppressClick.current = cancel || Math.hypot(event.clientX - g.clientX, event.clientY - g.clientY) > 4;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; gesture.current = null; setInvalidId(null); onPreview(null, null);
    if (!cancel && !g.invalid && canEdit && (g.nextZone.x !== g.zone.x || g.nextZone.y !== g.zone.y || g.nextZone.width !== g.zone.width || g.nextZone.height !== g.zone.height)) {
      onCommit(g.zones.map((z) => z.id === g.zone.id ? g.nextZone : z), g.nextPositions); setError("");
    } else if (g.invalid) setError(isEnglish ? "Zones cannot overlap. The move was cancelled." : "As zonas não podem sobrepor-se. O movimento foi cancelado.");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const displayedZones = zones;
  return <>
    {creating && canEdit && <GraphZoneDrawing viewport={viewport} size={size} zones={zones} isEnglish={isEnglish}
      onCancel={onFinishDrawing} onComplete={(bounds) => { setDrawnBounds(bounds); onFinishDrawing(); open(); }} />}

    <div data-graph-control className="absolute bottom-4 left-[22rem] z-50 flex max-w-[calc(100%-23rem)] flex-wrap items-center gap-2">
      {error && !dialog && <p role="status" className="max-w-xs rounded-lg bg-[var(--surface-strong)] p-2 text-xs text-[var(--foreground)]">{error}</p>}
    </div>
    {/* eslint-disable-next-line react-hooks/refs -- Gesture refs are accessed only inside the event handlers below, never during rendering. */}
    {displayedZones.map((zone) => {
      const selected = selectedId === zone.id;
      const count = Object.values(positions).filter((p) => getZoneForNodePosition(p, zones)?.id === zone.id).length;
      const left = size.width / 2 + viewport.x + (zone.x * 30 - 1500) * viewport.scale;
      const top = size.height / 2 + viewport.y + (zone.y * 30 - 1500) * viewport.scale;
      return <div key={zone.id} data-zone-id={zone.id} data-zone-color={zone.color}
        className={`papergraph-zone pointer-events-none absolute z-[1] rounded-2xl border ${selected ? "is-selected" : ""} ${candidateId === zone.id ? "is-candidate" : ""} ${invalidId === zone.id ? "is-invalid" : ""}`}
        style={{ left, top, width: zone.width * 30 * viewport.scale, height: zone.height * 30 * viewport.scale }}>
        <div className="pointer-events-auto absolute left-2 right-2 top-2 flex items-center gap-1" data-graph-control>
          <button type="button" aria-label={`${zone.name}: ${count} ${isEnglish ? "papers. Drag to move zone." : "artigos. Arrasta para mover a zona."}`}
            aria-pressed={selected} title={zone.name} className="min-w-0 flex-1 cursor-grab truncate rounded-md px-2 py-1 text-left font-semibold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:cursor-grabbing"
            style={{ fontSize: Math.max(10, Math.min(14, 13 * viewport.scale)), touchAction: "none" }}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(zone.id); onOpenNotes(zone.id); }}
            onPointerDown={(e) => begin(e, zone, null)} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)}
            onLostPointerCapture={(e) => end(e, true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onSelect(null);
              if (!canEdit || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              const step = e.shiftKey ? 1 : 0.2;
              const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
              const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
              const next = { ...zone, x: zone.x + dx, y: zone.y + dy };
              const moved = moveZoneMembers(zone, zones, positions, dx, dy);
              if (next.x >= 0 && next.y >= 0 && next.x + next.width <= 100 && next.y + next.height <= 100 &&
                Object.values(moved).every((p) => p.x >= 2 && p.x <= 98 && p.y >= 2 && p.y <= 98) && !zones.some((z) => z.id !== zone.id && zonesOverlap(z, next)))
                onCommit(zones.map((z) => z.id === zone.id ? next : z), moved);
            }}>{zone.name} <span className="font-normal opacity-60">· {count}</span></button>
          {selected && canEdit && <button type="button" className={controlClass} aria-label={isEnglish ? "Edit zone" : "Editar zona"} onClick={() => open(zone)}>···</button>}
        </div>
        {selected && canEdit && ["nw", "ne", "sw", "se"].map((corner) => <button key={corner} type="button" data-graph-control
          aria-label={`${isEnglish ? "Resize zone" : "Redimensionar zona"} ${corner}`} className="papergraph-zone-handle pointer-events-auto absolute h-4 w-4 rounded border-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ [corner.includes("n") ? "top" : "bottom"]: -6, [corner.includes("w") ? "left" : "right"]: -6, cursor: `${corner}-resize`, touchAction: "none" }}
          onPointerDown={(e) => begin(e, zone, corner)} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)}
          onLostPointerCapture={(e) => end(e, true)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const step = e.shiftKey ? 1 : 0.2;
            const next = { ...zone, ...resizeZone(zone, corner, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0) };
            if (!zones.some((z) => z.id !== zone.id && zonesOverlap(z, next))) onCommit(zones.map((z) => z.id === zone.id ? next : z), positions);
          }} />)}
      </div>;
    })}
    {dialog && createPortal(<div data-graph-control className="papergraph-app papergraph-graph-pane fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.4)" }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="zone-dialog-title"
        className="papergraph-graph-dialog w-full max-w-sm rounded-3xl border border-[var(--border)] p-5 shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); setDialog(null); }
          if (e.key === "Tab") {
            const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])];
            const first = elements[0], last = elements[elements.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
        <h2 id="zone-dialog-title" className="text-lg font-semibold text-[var(--foreground)]">{dialog.delete ? isEnglish ? "Delete zone?" : "Apagar zona?" : dialog.id ? isEnglish ? "Edit zone" : "Editar zona" : isEnglish ? "Create zone" : "Criar zona"}</h2>
        {dialog.delete ? <p className="my-4 text-sm text-[var(--muted)]">{isEnglish ? "Papers and their links will be kept." : "Os artigos e as suas ligações serão mantidos."}</p> : <>
          <label className="mt-4 block text-sm text-[var(--muted)]">{isEnglish ? "Name" : "Nome"}<input value={name} maxLength={ZONE_CONFIG.maxName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] outline-[var(--accent)]" /></label>
          <fieldset className="mt-4"><legend className="mb-2 text-sm text-[var(--muted)]">{isEnglish ? "Color" : "Cor"}</legend><div className="flex flex-wrap gap-2">{ZONE_COLORS.map((choice, i) => <button type="button" key={choice} data-zone-color={choice} aria-label={colorNames[isEnglish ? "en" : "pt"][i]} aria-pressed={color === choice} onClick={() => setColor(choice)} className={`papergraph-zone-swatch h-7 w-7 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${color === choice ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--surface)]" : ""}`} />)}</div></fieldset>

        </>}
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {dialog.id && !dialog.delete && <button type="button" className={controlClass} onClick={() => setDialog({ ...dialog, delete: true })}>{isEnglish ? "Delete zone" : "Apagar zona"}</button>}
          <button type="button" className={controlClass} onClick={() => setDialog(null)}>{isEnglish ? "Cancel" : "Cancelar"}</button>
          <button type="button" className={controlClass} disabled={!canEdit || (!dialog.delete && !name.trim())} onClick={submit}>{dialog.delete ? isEnglish ? "Delete" : "Apagar" : dialog.id ? isEnglish ? "Save" : "Guardar" : isEnglish ? "Create" : "Criar"}</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}
