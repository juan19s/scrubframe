import { takeCensus } from '../content/census';

/**
 * ISOLATED world. The completion value of an unlisted script is what
 * chrome.scripting.executeScript hands back, so nothing has to be messaged.
 */
export default defineUnlistedScript(() => takeCensus());
