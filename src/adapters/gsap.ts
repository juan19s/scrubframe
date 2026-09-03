import type { CdpSession } from '../background/cdp-session';
import { CdpError } from '../background/cdp-session';
import type { Rect, VisualViewport } from '../background/geometry';
import { clampToViewport, padRect, quadToRect, snapRect } from '../background/geometry';
import { STAGE_PADDING } from '../background/element-handle';
import { fitCubicBezier } from './bezier-fit';
import { AWAIT_PAINT } from './page-scripts';
import type { AnimationSpec, CaptureAdapter, TimelineRange } from './types';

const GLOBAL = '__scrubframeGsap';
/** Where the page samples the ease. Kept in step with SAMPLE_AT below. */
const SAMPLE_POINTS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const WATCHDOG_MS = 120_000;

/** One tween, as the page reported it. */
interface ProbedTween {
  index: number;
  durationMs: number;
  repeat: number;
  target: string;
  properties: string[];
  /** What the page author wrote. GSAP's own vocabulary, not a CSS curve. */
  ease: string;
  /** The resolved curve, sampled. Numbers rather than a name nobody can act on. */
  easeSamples: number[];
  /** Nearest standard GSAP ease, and how far off it is. A fit, not a fact. */
  easeFit: { name: string; error: number } | null;
  /** The values the tween animates TO. GSAP computes `from` at run time. */
  to: Record<string, string | number>;
  scrollDriven: boolean;
}

interface GsapProbe {
  version: string;
  tweens: ProbedTween[];
  scrollDriven: number;
}

/**
 * Steps GSAP tweens by hand.
 *
 * The SPEC prescribes `gsap.globalTimeline.pause()` and `.time(t)`. Measured on
 * a live GSAP 3.15 site: that moves nothing. The global timeline is the root
 * clock rather than an ordinary timeline, and seeking it does not re-render its
 * children. Seeking each tween — `tween.time(t)` — does, and visibly: a
 * `power2.out` tween read back 57.8 of 100 at quarter progress, which is
 * exactly the curve.
 *
 * So this drives tweens individually, and refuses the ones it cannot: a tween
 * owned by ScrollTrigger ignores `progress()` because ScrollTrigger rewrites it
 * on every tick. Those are the scroll adapter's, and saying so beats seeking
 * them into frames that never change.
 */
export function createGsapAdapter(
  session: CdpSession,
  backendNodeId: number | null,
): CaptureAdapter {
  let probe: GsapProbe | null = null;

  return {
    id: 'gsap',
    label: 'GSAP',

    async pause() {
      if (backendNodeId === null) {
        throw new CdpError(
          'no-animations',
          'GSAP timing is read off an element, not a drawn area. Switch Area to Element, or capture this region with Scroll.',
          'gsap requires an element',
        );
      }
      const result = await callOnElement<GsapProbe>(session, backendNodeId, PAUSE_FUNCTION);
      probe = result;

      if (result.tweens.length === 0) {
        throw new CdpError(
          'no-animations',
          result.scrollDriven > 0
            ? `Every GSAP tween on this element is driven by ScrollTrigger (${result.scrollDriven} of them), and those follow the scroll position rather than a clock. Use Scroll.`
            : 'No GSAP tween animates this element. Run "What is animating here?" to see which elements do.',
          `${result.scrollDriven} scroll-driven, 0 time-driven`,
        );
      }
      return result;
    },

    async getRange() {
      if (!probe) throw new CdpError('unknown', 'Call pause() first.', 'no probe');
      // Each tween is stepped from its own zero: the global timeline cannot be
      // scrubbed, so there is no shared axis to place them on. The range is the
      // longest one, and ANIMATION.md says they run in parallel rather than
      // pretending to a composed timeline that does not exist.
      const longest = Math.max(...probe.tweens.map((tween) => tween.durationMs));
      if (!Number.isFinite(longest) || longest < 1) {
        throw new CdpError('no-animations', 'These tweens have no duration to step.', `${longest}`);
      }
      return { from: 0, to: longest, unit: 'ms' } satisfies TimelineRange;
    },

    async stage() {
      if (backendNodeId === null) {
        throw new CdpError('unknown', 'A drawn region is its own stage.', 'no element');
      }
      const { box, viewport } = await measure(session, backendNodeId);
      const generous = Math.max(STAGE_PADDING, Math.round(Math.max(box.width, box.height) * 0.25));
      return snapRect(clampToViewport(padRect(box, generous), viewport));
    },

    async seek(position) {
      const landed = await evaluate<{ at: number; painted: boolean; hidden: boolean }>(
        session,
        seekSource(position),
      );
      if (landed.hidden) {
        throw new CdpError(
          'tab-hidden',
          'This tab has to stay visible while capturing — a background tab never paints.',
          'document.hidden was true during a seek',
        );
      }
      return landed.at;
    },

    async resume() {
      await evaluate(session, resumeSource()).catch(() => {
        // The page may be gone. Nothing left to restore.
      });
    },

    async extractSpec(): Promise<AnimationSpec | null> {
      if (!probe) return null;
      return {
        adapter: 'gsap',
        deterministic: true,
        properties: probe.tweens.flatMap((tween) =>
          tween.properties.map((property) => ({
            property,
            // GSAP reads the start value off the element when the tween runs, so
            // there is no authored `from`. The `to` is authored, and is in vars.
            from: '(read from the element at run time)',
            to: String(tween.to[property] ?? '(see raw tweens)'),
            durationMs: tween.durationMs,
            delayMs: 0,
            easing: describeEase(tween),
          })),
        ),
        rawKeyframes: probe.tweens.map((tween) => ({ ...tween })),
        notes: [
          `GSAP ${probe.version}. Each tween is stepped from its own zero: GSAP's global timeline is the root clock, not an ordinary timeline, and seeking it does not re-render children — measured, not assumed. So these run in parallel here, which may not be how the page sequences them.`,
          probe.scrollDriven > 0
            ? `${probe.scrollDriven} further tween(s) on this element are driven by ScrollTrigger and were left alone; capture those with the scroll adapter.`
            : '',
          'GSAP eases are functions in GSAP\'s own vocabulary, not CSS curves — a Webflow site reports names like "Ease" or "Out". So each curve was SAMPLED from the page\'s real easing function and a `cubic-bezier()` fitted to those samples. The samples are measurements; the bezier is a fit, and its error is printed so you can judge it. Where the fit lands on a curve CSS already names, the keyword is given instead.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    },
  };
}

const PAUSE_FUNCTION = `function () {
  const element = this;
  const g = globalThis.gsap;
  if (!g) throw new Error('GSAP is not on this page');

  const children = g.globalTimeline.getChildren(true, true, false)
    .filter((t) => typeof t.duration === 'function' && t.duration() > 0);

  const owned = [];
  let scrollDriven = 0;
  for (const tween of children) {
    const targets = typeof tween.targets === 'function' ? tween.targets() : [];
    const hits = targets.some((t) => t && t.nodeType === 1 && (t === element || element.contains(t)));
    if (!hits) continue;
    // ScrollTrigger rewrites progress on every tick, so seeking these produces
    // frames that never change. They belong to the scroll adapter.
    if (tween.vars && tween.vars.scrollTrigger) { scrollDriven += 1; continue; }
    owned.push(tween);
  }

  const state = { entries: [], watchdog: 0 };
  const probe = { version: g.version || '?', tweens: [], scrollDriven };

  const SAMPLE_AT = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
  const KNOWN = ['none','power1.in','power1.out','power1.inOut','power2.in','power2.out','power2.inOut','power3.out','power3.inOut','power4.out','expo.in','expo.out','expo.inOut','sine.out','sine.inOut','back.out','circ.out'];
  const round = (n) => Math.round(n * 10000) / 10000;

  owned.forEach((tween, index) => {
    const target = tween.targets()[0];
    const authored = typeof tween.vars.ease === 'string' ? tween.vars.ease
      : (tween.vars.ease && tween.vars.ease.name) || '(default)';
    const animated = Object.keys(tween.vars || {}).filter(
      (k) => !['duration','delay','ease','repeat','yoyo','stagger','onComplete','onUpdate','scrollTrigger','paused','immediateRender','lazy','overwrite','parent','startAt','inherit','data','id','callbackScope','repeatDelay','onStart','onReverseComplete','runBackwards','keyframes'].includes(k),
    );

    // Sampling beats naming. GSAP eases are its own vocabulary — a Webflow site
    // reports things like "Out" — and none of them are CSS curves. The numbers
    // are what a model can actually fit something to.
    let samples = [];
    let fit = null;
    try {
      const resolved = g.parseEase(tween.vars.ease);
      if (typeof resolved === 'function') {
        samples = SAMPLE_AT.map((p) => round(resolved(p)));
        let best = null;
        for (const name of KNOWN) {
          const other = g.parseEase(name);
          if (typeof other !== 'function') continue;
          const error = SAMPLE_AT.reduce((sum, p) => sum + Math.abs(other(p) - resolved(p)), 0);
          if (!best || error < best.error) best = { name, error: round(error) };
        }
        fit = best;
      }
    } catch {
      // An ease we cannot resolve is reported by name alone.
    }

    state.entries.push({ tween, time: tween.time(), paused: tween.paused() });
    tween.pause();
    probe.tweens.push({
      index,
      durationMs: Math.round(tween.duration() * 1000),
      repeat: (tween.vars && tween.vars.repeat) || 0,
      target: target && target.tagName
        ? target.tagName.toLowerCase() + (target.className && typeof target.className === 'string'
            ? '.' + target.className.split(' ')[0] : '')
        : '(object)',
      properties: animated,
      ease: authored,
      easeSamples: samples,
      easeFit: fit,
      to: Object.fromEntries(
        animated
          .map((k) => [k, tween.vars[k]])
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number'),
      ),
      scrollDriven: false,
    });
  });

  globalThis.${GLOBAL} = state;
  state.watchdog = setTimeout(() => {
    try {
      globalThis.${GLOBAL}.entries.forEach((e) => {
        try { e.tween.time(e.time); if (!e.paused) e.tween.play(); } catch {}
      });
    } catch {}
  }, ${WATCHDOG_MS});

  return probe;
}`;

function seekSource(positionMs: number): string {
  return `(async () => {
    const state = globalThis.${GLOBAL};
    if (state) {
      for (const entry of state.entries) {
        // Clamped: a tween shorter than the range holds its end rather than
        // wrapping, which is what the page would show anyway.
        const seconds = Math.min(${positionMs} / 1000, entry.tween.duration());
        try { entry.tween.time(seconds); } catch {}
      }
    }
    const paint = await ${AWAIT_PAINT};
    return { at: ${positionMs}, ...paint };
  })()`;
}

function resumeSource(): string {
  return `(() => {
    const state = globalThis.${GLOBAL};
    if (!state) return 0;
    clearTimeout(state.watchdog);
    let restored = 0;
    for (const entry of state.entries) {
      try {
        entry.tween.time(entry.time);
        if (!entry.paused) entry.tween.play();
        restored += 1;
      } catch {}
    }
    delete globalThis.${GLOBAL};
    return restored;
  })()`;
}

/**
 * The easing cell, measured first and named second.
 *
 * A GSAP ease is a function named in GSAP's own vocabulary, and on a Webflow
 * site that name can be as unhelpful as "Out". So the curve is sampled and
 * matched against the standard eases: the samples are fact, the name is a fit,
 * and the label says which is which so nobody pastes a guess as a certainty.
 */
function describeEase(tween: ProbedTween): string {
  const parts: string[] = [tween.ease];

  // The bezier first, because it is the only part of this a developer can
  // actually paste. A GSAP ease name is not a CSS curve; this is.
  const bezier = fitCubicBezier(
    tween.easeSamples.map((value, index) => ({
      at: SAMPLE_POINTS[index] ?? index / (tween.easeSamples.length - 1),
      value,
    })),
  );
  if (bezier && bezier.error < 0.02) {
    parts.push(
      bezier.keyword
        ? `= CSS \`${bezier.keyword}\` (${bezier.css}, fitted, error ${bezier.error})`
        : `≈ ${bezier.css} (fitted, error ${bezier.error})`,
    );
  }

  if (tween.easeFit && tween.easeFit.error < 0.05) {
    parts.push(`≈ GSAP ${tween.easeFit.name}`);
  }
  if (tween.easeSamples.length > 0) {
    parts.push(`curve ${tween.easeSamples.join(', ')}`);
  }
  return parts.join(' · ');
}

async function callOnElement<T>(
  session: CdpSession,
  backendNodeId: number,
  functionDeclaration: string,
): Promise<T> {
  const { object } = await session.send('DOM.resolveNode', { backendNodeId });
  try {
    const called = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration,
      returnByValue: true,
      awaitPromise: true,
    });
    if (called.exceptionDetails) {
      throw new CdpError('no-animations', 'GSAP is not usable on this page.', called.exceptionDetails.text);
    }
    return called.result.value as T;
  } finally {
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
  }
}

async function measure(
  session: CdpSession,
  backendNodeId: number,
): Promise<{ box: Rect; viewport: VisualViewport }> {
  const [{ model }, metrics] = await Promise.all([
    session.send('DOM.getBoxModel', { backendNodeId }),
    session.send('Page.getLayoutMetrics'),
  ]);
  return { box: quadToRect(model.border), viewport: metrics.cssVisualViewport };
}

async function evaluate<T>(session: CdpSession, expression: string): Promise<T> {
  const evaluated = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (evaluated.exceptionDetails) {
    throw new CdpError('unknown', 'The page rejected a GSAP command.', evaluated.exceptionDetails.text);
  }
  return evaluated.result.value as T;
}
