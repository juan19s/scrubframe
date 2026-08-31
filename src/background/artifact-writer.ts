import type { WriteReport } from '../shared/types';
import { readDirectoryHandle } from '../shared/handle-store';
import { CdpError } from './cdp-session';

/** Everything the fallback writes lands under one root, not loose in Downloads. */
export const DOWNLOADS_ROOT = 'Scrubframe';

/**
 * Writes one artifact, preferring the user's project folder.
 *
 * The worker does this, not the panel, and that is deliberate. The panel can be
 * closed at any moment; the worker is held alive by chrome.debugger for the
 * length of a capture. If the panel owned the writes, closing it at frame 40 of
 * 200 would leave the worker capturing frames and handing them to nothing —
 * silently, since there would be no UI left to complain to.
 *
 * Falling back to Downloads is never an error. Chrome before 143 cannot grant
 * the folder permission without a prompt the panel has no way to show, so the
 * honest behaviour is to write the file somewhere and say where.
 */
export async function writeArtifact(
  path: string,
  data: string | Blob,
): Promise<WriteReport> {
  const folder = await folderWriteAttempt(path, data);
  if (folder.ok) return { target: 'folder', path };

  // Only now does a Blob have to become base64: chrome.downloads needs a data:
  // URL, and a service worker has no URL.createObjectURL. Paying that cost on
  // the fallback path only is the point of accepting both types.
  await downloadArtifact(path, typeof data === 'string' ? data : await toBase64(data));
  const report: WriteReport = { target: 'downloads', path: `${DOWNLOADS_ROOT}/${path}` };
  if (folder.because) report.fellBackBecause = folder.because;
  return report;
}

async function folderWriteAttempt(
  path: string,
  data: string | Blob,
): Promise<{ ok: boolean; because?: string }> {
  const root = await readDirectoryHandle();
  if (!root) return { ok: false };

  // The worker has no user gesture, so it can only ever *check* the grant. The
  // panel is what escalates it, on a click, before starting a run — grants are
  // keyed by origin and path in the browser process, so the grant the panel
  // obtains is the one this handle sees.
  const permission = await root.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
  if (permission !== 'granted') {
    return {
      ok: false,
      because:
        permission === 'prompt'
          ? 'the folder needs permission again — click anything in the panel to re-arm it'
          : 'permission to the project folder was denied',
    };
  }

  try {
    await writeThroughHandle(root, path, data);
    return { ok: true };
  } catch (error) {
    return { ok: false, because: error instanceof Error ? error.message : String(error) };
  }
}

async function writeThroughHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  data: string | Blob,
): Promise<void> {
  const segments = path.split('/').filter(Boolean);
  const filename = segments.pop();
  if (!filename) throw new CdpError('write-failed', 'That file has no name.', path);

  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }

  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(typeof data === 'string' ? decodeBase64(data) : data);
  } finally {
    // close() is what actually commits the bytes; skipping it on the error
    // path would leave a zero-byte file behind.
    await writable.close();
  }
}

async function downloadArtifact(path: string, base64: string): Promise<void> {
  const downloadId = await chrome.downloads.download({
    url: `data:image/png;base64,${base64}`,
    filename: `${DOWNLOADS_ROOT}/${path}`,
    saveAs: false,
  });
  await settled(downloadId, path);
}

/** Resolves once Chrome reports the download complete; rejects if it is not. */
async function settled(downloadId: number, path: string): Promise<void> {
  const [existing] = await chrome.downloads.search({ id: downloadId });
  if (existing?.state === 'complete') return;
  if (existing?.state === 'interrupted') throw downloadError(existing.error, path);

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: CdpError) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') finish();
      if (delta.state.current === 'interrupted') finish(downloadError(delta.error?.current, path));
    };
    const timer = setTimeout(
      () =>
        finish(
          new CdpError('download-failed', 'Chrome never finished writing the file.', path),
        ),
      30_000,
    );
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

function downloadError(reason: string | undefined, path: string): CdpError {
  return new CdpError(
    'download-failed',
    reason === 'FILE_TOO_LARGE' || reason === 'FILE_FAILED'
      ? 'Chrome refused to write the frame. Choose a project folder — that path has no size limit.'
      : 'Chrome could not save the frame.',
    `${path}: ${reason ?? 'unknown'}`,
  );
}

/** bytes → base64, in chunks: spreading a large array into fromCharCode blows the stack. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * base64 → bytes. atob exists in an MV3 service worker; Buffer does not.
 *
 * Backed by an explicit ArrayBuffer so the result is Uint8Array<ArrayBuffer>
 * rather than Uint8Array<ArrayBufferLike>; the latter admits SharedArrayBuffer
 * and does not satisfy BufferSource.
 */
export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
