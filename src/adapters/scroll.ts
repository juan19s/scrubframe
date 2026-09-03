import type { CdpSession } from '../background/cdp-session';
import { CdpError } from '../background/cdp-session';
import type { Rect, VisualViewport } from '../background/geometry';
import { clampToViewport, padRect, quadToRect, snapRect } from '../background/geometry';
import { STAGE_PADDING } from '../background/element-handle';
import type { AnimationSpec, TimelineRange } from './types';
import { AWAIT_PAINT } from './page-scripts';

/** How far the real scroll position may miss the target before we stop trusting it. */
const SCROLL_TOLERANCE_PX = 2;

/** Extra scroll on each end, so the first and last frames show before and after. */
const RANGE_PADDING_PX = 80;

/** How the scroll range is chosen. */
export interface RangeOptions {
  /**
   * Fixed pixels per frame, starting from wherever the page is right now.
   *
   * Without it the range is derived: the whole span where the element crosses
   * the viewport. That is the right default for "show me this reveal", and the
   * wrong one when the element's path is long and you want a close look at part
   * of it — twenty frames then land twenty screenfuls apart.
   */
  stepPx?: number;
  frames: number;
}

export interface ScrollAdapter {
  readonly id: 'scroll';
  readonly label: string;
  /** Returns the position it will restore to. */
  pause(): Promise<{ x: number; y: number }>;
  getRange(options: RangeOptions): Promise<TimelineRange>;
  /** The frozen crop, in viewport space. Computed once, after getRange. */
  stage(range: TimelineRange): Promise<Rect>;
  seek(position: number): Promise<number>;
  resume(): Promise<void>;
  extractSpec(): Promise<AnimationSpec | null>;
}

/**
 * Scrolls the page to N positions and lets whatever is driven by scroll follow.
 *
 * The simplest adapter and the one with the widest reach: GSAP ScrollTrigger,
 * CSS scroll-driven animations and IntersectionObserver reveals all ride on it.
 * It never touches time.
 *
 * Two things it refuses to do quietly. It will not capture through a smooth
 * scroll, and it will not capture a page whose scrolling is hijacked — both
 * produce frames that look plausible and are wrong, which is the worst outcome
 * this project can produce.
 */
export function createScrollAdapter(
  session: CdpSession,
  backendNodeId: number | null,
): ScrollAdapter {
  let restoreTo: { x: number; y: number } | null = null;

  return {
    id: 'scroll',
    label: 'Scroll',

    async pause() {
      // Nothing to freeze — scroll has no clock. What pause() owns here is the
      // restore point, and it has to be taken before getRange moves the page.
      const position = await evaluate<{ x: number; y: number }>(
        session,
        '({ x: window.scrollX, y: window.scrollY })',
      );
      restoreTo = position;
      return position;
    },

    async getRange(options) {
      // With a drawn region there is no element to centre the range on, so the
      // user's step is the only intent available — and without one, the whole
      // document is the honest default rather than a guess.
      if (backendNodeId === null) {
        const metrics = await session.send('Page.getLayoutMetrics');
        const maxScroll = Math.max(
          0,
          metrics.cssContentSize.height - metrics.cssVisualViewport.clientHeight,
        );
        const from = clamp(restoreTo?.y ?? 0, 0, maxScroll);
        const to =
          options.stepPx && options.stepPx > 0
            ? clamp(from + options.stepPx * Math.max(1, options.frames - 1), 0, maxScroll)
            : maxScroll;
        if (to - from < 1) {
          throw new CdpError(
            'element-invisible',
            'There is nothing left to scroll from here. Scroll up, or set a step.',
            `range ${from}..${to}`,
          );
        }
        return { from, to, unit: 'px' };
      }

      const { box, viewport, content } = await measure(session, backendNodeId);
      const documentTop = box.y + viewport.pageY;
      const maxScroll = Math.max(0, content.height - viewport.clientHeight);

      // A fixed step starts where the user left the page, because that is how
      // they chose it: they scrolled to the part they care about.
      if (options.stepPx && options.stepPx > 0) {
        const from = clamp(restoreTo?.y ?? 0, 0, maxScroll);
        const span = options.stepPx * Math.max(1, options.frames - 1);
        return { from, to: clamp(from + span, 0, maxScroll), unit: 'px' };
      }

      // Otherwise: the element just below the fold to just above it, instead of
      // sweeping the whole document. On a 10,000px page the document range
      // would spend eleven of twelve frames on nothing.
      const from = clamp(documentTop - viewport.clientHeight - RANGE_PADDING_PX, 0, maxScroll);
      const to = clamp(documentTop + box.height + RANGE_PADDING_PX, 0, maxScroll);

      if (to - from < 1) {
        throw new CdpError(
          'element-invisible',
          'There is nothing to scroll here — the page fits in the window.',
          `range ${from}..${to}, maxScroll ${maxScroll}`,
        );
      }
      return { from, to, unit: 'px' };
    },

    /**
     * The crop, derived rather than swept.
     *
     * Measuring the element at every position first would be more exact, and it
     * would also run the animation once before capturing it — which destroys
     * any one-shot reveal, the exact thing people come here to capture. So the
     * span is computed from one measurement: as the page scrolls from `from` to
     * `to`, the element travels through viewport y `documentTop - to` up to
     * `documentTop - from + height`.
     */
    async stage(range) {
      if (backendNodeId === null) {
        throw new CdpError('unknown', 'A drawn region is its own stage.', 'no element');
      }
      const { box, viewport } = await measure(session, backendNodeId);
      const documentTop = box.y + viewport.pageY;
      const top = documentTop - range.to;
      const bottom = documentTop - range.from + box.height;
      const travelled: Rect = {
        x: box.x,
        y: top,
        width: box.width,
        height: Math.max(1, bottom - top),
      };
      return snapRect(clampToViewport(padRect(travelled, STAGE_PADDING), viewport));
    },

    /** Returns where the page actually landed, which is not always where we asked. */
    async seek(position) {
      const landed = await evaluate<{ y: number; painted: boolean; hidden: boolean }>(
        session,
        `(async () => {
          // 'instant' overrides CSS scroll-behavior: smooth. The spec only
          // consults the computed property for 'auto', so this is not a hint.
          window.scrollTo({ top: ${position}, left: 0, behavior: 'instant' });
          const paint = await ${AWAIT_PAINT};
          return { y: window.scrollY, ...paint };
        })()`,
        true,
      );

      if (landed.hidden) {
        throw new CdpError(
          'tab-hidden',
          'This tab has to stay visible while capturing — a background tab never paints, so the frames would all be identical.',
          'document.hidden was true during a seek',
        );
      }

      if (Math.abs(landed.y - position) > SCROLL_TOLERANCE_PX) {
        throw new CdpError(
          'scroll-hijacked',
          'This page controls its own scrolling (Lenis, Locomotive or similar), so Scrubframe cannot step it. Frames would look right and be wrong.',
          `asked ${Math.round(position)}, landed ${Math.round(landed.y)}`,
        );
      }
      return landed.y;
    },

    async resume() {
      if (!restoreTo) return;
      await evaluate(
        session,
        `window.scrollTo({ top: ${restoreTo.y}, left: ${restoreTo.x}, behavior: 'instant' })`,
      ).catch(() => {
        // The page may be gone. Nothing left to restore.
      });
    },

    async extractSpec() {
      // Honestly nothing. A scroll position is not a duration and there is no
      // easing to read; inventing one would be worse than saying so, and
      // ANIMATION.md says so instead.
      return null;
    },
  };
}

async function measure(
  session: CdpSession,
  backendNodeId: number,
): Promise<{ box: Rect; viewport: VisualViewport; content: { height: number } }> {
  const [{ model }, metrics] = await Promise.all([
    session.send('DOM.getBoxModel', { backendNodeId }),
    session.send('Page.getLayoutMetrics'),
  ]);
  return {
    box: quadToRect(model.border),
    viewport: metrics.cssVisualViewport,
    content: { height: metrics.cssContentSize.height },
  };
}

async function evaluate<T>(
  session: CdpSession,
  expression: string,
  awaitPromise = false,
): Promise<T> {
  const evaluated = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (evaluated.exceptionDetails) {
    throw new CdpError('unknown', 'The page rejected a scroll command.', evaluated.exceptionDetails.text);
  }
  return evaluated.result.value as T;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
