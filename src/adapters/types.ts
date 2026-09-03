import type { AdapterId } from '../shared/types';

/** What an adapter is given to work with. */
export interface PageContext {
  /** The tab under capture. Every CDP call is scoped to it. */
  tabId: number;
  /** The element the user picked, if any. Adapters may scope themselves to it. */
  element: SelectedElement | null;
}

/** A stable handle on the element the user picked in the page. */
export interface SelectedElement {
  /** CDP node handle, valid only for the current document. */
  backendNodeId: number;
  /** Human-readable, and what lands in ANIMATION.md. */
  selector: string;
  /** Short description for the popup: "div.card-grid > article". */
  label: string;
}

/** One stop in a property's keyframe list. */
export interface PropertyStop {
  offset: number;
  value: string;
  /** The easing of the segment STARTING here. Null on the last stop, which starts none. */
  easing: string | null;
}

/** One property an animation actually changes, as reported by the technology. */
export interface AnimatedProperty {
  property: string;
  from: string;
  to: string;
  durationMs: number;
  delayMs: number;
  /**
   * The curve a developer would copy — which is not simply getTiming().easing.
   * See easingFor() in waapi-extract.ts for why picking one level is wrong.
   */
  easing: string;
  /**
   * True when the effect-level and per-keyframe easings BOTH bite. They compose
   * by function composition and cannot be flattened into one cubic-bezier, so
   * `easing` above is a description rather than something to paste.
   */
  composedEasing?: boolean;
  /** Present when there are more than two stops, which from/to would hide. */
  stops?: PropertyStop[];
}

/**
 * What the page itself says about its animation.
 *
 * Adapters that cannot know this return null rather than guessing. An honest
 * "the frames are all we have" beats an invented cubic-bezier that a model will
 * then treat as fact (SPEC §4).
 */
export interface AnimationSpec {
  adapter: AdapterId;
  /** False for anything sampled in real time — say so in ANIMATION.md. */
  deterministic: boolean;
  properties: AnimatedProperty[];
  /** Literal effect.getKeyframes() output where the technology exposes it. */
  rawKeyframes: unknown[] | null;
  notes?: string;
}

export type RangeUnit = 'ms' | 'px';

export interface TimelineRange {
  from: number;
  to: number;
  unit: RangeUnit;
}

/**
 * The central abstraction (SPEC §4). Everything else hangs off this.
 *
 * Contract notes that are easy to get wrong:
 *  - `pause()` must be idempotent; the capture loop may call it defensively.
 *  - `resume()` is called ALWAYS, including when the capture throws. It restores
 *    the page to the state the user left it in — scroll position, injected CSS,
 *    paused timelines, everything.
 *  - `seek()` takes an absolute position within the range from `getRange()`,
 *    never a delta.
 */
export interface TimelineAdapter {
  /** Stable identifier. Appears verbatim in ANIMATION.md. */
  readonly id: AdapterId;
  /** Name shown in the popup. */
  readonly label: string;

  /** Does this adapter apply to this page, for this element? */
  detect(ctx: PageContext): Promise<boolean>;

  /** The scrubbable range: milliseconds for time adapters, pixels for scroll. */
  getRange(ctx: PageContext): Promise<TimelineRange>;

  /** Freeze. Idempotent. */
  pause(): Promise<void>;

  /** Move to an absolute position in the range. */
  seek(position: number): Promise<void>;

  /** Put the page back exactly as it was. Always called. */
  resume(): Promise<void>;

  /** Real timing metadata, or null when the technology cannot expose it. */
  extractSpec(): Promise<AnimationSpec | null>;
}

/**
 * What the capture loop actually consumes.
 *
 * Narrower than TimelineAdapter and shaped by the loop's contract rather than
 * by the SPEC's ideal: the session is already open, the element is already
 * resolved, and `stage` exists because the crop has to be decided once and
 * frozen — see capture-run.ts. TimelineAdapter stays as the interface a
 * contributor implements; this is the seam the engine talks to.
 */
export interface CaptureAdapter {
  readonly id: AdapterId;
  readonly label: string;
  /** Freezes, and takes the restore point. Called before getRange, which moves things. */
  pause(): Promise<unknown>;
  getRange(options: { frames: number; stepPx?: number }): Promise<TimelineRange>;
  /** The frozen crop, in viewport space. Computed once, after getRange. */
  stage(range: TimelineRange): Promise<{ x: number; y: number; width: number; height: number }>;
  /** Moves to an absolute position; returns where it actually landed. */
  seek(position: number): Promise<number>;
  /** Restores the page. Always called, including when the run throws. */
  resume(): Promise<void>;
  extractSpec(): Promise<AnimationSpec | null>;
  /**
   * The easing curve driving this run, sampled — when the technology has one.
   *
   * Used to place frames by progress rather than by clock. Scroll returns
   * nothing, which is correct: its axis is scroll position, and that is already
   * the one the user cares about.
   */
  curve?(): readonly { at: number; value: number }[] | null;
}
