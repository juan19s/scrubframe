import type { Measurement } from '../../shared/types';

/**
 * Raw numbers, deliberately.
 *
 * This is a diagnostic in the shape the Phase 0 spike proved works: show what
 * was measured, not a verdict about it, so a wrong number is visible rather
 * than laundered into a confident sentence.
 */
export function MeasureCard({ result }: { result: Measurement }) {
  const scaleSurprise = result.inheritsDeviceScale;

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
      <p className="truncate font-mono text-xs text-neutral-100" title={result.selector}>
        {result.selector}
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
        <Row label="node" value={`${result.nodeName} · backendNodeId ${result.backendNodeId}`} />
        <Row label="box" value={fmt(result.box)} />
        <Row label="stage" value={`${fmt(result.stage)}  (viewport space)`} />
        <Row label="clip" value={`${fmt(result.clip)}  (document space)`} />
        <Row label="scrollY" value={`${round(result.scrollY)}`} />
      </dl>

      <div
        className={`mt-3 rounded border p-2 ${
          scaleSurprise
            ? 'border-sky-900/60 bg-sky-950/40'
            : 'border-neutral-800 bg-neutral-950/60'
        }`}
      >
        <p className="text-[10px] uppercase tracking-wide text-neutral-500">Retina question</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
          <Row label="asked for" value={`${round(result.stage.width)}×${round(result.stage.height)} css px at scale 1`} />
          <Row label="got back" value={`${result.pngWidth}×${result.pngHeight} px`} />
          <Row label="dpr" value={`${result.devicePixelRatio}`} />
          <Row label="1:1 scale" value={`${result.scaleForOneToOne}`} />
        </dl>
        <p className="mt-2 text-[11px] leading-snug text-neutral-300">
          {scaleSurprise
            ? `A clipped capture DOES inherit the device scale factor. Pass scale ${result.scaleForOneToOne} for 1:1 CSS pixels, or keep 1 to bank the extra resolution.`
            : `A clipped capture does NOT inherit the device scale factor — scale 1 gives 1 CSS pixel per image pixel.`}
        </p>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-neutral-400">
        Saved <code className="text-neutral-200">{result.filename}</code> —{' '}
        {Math.round(result.bytes / 1024)} KB. Open it: it should contain your element and
        nothing else.
      </p>
    </div>
  );
}

function fmt(rect: { x: number; y: number; width: number; height: number }): string {
  return `${round(rect.width)}×${round(rect.height)} @ (${round(rect.x)}, ${round(rect.y)})`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
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
