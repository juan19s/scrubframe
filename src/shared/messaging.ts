import type {
  CaptureRun,
  Measurement,
  PopupState,
  ProjectState,
  ScreenshotResult,
  ScrubframeFailure,
  SelectionState,
  SpikeReport,
} from './types';

/**
 * Every popup -> background message lives here. One union, one place to look,
 * so adding a message without handling it is a compile error.
 */
export type Request =
  // popup -> background
  | { type: 'spike/attach-check'; tabId: number }
  | { type: 'capture/screenshot'; tabId: number }
  | { type: 'capture/run'; tabId: number; frames: number }
  | { type: 'picker/start'; tabId: number }
  | { type: 'measure/element'; tabId: number }
  | { type: 'project/get'; tabId: number }
  | { type: 'project/set-name'; tabId: number; name: string }
  | { type: 'state/get'; tabId: number }
  | { type: 'selection/clear'; tabId: number }
  // picker -> background. These carry no tabId: the background reads it from
  // the message sender, which is the only trustworthy source for it.
  | { type: 'picker/selected'; marker: string; selector: string; label: string }
  | { type: 'picker/cancelled' };

export interface ResultMap {
  'spike/attach-check': SpikeReport;
  'capture/screenshot': ScreenshotResult;
  'capture/run': CaptureRun;
  'picker/start': SelectionState;
  'measure/element': Measurement;
  'project/get': ProjectState;
  'project/set-name': ProjectState;
  'state/get': PopupState;
  'selection/clear': SelectionState;
  'picker/selected': SelectionState;
  'picker/cancelled': SelectionState;
}

export type Response<K extends Request['type']> =
  | { ok: true; data: ResultMap[K] }
  | { ok: false; error: ScrubframeFailure };

/**
 * Typed wrapper around chrome.runtime.sendMessage that never rejects.
 *
 * A rejection here — background worker crashed on startup, message channel
 * closed, popup dismissed mid-flight — used to escape an unawaited click
 * handler and strand the UI in its loading state with no way back. Every
 * failure comes back as a value the caller has to handle.
 */
export async function send<R extends Request>(request: R): Promise<Response<R['type']>> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as
      | Response<R['type']>
      | undefined;
    if (!response) {
      return {
        ok: false,
        error: {
          kind: 'unknown',
          message: 'The background worker did not answer. Close and reopen the popup.',
          detail: `${request.type}: empty response`,
        },
      };
    }
    return response;
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'Could not reach the background worker. Close and reopen the popup.',
        detail: `${request.type}: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
