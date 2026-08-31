/**
 * Snippets that run inside the page, shared by the adapters.
 *
 * Kept as strings rather than functions because they cross into the page
 * through Runtime.evaluate, where they have no access to anything in this
 * bundle.
 */

/**
 * Waits for a frame to actually reach the screen, or gives up.
 *
 * TWO requestAnimationFrames, because a rAF callback runs BEFORE the style,
 * layout and paint of its own frame: the first only proves the mutation is
 * queued, the second proves the frame carrying it was submitted.
 * Page.captureScreenshot with fromSurface:true copies the compositor surface,
 * not the style tree, so one is not enough.
 *
 * And a race, because in a BACKGROUND TAB rAF never fires at all — measured:
 * document.hidden true, zero callbacks after 1.5s, document.timeline.currentTime
 * still 0. Without the race the await hangs until the 15s command timeout and
 * the user is told "the page stopped responding", which is both wrong and
 * unactionable. Timing out here is not a failure; it is the honest answer that
 * the compositor is not running, and `painted` carries it out.
 */
export const AWAIT_PAINT = `(async () => {
  const painted = await Promise.race([
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))),
    ),
    new Promise((resolve) => setTimeout(() => resolve(false), 400)),
  ]);
  return { painted, hidden: document.hidden };
})()`;
