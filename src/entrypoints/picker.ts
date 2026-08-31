import { startPicker } from '../content/picker';

/**
 * Injected on demand by chrome.scripting.executeScript, never on page load.
 *
 * Unlisted rather than a declared content script: Scrubframe has no business
 * running on a page until the user asks it to, and `activeTab` only grants the
 * injection at the moment they click the toolbar icon.
 */
export default defineUnlistedScript(() => {
  startPicker({
    onSelected: (selection) => {
      void chrome.runtime.sendMessage({ type: 'picker/selected', ...selection });
    },
    onCancelled: () => {
      void chrome.runtime.sendMessage({ type: 'picker/cancelled' });
    },
  });
});
