import {
  cellLabel,
  DEFAULT_BUDGET,
  planSheets,
  type FrameSize,
  type SheetBudget,
  type SheetPlan,
} from './sheet-layout';

/**
 * Draws the contact sheet, in the service worker.
 *
 * No offscreen document and no new permission: OffscreenCanvas, getContext('2d'),
 * createImageBitmap and convertToBlob are all Exposed=(Window,Worker), and a
 * ServiceWorkerGlobalScope is inside the Worker exposure set. The only thing the
 * worker lacks is URL.createObjectURL, which compositing does not need.
 * docs/ADR-ADDENDUM.md predicted an `offscreen` permission would be required;
 * it is not, and that prediction is retired.
 *
 * Frames are drawn as they arrive rather than collected. Peak memory is a
 * canvas plus one bitmap instead of every decoded frame at once, and a run that
 * dies at frame 50 leaves the finished sheets already on disk.
 */

/**
 * Always ends in a generic family.
 *
 * A family that does not resolve is never invisible — but the last-resort
 * fallback in Blink is a SERIF face, so `20px "SF Mono"` silently renders in
 * something like Times. The generic at the end is what prevents that.
 */
const LABEL_FONT = '600 20px "Helvetica Neue", Helvetica, Arial, sans-serif';
const LEGEND_FONT = '500 16px "Helvetica Neue", Helvetica, Arial, sans-serif';

const BACKGROUND = '#0a0a0a';
const LABEL_COLOR = '#ffffff';
const LEGEND_COLOR = '#8a8a8a';
const CELL_BORDER = '#2a2a2a';

export interface SheetOutput {
  /** contact-sheet-01.png */
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface ContactSheetOptions {
  frame: FrameSize;
  totalFrames: number;
  /** One line under the title. Everything else belongs in ANIMATION.md. */
  legend: string;
  unit: 'ms' | 'px';
  budget?: SheetBudget;
}

export interface ContactSheets {
  readonly plans: SheetPlan[];
  /** Draws one frame. Returns a sheet when that frame completed it. */
  add(index: number, png: Uint8Array, position: number): Promise<SheetOutput | null>;
  /** Flushes whatever is half-drawn. */
  finish(): Promise<SheetOutput | null>;
}

export function createContactSheets(options: ContactSheetOptions): ContactSheets {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const plans = planSheets(options.frame, options.totalFrames, budget);

  let current: { plan: SheetPlan; canvas: OffscreenCanvas; drawn: number } | null = null;

  function begin(plan: SheetPlan) {
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = context(canvas);

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, plan.width, plan.height);

    // One legend line, not a rendered header block. Anything a model would have
    // to OCR back out of pixels is cheaper and more reliable as markdown, so
    // URL, selector and timing live in ANIMATION.md. What stays here is only
    // what makes the image self-describing if it travels alone.
    useFont(ctx, LEGEND_FONT, options.legend);
    ctx.fillStyle = LEGEND_COLOR;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      plan.totalSheets > 1
        ? `${options.legend}  ·  sheet ${plan.number}/${plan.totalSheets}  ·  read left to right, top to bottom`
        : `${options.legend}  ·  read left to right, top to bottom`,
      12,
      plan.legendHeight / 2,
    );

    current = { plan, canvas, drawn: 0 };
    return ctx;
  }

  async function flush(): Promise<SheetOutput | null> {
    if (!current) return null;
    const { plan, canvas } = current;
    current = null;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return {
      name: plan.totalSheets > 1
        ? `contact-sheet-${String(plan.number).padStart(2, '0')}.png`
        : 'contact-sheet.png',
      blob,
      width: plan.width,
      height: plan.height,
    };
  }

  return {
    plans,

    async add(index, png, position) {
      const plan = plans.find((candidate) => candidate.cells.some((c) => c.index === index));
      const cell = plan?.cells.find((c) => c.index === index);
      if (!plan || !cell) return null;

      let ready: SheetOutput | null = null;
      if (current && current.plan.number !== plan.number) ready = await flush();

      const ctx = current ? context(current.canvas) : begin(plan);

      // A bare Blob is enough — a CDP PNG carries no EXIF, so none of the
      // orientation or premultiply options change anything.
      const bitmap = await createImageBitmap(new Blob([toArrayBuffer(png)]));
      try {
        ctx.drawImage(bitmap, cell.x, cell.y, cell.width, cell.height);
      } finally {
        bitmap.close();
      }

      ctx.strokeStyle = CELL_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);

      // Drawn after the frame and at full sheet resolution, so the text never
      // passes through the downscale the frame just went through.
      const label = cellLabel(index, options.totalFrames, position, options.unit);
      useFont(ctx, LABEL_FONT, label);
      ctx.fillStyle = LABEL_COLOR;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(label, cell.labelX, cell.labelY);

      if (current) {
        current.drawn += 1;
        if (current.drawn === plan.cells.length) return (await flush()) ?? ready;
      }
      return ready;
    },

    finish() {
      return flush();
    },
  };
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas gave no 2d context');
  return ctx;
}

/**
 * Sets a font and proves it will draw something.
 *
 * OffscreenCanvas resolves fonts through FontStyleResolver, which builds its
 * conversion data with a zero viewport and 10px defaults. So `4vw`, `150%` and
 * `larger` all compute to 0px — silently, with no throw and nothing in the
 * console — and produce a sheet whose labels simply are not there. One
 * measurement catches it.
 */
function useFont(
  ctx: OffscreenCanvasRenderingContext2D,
  font: string,
  sample: string,
): void {
  ctx.font = font;
  if (ctx.measureText(sample || 'x').width <= 0) {
    throw new Error(`font "${font}" measured zero width — labels would be invisible`);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
