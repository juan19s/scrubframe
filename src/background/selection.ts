import type { Measurement, PopupState, SelectionState, StoredSelection } from '../shared/types';

/**
 * Where a selection lives between the popup closing and reopening.
 *
 * chrome.storage.session, not storage.local: this records the URL the user is
 * looking at and a label from their page, for a fact that stops being true the
 * moment the tab navigates. None of that belongs on disk.
 *
 * And not a variable in the service worker either — MV3 terminates the worker
 * on idle, which is exactly what happens while the user is hunting for the
 * element they want.
 */

const key = (tabId: number) => `sf:tab:${tabId}`;
const measureKey = (tabId: number) => `sf:measure:${tabId}`;

export async function readSelection(tabId: number): Promise<SelectionState> {
  const stored = await chrome.storage.session.get(key(tabId));
  const state = stored[key(tabId)] as SelectionState | undefined;
  return state ?? { status: 'none' };
}

export async function writeSelection(tabId: number, state: SelectionState): Promise<void> {
  await chrome.storage.session.set({ [key(tabId)]: state });
}

export async function clearSelection(tabId: number): Promise<void> {
  await chrome.storage.session.remove([key(tabId), measureKey(tabId)]);
}

/**
 * The last measurement, stored for the same reason the selection is.
 *
 * chrome.downloads opens Chrome's download bubble when a file lands, the bubble
 * takes focus, and an extension popup closes the moment it loses focus. So the
 * popup is reliably dead by the time a measurement that saved a file comes
 * back. Anything the popup must still be able to show has to outlive it.
 */
export async function readMeasurement(tabId: number): Promise<Measurement | null> {
  const stored = await chrome.storage.session.get(measureKey(tabId));
  return (stored[measureKey(tabId)] as Measurement | undefined) ?? null;
}

export async function writeMeasurement(tabId: number, result: Measurement): Promise<void> {
  await chrome.storage.session.set({ [measureKey(tabId)]: result });
}

export async function clearMeasurement(tabId: number): Promise<void> {
  await chrome.storage.session.remove(measureKey(tabId));
}

/** Everything the popup needs on mount, in one round trip. */
export async function readPopupState(tabId: number): Promise<PopupState> {
  const [selection, measurement] = await Promise.all([
    readSelection(tabId),
    readMeasurement(tabId),
  ]);
  return { selection, measurement };
}

export function selectionOf(state: SelectionState): StoredSelection | null {
  return state.status === 'selected' ? state.selection : null;
}

/** Forget a tab's selection once that tab is gone. */
export function registerTabCleanup(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearSelection(tabId);
  });
}
