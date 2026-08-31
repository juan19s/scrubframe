import { describe, expect, it } from 'vitest';
import { clipFor, stageFor, STAGE_PADDING } from '../src/background/element-handle';
import type { Rect, VisualViewport } from '../src/background/geometry';

const viewport: VisualViewport = {
  pageX: 0,
  pageY: 1200,
  clientWidth: 1512,
  clientHeight: 764,
};

describe('stageFor', () => {
  it('pads the element so a shadow or outline is not cut off', () => {
    const box: Rect = { x: 200, y: 100, width: 400, height: 300 };
    expect(stageFor(box, viewport)).toEqual({
      x: 200 - STAGE_PADDING,
      y: 100 - STAGE_PADDING,
      width: 400 + STAGE_PADDING * 2,
      height: 300 + STAGE_PADDING * 2,
    });
  });

  it('clamps padding that would run off the top of the viewport', () => {
    const box: Rect = { x: 0, y: 2, width: 400, height: 300 };
    const stage = stageFor(box, viewport);
    expect(stage.x).toBe(0);
    expect(stage.y).toBe(0);
  });

  it('clamps an element taller than the viewport', () => {
    const box: Rect = { x: 100, y: -300, width: 400, height: 2000 };
    const stage = stageFor(box, viewport);
    expect(stage.y).toBe(0);
    expect(stage.height).toBe(viewport.clientHeight);
  });
});

describe('clipFor', () => {
  it('converts the stage to document space by adding the scroll offset', () => {
    const stage: Rect = { x: 192, y: 92, width: 416, height: 316 };
    expect(clipFor(stage, viewport, 1)).toEqual({
      x: 192,
      y: 92 + 1200,
      width: 416,
      height: 316,
      scale: 1,
    });
  });

  it('refuses a stage Chromium would reject rather than sending it', () => {
    // Chromium answers "Cannot take screenshot with 0 width." — catching it
    // here turns a protocol error into a sentence about the user's element.
    expect(() => clipFor({ x: 0, y: 0, width: 0, height: 300 }, viewport, 1)).toThrowError(
      /not on screen/i,
    );
  });

  it('carries the calibrated scale through untouched', () => {
    const stage: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(clipFor(stage, viewport, 0.5).scale).toBe(0.5);
  });
});
