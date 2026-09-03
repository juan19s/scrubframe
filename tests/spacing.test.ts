import { describe, expect, it } from 'vitest';
import { bezierValueAt } from '../src/adapters/bezier-fit';
import { curveFromCssEasing, spaceByProgress } from '../src/adapters/spacing';
import type { EaseSample } from '../src/adapters/bezier-fit';

const AT = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

/** The real curve measured on era-residence.com, authored through Webflow as "Ease". */
const REAL: EaseSample[] = [
  { at: 0, value: 0 },
  { at: 0.1, value: 0.095 },
  { at: 0.25, value: 0.4084 },
  { at: 0.5, value: 0.8023 },
  { at: 0.75, value: 0.9604 },
  { at: 0.9, value: 0.9943 },
  { at: 1, value: 1 },
];

const LINEAR: EaseSample[] = AT.map((at) => ({ at, value: at }));

describe('spaceByProgress', () => {
  it('falls back to even spacing with no curve to go on', () => {
    const spacing = spaceByProgress(0, 600, 3, null);
    expect(spacing.mode).toBe('even');
    expect(spacing.positions).toEqual([0, 300, 600]);
  });

  it('leaves a linear curve evenly spaced, because it already is', () => {
    const spacing = spaceByProgress(0, 600, 5, LINEAR);
    expect(spacing.mode).toBe('eased');
    for (const [index, position] of spacing.positions.entries()) {
      expect(position).toBeCloseTo(index * 150, 1);
    }
  });

  it('bunches frames where an ease-out actually moves', () => {
    // The defect this exists to fix: with even spacing, the 600ms tween on
    // era-residence was 80% done by frame 6 and the last six frames were
    // within a kilobyte of each other.
    const spacing = spaceByProgress(0, 600, 12, REAL);
    expect(spacing.mode).toBe('eased');
    const gaps = spacing.positions.slice(1).map((p, i) => p - spacing.positions[i]!);
    // Not every gap wider than the last — this curve starts slowly before it
    // accelerates, so the first step is wide too. What matters is the tail:
    // once the motion is spent, the frames have to spread out rather than
    // stack up on an animation that already finished.
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[Math.floor(gaps.length / 2)]! * 2);
    // And half the MOTION should be reached well before half the time.
    expect(spacing.positions[5]).toBeLessThan(300);
  });

  it('pins the endpoints exactly, whatever the interpolation does', () => {
    const spacing = spaceByProgress(120, 980, 7, REAL);
    expect(spacing.positions[0]).toBe(120);
    expect(spacing.positions[spacing.positions.length - 1]).toBe(980);
  });

  it('keeps the frames in order', () => {
    const spacing = spaceByProgress(0, 600, 9, REAL);
    for (let i = 1; i < spacing.positions.length; i += 1) {
      expect(spacing.positions[i]).toBeGreaterThan(spacing.positions[i - 1]!);
    }
  });

  it('refuses to invert an overshooting ease, and says why', () => {
    // back.out passes the same progress twice, so there is no single time to
    // place a frame at. Picking either crossing would be unjustifiable.
    const overshoot: EaseSample[] = [
      { at: 0, value: 0 },
      { at: 0.25, value: 0.62 },
      { at: 0.5, value: 1.09 },
      { at: 0.75, value: 1.13 },
      { at: 1, value: 1 },
    ];
    const spacing = spaceByProgress(0, 400, 5, overshoot);
    expect(spacing.mode).toBe('even');
    expect(spacing.note).toContain('overshoots');
  });

  it('says so when the curve does not move at all', () => {
    const flat: EaseSample[] = AT.map((at) => ({ at, value: 0 }));
    const spacing = spaceByProgress(0, 600, 4, flat);
    expect(spacing.mode).toBe('even');
    expect(spacing.note).toContain('does not move');
  });

  it('always returns the frame count asked for', () => {
    for (const frames of [2, 3, 12, 40]) {
      expect(spaceByProgress(0, 600, frames, REAL).positions).toHaveLength(frames);
    }
  });
});

describe('curveFromCssEasing', () => {
  it('reads a cubic-bezier string', () => {
    const curve = curveFromCssEasing('cubic-bezier(0.22, 1, 0.36, 1)', bezierValueAt);
    expect(curve).not.toBeNull();
    expect(curve![0]!.value).toBeCloseTo(0, 4);
    // An aggressive ease-out is most of the way there by the midpoint.
    expect(curve!.find((s) => s.at === 0.5)!.value).toBeGreaterThan(0.8);
  });

  it('knows the CSS keywords', () => {
    expect(curveFromCssEasing('ease-in-out', bezierValueAt)).not.toBeNull();
    expect(curveFromCssEasing('linear', bezierValueAt)![3]!.value).toBeCloseTo(0.5, 3);
  });

  it('returns null for a step function rather than pretending it is a curve', () => {
    expect(curveFromCssEasing('steps(4, end)', bezierValueAt)).toBeNull();
  });
});
