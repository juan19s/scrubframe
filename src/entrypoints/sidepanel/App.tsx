import { useState } from 'react';
import { send } from '../../shared/messaging';
import type { ScreenshotResult } from '../../shared/types';
import { MeasureCard } from './MeasureCard';
import { SelectionCard } from './SelectionCard';
import { SpikeCard } from './SpikeCard';
import { usePanelState } from './usePanelState';
import type { SpikeReport } from '../../shared/types';

export default function App() {
  const panel = usePanelState();
  const [busy, setBusy] = useState<string | null>(null);
  const [spike, setSpike] = useState<SpikeReport | null>(null);
  const [shot, setShot] = useState<ScreenshotResult | null>(null);

  const tabId = panel.tab.id;
  const ready = tabId !== null && busy === null;

  async function act<T>(label: string, run: (tabId: number) => Promise<T | null>) {
    if (tabId === null || busy !== null) return;
    panel.setError(null);
    setBusy(label);
    try {
      await run(tabId);
    } finally {
      setBusy(null);
    }
  }

  const pick = () =>
    act('Starting picker…', async (id) => {
      panel.setMeasurement(null);
      const response = await send({ type: 'picker/start', tabId: id });
      if (response.ok) panel.setSelection(response.data);
      else panel.setError(response.error);
      return null;
    });

  const clear = () =>
    act('Clearing…', async (id) => {
      panel.setMeasurement(null);
      const response = await send({ type: 'selection/clear', tabId: id });
      if (response.ok) panel.setSelection(response.data);
      else panel.setError(response.error);
      return null;
    });

  const measure = () =>
    act('Measuring…', async (id) => {
      panel.setMeasurement(null);
      const response = await send({ type: 'measure/element', tabId: id });
      if (response.ok) panel.setMeasurement(response.data);
      else panel.setError(response.error);
      return null;
    });

  const capture = () =>
    act('Capturing…', async (id) => {
      setShot(null);
      const response = await send({ type: 'capture/screenshot', tabId: id });
      if (response.ok) setShot(response.data);
      else panel.setError(response.error);
      return null;
    });

  const runSpike = () =>
    act('Attaching…', async (id) => {
      setSpike(null);
      const response = await send({ type: 'spike/attach-check', tabId: id });
      if (response.ok) setSpike(response.data);
      else panel.setError(response.error);
      return null;
    });

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-[#0a0a0a] p-4 font-sans text-neutral-200">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold tracking-tight text-white">Scrubframe</h1>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
          Phase 1
        </span>
      </header>

      {!panel.tab.canPick && tabId !== null && <NoGrantNote />}

      <section className="flex flex-col gap-2">
        <SelectionCard
          state={panel.selection}
          currentUrl={panel.tab.url}
          onPick={() => void pick()}
          onClear={() => void clear()}
          disabled={!ready || !panel.tab.canPick}
        />
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-900 pt-4">
        <button
          type="button"
          onClick={() => void measure()}
          disabled={!ready || panel.selection.status !== 'selected'}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Measure
        </button>
        {panel.measurement && <MeasureCard result={panel.measurement} />}
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-900 pt-4">
        <button
          type="button"
          onClick={() => void capture()}
          disabled={!ready}
          className="rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Capture frame
        </button>
        {shot && (
          <p className="text-[11px] leading-snug text-neutral-400">
            Saved <code className="text-neutral-200">{shot.filename}</code> — {shot.width}×
            {shot.height}, {Math.round(shot.bytes / 1024)} KB
          </p>
        )}
      </section>

      <details className="border-t border-neutral-900 pt-4">
        <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-300">
          Diagnostics
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void runSpike()}
            disabled={!ready}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run ADR-002 spike
          </button>
          {spike && <SpikeCard report={spike} />}
        </div>
      </details>

      {busy && <p className="text-[11px] text-neutral-500">{busy}</p>}
      {panel.error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3">
          <p className="text-xs text-red-200">{panel.error.message}</p>
          {panel.error.detail && (
            <p className="mt-1 font-mono text-[10px] leading-snug text-red-400/70">
              {panel.error.detail}
            </p>
          )}
        </div>
      )}

      <footer className="mt-auto border-t border-neutral-900 pt-3 text-[10px] text-neutral-600">
        No network requests · MIT ·{' '}
        <a
          className="underline decoration-neutral-700 underline-offset-2 hover:text-neutral-400"
          href="https://github.com/juan19s/scrubframe"
          target="_blank"
          rel="noreferrer"
        >
          View source ↗
        </a>
      </footer>
    </div>
  );
}

/**
 * The panel outlives the tab it was opened on, so it lands on tabs where
 * activeTab was never granted. Saying "no access" there would be false —
 * chrome.debugger works regardless, which the Phase 0 spike established. Only
 * the picker is blocked.
 */
function NoGrantNote() {
  return (
    <div className="rounded-md border border-amber-900/60 bg-amber-950/40 p-3">
      <p className="text-xs font-semibold text-amber-200">Picking is off on this tab</p>
      <p className="mt-1 text-[11px] leading-snug text-amber-200/80">
        Click the Scrubframe icon while this tab is open to grant it. Measure and capture
        already work here — they do not need the grant.
      </p>
    </div>
  );
}
