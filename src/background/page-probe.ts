import type {
  AnimatedCandidate,
  AnimationCensus,
  LibraryReport,
  PageProbe,
  Recommendation,
} from '../shared/probe';
import { recommend } from '../shared/probe';
import { CdpError } from './cdp-session';
import { readSelection, selectionOf } from './selection';

const CENSUS_SCRIPT = 'census.js';
const LIBRARY_SCRIPT = 'library-probe.js';

export interface ProbeResult extends PageProbe {
  /** Animations attributed to the picked element, or null when none is picked. */
  elementWaapi: number | null;
  recommendation: Recommendation;
}

/**
 * Looks at the page and says which adapter to use.
 *
 * Two injections rather than one, and the split is forced: the census reads the
 * DOM, which an isolated world shares, while library detection reads JS
 * globals, which it does not. window.gsap is simply not there from the isolated
 * side, however much DOM the two worlds have in common.
 *
 * No debugger, no banner, no new permission — chrome.scripting under activeTab
 * is all of it.
 */
export async function probePage(tabId: number): Promise<ProbeResult> {
  const census = await inject<AnimationCensus>(tabId, CENSUS_SCRIPT, 'ISOLATED');
  const main = await inject<
    LibraryReport & { waapiTotal: number; candidates: AnimatedCandidate[] }
  >(
    tabId,
    LIBRARY_SCRIPT,
    'MAIN',
  ).catch(() => null);

  const libraries: LibraryReport = main
    ? {
        gsap: main.gsap,
        gsapTweens: main.gsapTweens,
        scrollTrigger: main.scrollTrigger,
        lottie: main.lottie,
        lenis: main.lenis,
        motionOne: main.motionOne,
      }
    : {
        gsap: false,
        gsapTweens: 0,
        scrollTrigger: false,
        lottie: false,
        lenis: false,
        motionOne: false,
      };

  // Merged rather than kept apart: the user is choosing an element, and which
  // world reported it is not their problem.
  const merged: AnimationCensus = {
    ...census,
    candidates: [...census.candidates, ...(main?.candidates ?? [])],
  };

  const probe: PageProbe = {
    census: merged,
    libraries,
    // The negative control. The isolated-world census rests on an argument
    // about Blink's IDL; comparing the two counts turns it into a measurement.
    mainWorldWaapiTotal: main?.waapiTotal ?? null,
  };

  const selection = selectionOf(await readSelection(tabId));
  const elementWaapi = selection ? countForElement(merged, selection.label) : null;

  return { ...probe, elementWaapi, recommendation: recommend(probe, elementWaapi) };
}

/**
 * How many candidates look like the picked element.
 *
 * A label match, deliberately: the exact attribution is the waapi adapter's job
 * and it does it properly, with subtree walking, from inside a session. This is
 * a hint for a recommendation, and a hint that is occasionally generous is
 * better than a second CDP attach just to sharpen it.
 */
function countForElement(census: AnimationCensus, label: string): number {
  return census.candidates.filter(
    (candidate) => candidate.kind === 'waapi' && candidate.label.startsWith(label),
  ).length;
}

async function inject<T>(
  tabId: number,
  file: string,
  world: 'ISOLATED' | 'MAIN',
): Promise<T> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: [file],
      world,
    });
    if (!result || result.result === undefined) {
      throw new CdpError('no-tab-access', 'The page returned nothing.', `${file} in ${world}`);
    }
    return result.result as T;
  } catch (error) {
    if (error instanceof CdpError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CdpError(
      'no-tab-access',
      'Scrubframe could not read this page. Click the Scrubframe icon on the tab you want, then try again.',
      `${file} in ${world}: ${detail}`,
    );
  }
}

/**
 * Selects a candidate the user clicked in the list.
 *
 * The whole point of the probe was to stop the guessing, and listing elements
 * you then have to find on the page by eye is still guessing. Clicking the row
 * is the shortest path there is: no picker, no hunting through a crowded
 * header.
 *
 * It goes back to whichever world found the element, re-enumerates the same
 * way, and checks the label still matches before stamping. If the page has
 * moved on, that is said rather than the wrong element being marked — the
 * failure this tool least wants is a confident capture of the wrong thing.
 */
export async function selectCandidate(
  tabId: number,
  source: 'census' | 'gsap',
  sourceIndex: number,
  expectedLabel: string,
): Promise<{ marker: string; selector: string; label: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: source === 'gsap' ? 'MAIN' : 'ISOLATED',
    args: [source, sourceIndex, expectedLabel],
    func: (from: string, index: number, label: string) => {
      const describe = (element: Element): string => {
        const raw =
          (element as HTMLElement).className ??
          (element as unknown as { className?: { baseVal?: string } }).className?.baseVal ??
          '';
        const classes = String(raw).split(' ').filter(Boolean).slice(0, 2);
        return element.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
      };

      const targets: Element[] = [];
      if (from === 'gsap') {
        const gsap = (globalThis as Record<string, unknown>).gsap as
          | { globalTimeline?: { getChildren?: (...a: unknown[]) => unknown[] } }
          | undefined;
        const seen = new Set<Element>();
        for (const raw of gsap?.globalTimeline?.getChildren?.(true, true, false) ?? []) {
          const tween = raw as { targets?: () => unknown[]; duration?: () => number };
          if ((tween.duration?.() ?? 0) <= 0) continue;
          for (const candidate of tween.targets?.() ?? []) {
            const element = candidate as Element;
            if (!element || (element as Node).nodeType !== 1 || seen.has(element)) continue;
            seen.add(element);
            const rect = element.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            targets.push(element);
          }
        }
      } else {
        const seen = new Set<Animation>();
        for (const animation of document.getAnimations()) seen.add(animation);
        const walk = (root: Document | ShadowRoot) => {
          for (const element of root.querySelectorAll('*')) {
            const shadow = (element as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
            if (!shadow) continue;
            for (const animation of shadow.getAnimations()) seen.add(animation);
            walk(shadow);
          }
        };
        walk(document);
        for (const animation of seen) {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? (effect as KeyframeEffect).target : null;
          if (!target) continue;
          const rect = target.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          targets.push(target);
        }
        for (const node of document.querySelectorAll(
          'animate, animateTransform, animateMotion, set',
        )) {
          const owner = node.closest('svg') ?? node.parentElement;
          if (!owner) continue;
          const rect = owner.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          targets.push(owner);
        }
      }

      const element = targets[index];
      if (!element) return { error: 'gone' as const };
      const found = describe(element);
      // The list was taken a moment ago; a page that has re-rendered since can
      // shift the order. Marking the wrong element silently would be worse than
      // asking for a fresh look.
      if (!label.startsWith(found) && !found.startsWith(label.split(' ')[0] ?? '')) {
        return { error: 'moved' as const, found };
      }

      const token =
        globalThis.crypto?.randomUUID?.() ??
        `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
      for (const stale of document.querySelectorAll('[data-scrubframe-target]')) {
        stale.removeAttribute('data-scrubframe-target');
      }
      element.setAttribute('data-scrubframe-target', token);

      const path: string[] = [found];
      let parent = element.parentElement;
      for (let depth = 0; depth < 2 && parent && parent !== document.documentElement; depth += 1) {
        path.unshift(describe(parent));
        parent = parent.parentElement;
      }
      return { marker: token, selector: path.join(' > '), label: found };
    },
  });

  const value = result?.result as
    | { marker: string; selector: string; label: string }
    | { error: 'gone' | 'moved'; found?: string }
    | undefined;

  if (!value) {
    throw new CdpError('element-gone', 'That element could not be reached.', 'no result');
  }
  if ('error' in value) {
    throw new CdpError(
      'element-gone',
      value.error === 'gone'
        ? 'That element is no longer animating. Run "What is animating here?" again.'
        : `The page changed — that row now points at ${value.found}. Run "What is animating here?" again.`,
      value.error,
    );
  }
  return value;
}
