interface Bounds { left: number; top: number; width: number; height: number }

/** Fixed tooltips inside Harness's layout containment use surface coordinates. */
export function tooltipPosition(anchor: Bounds, surface: Bounds, bubble = { width: 0, height: 28 }) {
  const gap = 6, margin = 8;
  const maxWidth = Math.max(0, Math.min(260, surface.width - margin * 2));
  const half = Math.min(bubble.width, maxWidth) / 2;
  const center = anchor.left + anchor.width / 2 - surface.left;
  const x = Math.max(margin + half, Math.min(center, surface.width - margin - half));
  const top = anchor.top - surface.top;
  const bottom = top + anchor.height;
  const belowSpace = surface.height - bottom - gap - margin;
  const aboveSpace = top - gap - margin;
  const above = belowSpace < bubble.height && aboveSpace > belowSpace;
  const y = above
    ? Math.max(margin + bubble.height, top - gap)
    : Math.max(margin, Math.min(bottom + gap, surface.height - margin - bubble.height));
  return { x, y, above, arrowOffset: center - x, maxWidth };
}
