import { useEffect, useState } from 'react';
import type { ProjectState } from '../../shared/types';

/**
 * The project: a name and, optionally, a real folder on disk.
 *
 * Without a folder everything still works — files go to
 * Downloads/Scrubframe/<project>/. The folder is an upgrade, not a
 * prerequisite, and the card says which one is in effect rather than implying
 * the tool is unconfigured.
 */
export function ProjectCard({
  project,
  onRename,
  onChooseFolder,
  onForgetFolder,
  disabled,
}: {
  project: ProjectState;
  onRename: (name: string) => void;
  onChooseFolder: () => void;
  onForgetFolder: () => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(project.name);
  useEffect(() => setDraft(project.name), [project.name]);

  const commit = () => {
    if (draft.trim() !== project.name) onRename(draft);
  };

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
      <label
        className="text-[10px] uppercase tracking-wide text-neutral-500"
        htmlFor="scrubframe-project"
      >
        Project
      </label>
      <input
        id="scrubframe-project"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        placeholder="project-name"
        className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 outline-none focus:border-neutral-600 disabled:opacity-40"
      />
      {!project.named && (
        <p className="mt-1 text-[10px] text-neutral-600">Taken from the site. Rename it freely.</p>
      )}

      <div className="mt-3 border-t border-neutral-800 pt-2">
        {project.folderName ? (
          <>
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">Saving to</p>
            <p className="mt-1 truncate font-mono text-xs text-neutral-200">
              {project.folderName}/{project.name}/
            </p>
            {project.folderPermission === 'prompt' && (
              <p className="mt-1 text-[11px] leading-snug text-amber-300/80">
                Chrome asks for this folder again each session. It is re-armed the moment you
                use any button here — you will not see a dialog.
              </p>
            )}
            {project.folderPermission === 'denied' && (
              <p className="mt-1 text-[11px] leading-snug text-amber-300/80">
                Chrome will not grant this folder. Files go to Downloads/Scrubframe/ instead.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">Saving to</p>
            <p className="mt-1 font-mono text-xs text-neutral-300">
              Downloads/Scrubframe/{project.name}/
            </p>
          </>
        )}

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onChooseFolder}
            disabled={disabled}
            className="rounded border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300 transition hover:border-neutral-700 disabled:opacity-40"
          >
            {project.folderName ? 'Change folder' : 'Choose folder…'}
          </button>
          {project.folderName && (
            <button
              type="button"
              onClick={onForgetFolder}
              disabled={disabled}
              className="rounded border border-neutral-800 px-2 py-1 text-[11px] text-neutral-500 transition hover:border-neutral-700 disabled:opacity-40"
            >
              Use Downloads
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
