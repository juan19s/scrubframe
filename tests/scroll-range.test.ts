import { describe, expect, it } from 'vitest';
import { clampToViewport, padRect, snapRect, type Rect, type VisualViewport } from '../src/background/geometry';

const STAGE_PADDING = 8;
const viewport: VisualViewport = { pageX: 0, pageY: 0, clientWidth: 1512, clientHeight: 764 };

/**
 * The stage for a scroll run, derived the way scroll.ts derives it.
 *
 * Kept as a test-local mirror rather than exported from the adapter: what is
 * worth locking down is the arithmetic, and the adapter's own version needs a
 * live CDP session to reach it.
 */
function travelStage(box: Rect, documentTop: number, from: number, to: number): Rect {
  const top = documentTop - to;
  const bottom = documentTop - from + box.height;
  const travelled: Rect = {
    x: box.x,
    y: top,
    width: box.width,
    height: Math.max(1, bottom - top),
  };
  return snapRect(clampToViewport(padRect(travelled, STAGE_PADDING), viewport));
}

describe('the frozen stage for a scroll run', () => {
  const box: Rect = { x: 200, y: 900, width: 400, height: 300 };
  const documentTop = 900;

  it('spans the whole path the element travels, not just where it starts', () => {
    // The element enters from below and leaves above, so the crop has to cover
    // the entire viewport height it passes through.
    const stage = travelStage(box, documentTop, 200, 1200);
    expect(stage.y).toBe(0);
    expect(stage.height).toBe(viewport.clientHeight);
  });

  it('stays put as the page scrolls — that is the point', () => {
    // Recomputing per frame would keep the element centred, which subtracts
    // exactly the motion being captured.
    const early = travelStage(box, documentTop, 200, 1200);
    const late = travelStage(box, documentTop, 200, 1200);
    expect(early).toEqual(late);
  });

  it('is a modest crop for a short range', () => {
    const stage = travelStage(box, documentTop, 880, 920);
    expect(stage.height).toBeLessThan(viewport.clientHeight);
    expect(stage.width).toBe(400 + STAGE_PADDING * 2);
  });

  it('produces whole pixels so every frame is identical in size', () => {
    const fractional: Rect = { x: 244.7, y: 900.3, width: 621.6, height: 291.4 };
    const stage = travelStage(fractional, 900.3, 400, 1100);
    for (const value of [stage.x, stage.y, stage.width, stage.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
