import { captureSingleFrame } from '../background/capture-engine';
import { captureScrollRun } from '../background/capture-run';
import { CdpError } from '../background/cdp-session';
import {
  cancelPicking,
  recordRegion,
  recordSelection,
  startPicking,
} from '../background/picker-control';
import {
  clearSelection,
  readPopupState,
  registerTabCleanup,
} from '../background/selection';
import { measureSelection } from '../background/measure';
import { projectStateFor, setProjectName } from '../background/project';
import { runAttachSpike } from '../background/spike';
import type { Request, ResultMap } from '../shared/messaging';
import type { ScrubframeFailure } from '../shared/types';

export default defineBackground(() => {
  registerTabCleanup();

  // Asserting false rather than merely abstaining: the setting is a persisted
  // profile pref, so a profile where it was ever turned on stays poisoned and
  // would keep costing us the activeTab grant on every click.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  chrome.action.onClicked.addListener((tab) => {
    // FIRST statement, and deliberately not awaited into. sidePanel.open()
    // hard-requires a user gesture, and any await before it spends the
    // activation — the call then rejects with "may only be called in response
    // to a user gesture". Everything else can wait.
    if (tab.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
  });

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
    case 'capture/run':
      return captureScrollRun(message.tabId, message.frames, message.stepPx, message.adapter);
    case 'picker/start':
      return startPicking(message.tabId, 'element');
    case 'region/start':
      return startPicking(message.tabId, 'region');
    case 'region/drawn':
      return recordRegion(senderTab(sender), message);
    case 'measure/element':
      return measureSelection(message.tabId);
    case 'project/get':
      return projectStateFor(await tabUrl(message.tabId));
    case 'project/set-name':
      return setProjectName(await tabUrl(message.tabId), message.name);
    case 'state/get':
      return readPopupState(message.tabId);
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
    default:
      return unknownMessage(message);
  }
}

/**
 * A message this build does not know about.
 *
 * TypeScript makes the switch above exhaustive, so at compile time this is
 * unreachable — the `never` assignment proves it. At runtime it is very
 * reachable: after an extension reload, a page still running the previous
 * build keeps talking to the new worker. Falling out of the switch used to
 * answer `{ok: true, data: undefined}`, and the old UI then blew up reading a
 * property of undefined, several layers away from the actual cause.
 */
function unknownMessage(message: never): never {
  const type = (message as { type?: unknown }).type;
  throw new CdpError(
    'unknown',
    'Scrubframe was reloaded. Close and reopen the side panel.',
    `unhandled message: ${String(type)}`,
  );
}

async function tabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? '';
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
