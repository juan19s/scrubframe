import { captureSingleFrame } from '../background/capture-engine';
import { CdpError } from '../background/cdp-session';
import { cancelPicking, recordSelection, startPicking } from '../background/picker-control';
import { clearSelection, readSelection, registerTabCleanup } from '../background/selection';
import { measureSelection } from '../background/measure';
import { runAttachSpike } from '../background/spike';
import type { Request, ResultMap } from '../shared/messaging';
import type { ScrubframeFailure } from '../shared/types';

export default defineBackground(() => {
  registerTabCleanup();

  chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
    handle(message, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse({ ok: false, error: toFailure(error) }));
    // Keeps the message channel open for the async reply above.
    return true;
  });
});

async function handle(
  message: Request,
  sender: chrome.runtime.MessageSender,
): Promise<ResultMap[Request['type']]> {
  switch (message.type) {
    case 'spike/attach-check':
      return runAttachSpike(message.tabId);
    case 'capture/screenshot':
      return captureSingleFrame(message.tabId);
    case 'picker/start':
      return startPicking(message.tabId);
    case 'measure/element':
      return measureSelection(message.tabId);
    case 'selection/get':
      return readSelection(message.tabId);
    case 'selection/clear':
      await clearSelection(message.tabId);
      return { status: 'none' };
    // The picker never tells us which tab it is in. Believing it if it did
    // would let any page that guessed our message shape rewrite another tab's
    // selection; chrome.runtime fills in the sender itself.
    case 'picker/selected':
      return recordSelection(senderTab(sender), message);
    case 'picker/cancelled':
      return cancelPicking(senderTab(sender));
  }
}

function senderTab(sender: chrome.runtime.MessageSender): number {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    throw new CdpError('tab-closed', 'That message did not come from a tab.', 'sender.tab missing');
  }
  return tabId;
}

function toFailure(error: unknown): ScrubframeFailure {
  if (error instanceof CdpError) return error.toFailure();
  return {
    kind: 'unknown',
    message: 'Something went wrong.',
    detail: error instanceof Error ? error.message : String(error),
  };
}
