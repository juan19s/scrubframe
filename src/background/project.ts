import type { ProjectState } from '../shared/types';
import { projectNameFor } from '../shared/naming';
import { readDirectoryHandle } from '../shared/handle-store';

/**
 * Project names, remembered per site.
 *
 * chrome.storage.local rather than session: a project name is a preference the
 * user set on purpose and expects to survive a restart, unlike a selection,
 * which stops being true the moment the tab navigates.
 */
const NAMES_KEY = 'projectNames';

type NameMap = Record<string, string>;

async function readNames(): Promise<NameMap> {
  const stored = await chrome.storage.local.get(NAMES_KEY);
  return (stored[NAMES_KEY] as NameMap | undefined) ?? {};
}

function siteKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export async function projectStateFor(url: string): Promise<ProjectState> {
  const names = await readNames();
  const key = siteKey(url);
  const handle = await readDirectoryHandle();

  return {
    name: names[key] ?? projectNameFor(url),
    /** True only when the user has explicitly named this site. */
    named: key !== '' && names[key] !== undefined,
    folderName: handle?.name ?? '',
    // The worker has no user gesture and so can only ever read the grant. The
    // panel escalates it on a click; see artifact-writer.ts.
    folderPermission: handle ? await queryPermission(handle) : 'none',
  };
}

export async function setProjectName(url: string, name: string): Promise<ProjectState> {
  const key = siteKey(url);
  const trimmed = name.trim();
  const names = await readNames();
  if (key !== '') {
    if (trimmed === '') delete names[key];
    else names[key] = trimmed;
    await chrome.storage.local.set({ [NAMES_KEY]: names });
  }
  return projectStateFor(url);
}

async function queryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<ProjectState['folderPermission']> {
  try {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    return state === 'granted' || state === 'denied' ? state : 'prompt';
  } catch {
    return 'denied';
  }
}
