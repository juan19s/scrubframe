import { describe, expect, it } from 'vitest';
import {
  easingFor,
  propertiesOf,
  rangeFor,
  toSpec,
  type ProbedAnimation,
  type ProbedTiming,
  type WaapiProbe,
} from '../src/adapters/waapi-extract';

const BEZIER = 'cubic-bezier(0.22, 1, 0.36, 1)';
const OTHER = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

function timing(over: Partial<ProbedTiming> = {}): ProbedTiming {
  return {
    delayMs: 0,
    endDelayMs: 0,
    durationMs: 900,
    iterations: 1,
    direction: 'normal',
    fill: 'none',
    easing: 'linear',
    ...over,
  };
}

describe('easingFor — the rule the whole project rests on', () => {
  it('reads a CSS @keyframes animation off the keyframes, not the timing', () => {
    // Measured on Chrome 148: a CSS animation authored with a bezier reports
    // getTiming().easing === "linear" and puts the real curve on every stop.
    // Reading the timing here would print "linear" for the majority of
    // animations on the web — confidently, and wrong.
    const result = easingFor(timing({ easing: 'linear' }), [
      { offset: 0, easing: BEZIER, values: { opacity: '0' } },
      { offset: 1, easing: BEZIER, values: { opacity: '1' } },
    ]);
    expect(result).toEqual({ easing: BEZIER, composed: false });
  });

  it('reads a CSS transition off the timing, not the keyframes', () => {
    // The exact mirror image, also measured: transitions carry the curve on the
    // effect and leave every keyframe linear.
    const result = easingFor(timing({ easing: BEZIER }), [
      { offset: 0, easing: 'linear', values: { transform: 'none' } },
      { offset: 1, easing: 'linear', values: { transform: 'translateY(-8px)' } },
    ]);
    expect(result).toEqual({ easing: BEZIER, composed: false });
  });

  it('refuses to name one curve when both levels bite', () => {
    // Measured: effect B and keyframe B give 0.968 at the midpoint, not
    // B(0.5)=0.776. They compose and cannot be flattened, so naming either one
    // would be a fabricated curve a developer would paste into production.
    const result = easingFor(timing({ easing: BEZIER }), [
      { offset: 0, easing: BEZIER, values: { opacity: '0' } },
      { offset: 1, easing: BEZIER, values: { opacity: '1' } },
    ]);
    expect(result.composed).toBe(true);
    expect(result.easing).toContain('composed');
    expect(result.easing).toContain('not a single cubic-bezier');
  });

  it('ignores the last stop, which starts no segment', () => {
    // A CSS animation puts the shorthand's curve on the final keyframe too,
    // where it governs nothing. Counting it would break "all segments agree".
    const result = easingFor(timing({ easing: 'linear' }), [
      { offset: 0, easing: BEZIER, values: { opacity: '0' } },
      { offset: 1, easing: OTHER, values: { opacity: '1' } },
    ]);
    expect(result.easing).toBe(BEZIER);
  });

  it('lists the segments when they genuinely differ', () => {
    const result = easingFor(timing({ easing: 'linear' }), [
      { offset: 0, easing: BEZIER, values: { opacity: '0' } },
      { offset: 0.6, easing: OTHER, values: { opacity: '1' } },
      { offset: 1, easing: BEZIER, values: { opacity: '1' } },
    ]);
    expect(result.easing).toBe(`per segment: ${BEZIER} then ${OTHER}`);
    expect(result.composed).toBe(false);
  });

  it('falls back to the effect easing for a one-keyframe animation', () => {
    // element.animate([{filter:'blur(4px)'}], …) really does return one stop.
    const result = easingFor(timing({ easing: 'ease-in' }), [
      { offset: 1, easing: 'linear', values: { filter: 'blur(4px)' } },
    ]);
    expect(result.easing).toBe('ease-in');
  });
});

describe('propertiesOf', () => {
  const animation: ProbedAnimation = {
    origin: 'css-animation',
    name: 'card-rise',
    target: 'article.card',
    pseudoElement: null,
    endTimeMs: 1050,
    timing: timing({ delayMs: 150, easing: 'linear' }),
    keyframes: [
      { offset: 0, easing: BEZIER, values: { opacity: '0', transform: 'translateY(48px)' } },
      { offset: 0.6, easing: OTHER, values: { opacity: '1', transform: 'translateY(-6px)' } },
      { offset: 1, easing: BEZIER, values: { opacity: '1', transform: 'translateY(0px)' } },
    ],
  };

  it('emits one row per property, named the way CSS names it', () => {
    const rows = propertiesOf(animation);
    expect(rows.map((row) => row.property)).toEqual(['opacity', 'transform']);
  });

  it('keeps the middle stops that from/to would hide', () => {
    const [opacity] = propertiesOf(animation);
    expect(opacity?.from).toBe('0');
    expect(opacity?.to).toBe('1');
    expect(opacity?.stops).toHaveLength(3);
    expect(opacity?.stops?.[2]?.easing).toBeNull();
  });

  it('carries the delay and duration onto every row', () => {
    for (const row of propertiesOf(animation)) {
      expect(row.delayMs).toBe(150);
      expect(row.durationMs).toBe(900);
    }
  });

  it('converts camelCase back to CSS', () => {
    const rows = propertiesOf({
      ...animation,
      keyframes: [
        { offset: 0, easing: 'linear', values: { backgroundColor: 'red' } },
        { offset: 1, easing: 'linear', values: { backgroundColor: 'blue' } },
      ],
    });
    expect(rows[0]?.property).toBe('background-color');
  });

  it('leaves custom properties alone', () => {
    const rows = propertiesOf({
      ...animation,
      keyframes: [
        { offset: 0, easing: 'linear', values: { '--sf-x': '0' } },
        { offset: 1, easing: 'linear', values: { '--sf-x': '10' } },
      ],
    });
    expect(rows[0]?.property).toBe('--sf-x');
  });
});

describe('toSpec', () => {
  const empty: WaapiProbe = { animations: [], skipped: 0, skippedReasons: [] };

  it('never claims it cannot read timing when it simply found none', () => {
    // spec: null makes ANIMATION.md print "this adapter cannot read the
    // underlying timing" — a false statement about an adapter that can.
    const spec = toSpec(empty);
    expect(spec.properties).toEqual([]);
    expect(spec.notes).toContain('fill: none');
    expect(spec.deterministic).toBe(true);
  });

  it('counts what it could not attribute instead of guessing', () => {
    const spec = toSpec({ ...empty, skipped: 2, skippedReasons: ['effect has no target'] });
    expect(spec.notes).toContain('2 effect(s)');
    expect(spec.notes).toContain('effect has no target');
  });

  it('warns when a curve is composed rather than copyable', () => {
    const spec = toSpec({
      animations: [
        {
          origin: 'script',
          name: '',
          target: 'div',
          pseudoElement: null,
          endTimeMs: 1000,
          timing: timing({ easing: BEZIER, durationMs: 1000 }),
          keyframes: [
            { offset: 0, easing: BEZIER, values: { opacity: '0' } },
            { offset: 1, easing: BEZIER, values: { opacity: '1' } },
          ],
        },
      ],
      skipped: 0,
      skippedReasons: [],
    });
    expect(spec.notes).toContain('compose');
    expect(spec.notes).toContain('raw keyframes');
  });
});

describe('rangeFor', () => {
  const base: ProbedAnimation = {
    origin: 'css-animation',
    name: 'a',
    target: 'div',
    pseudoElement: null,
    endTimeMs: 1050,
    timing: timing(),
    keyframes: [],
  };

  it('spans to the latest end across every animation', () => {
    expect(
      rangeFor({
        animations: [base, { ...base, endTimeMs: 2400 }],
        skipped: 0,
        skippedReasons: [],
      }),
    ).toEqual({ from: 0, to: 2400 });
  });

  it('captures one iteration of an animation that repeats forever', () => {
    // null is how the page reports Infinity, which JSON cannot carry. Letting
    // it through would make every seek NaN.
    const range = rangeFor({
      animations: [{ ...base, endTimeMs: null, timing: timing({ delayMs: 100, durationMs: 800 }) }],
      skipped: 0,
      skippedReasons: [],
    });
    expect(range).toEqual({ from: 0, to: 900 });
  });

  it('gives an empty range for nothing', () => {
    expect(rangeFor({ animations: [], skipped: 0, skippedReasons: [] })).toEqual({
      from: 0,
      to: 0,
    });
  });
});
