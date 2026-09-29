/** Apply one bounded delta to the whole selection, preserving its spacing. */
export function constrainDragDelta(positions: Array<{ x: number; y: number }>, dx: number, dy: number) {
  if (!positions.length) return { x: dx, y: dy };
  return {
    x: Math.max(dx, -Math.min(...positions.map(p => p.x))),
    y: Math.max(dy, -Math.min(...positions.map(p => p.y))),
  };
}
