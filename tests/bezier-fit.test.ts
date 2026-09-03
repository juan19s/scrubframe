import { describe, expect, it } from 'vitest';
import { bezierValueAt, fitCubicBezier, type EaseSample } from '../src/adapters/bezier-fit';

const AT = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

/** Samples a known cubic-bezier, the way the page samples a GSAP ease. */
function sampleBezier(x1: number, y1: number, x2: number, y2: number): EaseSample[] {
  return AT.map((at) => ({ at, value: bezierValueAt(x1, y1, x2, y2, at) }));
}

describe('bezierValueAt', () => {
  it('pins the endpoints', () => {
    expect(bezierValueAt(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(bezierValueAt(0.42, 0, 0.58, 1, 1)).toBe(1);
  });

  it('reproduces linear as the identity', () => {
    for (const x of [0.2, 0.5, 0.8]) {
      expect(bezierValueAt(0, 0, 1, 1, x)).toBeCloseTo(x, 4);
    }
  });

  it('is symmetric for ease-in-out', () => {
    // cubic-bezier(.42,0,.58,1) is CSS's ease-in-out and passes through 0.5.
    expect(bezierValueAt(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 4);
  });

  it('stays monotonic through a flat-sloped curve, where Newton alone wanders', () => {
    let previous = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const value = bezierValueAt(1, 0, 0, 1, x);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = value;
    }
  });
});

describe('fitCubicBezier', () => {
  it('recovers a curve it was given', () => {
    const fit = fitCubicBezier(sampleBezier(0.25, 0.1, 0.25, 1));
    expect(fit).not.toBeNull();
    expect(fit!.error).toBeLessThan(0.01);
    for (const at of AT) {
      expect(bezierValueAt(fit!.x1, fit!.y1, fit!.x2, fit!.y2, at)).toBeCloseTo(
        bezierValueAt(0.25, 0.1, 0.25, 1, at),
        2,
      );
    }
  });

  it('fits linear almost exactly', () => {
    const fit = fitCubicBezier(AT.map((at) => ({ at, value: at })));
    expect(fit!.error).toBeLessThan(0.005);
  });

  it('fits the real GSAP curve measured on era-residence.com', () => {
    // The ease the site authors as "Ease", read out of GSAP by sampling its
    // resolved function. No standard GSAP ease came within 0.2 of it, which is
    // exactly why a bezier fit is worth having.
    const measured: EaseSample[] = [
      { at: 0, value: 0 },
      { at: 0.1, value: 0.095 },
      { at: 0.25, value: 0.4084 },
      { at: 0.5, value: 0.8023 },
      { at: 0.75, value: 0.9604 },
      { at: 0.9, value: 0.9943 },
      { at: 1, value: 1 },
    ];
    const fit = fitCubicBezier(measured);
    expect(fit).not.toBeNull();
    expect(fit!.error).toBeLessThan(0.02);
    expect(fit!.css).toMatch(/^cubic-bezier\(/);
  });

  it('names the curve when CSS already has a word for it', () => {
    // The measured "Ease" from era-residence fits cubic-bezier(.25,.1,.25,1) to
    // 0.00007 — which is exactly CSS's `ease`. Saying so beats four decimals.
    const fit = fitCubicBezier([
      { at: 0, value: 0 },
      { at: 0.1, value: 0.095 },
      { at: 0.25, value: 0.4084 },
      { at: 0.5, value: 0.8023 },
      { at: 0.75, value: 0.9604 },
      { at: 0.9, value: 0.9943 },
      { at: 1, value: 1 },
    ]);
    expect(fit!.keyword).toBe('ease');
  });

  it('leaves keyword null for a curve CSS has no word for', () => {
    const fit = fitCubicBezier([
      { at: 0, value: 0 },
      { at: 0.1, value: 0.3277 },
      { at: 0.25, value: 0.6884 },
      { at: 0.5, value: 0.934 },
      { at: 0.75, value: 0.9938 },
      { at: 0.9, value: 0.9999 },
      { at: 1, value: 1 },
    ]);
    expect(fit!.keyword).toBeNull();
  });

  it('keeps x inside [0, 1], which is all CSS accepts', () => {
    const fit = fitCubicBezier(sampleBezier(0.9, 0.1, 0.1, 0.9));
    expect(fit!.x1).toBeGreaterThanOrEqual(0);
    expect(fit!.x1).toBeLessThanOrEqual(1);
    expect(fit!.x2).toBeGreaterThanOrEqual(0);
    expect(fit!.x2).toBeLessThanOrEqual(1);
  });

  it('lets y overshoot, so a springy ease is not flattened', () => {
    // back.out overshoots past 1 before settling. Clamping y would report a
    // curve that never overshoots — a different animation.
    const overshoot: EaseSample[] = [
      { at: 0, value: 0 },
      { at: 0.25, value: 0.62 },
      { at: 0.5, value: 1.09 },
      { at: 0.75, value: 1.13 },
      { at: 1, value: 1 },
    ];
    const fit = fitCubicBezier(overshoot);
    expect(fit).not.toBeNull();
    expect(Math.max(fit!.y1, fit!.y2)).toBeGreaterThan(1);
  });

  it('refuses to fit too few points instead of inventing a curve', () => {
    expect(fitCubicBezier([{ at: 0, value: 0 }, { at: 1, value: 1 }])).toBeNull();
  });

  it('ignores samples that are not numbers', () => {
    const dirty = [
      ...sampleBezier(0.42, 0, 0.58, 1),
      { at: Number.NaN, value: 0.5 },
      { at: 0.5, value: Number.POSITIVE_INFINITY },
    ];
    expect(fitCubicBezier(dirty)!.error).toBeLessThan(0.02);
  });
});
