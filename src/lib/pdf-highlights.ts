export type HighlightRect = { x: number; y: number; width: number; height: number };
export const highlightColors = {
  yellow: { hex: "#fde047", en: "Yellow", pt: "Amarelo" },
  green: { hex: "#86efac", en: "Green", pt: "Verde" },
  blue: { hex: "#7dd3fc", en: "Blue", pt: "Azul" },
  pink: { hex: "#f9a8d4", en: "Pink", pt: "Rosa" },
  purple: { hex: "#c4b5fd", en: "Purple", pt: "Roxo" },
} as const;
export type HighlightColor = keyof typeof highlightColors;
export type PdfHighlight = {
  id: string;
  page_number: number;
  selected_text: string;
  rects: HighlightRect[];
  color?: HighlightColor;
};

export function isPdfHighlight(value: unknown): value is PdfHighlight {
  if (!value || typeof value !== "object") return false;
  const item = value as PdfHighlight;
  return typeof item.id === "string" && Number.isInteger(item.page_number) && item.page_number > 0
    && (item.color === undefined || Object.hasOwn(highlightColors, item.color))
    && typeof item.selected_text === "string" && item.selected_text.length > 0 && item.selected_text.length <= 20000
    && Array.isArray(item.rects) && item.rects.length > 0 && item.rects.length <= 500 && item.rects.every((rect) =>
      rect && [rect.x, rect.y, rect.width, rect.height].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
      && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
      && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001);
}

export function normalizeHighlightRects(
  rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }>,
  page: { left: number; top: number; width: number; height: number },
): HighlightRect[] {
  if (page.width <= 0 || page.height <= 0) return [];
  const result: HighlightRect[] = [];
  for (const rect of Array.from(rects)) {
    const x = Math.max(0, (rect.left - page.left) / page.width);
    const y = Math.max(0, (rect.top - page.top) / page.height);
    const right = Math.min(1, (rect.right - page.left) / page.width);
    const bottom = Math.min(1, (rect.bottom - page.top) / page.height);
    if (right <= x || bottom <= y) continue;
    const next = { x, y, width: right - x, height: bottom - y };
    if (!result.some((existing) => Object.keys(next).every((key) =>
      Math.abs(existing[key as keyof HighlightRect] - next[key as keyof HighlightRect]) < 0.00001))) result.push(next);
  }
  return result;
}

export async function pdfDocumentKey(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
