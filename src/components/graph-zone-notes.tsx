"use client";

import { useEffect, useRef, useState } from "react";
import { ZONE_CONFIG, type GraphZone } from "@/lib/graph-zones";

export function GraphZoneNotes({ zone, canEdit, isEnglish, onSave, onRequestClose, onDirtyChange }: {
  zone: GraphZone; canEdit: boolean; isEnglish: boolean; onSave: (notes: string) => void; onRequestClose: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [notes, setNotes] = useState(zone.notes ?? "");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector("textarea")?.focus();
    return () => trigger?.focus();
  }, []);
  useEffect(() => { onDirtyChange(notes !== (zone.notes ?? "")); }, [notes, onDirtyChange, zone.notes]);
  return <div data-graph-control className="pointer-events-none absolute inset-0 z-[100]">
    <div ref={dialog} role="dialog" aria-modal="false" aria-labelledby="zone-notes-title" data-zone-color={zone.color}
      className="papergraph-zone-notes-drawer pointer-events-auto absolute bottom-5 right-5 top-[5.25rem] flex max-h-[calc(100%_-_7.75rem)] w-[min(23rem,calc(100%_-_2.5rem))] flex-col overflow-hidden rounded-[24px] border border-[var(--border)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur-xl"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onRequestClose(); }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canEdit) { e.preventDefault(); onSave(notes); }
        if (e.key === "Tab") {
          const elements = [...(dialog.current?.querySelectorAll<HTMLElement>("textarea, button:not(:disabled)") ?? [])];
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 id="zone-notes-title" className="text-xs uppercase tracking-widest text-[var(--muted)]">{isEnglish ? `Notes: ${zone.name}` : `Notas de ${zone.name}`}</h2>
      <textarea aria-label={isEnglish ? `Notes: ${zone.name}` : `Notas de ${zone.name}`} value={notes} readOnly={!canEdit} maxLength={ZONE_CONFIG.maxNotes}
        onChange={(e) => setNotes(e.target.value)} placeholder={isEnglish ? "Ideas, observations and next steps for this group…" : "Ideias, observações e próximos passos para este grupo…"}
        className="mt-4 min-h-0 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--foreground)] outline-[var(--accent)]" />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onRequestClose} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] focus-visible:outline-2">{isEnglish ? "Close" : "Fechar"}</button>
        {canEdit && <button type="button" onClick={() => onSave(notes)} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#041016] focus-visible:outline-2">{isEnglish ? "Save notes" : "Guardar notas"}</button>}
      </div>
    </div>
  </div>;
}
