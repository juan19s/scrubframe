import type { SelectionState } from '../shared/types';
import { readSelection, writeSelection } from './selection';
import { CdpError } from './cdp-session';

/** Built by WXT from src/entrypoints/, at the bundle root. */
const PICKER_SCRIPT = 'picker.js';
const REGION_SCRIPT = 'region.js';

/**
 * Injects the picker into the tab the user is looking at.
 *
 * This is the one place in Scrubframe where `activeTab` does real work.
 * chrome.scripting genuinely checks it — unlike chrome.debugger, which the
 * Phase 0 spike proved needs no per-tab grant at all (docs/ADR-ADDENDUM.md).
 */
export async function startPicking(
  tabId: number,
  mode: 'element' | 'region' = 'element',
): Promise<SelectionState> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: [mode === 'region' ? REGION_SCRIPT : PICKER_SCRIPT],
      world: 'ISOLATED',
    });
  } catch (error) {
    throw injectionError(error);
  }
  const state: SelectionState = { status: 'picking' };
  await writeSelection(tabId, state);
  return state;
}

export async function recordSelection(
  tabId: number,
  picked: { marker: string; selector: string; label: string },
): Promise<SelectionState> {
  const tab = await chrome.tabs.get(tabId);
  const state: SelectionState = {
    status: 'selected',
    selection: {
      marker: picked.marker,
      selector: picked.selector,
      label: picked.label,
      url: tab.url ?? '',
      pickedAt: Date.now(),
    },
  };
  await writeSelection(tabId, state);
  return state;
}

/**
 * Cancelling drops the picking state but keeps whatever was selected before,
 * so hitting Escape does not silently throw away an earlier choice.
 */
export async function recordRegion(
  tabId: number,
  drawn: { x: number; y: number; width: number; height: number; scrollY: number },
): Promise<SelectionState> {
  const tab = await chrome.tabs.get(tabId);
  const state: SelectionState = {
    status: 'region',
    region: { ...drawn, url: tab.url ?? '', drawnAt: Date.now() },
  };
  await writeSelection(tabId, state);
  return state;
}

export async function cancelPicking(tabId: number): Promise<SelectionState> {
  const current = await readSelection(tabId);
  if (current.status !== 'picking') return current;
  const state: SelectionState = { status: 'none' };
  await writeSelection(tabId, state);
  return state;
}

function injectionError(raw: unknown): CdpError {
  const detail = raw instanceof Error ? raw.message : String(raw);
  const text = detail.toLowerCase();
  if (text.includes('cannot access') || text.includes('chrome://') || text.includes('extension')) {
    return new CdpError(
      'restricted-url',
      'Chrome blocks extensions on this page. Open a regular http(s) site and try again.',
      detail,
    );
  }
  if (text.includes('no tab with id')) {
    return new CdpError('tab-closed', 'That tab is gone.', detail);
  }
  return new CdpError(
    'no-tab-access',
    'Scrubframe could not reach this tab. Click the Scrubframe icon on the tab you want, then try again.',
    detail,
  );
}
