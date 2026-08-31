/**
 * Output naming (SPEC §5.3): predictable, sortable, collision-free.
 *
 *   scrubframe_{hostname}_{selector-slug}_{timestamp}/
 */

/** Filesystem-safe local timestamp: 20260829-142200. */
export function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Collapses arbitrary text (a hostname, a CSS selector) into a path segment. */
export function slug(input: string, maxLength = 40): string {
  const cleaned = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, maxLength).replace(/-+$/g, '') || 'page';
}

/** Directory name for one capture run. */
export function captureDirectory(url: string, selector: string | null, date: Date): string {
  let hostname = 'local';
  try {
    hostname = new URL(url).hostname || 'local';
  } catch {
    // Keep the fallback; a bad URL should not sink a capture.
  }
  const parts = ['scrubframe', slug(hostname), selector ? slug(selector) : null, stamp(date)];
  return parts.filter((part): part is string => part !== null).join('_');
}

/** Zero-padded frame filename: frame-01.png. */
export function frameName(index: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return `frame-${String(index).padStart(width, '0')}.png`;
}
