/** Stable identifier for a timeline adapter. Appears verbatim in ANIMATION.md. */
export type AdapterId = 'scroll' | 'waapi' | 'gsap' | 'lottie' | 'realtime';

/** Why an attach or capture attempt failed, in terms the UI can act on. */
export type FailureKind =
  | 'devtools-open'
  | 'restricted-url'
  | 'no-tab-access'
  | 'already-attached'
  | 'tab-closed'
  | 'canceled-by-user'
  | 'page-crashed'
  | 'timeout'
  | 'download-failed'
  | 'unknown';

export interface ScrubframeFailure {
  kind: FailureKind;
  /** Message we show the user. Written for a human, not a stack trace. */
  message: string;
  /** Raw error text from Chrome, kept for bug reports. */
  detail?: string;
}

/** One attach attempt against one tab. */
export interface SpikeProbe {
  tabId: number;
  /** Empty when we hold no access to read it — which is itself informative. */
  url: string;
  attachSucceeded: boolean;
  /** A command round-tripped through the page's own JS context. */
  commandSucceeded: boolean;
  failure?: ScrubframeFailure;
}

export type SpikeVerdict =
  /** activeTab is the gate: the invoked tab attached, a non-invoked tab was refused. */
  | 'adr-002-holds'
  /** The `debugger` permission alone attaches anywhere. activeTab gates nothing. */
  | 'debugger-permission-suffices'
  /** Even the invoked tab was refused for lack of host access. */
  | 'adr-002-needs-revision'
  /** A dev build carries injected permissions. Any verdict from it would be a lie. */
  | 'dev-build'
  | 'inconclusive';

/**
 * Result of the Phase 0 spike for ADR-002.
 *
 * The experiment needs two tabs, not one. Attaching to the tab you clicked the
 * icon on proves only that *something* allowed it. Attaching to a tab you never
 * clicked on is the negative control that says whether that something was
 * activeTab or the `debugger` permission by itself.
 */
export interface SpikeReport {
  /** Permissions present in the loaded manifest that we never declare. */
  injectedByBuild: string[];
  grantedOrigins: string[];
  hostPermissionAbsent: boolean;
  /**
   * The tab the user invoked the extension on. activeTab granted.
   * null when no attach was attempted at all — a probe of all-false fields
   * reads as "tried and refused", which is a different and untrue statement.
   */
  active: SpikeProbe | null;
  /** A tab the user never invoked on. activeTab NOT granted. */
  control: SpikeProbe | null;
  /** Why there is no control probe, when there isn't one. */
  controlNote?: string;
  protocolVersion?: string;
  verdict: SpikeVerdict;
}

/** What the picker marked, as stored between popup openings. */
export interface StoredSelection {
  /** The token stamped on the element. This is the identity. */
  marker: string;
  /** Readable path, for the popup and the capture directory name. Never identity. */
  selector: string;
  /** Short form: `article.card`. */
  label: string;
  /** The page it was picked on, so we can notice a navigation. */
  url: string;
  pickedAt: number;
}

/**
 * The popup owns no state of its own — it closes the moment the user clicks
 * into the page to pick, taking any React state with it. It asks for this on
 * mount instead.
 */
export type SelectionState =
  | { status: 'none' }
  | { status: 'picking' }
  | { status: 'selected'; selection: StoredSelection };

export interface ScreenshotResult {
  filename: string;
  /** Size of the decoded PNG, in bytes. */
  bytes: number;
  width: number;
  height: number;
  /** Chrome's terminal state for the download. We wait for it before claiming success. */
  downloadState: 'complete';
}
