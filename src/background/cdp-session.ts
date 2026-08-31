import type { FailureKind, ScrubframeFailure } from '../shared/types';

/** The subset of the DevTools Protocol Scrubframe speaks. Grows per phase. */
export interface CdpCommands {
  'Browser.getVersion': {
    params?: Record<string, never>;
    result: { protocolVersion: string; product: string; userAgent: string };
  };
  'Page.enable': { params?: Record<string, never>; result: Record<string, never> };
  'Page.captureScreenshot': {
    params?: {
      format?: 'png' | 'jpeg' | 'webp';
      quality?: number;
      clip?: { x: number; y: number; width: number; height: number; scale: number };
      fromSurface?: boolean;
      captureBeyondViewport?: boolean;
    };
    /** base64-encoded image data. */
    result: { data: string };
  };
  'Runtime.evaluate': {
    params: {
      expression: string;
      returnByValue?: boolean;
      awaitPromise?: boolean;
      userGesture?: boolean;
    };
    result: {
      result: { type: string; value?: unknown };
      exceptionDetails?: { text: string };
    };
  };
}

export type CdpMethod = keyof CdpCommands;

const PROTOCOL_VERSION = '1.3';

/**
 * A renderer blocked on a tab-modal dialog never answers a CDP command, and
 * `withSession`'s finally never runs while the command is pending — which
 * leaves the yellow debugging banner up on the user's tab forever. Every
 * command races this deadline so the session always gets torn down.
 */
const COMMAND_TIMEOUT_MS = 15_000;

export class CdpError extends Error {
  readonly kind: FailureKind;
  readonly detail: string;

  constructor(kind: FailureKind, message: string, detail: string) {
    super(message);
    this.name = 'CdpError';
    this.kind = kind;
    this.detail = detail;
  }

  toFailure(): ScrubframeFailure {
    return { kind: this.kind, message: this.message, detail: this.detail };
  }
}

/**
 * Turns Chrome's raw debugger errors into something we can show a user.
 * Getting this right is the difference between "close DevTools on this tab"
 * and a stack trace nobody can act on (see SPEC §8).
 */
export function classify(raw: unknown): CdpError {
  const detail = raw instanceof Error ? raw.message : String(raw);
  const text = detail.toLowerCase();

  if (text.includes('another debugger is already attached')) {
    return new CdpError(
      'devtools-open',
      'Another debugger is attached to this tab. Close DevTools here and try again.',
      detail,
    );
  }
  if (text.includes('cannot access') && text.includes('chrome')) {
    return new CdpError(
      'restricted-url',
      'Chrome blocks extensions on this page. Open a regular http(s) site and try again.',
      detail,
    );
  }
  if (text.includes('cannot attach to this target')) {
    return new CdpError(
      'restricted-url',
      'Chrome will not let an extension attach to this page.',
      detail,
    );
  }
  if (text.includes('must request permission') || text.includes('cannot access contents')) {
    return new CdpError(
      'no-tab-access',
      'Scrubframe has no access to this tab. Click the Scrubframe icon on the tab you want to capture.',
      detail,
    );
  }
  if (text.includes('no tab with given id') || text.includes('no target with given id')) {
    return new CdpError('tab-closed', 'That tab is gone.', detail);
  }
  if (text.includes('already attached')) {
    return new CdpError('already-attached', 'Scrubframe is already attached to this tab.', detail);
  }
  return new CdpError('unknown', 'The debugger connection failed.', detail);
}

/**
 * Promisified wrapper over chrome.debugger, scoped to a single tab.
 *
 * Attach is deliberately short-lived: one capture, then detach. The yellow
 * "Scrubframe is debugging this browser" banner is the user's kill switch, and
 * leaving it up longer than the work takes would be rude.
 */
export class CdpSession {
  private readonly target: chrome.debugger.Debuggee;
  private attached = false;
  private readonly onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId === this.target.tabId) this.attached = false;
  };

  private constructor(tabId: number) {
    this.target = { tabId };
  }

  static async attach(tabId: number): Promise<CdpSession> {
    const session = new CdpSession(tabId);
    try {
      await chrome.debugger.attach(session.target, PROTOCOL_VERSION);
    } catch (error) {
      throw classify(error);
    }
    session.attached = true;
    chrome.debugger.onDetach.addListener(session.onDetach);
    return session;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  async send<M extends CdpMethod>(
    method: M,
    params?: CdpCommands[M]['params'],
  ): Promise<CdpCommands[M]['result']> {
    if (!this.attached) {
      throw new CdpError('tab-closed', 'The debugger session was closed.', `send(${method})`);
    }
    try {
      const result = await withTimeout(
        chrome.debugger.sendCommand(
          this.target,
          method,
          params as Record<string, unknown> | undefined,
        ),
        COMMAND_TIMEOUT_MS,
        method,
      );
      return result as CdpCommands[M]['result'];
    } catch (error) {
      throw classify(error);
    }
  }

  /** Idempotent. Safe to call from a finally block. */
  async detach(): Promise<void> {
    chrome.debugger.onDetach.removeListener(this.onDetach);
    if (!this.attached) return;
    this.attached = false;
    try {
      await chrome.debugger.detach(this.target);
    } catch {
      // Already gone (tab closed, user hit the banner). Nothing to undo.
    }
  }
}

/**
 * Rejects if `promise` has not settled within `ms`. The pending command is left
 * to its fate — we cannot cancel a CDP call — but the caller regains control,
 * which is what lets the session detach.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new CdpError(
            'timeout',
            'The page stopped responding. A dialog box open on the tab will do this.',
            `${label} timed out after ${ms}ms`,
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `work` with an attached session and always detaches, success or not.
 * Every capture path goes through this — a leaked attach leaves the yellow
 * banner up on the user's tab forever.
 */
export async function withSession<T>(
  tabId: number,
  work: (session: CdpSession) => Promise<T>,
): Promise<T> {
  const session = await CdpSession.attach(tabId);
  try {
    return await work(session);
  } finally {
    await session.detach();
  }
}
