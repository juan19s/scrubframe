/**
 * Where the chosen project folder lives.
 *
 * A FileSystemDirectoryHandle cannot travel over chrome.runtime — Chrome's
 * message passing is JSON, so a handle arrives as `{}` rather than throwing,
 * which would be a silent bug rather than a loud one. IndexedDB can store it,
 * because handles are serializable.
 *
 * That is the whole architecture: the side panel and the service worker share
 * one origin and therefore one IndexedDB. The panel picks the folder and puts
 * the handle here; the worker reads the same handle back out and does the
 * writing itself.
 *
 * Which is not just convenient — it is what keeps frames from being lost. If
 * the panel did the writing, closing it mid-run would leave the worker (kept
 * alive by chrome.debugger) capturing frames and handing them to nothing.
 */

const DB_NAME = 'scrubframe';
const STORE = 'handles';
const KEY = 'project-directory';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export async function readDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await withStore<FileSystemDirectoryHandle | undefined>('readonly', (store) =>
      store.get(KEY),
    );
    return handle ?? null;
  } catch {
    // A missing or corrupt database is not worth failing a capture over; the
    // caller falls back to Downloads.
    return null;
  }
}

export async function writeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, KEY));
}

export async function clearDirectoryHandle(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY));
}
