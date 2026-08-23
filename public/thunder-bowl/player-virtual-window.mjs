export const DEFAULT_PLAYER_ROW_HEIGHT = 92;
export const DEFAULT_PLAYER_OVERSCAN = 6;

export function calculatePlayerWindow({
  itemCount,
  scrollTop = 0,
  viewportHeight = 0,
  rowHeight = DEFAULT_PLAYER_ROW_HEIGHT,
  overscan = DEFAULT_PLAYER_OVERSCAN,
} = {}) {
  const count = Math.max(0, Math.trunc(Number(itemCount) || 0));
  const height = Math.max(1, Number(rowHeight) || DEFAULT_PLAYER_ROW_HEIGHT);
  const buffer = Math.max(0, Math.trunc(Number(overscan) || 0));
  const top = Math.max(0, Number(scrollTop) || 0);
  const viewport = Math.max(height, Number(viewportHeight) || height * 8);
  const visibleStart = Math.floor(top / height);
  const visibleCount = Math.max(1, Math.ceil(viewport / height));
  const start = Math.max(0, Math.min(count, visibleStart - buffer));
  const end = Math.max(start, Math.min(count, visibleStart + visibleCount + buffer));
  return {
    start,
    end,
    topSpacerHeight: start * height,
    bottomSpacerHeight: Math.max(0, (count - end) * height),
    renderedCount: end - start,
  };
}
