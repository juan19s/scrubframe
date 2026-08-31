import type { AdapterId } from '../shared/types';
import type { AnimatedProperty, AnimationSpec, PropertyStop } from './types';

/**
 * Turns what the page reported into the timing table ANIMATION.md renders.
 *
 * This is the payload of the whole project — the exact curve read from the
 * page rather than inferred from pixels — so it is a pure function over a plain
 * payload, and every rule below is asserted in tests.
 */

/** One keyframe, as the page serialised it. */
export interface ProbedKeyframe {
  offset: number;
  /** The easing of the segment STARTING at this stop. */
  easing: string;
  values: Record<string, string>;
}

export interface ProbedTiming {
  delayMs: number;
  endDelayMs: number;
  /** Resolved. `getTiming()` can say the string 'auto'; the page resolves it. */
  durationMs: number;
  iterations: number | null;
  direction: string;
  fill: string;
  /** From getTiming(), which holds the AUTHORED value. */
  easing: string;
}

export interface ProbedAnimation {
  /** 'css-animation' | 'css-transition' | 'script'. */
  origin: string;
  /** @keyframes name, transition property, or ''. */
  name: string;
  /** Readable target, for the notes. */
  target: string;
  pseudoElement: string | null;
  keyframes: ProbedKeyframe[];
  timing: ProbedTiming;
  /** Null means infinite — JSON cannot carry Infinity. */
  endTimeMs: number | null;
}

export interface WaapiProbe {
  animations: ProbedAnimation[];
  /** Effects we could not attribute, counted rather than guessed at. */
  skipped: number;
  skippedReasons: string[];
}

/**
 * The easing rule, and the single most important function in the project.
 *
 * There are TWO easings and neither one is the answer on its own. Measured on
 * Chrome 148:
 *
 *   CSS @keyframes  getTiming().easing is ALWAYS "linear"; the authored curve
 *                   sits on every keyframe. 4 of 4 animations measured.
 *   CSS transition  the exact mirror: getTiming().easing carries the curve and
 *                   every keyframe easing is "linear".
 *   element.animate either, both, or neither.
 *
 * So "just read getTiming().easing" reports linear for every CSS animation on
 * the web, and "just read the keyframe easing" reports linear for every
 * transition. Both are wrong, in opposite directions, and both are wrong
 * CONFIDENTLY — which is the one outcome this project must not produce.
 *
 * And when both levels are non-linear they COMPOSE, effect first then segment.
 * Measured with B = cubic-bezier(0.4, 0, 0.2, 1): either alone gives 0.7756 at
 * the midpoint, both together give 0.9681 = B(B(0.5)). That cannot be flattened
 * into one cubic-bezier, so naming either one alone would be a fabricated
 * curve. In that case we describe it and point at the raw keyframes.
 */
export function easingFor(
  timing: ProbedTiming,
  keyframes: ProbedKeyframe[],
): { easing: string; composed: boolean } {
  const effect = timing.easing;
  // The last stop starts no segment, so its easing governs nothing. Dropping it
  // is what makes "all the segments agree" mean anything for the ordinary
  // two-stop case.
  const segments = keyframes.slice(0, -1).map((frame) => frame.easing);
  const uniform =
    segments.length > 0 && segments.every((value) => value === segments[0])
      ? segments[0]!
      : null;

  if (segments.length === 0) return { easing: effect, composed: false };
  if (effect === 'linear' && uniform) return { easing: uniform, composed: false };
  if (effect === 'linear') {
    return { easing: `per segment: ${segments.join(' then ')}`, composed: false };
  }
  if (uniform === 'linear') return { easing: effect, composed: false };
  return {
    easing: `${effect} then ${uniform ?? `per segment: ${segments.join(' then ')}`}` +
      ' (composed — not a single cubic-bezier)',
    composed: true,
  };
}

/** Every property the keyframes mention, in the order they first appear. */
export function propertiesOf(animation: ProbedAnimation): AnimatedProperty[] {
  const names: string[] = [];
  for (const frame of animation.keyframes) {
    for (const property of Object.keys(frame.values)) {
      if (!names.includes(property)) names.push(property);
    }
  }

  const { easing, composed } = easingFor(animation.timing, animation.keyframes);

  return names.map((property) => {
    const stops: PropertyStop[] = animation.keyframes
      .filter((frame) => frame.values[property] !== undefined)
      .map((frame, index, all) => ({
        offset: frame.offset,
        value: frame.values[property]!,
        easing: index === all.length - 1 ? null : frame.easing,
      }));

    const first = stops[0];
    const last = stops[stops.length - 1];
    const row: AnimatedProperty = {
      property: toCssName(property),
      from: first?.value ?? '',
      to: last?.value ?? '',
      durationMs: animation.timing.durationMs,
      delayMs: animation.timing.delayMs,
      easing,
    };
    if (composed) row.composedEasing = true;
    // from/to would silently hide a 0% / 60% / 100% animation's middle.
    if (stops.length > 2) row.stops = stops;
    return row;
  });
}

/**
 * The spec for a whole probe.
 *
 * Never returns null when the probe ran, even with nothing to report: a null
 * spec makes ANIMATION.md print "this adapter cannot read the underlying
 * timing", which is a false statement about an adapter that can. An empty table
 * plus the reason is the honest version.
 */
export function toSpec(probe: WaapiProbe, adapter: AdapterId = 'waapi'): AnimationSpec {
  const properties = probe.animations.flatMap(propertiesOf);
  const notes: string[] = [];

  if (probe.animations.length === 0) {
    notes.push(
      'No animation on this element was current or in effect when the capture started.' +
        ' A one-shot reveal with `fill: none` disappears from getAnimations() once it' +
        ' finishes, so reload the page and capture before it plays.',
    );
  }
  if (probe.skipped > 0) {
    notes.push(
      `${probe.skipped} effect(s) were left out because their target could not be read:` +
        ` ${[...new Set(probe.skippedReasons)].join(', ')}.`,
    );
  }
  if (properties.some((property) => property.composedEasing)) {
    notes.push(
      'One or more rows have easing at BOTH the effect and keyframe level. Those compose' +
        ' (effect first, then the segment) and cannot be written as a single cubic-bezier —' +
        ' the raw keyframes below are the authority.',
    );
  }
  for (const animation of probe.animations) {
    if (animation.endTimeMs === null) {
      notes.push(`\`${animation.name || animation.target}\` repeats forever; one iteration was captured.`);
    }
  }

  const spec: AnimationSpec = {
    adapter,
    deterministic: true,
    properties,
    rawKeyframes: probe.animations.map((animation) => ({
      origin: animation.origin,
      name: animation.name,
      target: animation.target + (animation.pseudoElement ?? ''),
      timing: animation.timing,
      keyframes: animation.keyframes,
    })),
  };
  if (notes.length > 0) spec.notes = notes.join('\n\n');
  return spec;
}

/**
 * The scrubbable range: 0 to the latest end time across every animation.
 *
 * An infinite animation reports null rather than Infinity — JSON cannot carry
 * Infinity, and letting it reach the capture loop would make every seek NaN.
 * One iteration is the honest thing to capture.
 */
export function rangeFor(probe: WaapiProbe): { from: number; to: number } {
  let end = 0;
  for (const animation of probe.animations) {
    const finite =
      animation.endTimeMs ??
      animation.timing.delayMs + animation.timing.durationMs + animation.timing.endDelayMs;
    if (Number.isFinite(finite)) end = Math.max(end, finite);
  }
  return { from: 0, to: end };
}

/** backgroundColor -> background-color, so the table reads like CSS. */
function toCssName(property: string): string {
  if (property.startsWith('--')) return property;
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
