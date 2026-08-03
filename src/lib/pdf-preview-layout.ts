export const pdfZoomLevels = [50, 75, 100, 125, 150, 175, 200] as const;

type PageDimensions = {
  height: number;
  width: number;
};

export function getNextPdfZoomLevel(currentZoom: number, direction: -1 | 1) {
  const currentIndex = pdfZoomLevels.findIndex((zoomLevel) => zoomLevel === currentZoom);
  const fallbackIndex = pdfZoomLevels.findIndex((zoomLevel) => zoomLevel >= currentZoom);
  const normalizedIndex = currentIndex === -1 ? Math.max(0, fallbackIndex) : currentIndex;
  const nextIndex = Math.min(pdfZoomLevels.length - 1, Math.max(0, normalizedIndex + direction));

  return pdfZoomLevels[nextIndex];
}

export function getPdfFitScale(
  scroller: HTMLElement,
  pageDimensions: PageDimensions,
  options: { maxWidth?: number } = {},
) {
  const scrollerStyle = window.getComputedStyle(scroller);
  const horizontalPadding =
    Number.parseFloat(scrollerStyle.paddingLeft) + Number.parseFloat(scrollerStyle.paddingRight);
  const verticalPadding =
    Number.parseFloat(scrollerStyle.paddingTop) + Number.parseFloat(scrollerStyle.paddingBottom);
  const availableWidth = Math.max(280, scroller.clientWidth - horizontalPadding);
  const availableHeight = Math.max(280, scroller.clientHeight - verticalPadding);
  const targetWidth = options.maxWidth ? Math.min(availableWidth, options.maxWidth) : availableWidth;

  return Math.max(
    0.25,
    Math.min(targetWidth / pageDimensions.width, availableHeight / pageDimensions.height),
  );
}
