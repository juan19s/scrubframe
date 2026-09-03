import type { EaseSample } from './bezier-fit';

/**
 * Decides where in the range to take each frame.
 *
 * Frames spaced evenly in TIME are not spaced evenly in MOTION, and for an
 * eased animation the difference is most of the sheet. Measured on a real
 * capture: a 600ms tween whose curve reaches 0.80 at the halfway mark spent six
 * of twelve frames on an animation that had already finished — the file sizes
 * gave it away, all within a kilobyte of each other.
 *
 * So the frames are placed by inverting the curve: equal progress between
 * consecutive frames, which means dense early and sparse late for an ease-out,
 * and the reverse for an ease-in. Every frame then shows something the one
 * before it did not.
 *
 * Only possible because the page handed over its real easing function. This is
 * the same asset the cubic-bezier fit comes from, spent differently.
 */

export interface Spacing {
  /** Absolute positions within the range, in order, first and last inclusive. */
  positions: number[];
  mode: 'even' | 'eased';
  /** Why it fell back to even spacing, when it did. */
  note?: string;
}

/** Progress at a fraction of the way through, by interpolating the samples. */
function progressAt(curve: readonly EaseSample[], fraction: number): number {
  if (fraction <= curve[0]!.at) return curve[0]!.value;
  const last = curve[curve.length - 1]!;
  if (fraction >= last.at) return last.value;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (fraction <= b.at) {
      const span = b.at - a.at;
      const t = span === 0 ? 0 : (fraction - a.at) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** The fraction of the way through at which the curve reaches `target`. */
function fractionForProgress(curve: readonly EaseSample[], target: number): number {
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (target <= b.value) {
      const span = b.value - a.value;
      const t = span === 0 ? 0 : (target - a.value) / span;
      return a.at + (b.at - a.at) * t;
    }
  }
  return curve[curve.length - 1]!.at;
}

/**
 * A curve that goes back on itself cannot be inverted to one answer.
 *
 * An overshooting ease — `back.out`, a spring — passes the same progress twice.
 * Picking either crossing would put frames somewhere the tool cannot justify,
 * so those fall back to even spacing and say so.
 */
function isMonotonic(curve: readonly EaseSample[]): boolean {
  for (let i = 1; i < curve.length; i += 1) {
    if (curve[i]!.value < curve[i - 1]!.value - 1e-6) return false;
  }
  return true;
}

export function spaceByProgress(
  from: number,
  to: number,
  frames: number,
  curve: readonly EaseSample[] | null,
): Spacing {
  const count = Math.max(2, Math.round(frames));
  const even = (): number[] =>
    Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));

  if (!curve || curve.length < 3) return { positions: even(), mode: 'even' };

  const usable = [...curve]
    .filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.value))
    .sort((a, b) => a.at - b.at);
  if (usable.length < 3) return { positions: even(), mode: 'even' };

  if (!isMonotonic(usable)) {
    return {
      positions: even(),
      mode: 'even',
      note: 'This ease overshoots, so the same progress happens twice and there is no single time to place a frame at. Frames are evenly spaced in time instead.',
    };
  }

  const first = progressAt(usable, 0);
  const last = progressAt(usable, 1);
  if (Math.abs(last - first) < 1e-6) {
    return {
      positions: even(),
      mode: 'even',
      note: 'The curve does not move, so there is no progress to space by.',
    };
  }

  const positions = Array.from({ length: count }, (_, i) => {
    const target = first + ((last - first) * i) / (count - 1);
    const fraction = fractionForProgress(usable, target);
    return from + (to - from) * Math.min(1, Math.max(0, fraction));
  });
  // The endpoints are the range's, exactly: interpolation should never move
  // the first or last frame off the ends the user asked for.
  positions[0] = from;
  positions[count - 1] = to;
  return { positions, mode: 'eased' };
}

/** Samples a `cubic-bezier(a, b, c, d)` string, so WAAPI easings work too. */
export function curveFromCssEasing(
  easing: string,
  value: (x1: number, y1: number, x2: number, y2: number, x: number) => number,
): EaseSample[] | null {
  const match = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(
    easing,
  );
  const named: Record<string, [number, number, number, number]> = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
  };
  const parameters = match
    ? ([Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const)
    : named[easing.trim()];
  if (!parameters) return null;
  return [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((at) => ({
    at,
    value: value(parameters[0]!, parameters[1]!, parameters[2]!, parameters[3]!, at),
  }));
}
