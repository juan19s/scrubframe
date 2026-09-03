import { describe, expect, it } from 'vitest';
import { recommend, type AnimationCensus, type LibraryReport, type PageProbe } from '../src/shared/probe';

function census(over: Partial<AnimationCensus> = {}): AnimationCensus {
  return { waapiTotal: 0, transitions: 0, smil: 0, candidates: [], shadowRoots: 0, ...over };
}

function libraries(over: Partial<LibraryReport> = {}): LibraryReport {
  return {
    gsap: false,
    gsapTweens: 0,
    scrollTrigger: false,
    lottie: false,
    lenis: false,
    motionOne: false,
    ...over,
  };
}

function probe(over: Partial<PageProbe> = {}): PageProbe {
  return { census: census(), libraries: libraries(), mainWorldWaapiTotal: null, ...over };
}

describe('recommend', () => {
  it('sends a GSAP site to Scroll, and says why', () => {
    // The case that motivated all of this: era-residence.com runs 36 GSAP
    // tweens and getAnimations() sees 3. Recommending Time there is exactly the
    // advice that cost an afternoon.
    const result = recommend(
      probe({
        census: census({ waapiTotal: 3 }),
        libraries: libraries({ gsap: true, gsapTweens: 36, scrollTrigger: true }),
      }),
      0,
    );
    expect(result.adapter).toBe('scroll');
    expect(result.reason).toContain('36 live tweens');
    expect(result.reason).toContain('3');
  });

  it('prefers GSAP evidence over a handful of stray CSS animations', () => {
    const result = recommend(
      probe({
        census: census({ waapiTotal: 2 }),
        libraries: libraries({ gsap: true, gsapTweens: 20 }),
      }),
      2,
    );
    // Even with animations on the element, GSAP driving the page means Time
    // would report a fraction of the motion as if it were the whole thing.
    expect(result.adapter).toBe('scroll');
  });

  it('recommends Time when the element genuinely has readable animations', () => {
    const result = recommend(probe({ census: census({ waapiTotal: 4 }) }), 2);
    expect(result.adapter).toBe('waapi');
    expect(result.reason).toContain('real easing');
  });

  it('distinguishes "none here" from "none anywhere"', () => {
    const elsewhere = recommend(probe({ census: census({ waapiTotal: 5 }) }), 0);
    expect(elsewhere.reason).toContain('none on the element you picked');

    const nowhere = recommend(probe(), null);
    expect(nowhere.reason).toContain('Nothing on this page is animating');
  });

  it('warns about Lenis instead of letting a capture fail mysteriously', () => {
    const result = recommend(probe({ libraries: libraries({ lenis: true }) }), 0);
    expect(result.warnings.join(' ')).toContain('Lenis');
  });

  it('says plainly that SMIL cannot be frozen', () => {
    const result = recommend(probe({ census: census({ smil: 4 }) }), 0);
    expect(result.warnings.join(' ')).toContain('SMIL');
    expect(result.warnings.join(' ')).toContain('keep moving through every frame');
  });

  it('flags a disagreement between the two worlds', () => {
    // The negative control. The isolated-world census rests on an argument
    // about Blink's IDL; this turns it into a measurement.
    const result = recommend(
      probe({ census: census({ waapiTotal: 3 }), mainWorldWaapiTotal: 7 }),
      0,
    );
    expect(result.warnings.join(' ')).toContain('7 vs 3');
  });

  it('stays quiet when the worlds agree', () => {
    const result = recommend(
      probe({ census: census({ waapiTotal: 3 }), mainWorldWaapiTotal: 3 }),
      1,
    );
    expect(result.warnings.join(' ')).not.toContain('different animation counts');
  });
});
