/**
 * Human-readable names for a picked element.
 *
 * These are labels, never identity. The element is identified by the marker
 * attribute the picker stamps on it; a selector is only what we print in the
 * popup and write into the capture directory name. Keeping that distinction
 * is what lets the selector be readable instead of correct — computed
 * selectors break on any sibling reorder, and the sites this tool targets
 * reorder things while they animate.
 */

/**
 * Does this class name look machine-generated?
 *
 * The bar is deliberately conservative: a wrongly-kept hash makes an ugly
 * label, a wrongly-dropped class makes a label that points at the wrong thing.
 * So `col-span-2`, `text-2xl` and `hero-2024` all survive.
 */
function looksHashed(name: string): boolean {
  // CSS modules default pattern: Component_local__HASH
  if (/__[A-Za-z0-9]{4,}$/.test(name)) return true;
  // styled-components, emotion, styled-jsx
  if (/^(sc|css|emotion|jsx|glamor)[-_][A-Za-z0-9]{4,}$/i.test(name)) return true;
  // A segment long enough and mixed enough to be a hash rather than a word.
  return name.split(/[-_]+/).some((segment) => {
    if (segment.length < 5) return false;
    const digits = segment.match(/\d/g)?.length ?? 0;
    const letters = segment.match(/[A-Za-z]/g)?.length ?? 0;
    return digits >= 2 && letters >= 2;
  });
}

/** Class names that carry no meaning for a human reading the label. */
function meaningfulClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter((name) => name.length > 0 && name.length <= 24)
    .filter((name) => !looksHashed(name))
    .slice(0, 2);
}

/** One element, as a person would say it: `article.card`, `#hero`, `div`. */
export function describeOne(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute('id');
  if (id && /^[A-Za-z][\w-]*$/.test(id)) return `${tag}#${id}`;
  const classes = meaningfulClasses(element);
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

/**
 * A short ancestor path, so `div` becomes something you can actually place on
 * the page. Stops at two levels — enough to orient, short enough to fit in the
 * popup and in a filename.
 */
export function describePath(element: Element, depth = 2): string {
  const parts: string[] = [describeOne(element)];
  let current = element.parentElement;
  let remaining = depth;
  while (current && remaining > 0 && current !== document.documentElement) {
    parts.unshift(describeOne(current));
    current = current.parentElement;
    remaining -= 1;
  }
  return parts.join(' > ');
}

/** What the popup shows and what ends up in the directory name. */
export function describeElement(element: Element): { selector: string; label: string } {
  return { selector: describePath(element), label: describeOne(element) };
}

/**
 * A document-unique token for the marker attribute.
 *
 * crypto.randomUUID() only exists in a secure context, and plenty of the pages
 * a developer wants to capture are served over plain http on localhost aliases
 * or a LAN address. Falling back keeps the picker working there instead of
 * throwing somewhere the user cannot see.
 */
export function newToken(): string {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') return globalThis.crypto.randomUUID();
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${random()}-${random()}-${random()}`;
}
