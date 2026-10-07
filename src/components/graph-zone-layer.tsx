"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { isValidZoneBounds, getZoneForNodePosition, getZonesForNodePosition, moveZoneMembers, resizeZone,
  ZONE_COLORS, ZONE_CONFIG, type GraphZone, type Positions, type ZoneBounds, type ZoneColor } from "@/lib/graph-zones";

import { GraphZoneDrawing } from "@/components/graph-zone-drawing";
import type { ResearchAction } from '../../electron/research-contract.cjs';
import { graphActivityLabel, graphPreview, type GraphActivity, type GraphPeer } from "@/lib/graph-live";

type Props = {
  zones: GraphZone[]; positions: Positions;
  selectedId: string | null; onSelect: (id: string | null) => void;
  viewport: { x: number; y: number; scale: number }; size: { width: number; height: number };
  canEdit: boolean; isEnglish: boolean; candidateId: string | null;
  creating: boolean; onFinishDrawing: () => void; onOpenNotes: (id: string) => void;
  onPreview: (zones: GraphZone[] | null, positions: Positions | null) => void;
  onCommit: (zones: GraphZone[], positions: Positions) => void;
  graphPeers?: GraphPeer[];
  onActivity?: (activity: GraphActivity | null, committed?: boolean) => void;
  onResearch?: (id: string, action: ResearchAction) => void;
};
type Gesture = { zone: GraphZone; zones: GraphZone[]; positions: Positions; clientX: number; clientY: number;
  scale: number; corner: string | null; nextZone: GraphZone; nextPositions: Positions };
const colorNames = {
  en: ["Red", "Orange", "Amber", "Green", "Teal", "Blue", "Violet", "Pink"],
  pt: ["Vermelho", "Laranja", "Âmbar", "Verde", "Verde-azulado", "Azul", "Violeta", "Rosa"],
};
const controlClass = "rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40";

export function GraphZoneLayer(props: Props) {
  const { zones, positions, selectedId, onSelect, viewport, size, canEdit, isEnglish, candidateId,
    onPreview, onCommit, creating, onFinishDrawing, onOpenNotes, graphPeers = [], onActivity } = props;
  const [movingId, setMovingId] = useState<string | null>(null);
  const preview = graphPreview(positions, zones, graphPeers.filter((peer) => peer.activity?.target.id !== movingId));
  const [dialog, setDialog] = useState<{ id: string | null; delete?: boolean } | null>(null);
  const [drawnBounds, setDrawnBounds] = useState<ZoneBounds | null>(null);
  const suppressClick = useRef(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ZoneColor>("teal");
  const [error, setError] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    const dismissForArticle = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-article-id]')) return;
      setDialog(null);
      setError('');
      onActivity?.(null);
    };
    document.addEventListener('contextmenu', dismissForArticle, true);
    return () => document.removeEventListener('contextmenu', dismissForArticle, true);
  }, [onActivity]);
  useEffect(() => {
    if (!dialog) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>("input, button")?.focus();
    return () => triggerRef.current?.focus();
  }, [dialog]);

  function open(zone?: GraphZone, remove = false) {
    setError(""); setName(zone?.name ?? ""); setColor(zone?.color ?? "teal");
    setDialog({ id: zone?.id ?? null, delete: remove });
    if (zone) onActivity?.({ target: { kind: "zone", id: zone.id }, action: "edit" });
  }
  function closeDialog(committed = false) { setDialog(null); onActivity?.(null, committed); }
  function submit() {
    if (!canEdit || !dialog) return;
    if (dialog.delete) {
      onCommit(zones.filter((z) => z.id !== dialog.id), positions); onSelect(null); closeDialog(true); return;
    }
    if (!name.trim()) return;
    if (dialog.id) {
      onCommit(zones.map((z) => z.id === dialog.id ? { ...z, name: name.trim(), color } : z), positions);
    } else {
      if (!drawnBounds || !isValidZoneBounds(drawnBounds)) {
        setError(isEnglish ? "This area is too small or outside the map." : "Esta área é demasiado pequena ou fica fora do mapa."); return;
      }
      const zone = { ...drawnBounds, id: crypto.randomUUID(), name: name.trim(), color, notes: "" };
      onActivity?.({ target: { kind: "zone", id: zone.id }, action: "edit" });
      onCommit([...zones, zone], positions); onSelect(zone.id);
    }
    closeDialog(true);
  }
  function begin(event: ReactPointerEvent<HTMLElement>, zone: GraphZone, corner: string | null) {
    if (event.button !== 0) return;
    event.stopPropagation(); onSelect(zone.id); suppressClick.current = false;
    if (!canEdit) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    setMovingId(zone.id);
    onActivity?.({ target: { kind: "zone", id: zone.id }, action: corner ? "resize" : "move" });
    gesture.current = { zone: { ...zone }, zones: zones.map((item) => ({ ...item })), positions: { ...positions }, clientX: event.clientX, clientY: event.clientY, scale: viewport.scale,
      corner, nextZone: { ...zone }, nextPositions: { ...positions } };
  }
  function calculate(clientX: number, clientY: number) {
    const g = gesture.current; if (!g) return;
    let dx = (clientX - g.clientX) / (30 * g.scale), dy = (clientY - g.clientY) / (30 * g.scale);
    if (!g.corner) {
      const members = Object.values(g.positions).filter((p) => getZonesForNodePosition(p, g.zones).some((candidate) => candidate.id === g.zone.id));
      dx = Math.max(-g.zone.x, ...members.map((p) => 2 - p.x), Math.min(dx, 100 - g.zone.x - g.zone.width, ...members.map((p) => 98 - p.x)));
      dy = Math.max(-g.zone.y, ...members.map((p) => 2 - p.y), Math.min(dy, 100 - g.zone.y - g.zone.height, ...members.map((p) => 98 - p.y)));
    }
    g.nextZone = { ...g.zone, ...(g.corner ? resizeZone(g.zone, g.corner, dx, dy) : { x: g.zone.x + dx, y: g.zone.y + dy }) };
    g.nextPositions = g.corner ? g.positions : moveZoneMembers(g.zone, g.zones, g.positions, dx, dy);
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    if (!gesture.current) return;
    calculate(event.clientX, event.clientY);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const g = gesture.current; if (!g) return;
      onPreview(g.zones.map((z) => z.id === g.zone.id ? g.nextZone : z), g.nextPositions);
      broadcastGesture(g);
    });
  }
  function broadcastGesture(g: Gesture) {
    const changed = Object.fromEntries(Object.entries(g.nextPositions).filter(([id, p]) => p.x !== g.positions[id]?.x || p.y !== g.positions[id]?.y));
    onActivity?.({ target: { kind: "zone", id: g.zone.id }, action: g.corner ? "resize" : "move", zone: { ...g.nextZone, notes: undefined }, positions: changed });
  }
  function end(event: ReactPointerEvent<HTMLElement>, cancel = false) {
    const g = gesture.current; if (!g) return;
    calculate(event.clientX, event.clientY);
    suppressClick.current = cancel || Math.hypot(event.clientX - g.clientX, event.clientY - g.clientY) > 4;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; gesture.current = null; setMovingId(null); onPreview(null, null);
    if (!cancel && canEdit && (g.nextZone.x !== g.zone.x || g.nextZone.y !== g.zone.y || g.nextZone.width !== g.zone.width || g.nextZone.height !== g.zone.height)) {
      broadcastGesture(g);
      onCommit(g.zones.map((z) => z.id === g.zone.id ? g.nextZone : z), g.nextPositions); setError("");
      onActivity?.(null, true);
    } else {
      onActivity?.(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <>
    {creating && canEdit && <GraphZoneDrawing viewport={viewport} size={size} isEnglish={isEnglish}
      onCancel={onFinishDrawing} onComplete={(bounds) => { setDrawnBounds(bounds); onFinishDrawing(); open(); }} />}

    <div data-graph-control className="absolute bottom-4 left-[22rem] z-50 flex max-w-[calc(100%-23rem)] flex-wrap items-center gap-2">
      {error && !dialog && <p role="status" className="max-w-xs rounded-lg bg-[var(--surface-strong)] p-2 text-xs text-[var(--foreground)]">{error}</p>}
    </div>
    {/* eslint-disable-next-line react-hooks/refs -- Gesture refs are accessed only inside the event handlers below, never during rendering. */}
    {zones.map((zone) => {
      const selected = selectedId === zone.id;
      const shown = preview.zones.find((item) => item.id === zone.id) ?? zone;
      const collaborators = graphPeers.filter((peer) => peer.activity?.target.kind === "zone" && peer.activity.target.id === zone.id);
      const count = Object.values(preview.positions).filter((p) => getZoneForNodePosition(p, preview.zones)?.id === zone.id).length;
      const left = size.width / 2 + viewport.x + (shown.x * 30 - 1500) * viewport.scale;
      const top = size.height / 2 + viewport.y + (shown.y * 30 - 1500) * viewport.scale;
      // No stacking context on the wrapper: controls from every zone must sit
      // above every background, while article nodes retain their higher layer.
      return <div key={zone.id} data-zone-id={zone.id} data-zone-color={zone.color}
        className="pointer-events-none absolute"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(zone.id);
          if (canEdit) open(zone);
        }}
        onPointerDown={(event) => {
          if (event.button === 0 && !event.currentTarget.contains(event.target as Node)) return;
          if (event.target instanceof Element && event.target.closest("[data-graph-control]")) return;
          begin(event, zone, null);
        }}
        onPointerMove={move}
        onPointerUp={(event) => end(event)}
        onPointerCancel={(event) => end(event, true)}
        onLostPointerCapture={(event) => end(event, true)}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-graph-control]")) return;
          if (suppressClick.current) { suppressClick.current = false; return; }
          onSelect(zone.id);
        }}
        style={{ left, top, width: shown.width * 30 * viewport.scale, height: shown.height * 30 * viewport.scale }}>
        <div data-zone-background className={`papergraph-zone pointer-events-auto absolute inset-0 z-[1] rounded-2xl border ${selected ? "is-selected" : ""} ${candidateId === zone.id ? "is-candidate" : ""}`} />
        {collaborators.length > 0 && <span data-graph-presence className="pointer-events-none absolute -top-7 left-2 z-[22] max-w-xs truncate rounded-lg border border-[var(--accent)] bg-[var(--surface-strong)] px-2 py-1 text-[10px] text-[var(--accent)]">
          {collaborators.map((peer) => graphActivityLabel(peer, isEnglish)).join(", ")}
        </span>}
        <div className={`pointer-events-none absolute left-2 right-2 top-2 flex items-center gap-1 ${selected ? "z-[21]" : "z-20"}`} data-graph-control>
          <button type="button" aria-label={`${zone.name}: ${count} ${isEnglish ? "papers. Drag to move group." : "artigos. Arrasta para mover o grupo."}`}
            aria-pressed={selected} title={zone.name} className="pointer-events-auto min-w-0 flex-1 cursor-grab truncate rounded-md px-2 py-1 text-left font-semibold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:cursor-grabbing"
            style={{ fontSize: Math.max(10, Math.min(14, 13 * viewport.scale)), touchAction: "none" }}
            onClick={() => { if (!suppressClick.current) onSelect(zone.id); else suppressClick.current = false; }}
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
                Object.values(moved).every((p) => p.x >= 2 && p.x <= 98 && p.y >= 2 && p.y <= 98)) {
                const changed = Object.fromEntries(Object.entries(moved).filter(([id, p]) => p.x !== positions[id]?.x || p.y !== positions[id]?.y));
                onActivity?.({ target: { kind: "zone", id: zone.id }, action: "move", zone: { ...next, notes: undefined }, positions: changed });
                onCommit(zones.map((z) => z.id === zone.id ? next : z), moved);
                onActivity?.(null, true);
              }
            }}>{zone.name} <span className="font-normal opacity-60">· {count}</span></button>
          {selected && <button type="button" className={`pointer-events-auto ${controlClass}`} aria-label={isEnglish ? "Open group notes" : "Abrir notas do grupo"} title={isEnglish ? "Open group notes" : "Abrir notas do grupo"} onClick={() => onOpenNotes(zone.id)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
          </button>}
          {selected && count > 0 && props.onResearch && <button type="button" data-graph-control className="pointer-events-auto papergraph-ask-button"
            onClick={() => props.onResearch?.(zone.id, 'question')}>{isEnglish ? 'Ask Papergraph' : 'Perguntar a Papergraph'}</button>}
        </div>
        {selected && canEdit && ["nw", "ne", "sw", "se"].map((corner) => <button key={corner} type="button" data-graph-control
          aria-label={`${isEnglish ? "Resize group" : "Redimensionar grupo"} ${corner}`} className="papergraph-zone-handle pointer-events-auto absolute z-[21] h-4 w-4 rounded border-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ [corner.includes("n") ? "top" : "bottom"]: -6, [corner.includes("w") ? "left" : "right"]: -6, cursor: `${corner}-resize`, touchAction: "none" }}
          onPointerDown={(e) => begin(e, zone, corner)} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)}
          onLostPointerCapture={(e) => end(e, true)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const step = e.shiftKey ? 1 : 0.2;
            const next = { ...zone, ...resizeZone(zone, corner, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0) };
            onActivity?.({ target: { kind: "zone", id: zone.id }, action: "resize", zone: { ...next, notes: undefined } });
            onCommit(zones.map((z) => z.id === zone.id ? next : z), positions);
            onActivity?.(null, true);
          }} />)}
      </div>;
    })}
    {dialog && createPortal(<div data-graph-control className="papergraph-app papergraph-graph-pane fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.4)" }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="zone-dialog-title"
        className="papergraph-graph-dialog w-full max-w-sm rounded-3xl border border-[var(--border)] p-5 shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); closeDialog(); }
          if (e.key === "Tab") {
            const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])];
            const first = elements[0], last = elements[elements.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
        <h2 id="zone-dialog-title" className="text-lg font-semibold text-[var(--foreground)]">{dialog.delete ? isEnglish ? "Delete group?" : "Apagar grupo?" : dialog.id ? isEnglish ? "Edit group" : "Editar grupo" : isEnglish ? "Create group" : "Criar grupo"}</h2>
        {dialog.delete ? <p className="my-4 text-sm text-[var(--muted)]">{isEnglish ? "Papers and their links will be kept." : "Os artigos e as suas ligações serão mantidos."}</p> : <>
          <label className="mt-4 block text-sm text-[var(--muted)]">{isEnglish ? "Name" : "Nome"}<input value={name} maxLength={ZONE_CONFIG.maxName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] outline-[var(--accent)]" /></label>
          <fieldset className="mt-4"><legend className="mb-2 text-sm text-[var(--muted)]">{isEnglish ? "Color" : "Cor"}</legend><div className="flex flex-wrap gap-2">{ZONE_COLORS.map((choice, i) => <button type="button" key={choice} data-zone-color={choice} aria-label={colorNames[isEnglish ? "en" : "pt"][i]} aria-pressed={color === choice} onClick={() => setColor(choice)} className={`papergraph-zone-swatch h-7 w-7 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${color === choice ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--surface)]" : ""}`} />)}</div></fieldset>

        </>}
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {dialog.id && !dialog.delete && <button type="button" className={controlClass} onClick={() => setDialog({ ...dialog, delete: true })}>{isEnglish ? "Delete group" : "Apagar grupo"}</button>}
          <button type="button" className={controlClass} onClick={() => closeDialog()}>{isEnglish ? "Cancel" : "Cancelar"}</button>
          <button type="button" className={controlClass} disabled={!canEdit || (!dialog.delete && !name.trim())} onClick={submit}>{dialog.delete ? isEnglish ? "Delete" : "Apagar" : dialog.id ? isEnglish ? "Save" : "Guardar" : isEnglish ? "Create" : "Criar"}</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}
