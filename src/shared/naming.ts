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

/**
 * Where one capture run's files go, inside the project folder.
 *
 *   era-residence/20260831-1145_h1-hero/frame-01.png
 *
 * One directory per run, because a run's frames belong together. Diagnostics
 * are different and deliberately do not use this: Measure overwrites a single
 * file, since a folder per click is what made the output unreadable.
 */
export function runDirectory(project: string, selector: string | null, date: Date): string {
  const name = [stamp(date), selector ? slug(selector) : null].filter(Boolean).join('_');
  return `${slug(project)}/${name}`;
}

/** Zero-padded frame filename: frame-01.png. */
export function frameName(index: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return `frame-${String(index).padStart(width, '0')}.png`;
}

/**
 * Two-part public suffixes, curated.
 *
 * The correct source for this is the Public Suffix List, which is ~15,000
 * rules maintained by Mozilla. Shipping it would be larger than the rest of
 * the extension put together, in a project whose pitch is "it is small, read
 * it yourself". So: the common cases, and honesty about the rest.
 *
 * What this gets wrong: an uncommon two-part suffix falls back to a one-part
 * split, so `example.co.za` would come out as `co` rather than `example`. The
 * project name is editable, which is what makes that an annoyance rather than
 * a defect.
 */
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  'com.ar', 'com.br', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.ec',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.nz', 'co.in', 'co.kr', 'co.za', 'co.il', 'co.id', 'co.th',
  'com.tr', 'com.cn', 'com.hk', 'com.sg', 'com.my', 'com.ph', 'com.tw',
  'com.es', 'com.pt', 'com.pl', 'com.ua', 'com.sa', 'com.eg', 'com.ng',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The default project name for a URL: what sits between the `www.` and the TLD.
 *
 * Subdomains are kept, minus `www`, because the result is a folder someone
 * scans in Finder. If you work on both the blog and the main site, two folders
 * called `example` help nobody — `blog-example` and `example` do.
 *
 *   www.era-residence.com        -> era-residence
 *   blog.example.com             -> blog-example
 *   app.staging.example.co.uk    -> app-staging-example
 *   localhost:3000               -> localhost
 */
export function projectNameFor(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return 'project';
  }
  if (hostname === '') return 'project';

  // An address is not a name, but it is what the user has. Keep it recognisable.
  if (IPV4.test(hostname) || hostname.includes(':')) return slug(hostname);

  const labels = hostname.split('.').filter(Boolean);
  if (labels.length === 0) return 'project';
  // localhost, or any single-label host on a LAN.
  if (labels.length === 1) return slug(labels[0]!);

  const withoutWww = labels[0] === 'www' ? labels.slice(1) : labels;
  if (withoutWww.length === 1) return slug(withoutWww[0]!);

  const lastTwo = withoutWww.slice(-2).join('.');
  const suffixLabels = TWO_PART_SUFFIXES.has(lastTwo) ? 2 : 1;
  const meaningful = withoutWww.slice(0, Math.max(1, withoutWww.length - suffixLabels));

  return slug(meaningful.join('-'));
}
