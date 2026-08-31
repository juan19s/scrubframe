import { useCallback, useEffect, useState } from 'react';
import { send } from '../../shared/messaging';
import type { Measurement, ScrubframeFailure, SelectionState } from '../../shared/types';

export interface PanelTab {
  id: number | null;
  url: string;
  /**
   * Whether the picker can be injected here.
   *
   * chrome.scripting genuinely requires activeTab, and without that grant
   * Chrome withholds the tab's URL — so an undefined url IS the signal. Note
   * what still works without it: chrome.debugger, which the Phase 0 spike
   * proved needs no per-tab grant at all. So the honest state on an ungranted
   * tab is "measuring works, picking does not", not "no access".
   */
  canPick: boolean;
}

export interface PanelState {
  tab: PanelTab;
  selection: SelectionState;
  measurement: Measurement | null;
  error: ScrubframeFailure | null;
  refresh: () => void;
  setSelection: (state: SelectionState) => void;
  setMeasurement: (result: Measurement | null) => void;
  setError: (error: ScrubframeFailure | null) => void;
}

const NO_TAB: PanelTab = { id: null, url: '', canPick: false };

/**
 * Keeps the panel honest about a tab it does not control.
 *
 * The popup used to get a correctness reset for free: it was destroyed and
 * rebuilt on every open. A side panel outlives tab switches, navigations and
 * the service worker, so everything that used to be implicit has to be
 * subscribed to explicitly — otherwise the panel sits there showing a
 * selection that died two pages ago, with Measure still enabled.
 */
export function usePanelState(): PanelState {
  const [tab, setTab] = useState<PanelTab>(NO_TAB);
  const [selection, setSelection] = useState<SelectionState>({ status: 'none' });
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [error, setError] = useState<ScrubframeFailure | null>(null);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (active?.id === undefined) {
          setTab(NO_TAB);
          return;
        }
        setTab({ id: active.id, url: active.url ?? '', canPick: active.url !== undefined });
        const response = await send({ type: 'state/get', tabId: active.id });
        if (response.ok) {
          setSelection(response.data.selection);
          setMeasurement(response.data.measurement);
        } else {
          setError(response.error);
        }
      } catch (cause) {
        setError({
          kind: 'no-tab-access',
          message: 'Scrubframe could not read the current tab.',
          detail: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();
  }, []);

  useEffect(() => {
    refresh();

    const onActivated = () => refresh();
    // A navigation revokes activeTab and kills the marker with the old
    // document, so the panel has to stop trusting what it is showing.
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.status === 'loading' || change.url !== undefined) refresh();
    };
    // The background is the only writer of selection state; this is how the
    // panel learns the picker finished while the user was in the page.
    const onStorage = () => refresh();

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.storage.session.onChanged.addListener(onStorage);
    chrome.windows.onFocusChanged.addListener(onActivated);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.session.onChanged.removeListener(onStorage);
      chrome.windows.onFocusChanged.removeListener(onActivated);
    };
  }, [refresh]);

  return {
    tab,
    selection,
    measurement,
    error,
    refresh,
    setSelection,
    setMeasurement,
    setError,
  };
}
