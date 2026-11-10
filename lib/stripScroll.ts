// Where to scroll the detail-screen thumbnail strip so the selected thumbnail is centred. Pure (tests/stripScroll.test.ts).
// Used with scrollToOffset instead of scrollToIndex: the cell size is fixed and known, so the offset can be computed, and an
// offset scroll has no "index out of range / not yet measured" failure mode.

export function stripScrollOffset(input: {
  index: number;
  count: number;
  viewport: number;
  cell: number;
  gap: number;
  /** Padding at each end of the content. */
  pad: number;
}): number {
  const { count, viewport, cell, gap, pad } = input;
  if (!(count > 0) || !(viewport > 0)) return 0;
  const index = Math.max(0, Math.min(Math.trunc(input.index) || 0, count - 1));
  const content = pad * 2 + count * cell + (count - 1) * gap;
  const maxOffset = Math.max(0, content - viewport);
  const centred = pad + index * (cell + gap) + cell / 2 - viewport / 2;
  return Math.min(Math.max(centred, 0), maxOffset);
}
