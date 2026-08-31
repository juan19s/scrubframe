/** Stable identifier for a timeline adapter. Appears verbatim in ANIMATION.md. */
export type AdapterId = 'scroll' | 'waapi' | 'gsap' | 'lottie' | 'realtime';

/** Why an attach or capture attempt failed, in terms the UI can act on. */
export type FailureKind =
  | 'devtools-open'
  | 'restricted-url'
  | 'no-tab-access'
  | 'element-gone'
  | 'element-invisible'
  | 'scroll-hijacked'
  | 'already-attached'
  | 'tab-closed'
  | 'canceled-by-user'
  | 'page-crashed'
  | 'timeout'
  | 'download-failed'
  | 'folder-permission'
  | 'write-failed'
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

/** The project a site's captures belong to. */
export interface ProjectState {
  /** Editable; defaults to the site's registrable name. */
  name: string;
  /** True when the user named this site explicitly rather than taking the default. */
  named: boolean;
  /** The folder the user chose, if any. Empty means everything goes to Downloads. */
  folderName: string;
  folderPermission: 'granted' | 'prompt' | 'denied' | 'none';
}

/** Where a run's files went, and why. */
export interface WriteReport {
  /** 'folder' = the project folder the user chose. 'downloads' = the fallback. */
  target: 'folder' | 'downloads';
  path: string;
  /** Present when we wanted the folder and could not use it. */
  fellBackBecause?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One measurement of the picked element, plus the answer to the question the
 * documentation would not settle: does a clipped capture inherit a Retina
 * surface's device scale factor?
 */
export interface Measurement {
  selector: string;
  nodeName: string;
  backendNodeId: number;
  /** Viewport space: what DOM.getBoxModel reported. */
  box: Box;
  /** Viewport space: the element's box padded and clamped to what is on screen. */
  stage: Box;
  /** Document space: what we actually sent to Chrome. */
  clip: Box & { scale: number };
  scrollY: number;
  devicePixelRatio: number;
  pngWidth: number;
  pngHeight: number;
  /** True when the PNG came out at devicePixelRatio despite scale: 1. */
  inheritsDeviceScale: boolean;
  /** The scale to pass for a 1:1 CSS-pixel frame. */
  scaleForOneToOne: number;
  filename: string;
  /** Where it landed, and whether the project folder was used. */
  write: WriteReport;
  bytes: number;
}

/** The result of one N-frame capture. */
export interface CaptureRun {
  /** Relative to the project root, wherever that is. */
  directory: string;
  project: string;
  frames: number;
  requested: number;
  range: { from: number; to: number; unit: 'ms' | 'px' };
  stage: Box;
  /** Calibrated once from the first frame so every frame is the same size. */
  scale: number;
  pngWidth: number;
  pngHeight: number;
  bytes: number;
  /** Where the page actually landed for each frame, not what we asked for. */
  positions: number[];
  target: 'folder' | 'downloads';
  devicePixelRatio: number;
  /** Contact sheet filenames, in order. */
  sheets: string[];
  /** The markdown half of the deliverable. */
  specFile: string;
  /** Why no sheet was produced. The frames are written either way. */
  sheetSkipped?: string;
  /** Set when the first frame came back a different size than predicted. */
  sizeDrift?: string;
}

/** Everything the popup rehydrates on mount. It keeps no state of its own. */
export interface PopupState {
  selection: SelectionState;
  measurement: Measurement | null;
}

export interface ScreenshotResult {
  filename: string;
  /** Size of the decoded PNG, in bytes. */
  bytes: number;
  width: number;
  height: number;
  /** Chrome's terminal state for the download. We wait for it before claiming success. */
  downloadState: 'complete';
}
