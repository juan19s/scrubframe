import type { SpikeProbe, SpikeReport, SpikeVerdict } from '../../shared/types';

const VERDICTS: Record<SpikeVerdict, { label: string; body: string; tone: string }> = {
  'adr-002-holds': {
    label: 'ADR-002 holds',
    body: 'The invoked tab attached; a tab you never invoked was refused. activeTab is the real gate, so shipping without fixed host permissions is sound.',
    tone: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200',
  },
  'debugger-permission-suffices': {
    label: 'ADR-002 rests on a false premise',
    body: 'A tab you never invoked the extension on attached just as easily. The `debugger` permission grants this by itself — activeTab gates nothing, and omitting host permissions buys no narrower install prompt.',
    tone: 'border-orange-900/60 bg-orange-950/40 text-orange-200',
  },
  'adr-002-needs-revision': {
    label: 'ADR-002 needs revision',
    body: 'Chrome refused the attach for lack of host access. Move to optional_host_permissions with a first-run prompt before Phase 1.',
    tone: 'border-red-900/60 bg-red-950/40 text-red-200',
  },
  'dev-build': {
    label: 'Development build — no verdict',
    body: 'This build carries permissions Scrubframe never ships (listed below). Any answer from it would be about a manifest that is not the one under test. Run `pnpm build` and load .output/chrome-mv3 unpacked.',
    tone: 'border-sky-900/60 bg-sky-950/40 text-sky-200',
  },
  inconclusive: {
    label: 'Inconclusive',
    body: 'The run did not isolate the question. See the rows below.',
    tone: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
  },
};

export function SpikeCard({ report }: { report: SpikeReport }) {
  const verdict = VERDICTS[report.verdict];

  return (
    <div className={`rounded-md border p-3 ${verdict.tone}`}>
      <p className="text-xs font-semibold">{verdict.label}</p>
      <p className="mt-1 text-[11px] leading-snug opacity-80">{verdict.body}</p>

      {report.injectedByBuild.length > 0 && (
        <p className="mt-2 font-mono text-[10px] leading-snug text-sky-300/70">
          injected: {report.injectedByBuild.join(' ')}
        </p>
      )}

      {report.active && (
        <ProbeRows title="invoked tab (activeTab granted)" probe={report.active} />
      )}
      {report.control ? (
        <ProbeRows title="control tab (activeTab NOT granted)" probe={report.control} />
      ) : (
        report.controlNote && (
          <p className="mt-3 text-[10px] leading-snug text-neutral-400">{report.controlNote}</p>
        )
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
        <Row label="host perm" value={report.hostPermissionAbsent ? 'absent' : 'granted'} />
        {report.protocolVersion && <Row label="protocol" value={report.protocolVersion} />}
        {report.grantedOrigins.length > 0 && (
          <Row label="origins" value={report.grantedOrigins.join(' ')} />
        )}
      </dl>
    </div>
  );
}

function ProbeRows({ title, probe }: { title: string; probe: SpikeProbe }) {
  return (
    <div className="mt-3 border-t border-white/10 pt-2">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">{title}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
        <Row label="url" value={probe.url || '(not readable)'} />
        <Row label="attach" value={probe.attachSucceeded ? 'ok' : 'refused'} />
        <Row label="round trip" value={probe.commandSucceeded ? 'ok' : 'failed'} />
        {probe.failure && (
          <Row label="reason" value={`${probe.failure.kind}: ${probe.failure.detail ?? probe.failure.message}`} />
        )}
      </dl>
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
