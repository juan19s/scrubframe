import { describe, expect, it } from 'vitest';
import {
  calibrateScale,
  clampToViewport,
  isCapturable,
  padRect,
  quadToRect,
  stageToClip,
  unionRects,
  type Rect,
  type VisualViewport,
} from '../src/background/geometry';

const viewport: VisualViewport = { pageX: 0, pageY: 800, clientWidth: 1512, clientHeight: 764 };

describe('quadToRect', () => {
  it('reads an axis-aligned quad', () => {
    expect(quadToRect([10, 20, 110, 20, 110, 70, 10, 70])).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('bounds a rotated quad instead of taking two opposite corners', () => {
    // A square rotated 45°. Corners [0] and [4] are (50,0) and (50,100) —
    // reading those as opposite corners gives width 0 and crops the element away.
    expect(quadToRect([50, 0, 100, 50, 50, 100, 0, 50])).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it('survives a truncated quad rather than producing NaN', () => {
    expect(quadToRect([1, 2, 3])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('unionRects', () => {
  it('spans an element that travelled up the viewport', () => {
    const start: Rect = { x: 100, y: 700, width: 300, height: 200 };
    const end: Rect = { x: 100, y: 100, width: 300, height: 200 };
    expect(unionRects([start, end])).toEqual({ x: 100, y: 100, width: 300, height: 800 });
  });

  it('ignores empty rects so a collapsed frame does not drag the stage to 0,0', () => {
    const real: Rect = { x: 50, y: 50, width: 100, height: 100 };
    expect(unionRects([{ x: 0, y: 0, width: 0, height: 0 }, real])).toEqual(real);
  });

  it('returns an empty rect for no input', () => {
    expect(unionRects([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('clampToViewport', () => {
  it('crops a stage that runs off the top and bottom', () => {
    const stage: Rect = { x: 100, y: -200, width: 300, height: 1200 };
    expect(clampToViewport(stage, viewport)).toEqual({
      x: 100,
      y: 0,
      width: 300,
      height: 764,
    });
  });

  it('gives an empty rect for a stage entirely offscreen', () => {
    const stage: Rect = { x: 0, y: -500, width: 300, height: 100 };
    expect(clampToViewport(stage, viewport).height).toBe(0);
  });
});

describe('stageToClip', () => {
  it('adds the scroll offset, because clip is document-relative', () => {
    const stage: Rect = { x: 100, y: 50, width: 300, height: 200 };
    expect(stageToClip(stage, viewport, 1)).toEqual({
      x: 100,
      y: 850,
      width: 300,
      height: 200,
      scale: 1,
    });
  });

  it('keeps the stage size fixed as the page scrolls', () => {
    const stage: Rect = { x: 0, y: 0, width: 400, height: 300 };
    const early = stageToClip(stage, { ...viewport, pageY: 0 }, 1);
    const late = stageToClip(stage, { ...viewport, pageY: 2400 }, 1);
    expect(late.y - early.y).toBe(2400);
    expect(late.width).toBe(early.width);
    expect(late.height).toBe(early.height);
  });

  it('does not truncate a fractional scroll offset', () => {
    // The reason we read cssVisualViewport and not cssLayoutViewport: the
    // latter is declared `integer` in the protocol and would land on 850 here.
    const stage: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(stageToClip(stage, { ...viewport, pageY: 850.5 }, 1).y).toBe(850.5);
  });
});

describe('calibrateScale', () => {
  it('halves the requested scale on a 2x display', () => {
    // Phase 0 asked for a 1512px-wide viewport and got a 3024px PNG.
    expect(calibrateScale(3024, 1512, 1)).toBe(0.5);
  });

  it('leaves a 1x display alone', () => {
    expect(calibrateScale(1512, 1512, 1)).toBe(1);
  });

  it('can target 2x deliberately', () => {
    expect(calibrateScale(1512, 1512, 2)).toBe(2);
  });

  it('falls back to the requested scale on nonsense input', () => {
    expect(calibrateScale(0, 1512, 1)).toBe(1);
    expect(calibrateScale(3024, 0, 1)).toBe(1);
  });
});

describe('isCapturable', () => {
  it('rejects what Chromium would reject', () => {
    expect(isCapturable({ x: 0, y: 0, width: 0, height: 100 })).toBe(false);
    expect(isCapturable({ x: 0, y: 0, width: 0.4, height: 100 })).toBe(false);
    expect(isCapturable({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });
});

describe('padRect', () => {
  it('grows in both directions', () => {
    expect(padRect({ x: 100, y: 100, width: 50, height: 50 }, 10)).toEqual({
      x: 90,
      y: 90,
      width: 70,
      height: 70,
    });
  });
});
