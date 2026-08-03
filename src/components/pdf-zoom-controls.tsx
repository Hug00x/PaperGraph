"use client";

import type { AppLanguage } from "@/lib/portuguese-labels";
import { getNextPdfZoomLevel, pdfZoomLevels } from "@/lib/pdf-preview-layout";
import { useId } from "react";

type PdfZoomControlsProps = {
  className?: string;
  language: AppLanguage;
  onChange: (nextZoom: number) => void;
  value: number;
};

export function PdfZoomControls({
  className = "",
  language,
  onChange,
  value,
}: PdfZoomControlsProps) {
  const isEnglish = language === "en";
  const zoomSelectId = useId();
  const minimumZoom = pdfZoomLevels[0];
  const maximumZoom = pdfZoomLevels[pdfZoomLevels.length - 1];

  return (
    <div
      className={`flex items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-strong)] text-sm font-semibold text-white shadow-[0_12px_30px_rgba(0,0,0,0.24)] backdrop-blur-xl ${className}`}
    >
      <button
        type="button"
        aria-label={isEnglish ? "Zoom out" : "Afastar"}
        title={isEnglish ? "Zoom out" : "Afastar"}
        disabled={value <= minimumZoom}
        onClick={() => onChange(getNextPdfZoomLevel(value, -1))}
        className="flex h-9 w-10 items-center justify-center border-r border-[var(--border)] text-lg leading-none transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        -
      </button>
      <button
        type="button"
        aria-label={isEnglish ? "Zoom in" : "Aproximar"}
        title={isEnglish ? "Zoom in" : "Aproximar"}
        disabled={value >= maximumZoom}
        onClick={() => onChange(getNextPdfZoomLevel(value, 1))}
        className="flex h-9 w-10 items-center justify-center border-r border-[var(--border)] text-lg leading-none transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
      <label className="sr-only" htmlFor={zoomSelectId}>
        {isEnglish ? "PDF zoom" : "Zoom do PDF"}
      </label>
      <select
        id={zoomSelectId}
        aria-label={isEnglish ? "PDF zoom" : "Zoom do PDF"}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="papergraph-pdf-zoom-select h-9 appearance-none bg-transparent px-3 pr-7 text-sm font-semibold outline-none transition-colors hover:bg-white/10"
      >
        {pdfZoomLevels.map((zoomLevel) => (
          <option key={zoomLevel} value={zoomLevel}>
            {zoomLevel}%
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none -ml-5 pr-3 text-[10px] text-[var(--muted)]">
        v
      </span>
    </div>
  );
}
