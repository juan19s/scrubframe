import { CdpError, type CdpSession } from './cdp-session';
import {
  clampToViewport,
  isCapturable,
  padRect,
  quadToRect,
  snapRect,
  stageToClip,
  type Clip,
  type Rect,
  type VisualViewport,
} from './geometry';

/** Breathing room around the element so a shadow or outline is not cut off. */
export const STAGE_PADDING = 8;

export interface ResolvedElement {
  backendNodeId: number;
  nodeName: string;
}

export interface ElementBox {
  /** Viewport-space, CSS px. Scroll is already subtracted — see geometry.ts. */
  box: Rect;
  viewport: VisualViewport;
}

/**
 * Finds the element the picker marked and converts it to a node handle.
 *
 * The marker attribute is the bridge. A content script shares the page's DOM
 * but not its globals, so an attribute is the only thing that survives the trip
 * from the isolated world to a CDP session — and it survives the popup closing
 * and the service worker being evicted along the way.
 *
 * Not finding the marker is not an error to paper over: it is the exact and
 * only staleness test. The token dies with the document, which is precisely
 * when the selection should die.
 */
export async function resolveElement(
  session: CdpSession,
  marker: string,
): Promise<ResolvedElement> {
  await session.send('DOM.enable');

  const evaluated = await session.send('Runtime.evaluate', {
    expression: findMarkerExpression(marker),
    returnByValue: false,
  });

  if (evaluated.exceptionDetails) {
    throw new CdpError(
      'unknown',
      'Could not look for the selected element on this page.',
      evaluated.exceptionDetails.text,
    );
  }

  const objectId = evaluated.result.objectId;
  if (!objectId) {
    throw new CdpError(
      'element-gone',
      'The element you picked is no longer on the page. Pick it again.',
      `marker ${marker} not found`,
    );
  }

  try {
    const { node } = await session.send('DOM.describeNode', { objectId });
    return { backendNodeId: node.backendNodeId, nodeName: node.nodeName.toLowerCase() };
  } finally {
    // The RemoteObject holds a strong reference into the page. Letting it leak
    // would keep a detached DOM subtree alive for as long as the session.
    await session.send('Runtime.releaseObject', { objectId }).catch(() => {
      // Best effort; the reference dies with the session anyway.
    });
  }
}

/**
 * Walks open shadow roots as well as the light DOM.
 *
 * Closed roots are unreachable from here — but they are also unreachable from
 * the picker's composedPath(), which truncates at a closed boundary and hands
 * back the host instead. So the two ends agree: what the picker could mark is
 * what this can find.
 */
function findMarkerExpression(marker: string): string {
  const selector = `[data-scrubframe-target=${JSON.stringify(marker)}]`;
  return `(() => {
    const SELECTOR = ${JSON.stringify(selector)};
    const seen = new Set();
    const walk = (root) => {
      const hit = root.querySelector(SELECTOR);
      if (hit) return hit;
      for (const element of root.querySelectorAll('*')) {
        const shadow = element.shadowRoot;
        if (shadow && !seen.has(shadow)) {
          seen.add(shadow);
          const found = walk(shadow);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(document);
  })()`;
}

/** Where the element is right now, and where the viewport is. */
export async function measureElement(
  session: CdpSession,
  backendNodeId: number,
): Promise<ElementBox> {
  const [{ model }, metrics] = await Promise.all([
    session.send('DOM.getBoxModel', { backendNodeId }),
    session.send('Page.getLayoutMetrics'),
  ]);

  const box = quadToRect(model.border);
  const viewport = metrics.cssVisualViewport;

  if (box.width === 0 || box.height === 0) {
    throw new CdpError(
      'element-invisible',
      'That element has no size on screen — it may be hidden or collapsed. Pick a visible one.',
      `border box ${box.width}×${box.height}`,
    );
  }

  return { box, viewport };
}

/**
 * The crop rectangle, in the two spaces that matter.
 *
 * The stage is viewport-relative and gets frozen for a whole capture run; the
 * clip is document-relative and is recomputed every frame. Locking the stage to
 * the viewport rather than to the element is the whole point: a camera that
 * follows the subject subtracts exactly the motion being captured.
 */
export function stageFor(box: Rect, viewport: VisualViewport): Rect {
  // Snapped last: the clamp can reintroduce fractions from the viewport size,
  // and every frame in a run has to request the exact same integer dimensions.
  return snapRect(clampToViewport(padRect(box, STAGE_PADDING), viewport));
}

export function clipFor(stage: Rect, viewport: VisualViewport, scale: number): Clip {
  if (!isCapturable(stage)) {
    throw new CdpError(
      'element-invisible',
      'That element is not on screen. Scroll it into view and pick again.',
      `stage ${stage.width}×${stage.height}`,
    );
  }
  return stageToClip(stage, viewport, scale);
}
