/**
 * Fits a CSS `cubic-bezier()` to a sampled easing curve.
 *
 * This is what turns a GSAP ease into something you can paste. GSAP's curves
 * are functions in its own vocabulary — `power3.out`, or on a Webflow site
 * simply `"Ease"` — and none of them exist in CSS. But a curve sampled at
 * enough points is just data, and CSS's cubic-bezier has four free numbers.
 *
 * The result is labelled as a FIT, with its error, and printed alongside the
 * raw samples. A curve that does not fit well says so rather than handing over
 * four numbers that look authoritative and are wrong — the whole project turns
 * on not doing that.
 *
 * Only reachable because the page was asked for its real easing function. A
 * tool that records video has pixels and no curve to sample.
 */

export interface BezierFit {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Mean absolute error across the sampled points. */
  error: number;
  css: string;
  /** Set when the fitted curve is one CSS already has a word for. */
  keyword: string | null;
}

/**
 * The curves CSS gives names to.
 *
 * Worth checking, because a fit that lands on one of these is not just usable —
 * it is a keyword, and a keyword reads better in a stylesheet than four
 * decimals. era-residence.com's ease, authored through Webflow as "Ease",
 * fits cubic-bezier(0.25, 0.1, 0.25, 1) to within 0.00007. That IS `ease`.
 */
const CSS_KEYWORDS: ReadonlyArray<{ name: string; p: [number, number, number, number] }> = [
  { name: 'linear', p: [0, 0, 1, 1] },
  { name: 'ease', p: [0.25, 0.1, 0.25, 1] },
  { name: 'ease-in', p: [0.42, 0, 1, 1] },
  { name: 'ease-out', p: [0, 0, 0.58, 1] },
  { name: 'ease-in-out', p: [0.42, 0, 0.58, 1] },
];

export interface EaseSample {
  /** Progress along the timeline, 0..1. */
  at: number;
  /** The eased output at that progress. */
  value: number;
}

/** One axis of a cubic Bézier with fixed endpoints at 0 and 1. */
function axis(a: number, b: number, t: number): number {
  const u = 1 - t;
  return 3 * a * t * u * u + 3 * b * t * t * u + t * t * t;
}

function axisSlope(a: number, b: number, t: number): number {
  const u = 1 - t;
  return 3 * a * u * (1 - 3 * t) + 3 * b * t * (2 - 3 * t) + 3 * t * t;
}

/**
 * Solves for the curve parameter at a given x.
 *
 * Newton first because it converges in a handful of steps, bisection after
 * because Newton wanders when the slope goes flat — which it does for exactly
 * the aggressive eases people reach for.
 */
function solveT(x1: number, x2: number, x: number): number {
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const error = axis(x1, x2, t) - x;
    if (Math.abs(error) < 1e-7) return t;
    const slope = axisSlope(x1, x2, t);
    if (Math.abs(slope) < 1e-7) break;
    t -= error / slope;
    if (t < 0 || t > 1) break;
  }
  let low = 0;
  let high = 1;
  t = x;
  for (let i = 0; i < 40; i += 1) {
    const value = axis(x1, x2, t);
    if (Math.abs(value - x) < 1e-7) return t;
    if (value < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return t;
}

/** The eased value a `cubic-bezier(x1, y1, x2, y2)` produces at time `x`. */
export function bezierValueAt(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return axis(y1, y2, solveT(x1, x2, x));
}

function meanError(samples: readonly EaseSample[], p: readonly number[]): number {
  let total = 0;
  for (const sample of samples) {
    total += Math.abs(bezierValueAt(p[0]!, p[1]!, p[2]!, p[3]!, sample.at) - sample.value);
  }
  return total / samples.length;
}

/**
 * Coarse grid, then a shrinking local search.
 *
 * x1 and x2 are clamped to [0, 1] because CSS rejects anything else. y is
 * allowed past the unit range so overshoot — `back.out`, a spring — can be
 * expressed rather than flattened into something that never overshoots.
 */
export function fitCubicBezier(samples: readonly EaseSample[]): BezierFit | null {
  const usable = samples.filter(
    (sample) => Number.isFinite(sample.at) && Number.isFinite(sample.value),
  );
  if (usable.length < 3) return null;

  let best: number[] = [0.25, 0.1, 0.25, 1];
  let bestError = meanError(usable, best);

  for (let x1 = 0; x1 <= 1; x1 += 0.1) {
    for (let y1 = -0.5; y1 <= 1.5; y1 += 0.25) {
      for (let x2 = 0; x2 <= 1; x2 += 0.1) {
        for (let y2 = -0.5; y2 <= 1.5; y2 += 0.25) {
          const error = meanError(usable, [x1, y1, x2, y2]);
          if (error < bestError) {
            bestError = error;
            best = [x1, y1, x2, y2];
          }
        }
      }
    }
  }

  // Coordinate descent on a shrinking step. Cheap, and enough: the grid already
  // lands in the right basin and the surface is smooth from there.
  for (let step = 0.05; step >= 0.002; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let axisIndex = 0; axisIndex < 4; axisIndex += 1) {
        for (const direction of [-1, 1]) {
          const candidate = [...best];
          candidate[axisIndex] = (candidate[axisIndex] ?? 0) + direction * step;
          if (axisIndex % 2 === 0) {
            // CSS only accepts x within [0, 1]; a fit outside it is unusable.
            candidate[axisIndex] = Math.min(1, Math.max(0, candidate[axisIndex]!));
          }
          const error = meanError(usable, candidate);
          if (error < bestError - 1e-9) {
            bestError = error;
            best = candidate;
            improved = true;
          }
        }
      }
    }
  }

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const [x1, y1, x2, y2] = best.map(round) as [number, number, number, number];

  // Compared on the curve rather than on the four numbers: two different
  // control points can describe the same shape, and the shape is what matters.
  let keyword: string | null = null;
  for (const candidate of CSS_KEYWORDS) {
    const drift =
      usable.reduce(
        (sum, sample) =>
          sum +
          Math.abs(
            bezierValueAt(...candidate.p, sample.at) -
              bezierValueAt(x1, y1, x2, y2, sample.at),
          ),
        0,
      ) / usable.length;
    if (drift < 0.01) {
      keyword = candidate.name;
      break;
    }
  }

  return {
    x1,
    y1,
    x2,
    y2,
    error: Math.round(bestError * 100000) / 100000,
    css: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
    keyword,
  };
}
