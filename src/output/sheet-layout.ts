/**
 * Where every frame goes on a contact sheet.
 *
 * Pure arithmetic, no canvas. Two reasons this is worth testing on its own: an
 * off-by-one in a row index puts frame 9 where frame 5 belongs and a model then
 * describes an animation that never happened; and the sizing rules below are
 * derived from numbers that are easy to get wrong.
 *
 * THE NUMBER THAT DECIDES EVERYTHING is not the source resolution — it is the
 * DELIVERED one. Chat interfaces resample an upload before the model sees it:
 * Claude cuts images into 28x28 patches and caps the standard tier at a 1568px
 * long edge and 1568 patches (~1.22 MP); ChatGPT uses 32x32 patches and caps
 * `detail: high` at 2048px. Anything past that is thrown away on the way in,
 * and what the resampler eats first is exactly what matters here: 1px borders
 * and small label text.
 *
 * So the sheet is composed AT the delivered size. Frames are scaled down as
 * they are drawn and labels are then drawn at full sheet resolution, so the
 * text never passes through a resampler at all.
 */

export interface FrameSize {
  width: number;
  height: number;
}

export interface SheetBudget {
  /** Neither side may exceed this. 1568 keeps Claude's standard tier from resizing. */
  maxEdge: number;
  /** Total pixels. 1568 patches of 28x28. */
  maxArea: number;
  /**
   * Target for a cell's SHORT edge.
   *
   * Below roughly 300px a 16px glyph in the captured page lands under 5px and a
   * small translate falls under the encoder's noise floor. This is what decides
   * how many frames go on a sheet — not a fixed count.
   */
  targetCellShortEdge: number;
  /**
   * Never go below this. Anthropic's own guidance warns the model "might
   * hallucinate or make mistakes" on images under 200px.
   */
  minCellShortEdge: number;
  maxPerSheet: number;
}

export const DEFAULT_BUDGET: SheetBudget = {
  maxEdge: 1568,
  maxArea: 1568 * 28 * 28,
  targetCellShortEdge: 300,
  minCellShortEdge: 200,
  maxPerSheet: 16,
};

const LEGEND_HEIGHT = 40;
const PADDING = 12;
const GUTTER = 12;
const LABEL_HEIGHT = 34;

export interface CellPlan {
  /** Fixed for the WHOLE run, so a short final sheet is never rescaled. */
  width: number;
  height: number;
  scale: number;
  columns: number;
  perSheet: number;
  /** True when even the hard floor could not be met. */
  belowFloor: boolean;
}

export interface CellBox {
  /** 0-based index within the whole run, not within the sheet. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  labelX: number;
  labelY: number;
}

export interface SheetPlan {
  number: number;
  totalSheets: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  scale: number;
  legendHeight: number;
  cells: CellBox[];
}

/** Sheet size for a given cell width, columns and rows. */
function sheetSize(
  cellWidth: number,
  aspect: number,
  columns: number,
  rows: number,
): { width: number; height: number; cellHeight: number } {
  const cellHeight = Math.max(1, Math.round(cellWidth * aspect));
  return {
    width: PADDING * 2 + columns * cellWidth + GUTTER * (columns - 1),
    height:
      LEGEND_HEIGHT + PADDING * 2 + rows * (cellHeight + LABEL_HEIGHT) + GUTTER * (rows - 1),
    cellHeight,
  };
}

/** Largest cell width that fits every budget constraint. 0 when none does. */
function largestCell(
  frame: FrameSize,
  columns: number,
  rows: number,
  budget: SheetBudget,
): number {
  const aspect = frame.height / frame.width;
  const fits = (cellWidth: number) => {
    const size = sheetSize(cellWidth, aspect, columns, rows);
    return (
      size.width <= budget.maxEdge &&
      size.height <= budget.maxEdge &&
      size.width * size.height <= budget.maxArea
    );
  };
  // Cells never scale UP: a small frame keeps its own size rather than being
  // blown up, which would invent detail that was never captured.
  let low = 0;
  let high = frame.width;
  if (fits(high)) return high;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Decides the cell size ONCE for a whole run.
 *
 * Called once and reused for every sheet. Deriving it per sheet is what made a
 * 17-frame run put frame 17 on its own page at 1.83x the size of the other
 * sixteen — a zoom that never happened, which is exactly the artifact this
 * project exists not to produce.
 *
 * Column count follows the frame's aspect rather than being fixed. A single
 * column of eight landscape frames is 1:11, where the edge cap binds long
 * before the area cap and two thirds of the token budget goes unused; a
 * squarish sheet makes both caps bind at once. So every column count is tried
 * and the best is kept.
 */
export function planCells(frame: FrameSize, budget: SheetBudget = DEFAULT_BUDGET): CellPlan {
  const aspect = frame.height / frame.width;
  let best: CellPlan | null = null;
  let fallback: CellPlan | null = null;

  for (let perSheet = Math.max(1, budget.maxPerSheet); perSheet >= 1; perSheet -= 1) {
    let bestForCount: CellPlan | null = null;
    for (let columns = 1; columns <= perSheet; columns += 1) {
      const rows = Math.ceil(perSheet / columns);
      const width = largestCell(frame, columns, rows, budget);
      if (width < 1) continue;
      const height = Math.max(1, Math.round(width * aspect));
      const candidate: CellPlan = {
        width,
        height,
        scale: width / frame.width,
        columns,
        perSheet,
        belowFloor: false,
      };
      if (!bestForCount || width * height > bestForCount.width * bestForCount.height) {
        bestForCount = candidate;
      }
    }
    if (!bestForCount) continue;

    const shortEdge = Math.min(bestForCount.width, bestForCount.height);
    // Prefer the most frames per sheet that still clears the target, so the
    // user gets fewer sheets without losing readable detail.
    if (shortEdge >= budget.targetCellShortEdge) return bestForCount;
    if (!fallback && shortEdge >= budget.minCellShortEdge) fallback = bestForCount;
    if (!best) best = bestForCount;
  }

  if (fallback) return fallback;
  if (best) return { ...best, belowFloor: true };
  return { width: 1, height: 1, scale: 0, columns: 1, perSheet: 1, belowFloor: true };
}

/** Lays a run out across sheets, all sharing one cell size. */
export function planSheets(
  frame: FrameSize,
  totalFrames: number,
  budget: SheetBudget = DEFAULT_BUDGET,
): SheetPlan[] {
  if (totalFrames < 1 || frame.width < 1 || frame.height < 1) return [];
  const cell = planCells(frame, budget);
  const totalSheets = Math.ceil(totalFrames / cell.perSheet);
  const plans: SheetPlan[] = [];

  for (let sheet = 0; sheet < totalSheets; sheet += 1) {
    const first = sheet * cell.perSheet;
    const count = Math.min(cell.perSheet, totalFrames - first);
    const rows = Math.ceil(count / cell.columns);
    const cells: CellBox[] = [];

    for (let i = 0; i < count; i += 1) {
      const column = i % cell.columns;
      const row = Math.floor(i / cell.columns);
      const x = PADDING + column * (cell.width + GUTTER);
      const top = LEGEND_HEIGHT + PADDING + row * (cell.height + LABEL_HEIGHT + GUTTER);
      cells.push({
        index: first + i,
        x,
        y: top + LABEL_HEIGHT,
        width: cell.width,
        height: cell.height,
        labelX: x,
        // In the band ABOVE the frame. A label drawn over the image would cover
        // the top-left corner of every capture, which on a web page is exactly
        // where headings and the first line of content live.
        labelY: top + LABEL_HEIGHT - 10,
      });
    }

    plans.push({
      number: sheet + 1,
      totalSheets,
      // Width comes from the run's column count, not this sheet's, so a short
      // final sheet is narrower only if it genuinely has fewer columns of content.
      width: PADDING * 2 + Math.min(cell.columns, count) * cell.width +
        GUTTER * (Math.min(cell.columns, count) - 1),
      height:
        LEGEND_HEIGHT + PADDING * 2 + rows * (cell.height + LABEL_HEIGHT) + GUTTER * (rows - 1),
      columns: cell.columns,
      rows,
      scale: cell.scale,
      legendHeight: LEGEND_HEIGHT,
      cells,
    });
  }

  return plans;
}

/** Frame label: `01 · y=340px`. Zero-padded so the column stays aligned. */
export function cellLabel(
  index: number,
  total: number,
  position: number,
  unit: 'ms' | 'px',
): string {
  const width = Math.max(2, String(total).length);
  const number = String(index + 1).padStart(width, '0');
  const value = unit === 'ms' ? `t=${Math.round(position)}ms` : `y=${Math.round(position)}px`;
  return `${number} · ${value}`;
}
