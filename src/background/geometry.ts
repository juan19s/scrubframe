/**
 * Coordinate math for the capture clip.
 *
 * Every bug in this area is a coordinate-space mix-up, so the three spaces are
 * named here and the names are used everywhere else.
 *
 *  1. QUAD space   CSS px, origin at the top-left of the VISUAL VIEWPORT.
 *                  What DOM.getBoxModel returns. Scroll is already subtracted:
 *                  an element 500px above the fold has y ≈ -500. Transforms are
 *                  baked in and page zoom is divided out.
 *  2. STAGE space  Same origin and units as quad space. Our crop rectangle,
 *                  FROZEN for the whole run.
 *  3. CLIP space   CSS px, origin at the top-left of the DOCUMENT.
 *                  What Page.captureScreenshot.clip wants.
 *
 * The conversion between (2) and (3) is the scroll offset, and it has to be
 * redone every frame because the page moves under a frozen stage. This is the
 * same arithmetic Puppeteer's ElementHandle.screenshot does.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Clip extends Rect {
  scale: number;
}

/** The fields of Page.getLayoutMetrics we are allowed to use. */
export interface VisualViewport {
  /** Document-space scroll offset. Use cssVisualViewport — see note below. */
  pageX: number;
  pageY: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * Collapses a DOM.getBoxModel quad into its axis-aligned bounding box.
 *
 * A quad is 8 numbers: x1,y1,x2,y2,x3,y3,x4,y4. For a rotated element those
 * corners are not axis-aligned, so taking [0] and [4] as opposite corners —
 * which looks right and is what you write first — silently under-crops.
 */
export function quadToRect(quad: readonly number[]): Rect {
  const xs = [quad[0], quad[2], quad[4], quad[6]].filter(isFiniteNumber);
  const ys = [quad[1], quad[3], quad[5], quad[7]].filter(isFiniteNumber);
  if (xs.length < 4 || ys.length < 4) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Smallest rect containing all of them. Empty input gives an empty rect. */
export function unionRects(rects: readonly Rect[]): Rect {
  const real = rects.filter((r) => r.width > 0 && r.height > 0);
  if (real.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...real.map((r) => r.x));
  const top = Math.min(...real.map((r) => r.y));
  const right = Math.max(...real.map((r) => r.x + r.width));
  const bottom = Math.max(...real.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function padRect(rect: Rect, pad: number): Rect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

/**
 * Clips the stage to what is actually on screen.
 *
 * Required because we capture with captureBeyondViewport:false — that option
 * resizes the viewport to fit, which reflows the page, moves position:fixed
 * elements and changes the scroll range out from under the adapter. Cropping
 * instead of resizing keeps the capture faithful.
 */
export function clampToViewport(stage: Rect, viewport: VisualViewport): Rect {
  const left = Math.max(0, stage.x);
  const top = Math.max(0, stage.y);
  const right = Math.min(viewport.clientWidth, stage.x + stage.width);
  const bottom = Math.min(viewport.clientHeight, stage.y + stage.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Stage (viewport-relative) → clip (document-relative), for one frame.
 *
 * Feed this cssVisualViewport, never cssLayoutViewport: in the protocol the
 * layout viewport's pageX/pageY are declared `integer` and truncate, which
 * shows up as sub-pixel shimmer across a contact sheet where every frame should
 * be pixel-aligned with the others.
 */
export function stageToClip(stage: Rect, viewport: VisualViewport, scale: number): Clip {
  return {
    x: stage.x + viewport.pageX,
    y: stage.y + viewport.pageY,
    width: stage.width,
    height: stage.height,
    scale,
  };
}

/**
 * Works out what `clip.scale` has to be to land a frame at the intended
 * resolution.
 *
 * Nobody could tell us from the docs whether a clipped capture inherits the
 * Retina surface's device scale factor, so we measure it: capture once, compare
 * the PNG's real width against the stage width we asked for, and correct.
 * Phase 0 already saw this — a 1512px viewport produced a 3024px PNG.
 */
export function calibrateScale(observedWidth: number, stageWidth: number, want = 1): number {
  if (observedWidth <= 0 || stageWidth <= 0) return want;
  const observedScale = observedWidth / stageWidth;
  if (!isFiniteNumber(observedScale) || observedScale === 0) return want;
  return want / observedScale;
}

/** Chromium refuses a screenshot with zero width, so catch it before asking. */
export function isCapturable(rect: Rect): boolean {
  return rect.width >= 1 && rect.height >= 1;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
