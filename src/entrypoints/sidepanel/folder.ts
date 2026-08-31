import {
  clearDirectoryHandle,
  readDirectoryHandle,
  writeDirectoryHandle,
} from '../../shared/handle-store';

/**
 * Folder picking, which can only happen here.
 *
 * showDirectoryPicker() is on Window, so a service worker cannot call it, and
 * it needs transient user activation. The side panel is the first UI surface
 * this extension has had that can do both — the popup was destroyed the moment
 * the file dialog took focus, which is why this was not possible before.
 */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await window.showDirectoryPicker({ id: 'scrubframe', mode: 'readwrite' });
    await writeDirectoryHandle(handle);
    return handle;
  } catch (error) {
    // AbortError is the user closing the dialog. Not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function forgetFolder(): Promise<void> {
  await clearDirectoryHandle();
}

/**
 * Re-arms the folder permission, and must be the FIRST thing a click handler
 * awaits.
 *
 * The grant does not survive a browser restart — Chromium never gives an
 * extension origin the "allow on every visit" tier, because that check is an
 * installed-PWA check a chrome-extension:// origin can never pass. What it does
 * give, from Chrome 143, is an auto-grant with no prompt for extension origins
 * that have no permission dialog attached, which a side panel does not. So the
 * user sees nothing; we just have to ask, from inside a gesture, once a session.
 *
 * requestPermission requires transient activation, and any await before it
 * spends the activation window.
 */
export async function armFolderPermission(): Promise<PermissionState | 'none'> {
  const handle = await readDirectoryHandle();
  if (!handle) return 'none';
  const current = await handle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return current;
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    // Chrome 142 and earlier: no request manager, no auto-grant, no way to ask.
    return 'denied';
  }
}
