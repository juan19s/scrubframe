import { describe, expect, it } from 'vitest';
import {
  cellLabel,
  DEFAULT_BUDGET,
  planCells,
  planSheets,
  type FrameSize,
} from '../src/output/sheet-layout';

/** The real frame size from a capture on a 2x display, at 1:1 CSS pixels. */
const frame: FrameSize = { width: 1061, height: 736 };

describe('planCells', () => {
  it('picks one cell size for the whole run', () => {
    const cell = planCells(frame);
    expect(cell.width).toBeGreaterThan(0);
    expect(cell.perSheet).toBeGreaterThan(0);
    expect(cell.columns).toBeLessThanOrEqual(cell.perSheet);
  });

  it('keeps every cell above the readable floor', () => {
    const cell = planCells(frame);
    expect(Math.min(cell.width, cell.height)).toBeGreaterThanOrEqual(
      DEFAULT_BUDGET.targetCellShortEdge,
    );
    expect(cell.belowFloor).toBe(false);
  });

  it('gives a wide banner fewer columns than a squarish frame', () => {
    // Forcing four columns onto a 3:1 banner makes the sheet 5:1, where the
    // long-edge cap binds long before the area cap and most of the budget goes
    // unspent. The planner should notice.
    const banner = planCells({ width: 1200, height: 400 });
    const square = planCells({ width: 800, height: 800 });
    expect(banner.columns).toBeLessThanOrEqual(square.columns + 1);
    expect(banner.width * banner.height).toBeGreaterThan(0);
  });

  it('never scales a small frame up', () => {
    const small = planCells({ width: 200, height: 150 });
    expect(small.scale).toBe(1);
    expect(small.width).toBe(200);
  });
});

describe('planSheets', () => {
  it('uses the SAME cell size on every sheet of a run', () => {
    // The defect this exists to catch: deriving the cell from each sheet's own
    // count put frame 17 alone on sheet 2 at 1.83x the size of the first
    // sixteen — a zoom that never happened.
    for (let total = 2; total <= 60; total += 1) {
      const plans = planSheets(frame, total);
      const widths = new Set(plans.flatMap((p) => p.cells.map((c) => c.width)));
      const scales = new Set(plans.map((p) => p.scale));
      expect(widths.size, `frames=${total}`).toBe(1);
      expect(scales.size, `frames=${total}`).toBe(1);
    }
  });

  it('numbers every frame exactly once, in order, across sheets', () => {
    for (const total of [7, 17, 20, 37, 60]) {
      const indices = planSheets(frame, total).flatMap((p) => p.cells.map((c) => c.index));
      expect(indices, `frames=${total}`).toEqual(
        Array.from({ length: total }, (_, i) => i),
      );
    }
  });

  it('stays inside the resolution a chat will actually deliver', () => {
    for (const total of [1, 6, 12, 17, 40]) {
      for (const plan of planSheets(frame, total)) {
        expect(plan.width, `frames=${total}`).toBeLessThanOrEqual(DEFAULT_BUDGET.maxEdge);
        expect(plan.height, `frames=${total}`).toBeLessThanOrEqual(DEFAULT_BUDGET.maxEdge);
        expect(plan.width * plan.height).toBeLessThanOrEqual(DEFAULT_BUDGET.maxArea);
      }
    }
  });

  it('keeps cells inside the sheet, with the label above the frame', () => {
    for (const plan of planSheets(frame, 12)) {
      for (const cell of plan.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.width).toBeLessThanOrEqual(plan.width);
        expect(cell.y + cell.height).toBeLessThanOrEqual(plan.height);
        expect(cell.labelY).toBeLessThan(cell.y);
        expect(cell.labelY).toBeGreaterThan(plan.legendHeight);
      }
    }
  });

  it('reads left to right, then down', () => {
    const [sheet] = planSheets(frame, 6);
    const cells = sheet!.cells;
    const columns = sheet!.columns;
    expect(cells[1]!.y).toBe(cells[0]!.y);
    expect(cells[1]!.x).toBeGreaterThan(cells[0]!.x);
    expect(cells[columns]!.x).toBe(cells[0]!.x);
    expect(cells[columns]!.y).toBeGreaterThan(cells[0]!.y);
  });

  it('returns nothing for nothing', () => {
    expect(planSheets(frame, 0)).toEqual([]);
  });
});

describe('cellLabel', () => {
  it('pads so the numbers stay aligned down a column', () => {
    expect(cellLabel(0, 12, 340, 'px')).toBe('01 · y=340px');
    expect(cellLabel(11, 12, 1580, 'px')).toBe('12 · y=1580px');
  });

  it('widens the padding for a long run', () => {
    expect(cellLabel(0, 120, 0, 'px')).toBe('001 · y=0px');
  });

  it('speaks milliseconds for time-based adapters', () => {
    expect(cellLabel(3, 12, 105.6, 'ms')).toBe('04 · t=106ms');
  });
});
