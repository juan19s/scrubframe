import { startRegion } from '../content/region';

/**
 * Injected on demand, like the element picker. Same reasoning: Scrubframe has
 * no business running on a page until the user asks it to.
 */
export default defineUnlistedScript(() => {
  startRegion({
    onDrawn: (region) => {
      void chrome.runtime.sendMessage({ type: 'region/drawn', ...region });
    },
    onCancelled: () => {
      void chrome.runtime.sendMessage({ type: 'picker/cancelled' });
    },
  });
});
