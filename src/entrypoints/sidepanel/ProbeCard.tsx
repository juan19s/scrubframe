import type { ProbeResult } from '../../background/page-probe';
import type { AdapterId } from '../../shared/types';

/**
 * What is on this page, and which road to take.
 *
 * The reason this exists: a site whose logo visibly spins reported "nothing on
 * this element is animating". True, and useless — the page runs 36 GSAP tweens
 * and getAnimations() can see 3, because GSAP drives its own ticker and writes
 * inline styles instead of creating Web Animations. Naming that in one line is
 * the difference between a minute and an afternoon.
 */
export function ProbeCard({
  probe,
  current,
  onUse,
}: {
  probe: ProbeResult;
  current: AdapterId;
  onUse: (adapter: AdapterId) => void;
}) {
  const { census, libraries, recommendation } = probe;
  const agrees = recommendation.adapter === current;

  const found = [
    census.waapiTotal > 0 ? `${census.waapiTotal} web animation${census.waapiTotal === 1 ? '' : 's'}` : null,
    libraries.gsap ? `GSAP (${libraries.gsapTweens} tweens)` : null,
    libraries.scrollTrigger ? 'ScrollTrigger' : null,
    libraries.lottie ? 'Lottie' : null,
    libraries.lenis ? 'Lenis' : null,
    libraries.motionOne ? 'Motion One' : null,
    census.smil > 0 ? `${census.smil} SMIL` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">On this page</p>
      <p className="mt-1 text-[11px] leading-snug text-neutral-200">
        {found.length > 0 ? found.join(' · ') : 'No animation API in use'}
      </p>

      <div
        className={`mt-3 rounded border p-2 ${
          agrees ? 'border-emerald-900/60 bg-emerald-950/30' : 'border-sky-900/60 bg-sky-950/30'
        }`}
      >
        <p className={`text-xs font-semibold ${agrees ? 'text-emerald-200' : 'text-sky-200'}`}>
          {agrees ? `${labelFor(recommendation.adapter)} — the right choice here` : `Use ${labelFor(recommendation.adapter)}`}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-neutral-300">{recommendation.reason}</p>
        {!agrees && (
          <button
            type="button"
            onClick={() => onUse(recommendation.adapter)}
            className="mt-2 rounded border border-sky-800 px-2 py-1 text-[11px] text-sky-200 transition hover:border-sky-600"
          >
            Switch to {labelFor(recommendation.adapter)}
          </button>
        )}
      </div>

      {recommendation.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-[11px] leading-snug text-amber-300/80">
          {warning}
        </p>
      ))}

      {census.candidates.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-neutral-500 hover:text-neutral-300">
            {census.candidates.length} animated element(s)
          </summary>
          <ul className="mt-1 space-y-0.5">
            {census.candidates.slice(0, 12).map((candidate, index) => (
              <li
                key={`${candidate.label}-${index}`}
                className="truncate font-mono text-[10px] text-neutral-400"
                title={`${candidate.label} — ${candidate.driver}`}
              >
                <span className={candidate.kind === 'smil' ? 'text-amber-400/80' : 'text-neutral-300'}>
                  {candidate.label}
                </span>{' '}
                {candidate.driver}
                {candidate.durationMs !== null ? ` ${Math.round(candidate.durationMs)}ms` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function labelFor(adapter: AdapterId): string {
  if (adapter === 'waapi') return 'Time';
  if (adapter === 'scroll') return 'Scroll';
  if (adapter === 'gsap') return 'GSAP';
  return adapter;
}
