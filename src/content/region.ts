import { OVERLAY_ATTR } from './picker';

/**
 * Draw-a-rectangle area selection.
 *
 * The crop was always a window on the viewport; the picked element only ever
 * served to compute one. Letting the user draw it directly sidesteps element
 * identification entirely — which is the part that makes a crowded header, with
 * a dozen overlapping nodes, genuinely hard to pick from.
 *
 * Shares the picker's discipline: one host node, a closed shadow root holding
 * everything that moves, capture-phase listeners that swallow the interaction
 * so the page never sees it.
 */

export interface DrawnRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollY: number;
}

interface RegionHandlers {
  onDrawn(region: DrawnRegion): void;
  onCancelled(): void;
}

/** Below this a drag reads as a stray click rather than an intentional box. */
const MIN_SIZE = 8;

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
  // Unlike the element picker, this one DOES take the pointer: it needs the
  // drag, and it must stop the page from reacting to it.
  'pointer-events:auto',
  'cursor:crosshair',
  'z-index:2147483647',
].join(';');

const SHADOW_CSS = `
  .veil { position:absolute; inset:0; background:rgba(10,10,10,0.45); }
  .box {
    position:absolute; left:0; top:0; box-sizing:border-box;
    border:2px solid #38bdf8; border-radius:2px;
    /* The cut-out: the veil dims everything except what is being framed. */
    box-shadow: 0 0 0 100vmax rgba(10,10,10,0.45);
    display:none;
  }
  .box[data-visible='1'] { display:block; }
  .size {
    position:absolute; left:0; top:-24px;
    font:500 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace;
    background:#0ea5e9; color:#04191f; padding:0 6px; border-radius:3px; white-space:nowrap;
  }
  .box[data-flip='1'] .size { top:100%; }
  .hint {
    position:absolute; left:50%; top:16px; transform:translateX(-50%);
    font:500 12px/24px ui-monospace, SFMono-Regular, Menlo, monospace;
    background:#0a0a0a; color:#e5e5e5; padding:0 10px; border-radius:4px;
    border:1px solid #2a2a2a; white-space:nowrap;
  }
`;

export function startRegion(handlers: RegionHandlers): () => void {
  disposePrevious();

  const host = document.createElement('scrubframe-overlay');
  host.setAttribute(OVERLAY_ATTR, '');
  host.style.cssText = HOST_CSS;
  host.setAttribute('popover', 'manual');

  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  const veil = document.createElement('div');
  veil.className = 'veil';
  const box = document.createElement('div');
  box.className = 'box';
  const size = document.createElement('span');
  size.className = 'size';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Drag to frame the area · Escape to cancel';
  box.append(size);
  root.append(style, veil, box, hint);

  document.documentElement.append(host);
  try {
    host.showPopover();
  } catch {
    // Older Chrome. The z-index in HOST_CSS is the fallback.
  }

  let origin: { x: number; y: number } | null = null;
  let current: DrawnRegion | null = null;
  let disposed = false;

  const paint = (region: DrawnRegion) => {
    // The veil is a hole punched by an enormous spread shadow, so the box is
    // the only lit part. Nothing in the light DOM is touched to do it.
    veil.style.display = 'none';
    box.setAttribute('data-visible', '1');
    box.setAttribute('data-flip', region.y < 28 ? '1' : '0');
    box.style.transform = `translate(${region.x}px, ${region.y}px)`;
    box.style.width = `${region.width}px`;
    box.style.height = `${region.height}px`;
    size.textContent = `${Math.round(region.width)} × ${Math.round(region.height)}`;
  };

  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onPointerDown = (event: PointerEvent) => {
    swallow(event);
    origin = { x: event.clientX, y: event.clientY };
    current = null;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!origin) return;
    swallow(event);
    // Normalised, so dragging up or left works exactly as well as down-right.
    const x = Math.min(origin.x, event.clientX);
    const y = Math.min(origin.y, event.clientY);
    current = {
      x,
      y,
      width: Math.abs(event.clientX - origin.x),
      height: Math.abs(event.clientY - origin.y),
      scrollY: window.scrollY,
    };
    paint(current);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!origin) return;
    swallow(event);
    const region = current;
    origin = null;
    if (!region || region.width < MIN_SIZE || region.height < MIN_SIZE) {
      // A stray click, not a box. Stay open rather than cancelling out from
      // under someone who simply mis-clicked.
      current = null;
      box.removeAttribute('data-visible');
      veil.style.display = '';
      return;
    }
    dispose();
    handlers.onDrawn(region);
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
    for (const [type, listener] of listeners) {
      window.removeEventListener(type, listener as EventListener, true);
    }
    host.remove();
    delete (globalThis as Record<string, unknown>).__scrubframeDispose;
  }

  const listeners: Array<[string, (event: never) => void]> = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['click', swallow],
    ['keydown', onKeyDown],
  ];
  for (const [type, listener] of listeners) {
    window.addEventListener(type, listener as EventListener, true);
  }

  (globalThis as Record<string, unknown>).__scrubframeDispose = dispose;
  return dispose;
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
  document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((node) => node.remove());
}
