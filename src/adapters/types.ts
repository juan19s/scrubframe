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

/** One property an animation actually changes, as reported by the technology. */
export interface AnimatedProperty {
  property: string;
  from: string;
  to: string;
  durationMs: number;
  delayMs: number;
  easing: string;
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
