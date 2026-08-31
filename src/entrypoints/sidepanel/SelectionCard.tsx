import type { SelectionState } from '../../shared/types';

/**
 * The picked element, or the lack of one.
 *
 * `stale` is the case worth designing for: the user picked something, then
 * reloaded or navigated. The marker died with the old document, so the
 * selection is gone whether or not we admit it. Saying so beats capturing 12
 * frames of nothing.
 */
export function SelectionCard({
  state,
  currentUrl,
  onPick,
  onClear,
  disabled,
}: {
  state: SelectionState;
  currentUrl: string;
  onPick: () => void;
  onClear: () => void;
  disabled: boolean;
}) {
  if (state.status === 'picking') {
    return (
      <div className="rounded-md border border-sky-900/60 bg-sky-950/40 p-3">
        <p className="text-xs font-semibold text-sky-200">Click an element on the page</p>
        <p className="mt-1 text-[11px] leading-snug text-sky-200/70">
          Hover to highlight, click to choose. Escape cancels. This popup closes when you
          click — that is expected, reopen it after.
        </p>
      </div>
    );
  }

  if (state.status === 'none') {
    return (
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Pick element
      </button>
    );
  }

  const { selection } = state;
  const stale = currentUrl !== '' && selection.url !== '' && currentUrl !== selection.url;

  return (
    <div
      className={`rounded-md border p-3 ${
        stale
          ? 'border-amber-900/60 bg-amber-950/40'
          : 'border-neutral-800 bg-neutral-900/60'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">Selected</p>
      <p className="mt-1 truncate font-mono text-xs text-neutral-100" title={selection.selector}>
        {selection.selector}
      </p>

      {stale && (
        <p className="mt-2 text-[11px] leading-snug text-amber-200">
          The page changed since you picked this. The element is gone — pick again.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="rounded border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300 transition hover:border-neutral-700 disabled:opacity-40"
        >
          Pick another
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="rounded border border-neutral-800 px-2 py-1 text-[11px] text-neutral-500 transition hover:border-neutral-700 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
