import { useCallback, useEffect, useState } from 'react';
import { send } from '../../shared/messaging';
import type {
  Measurement,
  ScreenshotResult,
  ScrubframeFailure,
  SelectionState,
  SpikeReport,
} from '../../shared/types';
import { MeasureCard } from './MeasureCard';
import { SelectionCard } from './SelectionCard';
import { SpikeCard } from './SpikeCard';

type Status =
  | { state: 'idle' }
  | { state: 'running'; label: string }
  | { state: 'failed'; error: ScrubframeFailure };

export default function App() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [selection, setSelection] = useState<SelectionState>({ status: 'none' });
  const [spike, setSpike] = useState<SpikeReport | null>(null);
  const [shot, setShot] = useState<ScreenshotResult | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);

  const busy = status.state === 'running';

  const fail = useCallback((error: ScrubframeFailure) => setStatus({ state: 'failed', error }), []);

  // The popup is destroyed every time the user clicks into the page to pick,
  // so it rehydrates from the background rather than remembering anything.
  useEffect(() => {
    let cancelled = false;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (cancelled || tab?.id === undefined) return;
        setTabId(tab.id);
        setTabUrl(tab.url ?? '');
        const response = await send({ type: 'selection/get', tabId: tab.id });
        if (cancelled) return;
        if (response.ok) setSelection(response.data);
        else fail(response.error);
      })
      .catch((error: unknown) =>
        fail({
          kind: 'no-tab-access',
          message: 'Scrubframe could not read the current tab.',
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [fail]);

  async function measure() {
    if (tabId === null || busy) return;
    setMeasurement(null);
    setStatus({ state: 'running', label: 'Measuring…' });
    const response = await send({ type: 'measure/element', tabId });
    if (response.ok) {
      setMeasurement(response.data);
      setStatus({ state: 'idle' });
    } else {
      fail(response.error);
    }
  }

  async function capture() {
    if (tabId === null || busy) return;
    setShot(null);
    setStatus({ state: 'running', label: 'Capturing…' });
    const response = await send({ type: 'capture/screenshot', tabId });
    if (response.ok) {
      setShot(response.data);
      setStatus({ state: 'idle' });
    } else {
      fail(response.error);
    }
  }

  async function runSpike() {
    if (tabId === null || busy) return;
    setSpike(null);
    setStatus({ state: 'running', label: 'Attaching…' });
    const response = await send({ type: 'spike/attach-check', tabId });
    if (response.ok) {
      setSpike(response.data);
      setStatus({ state: 'idle' });
    } else {
      fail(response.error);
    }
  }

  async function pick() {
    if (tabId === null || busy) return;
    setStatus({ state: 'running', label: 'Starting picker…' });
    setMeasurement(null);
    const response = await send({ type: 'picker/start', tabId });
    if (response.ok) {
      setSelection(response.data);
      setStatus({ state: 'idle' });
    } else {
      fail(response.error);
    }
  }

  async function clear() {
    if (tabId === null || busy) return;
    setMeasurement(null);
    const response = await send({ type: 'selection/clear', tabId });
    if (response.ok) setSelection(response.data);
    else fail(response.error);
  }

  return (
    <div className="flex min-h-full w-[360px] flex-col gap-4 bg-[#0a0a0a] p-4 font-sans text-neutral-200">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold tracking-tight text-white">Scrubframe</h1>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
          Phase 1
        </span>
      </header>

      <section className="flex flex-col gap-2">
        <SelectionCard
          state={selection}
          currentUrl={tabUrl}
          onPick={pick}
          onClear={clear}
          disabled={busy || tabId === null}
        />
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-900 pt-4">
        <button
          type="button"
          onClick={() => void measure()}
          disabled={busy || tabId === null || selection.status !== 'selected'}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Measure
        </button>
        {measurement && <MeasureCard result={measurement} />}
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-900 pt-4">
        <button
          type="button"
          onClick={() => void capture()}
          disabled={busy || tabId === null}
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
            disabled={busy || tabId === null}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run ADR-002 spike
          </button>
          {spike && <SpikeCard report={spike} />}
        </div>
      </details>

      {busy && <p className="text-[11px] text-neutral-500">{status.label}</p>}
      {status.state === 'failed' && <ErrorNote error={status.error} />}

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

function ErrorNote({ error }: { error: ScrubframeFailure }) {
  return (
    <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3">
      <p className="text-xs text-red-200">{error.message}</p>
      {error.detail && (
        <p className="mt-1 font-mono text-[10px] leading-snug text-red-400/70">{error.detail}</p>
      )}
    </div>
  );
}
