import { useEffect, useState } from 'react';
import { send } from '../../shared/messaging';
import type { ScreenshotResult, ScrubframeFailure, SpikeReport } from '../../shared/types';
import { SpikeCard } from './SpikeCard';

type Status =
  | { state: 'idle' }
  | { state: 'running'; label: string }
  | { state: 'failed'; error: ScrubframeFailure };

export default function App() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [spike, setSpike] = useState<SpikeReport | null>(null);
  const [shot, setShot] = useState<ScreenshotResult | null>(null);

  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setTabId(tab?.id ?? null))
      .catch((error: unknown) =>
        setStatus({
          state: 'failed',
          error: {
            kind: 'no-tab-access',
            message: 'Scrubframe could not read the current tab.',
            detail: error instanceof Error ? error.message : String(error),
          },
        }),
      );
  }, []);

  const busy = status.state === 'running';

  async function runSpike() {
    if (tabId === null || busy) return;
    setSpike(null);
    setStatus({ state: 'running', label: 'Attaching…' });
    const response = await send({ type: 'spike/attach-check', tabId });
    if (response.ok) {
      setSpike(response.data);
      setStatus({ state: 'idle' });
    } else {
      setStatus({ state: 'failed', error: response.error });
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
      setStatus({ state: 'failed', error: response.error });
    }
  }

  return (
    <div className="flex min-h-full w-[360px] flex-col gap-4 bg-[#0a0a0a] p-4 font-sans text-neutral-200">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold tracking-tight text-white">Scrubframe</h1>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
          Phase 0
        </span>
      </header>

      <section className="flex flex-col gap-2">
        <Button onClick={runSpike} disabled={busy || tabId === null}>
          Run ADR-002 spike
        </Button>
        <p className="text-[11px] leading-snug text-neutral-500">
          Attaches to this tab, then to a background tab you never invoked Scrubframe on. The
          second one is the control: it is what separates <code>activeTab</code> from the{' '}
          <code>debugger</code> permission. Keep another http(s) tab open.
        </p>
        {spike && <SpikeCard report={spike} />}
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-900 pt-4">
        <Button onClick={capture} disabled={busy || tabId === null} variant="primary">
          Capture frame
        </Button>
        {shot && (
          <p className="text-[11px] leading-snug text-neutral-400">
            Saved <code className="text-neutral-200">{shot.filename}</code> — {shot.width}×
            {shot.height}, {Math.round(shot.bytes / 1024)} KB
          </p>
        )}
      </section>

      {busy && <p className="text-[11px] text-neutral-500">{status.label}</p>}
      {status.state === 'failed' && <ErrorNote error={status.error} />}

      <footer className="mt-auto border-t border-neutral-900 pt-3 text-[10px] text-neutral-600">
        No network requests · MIT ·{' '}
        <a
          className="underline decoration-neutral-700 underline-offset-2 hover:text-neutral-400"
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
        >
          View source ↗
        </a>
      </footer>
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary';
}) {
  const tone =
    variant === 'primary'
      ? 'bg-white text-neutral-950 hover:bg-neutral-200'
      : 'border border-neutral-800 bg-neutral-900 text-neutral-200 hover:border-neutral-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
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
