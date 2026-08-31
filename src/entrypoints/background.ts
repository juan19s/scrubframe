import { captureSingleFrame } from '../background/capture-engine';
import { CdpError } from '../background/cdp-session';
import { runAttachSpike } from '../background/spike';
import type { Request, ResultMap } from '../shared/messaging';
import type { ScrubframeFailure } from '../shared/types';

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse({ ok: false, error: toFailure(error) }));
    // Keeps the message channel open for the async reply above.
    return true;
  });
});

async function handle(message: Request): Promise<ResultMap[Request['type']]> {
  switch (message.type) {
    case 'spike/attach-check':
      return runAttachSpike(message.tabId);
    case 'capture/screenshot':
      return captureSingleFrame(message.tabId);
  }
}

function toFailure(error: unknown): ScrubframeFailure {
  if (error instanceof CdpError) return error.toFailure();
  return {
    kind: 'unknown',
    message: 'Something went wrong.',
    detail: error instanceof Error ? error.message : String(error),
  };
}
