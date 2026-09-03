import type { AnimationCensus, LibraryReport, PageProbe, Recommendation } from '../shared/probe';
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
  const main = await inject<LibraryReport & { waapiTotal: number }>(
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

  const probe: PageProbe = {
    census,
    libraries,
    // The negative control. The isolated-world census rests on an argument
    // about Blink's IDL; comparing the two counts turns it into a measurement.
    mainWorldWaapiTotal: main?.waapiTotal ?? null,
  };

  const selection = selectionOf(await readSelection(tabId));
  const elementWaapi = selection ? countForElement(census, selection.label) : null;

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
