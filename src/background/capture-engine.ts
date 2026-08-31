import type { ScreenshotResult, ScrubframeFailure } from '../shared/types';
import { captureDirectory, frameName } from '../shared/naming';
import { CdpError, withSession, type CdpSession } from './cdp-session';

/** Chrome gives up on a download long before this; the cap is just a backstop. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Phase 0 capture: one full-viewport frame, straight to Downloads.
 *
 * The seek loop, the element clip and the adapters land in later phases. What
 * this proves today is the whole pipe — attach, capture through CDP, write a
 * file, detach — with no rate limit and no user-visible leftovers.
 */
export async function captureSingleFrame(tabId: number): Promise<ScreenshotResult> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';

  const data = await withSession(tabId, (session) => screenshot(session));
  const directory = captureDirectory(url, null, new Date());
  const filename = `${directory}/${frameName(1, 1)}`;

  await saveFrame(data, filename);

  const { width, height } = readPngSize(data);
  return { filename, bytes: base64Bytes(data), width, height, downloadState: 'complete' };
}

/**
 * Writes one base64 PNG to Downloads and waits for Chrome to finish.
 *
 * download() resolves as soon as the download is *created*. A data: URL over
 * Chrome's size ceiling gets created and then interrupted, so returning here
 * would mean reporting "saved" for a file that is not on disk.
 */
export async function saveFrame(data: string, filename: string): Promise<void> {
  const downloadId = await chrome.downloads.download({
    url: `data:image/png;base64,${data}`,
    filename,
    saveAs: false,
  });
  await settled(downloadId, filename);
}

/** Returns base64 PNG data. */
async function screenshot(session: CdpSession): Promise<string> {
  const { data } = await session.send('Page.captureScreenshot', {
    format: 'png',
    // fromSurface goes through the compositor, which is what makes the frame
    // match what the user actually sees. Later phases lean on this hard.
    fromSurface: true,
  });
  return data;
}

/** Resolves once Chrome reports the download complete; rejects if it is not. */
async function settled(downloadId: number, filename: string): Promise<void> {
  const [existing] = await chrome.downloads.search({ id: downloadId });
  if (existing?.state === 'complete') return;
  if (existing?.state === 'interrupted') throw downloadError(existing.error, filename);

  await new Promise<void>((resolve, reject) => {
    const finish = (outcome?: ScrubframeFailure) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (outcome) reject(new CdpError(outcome.kind, outcome.message, outcome.detail ?? ''));
      else resolve();
    };

    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') finish();
      if (delta.state.current === 'interrupted') {
        finish(downloadError(delta.error?.current, filename).toFailure());
      }
    };

    const timer = setTimeout(
      () =>
        finish({
          kind: 'download-failed',
          message: 'Chrome never finished writing the file.',
          detail: `download ${downloadId} did not settle in ${DOWNLOAD_TIMEOUT_MS}ms`,
        }),
      DOWNLOAD_TIMEOUT_MS,
    );

    chrome.downloads.onChanged.addListener(onChanged);
  });
}

function downloadError(reason: string | undefined, filename: string): CdpError {
  return new CdpError(
    'download-failed',
    reason === 'FILE_TOO_LARGE' || reason === 'FILE_FAILED'
      ? 'Chrome refused to write the frame. It is likely too large for a data: URL.'
      : 'Chrome could not save the frame.',
    `${filename}: ${reason ?? 'unknown'}`,
  );
}

/** Decoded byte length of a base64 payload, without decoding it. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Pulls width/height out of a PNG's IHDR chunk, which always sits at a fixed
 * offset. Cheaper than decoding the image just to report its size.
 */
export function readPngSize(base64: string): { width: number; height: number } {
  // The IHDR dimensions live in bytes 16..23; 32 base64 chars cover that.
  const head = Uint8Array.from(atob(base64.slice(0, 64)), (c) => c.charCodeAt(0));
  if (head.length < 24) return { width: 0, height: 0 };
  const view = new DataView(head.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
