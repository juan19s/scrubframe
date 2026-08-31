import type { CaptureRun } from '../../shared/types';

/**
 * What a run produced.
 *
 * Shows the scroll positions the page ACTUALLY landed on, not the ones we asked
 * for. On a well-behaved page they are the same; where they are not, the
 * difference is the whole story, and burying it would leave the user trusting
 * frames that do not mean what they look like.
 */
export function RunCard({ run }: { run: CaptureRun }) {
  const step = run.frames > 1 ? (run.range.to - run.range.from) / (run.frames - 1) : 0;

  return (
    <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3">
      <p className="text-xs font-semibold text-emerald-200">
        {run.frames} frames captured
      </p>
      <p className="mt-1 truncate font-mono text-[11px] text-neutral-300" title={run.directory}>
        {run.directory}/
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
        <Row label="scroll" value={`${Math.round(run.range.from)} → ${Math.round(run.range.to)} px`} />
        <Row label="step" value={`${Math.round(step)} px`} />
        <Row label="frame" value={`${run.pngWidth}×${run.pngHeight} px`} />
        <Row label="scale" value={`${run.scale}`} />
        <Row label="total" value={`${Math.round(run.bytes / 1024 / 1024 * 10) / 10} MB`} />
        <Row label="saved to" value={run.target === 'folder' ? 'project folder' : 'Downloads'} />
        <Row label="dpr" value={`${run.devicePixelRatio}`} />
      </dl>

      {run.sizeDrift && (
        <p className="mt-2 text-[11px] leading-snug text-amber-300/80">
          Frame size did not match the prediction: {run.sizeDrift}. Every frame is still the
          same size as every other one.
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-neutral-500 hover:text-neutral-300">
          Where the page actually landed
        </summary>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-neutral-400">
          {run.positions.map((y) => Math.round(y)).join(' · ')}
        </p>
      </details>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="truncate text-neutral-300" title={value}>
        {value}
      </dd>
    </>
  );
}
