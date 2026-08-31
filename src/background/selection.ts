import type { SelectionState, StoredSelection } from '../shared/types';

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

export async function readSelection(tabId: number): Promise<SelectionState> {
  const stored = await chrome.storage.session.get(key(tabId));
  const state = stored[key(tabId)] as SelectionState | undefined;
  return state ?? { status: 'none' };
}

export async function writeSelection(tabId: number, state: SelectionState): Promise<void> {
  await chrome.storage.session.set({ [key(tabId)]: state });
}

export async function clearSelection(tabId: number): Promise<void> {
  await chrome.storage.session.remove(key(tabId));
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
