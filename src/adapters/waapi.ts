import type { CdpSession } from '../background/cdp-session';
import { CdpError } from '../background/cdp-session';
import type { Rect, VisualViewport } from '../background/geometry';
import { clampToViewport, padRect, quadToRect, snapRect } from '../background/geometry';
import { STAGE_PADDING } from '../background/element-handle';
import { AWAIT_PAINT } from './page-scripts';
import { bezierValueAt } from './bezier-fit';
import { curveFromCssEasing } from './spacing';
import { easingFor, rangeFor, toSpec, type WaapiProbe } from './waapi-extract';
import type { AnimationSpec, CaptureAdapter, TimelineRange } from './types';

const GLOBAL = '__scrubframeWaapi';
/** Restores the page even if resume() never runs — banner Cancel, worker evicted. */
const WATCHDOG_MS = 120_000;

/**
 * Freezes the document timeline and steps it by hand.
 *
 * Driven from the page rather than through CDP's Animation domain, and not as a
 * close call. That domain has no command that lists animations — ids arrive
 * only through events this extension has no listener for — and worse,
 * Animation.seekAnimations pours a millisecond value into every animation it is
 * given, including scroll-driven ones whose timeline is a percentage. The
 * page-side setter refuses those with a named exception instead. This project
 * already turns down a hijacked scroll because "frames would look right and be
 * wrong"; the CDP path is a machine for producing exactly that.
 *
 * Attribution and driving are deliberately different sets. We REPORT only what
 * animates the chosen element, and we PAUSE everything, because an unrelated
 * header spinner left running would smear across the sheet for reasons the
 * timeline cannot explain.
 */
export function createWaapiAdapter(
  session: CdpSession,
  backendNodeId: number | null,
): CaptureAdapter {
  let probe: WaapiProbe | null = null;

  return {
    id: 'waapi',
    label: 'Web Animations',

    async pause() {
      if (backendNodeId === null) {
        // The whole point of this adapter is reading the timing off a specific
        // element. A drawn rectangle has no element to attribute anything to,
        // so refusing beats capturing frames with an empty timing table.
        throw new CdpError(
          'no-animations',
          'Reading real timing needs an element, not a drawn area. Switch Area to Element, or capture this region with Scroll.',
          'waapi requires an element',
        );
      }
      const result = await callOnElement<{ probe: WaapiProbe; frozen: number }>(
        session,
        backendNodeId,
        PAUSE_FUNCTION,
      );
      // Probed HERE, not in extractSpec(). An animation with `fill: none`
      // parked at its own end time is no longer "current or in effect" and
      // vanishes from getAnimations() — so probing after the seek loop, which
      // is when extractSpec() is called, returns nothing for the single most
      // common capture there is: a one-shot reveal.
      probe = result.probe;
      // These are two different situations and conflating them produced a
      // message that sent the user looking for the wrong problem: "no duration
      // to step through" when the real answer was "that element is not the one
      // animating". `frozen` counts the whole page; `animations` counts this
      // element.
      if (result.probe.animations.length === 0) {
        throw new CdpError(
          'no-animations',
          result.frozen > 0
            ? `Nothing on this element is animating — though ${result.frozen} other animation(s) are running on the page. Run "What is animating here?" — it lists them and says which adapter to use.`
            : 'Nothing on this page is animating right now. A one-shot reveal disappears once it has played, so reload and capture before it runs — or use the scroll adapter.',
          `attributed 0 of ${result.frozen} frozen`,
        );
      }
      return result;
    },

    async getRange() {
      if (!probe) throw new CdpError('unknown', 'Call pause() first.', 'no probe');
      const range = rangeFor(probe);
      if (range.to - range.from < 1) {
        throw new CdpError(
          'no-animations',
          'The animations on this element have no duration to step through.',
          `range ${range.from}..${range.to}`,
        );
      }
      return { ...range, unit: 'ms' } satisfies TimelineRange;
    },

    /**
     * The crop, from where the element sits right now, padded generously.
     *
     * Unlike scroll, the element's path here is arbitrary — it can translate,
     * scale or rotate anywhere — so there is nothing to derive it from without
     * a warm-up sweep, and a sweep would run the animation once before
     * capturing it and consume any one-shot reveal. Padding wide is the honest
     * trade; ANIMATION.md says the element travels through a fixed window.
     */
    async stage() {
      if (backendNodeId === null) {
        throw new CdpError('unknown', 'A drawn region is its own stage.', 'no element');
      }
      const { box, viewport } = await measure(session, backendNodeId);
      const generous = Math.max(STAGE_PADDING, Math.round(Math.max(box.width, box.height) * 0.25));
      return snapRect(clampToViewport(padRect(box, generous), viewport));
    },

    async seek(position) {
      const landed = await evaluate<{
        at: number;
        painted: boolean;
        hidden: boolean;
        refused: number;
      }>(session, seekSource(position), true);

      if (landed.hidden) {
        throw new CdpError(
          'tab-hidden',
          'This tab has to stay visible while capturing — a background tab never paints, and its timeline never advances.',
          'document.hidden was true during a seek',
        );
      }
      return landed.at;
    },

    async resume() {
      await evaluate(session, resumeSource(), true).catch(() => {
        // The page may be gone. Nothing left to restore.
      });
    },

    /** The longest animation's easing, parsed from its cubic-bezier. */
    curve() {
      if (!probe || probe.animations.length === 0) return null;
      const dominant = probe.animations.reduce((longest, animation) =>
        animation.timing.durationMs > longest.timing.durationMs ? animation : longest,
      );
      const { easing, composed } = easingFor(dominant.timing, dominant.keyframes);
      // A composed easing is two curves applied in sequence and is not one
      // bezier, so there is nothing single to invert. Even spacing, honestly.
      if (composed) return null;
      return curveFromCssEasing(easing, bezierValueAt);
    },

    async extractSpec(): Promise<AnimationSpec | null> {
      return probe ? toSpec(probe) : null;
    },
  };
}

/**
 * Freezes every time-based animation and probes the ones that belong to the
 * element.
 *
 * `pause()` on its own is not enough, and this is the subtlety that decides
 * whether the capture is deterministic: pause() only QUEUES a pending pause
 * task, leaving startTime resolved and currentTime still advancing until the
 * next frame — and in a tab that never gets a next frame it never commits at
 * all. Writing currentTime immediately after is what takes the hold time and
 * detaches startTime, in the same task.
 */
const PAUSE_FUNCTION = `async function () {
    const element = this;
    const state = { entries: [], watchdog: 0 };

    const collect = (root, out) => {
      if (root.getAnimations) for (const a of root.getAnimations({ subtree: true })) out.add(a);
      // getAnimations is scoped to a tree scope and never crosses a shadow
      // boundary, in either direction — so open roots are walked by hand, the
      // same way the picker's marker lookup does it.
      const walk = (node) => {
        for (const el of node.querySelectorAll('*')) {
          if (el.shadowRoot) {
            for (const a of el.shadowRoot.getAnimations()) out.add(a);
            walk(el.shadowRoot);
          }
        }
      };
      walk(root === document ? document : root);
      return out;
    };

    const mine = collect(element, new Set());
    const probe = { animations: [], skipped: 0, skippedReasons: [] };

    for (const a of mine) {
      const effect = a.effect;
      if (!effect || typeof effect.getKeyframes !== 'function') {
        probe.skipped += 1;
        probe.skippedReasons.push(effect ? 'effect exposes no keyframes' : 'animation has no effect');
        continue;
      }
      const timing = effect.getTiming();
      const computed = effect.getComputedTiming();
      const duration = typeof timing.duration === 'number' ? timing.duration
        : typeof computed.duration === 'number' ? computed.duration : 0;
      const endTime = typeof computed.endTime === 'number' && Number.isFinite(computed.endTime)
        ? computed.endTime : null;
      probe.animations.push({
        origin: a.constructor?.name === 'CSSAnimation' ? 'css-animation'
          : a.constructor?.name === 'CSSTransition' ? 'css-transition' : 'script',
        name: a.animationName ?? a.transitionProperty ?? '',
        target: effect.target ? (effect.target.tagName ?? '').toLowerCase() : '(unknown)',
        pseudoElement: effect.pseudoElement ?? null,
        keyframes: effect.getKeyframes().map((k) => {
          const { offset, computedOffset, easing, composite, ...values } = k;
          return { offset: computedOffset ?? offset ?? 0, easing: easing ?? 'linear', values };
        }),
        timing: {
          delayMs: timing.delay ?? 0,
          endDelayMs: timing.endDelay ?? 0,
          durationMs: duration,
          iterations: Number.isFinite(timing.iterations) ? timing.iterations : null,
          direction: timing.direction ?? 'normal',
          fill: computed.fill ?? timing.fill ?? 'auto',
          easing: timing.easing ?? 'linear',
        },
        endTimeMs: endTime,
      });
    }

    // Drive broadly: anything still moving would change between frames for
    // reasons the timeline cannot account for.
    let frozen = 0;
    for (const a of collect(document, new Set())) {
      try {
        const before = { playState: a.playState, currentTime: a.currentTime, startTime: a.startTime };
        a.pause();
        a.currentTime = a.currentTime;
        state.entries.push({ animation: a, before });
        frozen += 1;
      } catch {
        // Progress-based (scroll-driven) animations refuse an absolute
        // currentTime. Leaving them alone is correct: their timeline is the
        // scroll position, which this adapter is not moving.
      }
    }

    globalThis.${GLOBAL} = state;
    state.watchdog = setTimeout(() => {
      try { globalThis.${GLOBAL}?.entries.forEach(restore); } catch {}
    }, ${WATCHDOG_MS});
    function restore(entry) {
      try {
        entry.animation.currentTime = entry.before.currentTime;
        if (entry.before.playState === 'running') entry.animation.play();
      } catch {}
    }

    return { probe, frozen };
  }`;

function seekSource(position: number): string {
  return `(async () => {
    const state = globalThis.${GLOBAL};
    let refused = 0;
    if (state) {
      for (const entry of state.entries) {
        try { entry.animation.currentTime = ${position}; } catch { refused += 1; }
      }
    }
    const paint = await ${AWAIT_PAINT};
    return { at: ${position}, refused, ...paint };
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
        entry.animation.currentTime = entry.before.currentTime;
        if (entry.before.playState === 'running') entry.animation.play();
        restored += 1;
      } catch {}
    }
    delete globalThis.${GLOBAL};
    return restored;
  })()`;
}

/**
 * Runs page code with the chosen element as `this`.
 *
 * DOM.resolveNode turns the node handle back into a real JS reference, so the
 * element crosses without being re-found by selector — no second lookup to go
 * stale, and no dependence on the marker attribute surviving whatever the page
 * does to its own DOM mid-run.
 */
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
      throw new CdpError(
        'unknown',
        'The page rejected an animation command.',
        called.exceptionDetails.text,
      );
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

async function evaluate<T>(session: CdpSession, expression: string, awaitPromise = false): Promise<T> {
  const evaluated = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (evaluated.exceptionDetails) {
    throw new CdpError('unknown', 'The page rejected an animation command.', evaluated.exceptionDetails.text);
  }
  return evaluated.result.value as T;
}
