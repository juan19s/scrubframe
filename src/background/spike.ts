import type { ScrubframeFailure, SpikeProbe, SpikeReport, SpikeVerdict } from '../shared/types';
import { CdpError, CdpSession, classify } from './cdp-session';

/** Exactly what wxt.config.ts declares. Anything else was injected by a build. */
const DECLARED_PERMISSIONS = new Set([
  'debugger',
  'activeTab',
  'scripting',
  'downloads',
  'storage',
  // WXT adds this to the manifest itself when a sidepanel entrypoint exists.
  // Leaving it out here would make every production build look like a dev
  // build to the spike, which would then refuse to give a verdict.
  'sidePanel',
]);

/** How many background tabs we are willing to touch looking for a usable control. */
const MAX_CONTROL_CANDIDATES = 5;

/**
 * Phase 0 spike for ADR-002.
 *
 * The question is whether `chrome.debugger.attach()` works when the only access
 * we hold is the temporary grant `activeTab` hands us on toolbar click.
 *
 * Attaching to the tab you clicked the icon on cannot answer that on its own.
 * It proves *something* allowed the attach, and there are two candidates:
 * activeTab, or the `debugger` permission being sufficient by itself. Those are
 * different answers to ADR-002 and only one of them supports the ADR's privacy
 * story, so the spike runs a negative control — a second tab the user never
 * invoked the extension on, where activeTab is definitionally not granted.
 *
 *   control refused  -> activeTab is the gate. ADR-002 holds.
 *   control attached -> activeTab gates nothing. ADR-002's premise is wrong.
 */
export async function runAttachSpike(tabId: number): Promise<SpikeReport> {
  const injectedByBuild = detectInjectedPermissions();
  const granted = await chrome.permissions.getAll();
  const grantedOrigins = granted.origins ?? [];

  const activeTab = await chrome.tabs.get(tabId);
  const activeUrl = activeTab.url ?? '';
  const hostPermissionAbsent = !(await hasOriginPermission(activeUrl));

  // A dev build carries permissions we never ship. Refuse to answer rather
  // than answer from a manifest that is not the one under test.
  if (injectedByBuild.length > 0) {
    return {
      injectedByBuild,
      grantedOrigins,
      hostPermissionAbsent,
      active: null,
      control: null,
      controlNote: 'Nothing was attached. The experiment stops before touching the tab.',
      verdict: 'dev-build',
    };
  }

  const active = await probe(tabId, activeUrl);
  const { control, controlNote } = active.attachSucceeded
    ? await findControlProbe(tabId)
    : { control: null, controlNote: 'Not attempted — the active tab did not attach.' };

  const report: SpikeReport = {
    injectedByBuild,
    grantedOrigins,
    hostPermissionAbsent,
    active,
    control,
    verdict: decide(active, control),
  };
  if (controlNote) report.controlNote = controlNote;
  if (active.protocolVersion) report.protocolVersion = active.protocolVersion;
  return report;
}

export function decide(active: SpikeProbe, control: SpikeProbe | null): SpikeVerdict {
  if (!active.attachSucceeded) {
    return active.failure?.kind === 'no-tab-access' ? 'adr-002-needs-revision' : 'inconclusive';
  }
  // The active tab worked but we never established *why*. Not an answer.
  if (control === null) return 'inconclusive';
  if (control.attachSucceeded && control.commandSucceeded) return 'debugger-permission-suffices';
  if (control.failure?.kind === 'no-tab-access') return 'adr-002-holds';
  return 'inconclusive';
}

/** One attach + round trip against one tab. Never throws. */
async function probe(
  tabId: number,
  url: string,
): Promise<SpikeProbe & { protocolVersion?: string }> {
  let session: CdpSession;
  try {
    session = await CdpSession.attach(tabId);
  } catch (error) {
    // Attach refused. This is the measurement, not an error to swallow.
    return {
      tabId,
      url,
      attachSucceeded: false,
      commandSucceeded: false,
      failure: toFailure(error),
    };
  }

  // Attach succeeded. Whatever happens next, that fact is recorded.
  try {
    const evaluated = await session.send('Runtime.evaluate', {
      expression: '1 + 1',
      returnByValue: true,
    });
    if (evaluated.result.value !== 2) {
      return {
        tabId,
        url,
        attachSucceeded: true,
        commandSucceeded: false,
        failure: {
          kind: 'unknown',
          message: 'The page answered, but not with what we asked for.',
          detail: JSON.stringify(evaluated.result),
        },
      };
    }

    let protocolVersion: string | undefined;
    try {
      protocolVersion = (await session.send('Browser.getVersion')).protocolVersion;
    } catch {
      // Browser-level domain, not always reachable from a tab session, and not
      // part of the question being answered here.
    }

    const result: SpikeProbe & { protocolVersion?: string } = {
      tabId,
      url,
      attachSucceeded: true,
      commandSucceeded: true,
    };
    if (protocolVersion) result.protocolVersion = protocolVersion;
    return result;
  } catch (error) {
    return {
      tabId,
      url,
      attachSucceeded: true,
      commandSucceeded: false,
      failure: toFailure(error),
    };
  } finally {
    await session.detach();
  }
}

/**
 * Finds a tab the user has not invoked the extension on and probes it.
 *
 * Without the `tabs` permission we cannot read a background tab's URL, so we
 * cannot pre-filter out chrome:// pages. We attach and read the refusal instead:
 * 'restricted-url' means bad candidate, 'no-tab-access' means a real answer.
 */
async function findControlProbe(
  activeTabId: number,
): Promise<{ control: SpikeProbe | null; controlNote?: string }> {
  const candidates = (await chrome.tabs.query({}))
    .filter((tab) => tab.id !== undefined && tab.id !== activeTabId && !tab.active)
    .slice(0, MAX_CONTROL_CANDIDATES);

  if (candidates.length === 0) {
    return {
      control: null,
      controlNote:
        'No control tab available. Open a second http(s) tab in the background and run this again — without one the spike cannot tell activeTab apart from the debugger permission.',
    };
  }

  for (const tab of candidates) {
    const result = await probe(tab.id!, tab.url ?? '');
    // Decisive either way: it attached, or it was refused for lack of access.
    if (result.attachSucceeded || result.failure?.kind === 'no-tab-access') {
      return { control: result };
    }
  }

  return {
    control: null,
    controlNote: `Tried ${candidates.length} background tab(s); none gave a decisive answer. Open a plain https page in a background tab and run this again.`,
  };
}

function toFailure(error: unknown): ScrubframeFailure {
  return error instanceof CdpError ? error.toFailure() : classify(error).toFailure();
}

/**
 * Permissions in the running manifest that wxt.config.ts does not declare.
 *
 * WXT's dev build injects `tabs` and `host_permissions: http://localhost/*` for
 * hot reload. Both change the answer to this experiment, so a dev build has to
 * be caught and refused rather than quietly measured.
 */
function detectInjectedPermissions(): string[] {
  const manifest = chrome.runtime.getManifest();
  const extras = (manifest.permissions ?? [])
    .filter((permission) => !DECLARED_PERMISSIONS.has(permission))
    .map((permission) => `permission:${permission}`);
  const declaredHosts: string[] = manifest.host_permissions ?? [];
  const hosts = declaredHosts.map((host) => `host:${host}`);
  return [...extras, ...hosts];
}

/** Asks Chrome itself whether we hold an origin permission covering `url`. */
async function hasOriginPermission(url: string): Promise<boolean> {
  let origin: string;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return false;
  }
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch {
    // Non-matchable scheme (chrome://, about:) — no origin permission exists.
    return false;
  }
}
