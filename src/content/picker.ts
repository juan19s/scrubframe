import { describeElement, newToken } from './describe';

/**
 * In-page element picker.
 *
 * Runs in the ISOLATED world, injected on demand — never on page load. It has
 * two hard constraints, and both come from what this tool is for.
 *
 * It must not appear in the capture. The overlay is one element in the top
 * layer, torn down before any screenshot is taken, and every capture also
 * sweeps for leftovers before attaching.
 *
 * It must not disturb the page. Scrubframe promises a faithful capture of an
 * animation, so the act of picking cannot perturb what is being measured. All
 * the moving parts live inside a CLOSED shadow root: mutations inside a shadow
 * tree are never delivered to a light-DOM MutationObserver, because a
 * ShadowRoot's node-tree parent is null. A whole pick session therefore costs
 * the page two mutation records — the host going in and coming out — instead
 * of one per mouse move.
 */

export const MARKER_ATTR = 'data-scrubframe-target';
export const OVERLAY_ATTR = 'data-scrubframe-overlay';
const HOST_TAG = 'scrubframe-overlay';
const MAX_REMOUNTS = 3;

export interface PickSelection {
  marker: string;
  selector: string;
  label: string;
}

interface PickerHandlers {
  onSelected(selection: PickSelection): void;
  onCancelled(): void;
}

const HOST_CSS = [
  'position:fixed',
  'inset:0',
  'margin:0',
  'padding:0',
  'border:0',
  'background:transparent',
  'width:100vw',
  'height:100vh',
  'max-width:none',
  'max-height:none',
  'overflow:hidden',
  // The host must never eat a pointer event: the picker resolves its target
  // from composedPath(), which would otherwise resolve to the overlay itself.
  'pointer-events:none',
  // Belt and braces for the top layer, in case popover is unavailable.
  'z-index:2147483647',
].join(';');

const SHADOW_CSS = `
  .box {
    position: absolute;
    left: 0;
    top: 0;
    box-sizing: border-box;
    border: 2px solid #38bdf8;
    background: rgba(56, 189, 248, 0.14);
    border-radius: 2px;
    opacity: 0;
  }
  .box[data-visible='1'] { opacity: 1; }
  .tag {
    position: absolute;
    left: -2px;
    top: -22px;
    font: 500 11px/20px ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #0ea5e9;
    color: #04191f;
    padding: 0 6px;
    border-radius: 3px;
    white-space: nowrap;
  }
  .box[data-flip='1'] .tag { top: 100%; }
`;

/**
 * Starts picking. Returns a dispose function; calling it twice is safe.
 *
 * Any previous picker is disposed first, so double-clicking "Pick element"
 * cannot leave two overlays fighting over the same page.
 */
export function startPicker(handlers: PickerHandlers): () => void {
  disposePrevious();

  let host = mountHost();
  let shadow = host.shadow;
  let remounts = 0;
  let target: Element | null = null;
  let disposed = false;

  const previousCursor = document.documentElement.style.getPropertyValue('cursor');
  document.documentElement.style.setProperty('cursor', 'crosshair', 'important');

  function ensureMounted(): boolean {
    // Some frameworks wipe nodes they did not create out of <html>. Remount a
    // few times, then give up rather than fight a re-render loop forever.
    if (host.element.isConnected) return true;
    if (remounts >= MAX_REMOUNTS) return false;
    remounts += 1;
    host = mountHost();
    shadow = host.shadow;
    return true;
  }

  function paint(element: Element): void {
    if (!ensureMounted()) return;
    const rect = element.getBoundingClientRect();
    shadow.box.setAttribute('data-visible', '1');
    shadow.box.setAttribute('data-flip', rect.top < 24 ? '1' : '0');
    shadow.box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    shadow.box.style.width = `${rect.width}px`;
    shadow.box.style.height = `${rect.height}px`;
    shadow.tag.textContent =
      `${describeElement(element).label}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
  }

  /** composedPath pierces shadow roots, so this reaches into web components. */
  function targetOf(event: Event): Element | null {
    const first = event.composedPath()[0];
    if (!(first instanceof Element)) return null;
    if (first === document.documentElement || first === host.element) return null;
    return first;
  }

  const onPointerMove = (event: PointerEvent) => {
    const found = targetOf(event);
    if (!found || found === target) return;
    target = found;
    paint(found);
  };

  const onScroll = () => {
    if (target) paint(target);
  };

  /** Swallow everything a page might act on, not just click. */
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onClick = (event: MouseEvent) => {
    const chosen = targetOf(event) ?? target;
    swallow(event);
    if (!chosen) return;
    const marker = newToken();
    clearPreviousMarkers();
    chosen.setAttribute(MARKER_ATTR, marker);
    // A live reference in the isolated world: a zero-CDP liveness probe that
    // dies exactly when the document does, which is when a selection should.
    (globalThis as Record<string, unknown>).__scrubframe = { marker, element: chosen };
    const described = describeElement(chosen);
    dispose();
    handlers.onSelected({ marker, ...described });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    swallow(event);
    dispose();
    handlers.onCancelled();
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerdown', swallow, true);
    window.removeEventListener('mousedown', swallow, true);
    window.removeEventListener('mouseup', swallow, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, true);
    if (previousCursor) {
      document.documentElement.style.setProperty('cursor', previousCursor);
    } else {
      document.documentElement.style.removeProperty('cursor');
    }
    removeOverlays();
    delete (globalThis as Record<string, unknown>).__scrubframeDispose;
  }

  // Capture phase throughout, so the page never sees the interaction. A click
  // that reached a link would navigate away mid-pick.
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerdown', swallow, true);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('mouseup', swallow, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, true);

  (globalThis as Record<string, unknown>).__scrubframeDispose = dispose;
  return dispose;
}

interface MountedHost {
  element: HTMLElement;
  shadow: { box: HTMLElement; tag: HTMLElement };
}

function mountHost(): MountedHost {
  const element = document.createElement(HOST_TAG);
  element.setAttribute(OVERLAY_ATTR, '');
  // Written once, before insertion, and never touched again — so the only
  // mutation records the page sees are the host going in and coming out.
  element.style.cssText = HOST_CSS;
  element.setAttribute('popover', 'manual');

  const root = element.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  const box = document.createElement('div');
  box.className = 'box';
  const tag = document.createElement('span');
  tag.className = 'tag';
  box.append(tag);
  root.append(style, box);

  document.documentElement.append(element);
  try {
    // The top layer beats any z-index and ignores a transformed ancestor,
    // which is what breaks position:fixed overlays on exactly the animated
    // sites this tool is aimed at.
    element.showPopover();
  } catch {
    // Older Chrome, or the element was already showing. The z-index in
    // HOST_CSS is the fallback.
  }
  return { element, shadow: { box, tag } };
}

/** Removes every overlay node, including one stranded by a previous run. */
export function removeOverlays(): number {
  const nodes = document.querySelectorAll(`[${OVERLAY_ATTR}]`);
  nodes.forEach((node) => node.remove());
  return nodes.length;
}

function clearPreviousMarkers(): void {
  document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((node) => {
    node.removeAttribute(MARKER_ATTR);
  });
}

function disposePrevious(): void {
  const previous = (globalThis as Record<string, unknown>).__scrubframeDispose;
  if (typeof previous === 'function') {
    try {
      (previous as () => void)();
    } catch {
      // A half-disposed picker must not block a new one.
    }
  }
  removeOverlays();
}
