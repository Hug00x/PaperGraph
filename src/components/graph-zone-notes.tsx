"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ZONE_CONFIG, type GraphZone } from "@/lib/graph-zones";

export function GraphZoneNotes({ zone, canEdit, isEnglish, onSave, onClose }: {
  zone: GraphZone; canEdit: boolean; isEnglish: boolean; onSave: (notes: string) => void; onClose: () => void;
}) {
  const [notes, setNotes] = useState(zone.notes ?? "");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector("textarea")?.focus();
    return () => trigger?.focus();
  }, []);
  return createPortal(<div data-graph-control className="papergraph-app papergraph-graph-pane fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.4)" }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="zone-notes-title" data-zone-color={zone.color}
      className="papergraph-graph-dialog flex max-h-[90vh] w-full max-w-xl flex-col rounded-3xl border border-[var(--border)] p-5 shadow-xl"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canEdit) { e.preventDefault(); onSave(notes); }
        if (e.key === "Tab") {
          const elements = [...(dialog.current?.querySelectorAll<HTMLElement>("textarea, button:not(:disabled)") ?? [])];
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{isEnglish ? "Zone notes" : "Notas da zona"}</p>
      <h2 id="zone-notes-title" className="mt-2 break-words text-xl font-semibold text-[var(--foreground)]">{zone.name}</h2>
      <textarea aria-label={isEnglish ? "Zone notes" : "Notas da zona"} value={notes} readOnly={!canEdit} maxLength={ZONE_CONFIG.maxNotes}
        onChange={(e) => setNotes(e.target.value)} placeholder={isEnglish ? "Ideas, observations and next steps for this zone…" : "Ideias, observações e próximos passos para esta zona…"}
        className="mt-4 min-h-64 resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--foreground)] outline-[var(--accent)]" />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] focus-visible:outline-2">{isEnglish ? "Close" : "Fechar"}</button>
        {canEdit && <button type="button" onClick={() => onSave(notes)} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#041016] focus-visible:outline-2">{isEnglish ? "Save notes" : "Guardar notas"}</button>}
      </div>
    </div>
  </div>, document.body);
}
