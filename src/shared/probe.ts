import type { AdapterId } from './types';

/** One element that visibly animates, for highlighting. */
export interface AnimatedCandidate {
  /** Viewport CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** What drives it: a @keyframes name, a transition property, or 'SMIL'. */
  driver: string;
  kind: 'waapi' | 'smil' | 'gsap' | 'gsap-scroll';
  /** Milliseconds, when the technology reports one. */
  durationMs: number | null;
  /** Which probe found it, so clicking the row can go back to the right world. */
  source: 'census' | 'gsap';
  /** Position within that probe's own list. */
  sourceIndex: number;
}

/** What the census found in the page's DOM. Gathered from the ISOLATED world. */
export interface AnimationCensus {
  /** Every animation the Web Animations API can see, document-wide. */
  waapiTotal: number;
  /** Of those, how many are CSS transitions — transient by nature. */
  transitions: number;
  /** SVG SMIL elements. Invisible to the Web Animations API entirely. */
  smil: number;
  candidates: AnimatedCandidate[];
  /** Open shadow roots walked, since getAnimations() never crosses one. */
  shadowRoots: number;
}

/** Animation libraries, which live in JS globals and so need the MAIN world. */
export interface LibraryReport {
  gsap: boolean;
  /** Live tweens, which is what says whether GSAP is actually driving anything. */
  gsapTweens: number;
  scrollTrigger: boolean;
  lottie: boolean;
  lenis: boolean;
  motionOne: boolean;
}

export interface PageProbe {
  census: AnimationCensus;
  libraries: LibraryReport;
  /**
   * The negative control.
   *
   * The census runs in the ISOLATED world on the argument that getAnimations()
   * carries no [CallWith=ScriptState] in Blink's IDL, so the C++ is never told
   * which world asked and cannot filter by one. Strong, and still an argument.
   * Running the same count in the MAIN world and comparing turns it into a
   * measurement — the same discipline the ADR-002 spike used.
   */
  mainWorldWaapiTotal: number | null;
}

export interface Recommendation {
  adapter: AdapterId;
  /** One sentence, naming what was found rather than what is missing. */
  reason: string;
  /** Things that will bite, whichever adapter is chosen. */
  warnings: string[];
  /** False when the recommended adapter is not built yet. */
  available: boolean;
}

/**
 * Picks the adapter, from what is actually on the page.
 *
 * This exists because of a real afternoon lost: a site whose logo visibly spins
 * reported "nothing on this element is animating". True, and useless — the page
 * runs 36 GSAP tweens and getAnimations() could see 3 of them, because GSAP
 * drives its own requestAnimationFrame ticker and writes inline styles instead
 * of creating Web Animations.
 *
 * Nothing else in this space tells you which road to take. AnimSpec only
 * records; Motion DevTools only reads WAAPI. Being the one that says "use this
 * one, because of that" is the whole idea.
 */
export function recommend(probe: PageProbe, elementWaapi: number | null): Recommendation {
  const { census, libraries } = probe;
  const warnings: string[] = [];

  if (libraries.lenis) {
    warnings.push(
      'This page uses Lenis for smooth scrolling. If a capture comes back with identical frames, that is why — Scrubframe refuses rather than guessing.',
    );
  }
  if (census.smil > 0) {
    warnings.push(
      `${census.smil} SVG SMIL animation(s) here. Nothing can freeze those — they are invisible to the Web Animations API — so they keep moving through every frame.`,
    );
  }
  if (probe.mainWorldWaapiTotal !== null && probe.mainWorldWaapiTotal !== census.waapiTotal) {
    warnings.push(
      `The page and the extension see different animation counts (${probe.mainWorldWaapiTotal} vs ${census.waapiTotal}). Timing may be incomplete.`,
    );
  }

  // GSAP first: when it is driving, the WAAPI count is a rounding error and
  // recommending `waapi` on the strength of it would send the user down the
  // road that just failed them.
  if (libraries.gsap && libraries.gsapTweens > census.waapiTotal) {
    if (libraries.scrollTrigger) {
      warnings.push(
        'ScrollTrigger is here too. Tweens it owns follow the scroll position rather than a clock, so GSAP cannot step those — Scrubframe leaves them alone and says how many.',
      );
    }
    return {
      adapter: 'gsap',
      reason: `This page runs GSAP with ${libraries.gsapTweens} live tweens; the Web Animations API can only see ${census.waapiTotal} of them, so Time would report a fraction of the motion as if it were all of it.`,
      warnings,
      available: true,
    };
  }

  if ((elementWaapi ?? 0) > 0) {
    return {
      adapter: 'waapi',
      reason: `${elementWaapi} animation(s) on this element are visible to the Web Animations API, so Time can read the real easing.`,
      warnings,
      available: true,
    };
  }

  if (census.waapiTotal > 0 && elementWaapi === 0) {
    return {
      adapter: 'scroll',
      reason: `${census.waapiTotal} animation(s) are running on the page but none on the element you picked. Pick one of the highlighted elements for Time, or capture this one with Scroll.`,
      warnings,
      available: true,
    };
  }

  if (census.smil > 0 && census.waapiTotal === 0) {
    return {
      adapter: 'scroll',
      reason:
        'The only motion here is SVG SMIL, which no adapter can step. Scroll captures it as it plays; the frames are real but not reproducible.',
      warnings,
      available: true,
    };
  }

  return {
    adapter: 'scroll',
    reason:
      'Nothing on this page is animating through an API Scrubframe can read. Scroll still works — it moves the page and photographs whatever follows.',
    warnings,
    available: true,
  };
}
