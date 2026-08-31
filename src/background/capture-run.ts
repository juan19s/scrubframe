import type { CaptureRun } from '../shared/types';
import { frameName, runDirectory, slug } from '../shared/naming';
import { createScrollAdapter } from '../adapters/scroll';
import { writeArtifact } from './artifact-writer';
import { base64Bytes, readPngSize } from './capture-engine';
import { CdpError, withSession } from './cdp-session';
import { clipFor, resolveElement } from './element-handle';
import { calibrateScale } from './geometry';
import { projectStateFor } from './project';
import { readSelection, selectionOf } from './selection';

export const MIN_FRAMES = 2;
export const MAX_FRAMES = 60;

/**
 * Captures N frames across the scroll range of the selected element.
 *
 * The order is a contract, not a preference:
 *
 *   pause -> getRange -> stage -> (seek -> capture) x N -> resume [finally]
 *
 * pause first, because it takes the restore point and getRange moves the page
 * to measure it. resume in a finally, because a run that throws halfway has
 * still scrolled the user's page somewhere they did not ask to be.
 *
 * The stage is computed once and frozen. Recomputing it per frame would keep
 * the element centred, which sounds better and is wrong: a camera locked to the
 * subject subtracts exactly the motion being captured.
 */
export async function captureScrollRun(tabId: number, frames: number): Promise<CaptureRun> {
  const count = Math.round(Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, frames)));
  const selection = selectionOf(await readSelection(tabId));
  if (!selection) {
    throw new CdpError('element-gone', 'Nothing is selected. Use "Pick element" first.', '');
  }

  const tab = await chrome.tabs.get(tabId);
  const project = await projectStateFor(tab.url ?? '');
  const directory = runDirectory(project.name, selection.selector, new Date());

  return withSession(tabId, async (session) => {
    const { backendNodeId } = await resolveElement(session, selection.marker);
    const adapter = createScrollAdapter(session, backendNodeId);

    await adapter.pause();
    try {
      const range = await adapter.getRange();
      const stage = await adapter.stage(range);
      const written: string[] = [];
      /** Where the page actually landed, which is not always where we asked. */
      const positions: number[] = [];
      let scale = 1;
      let bytes = 0;
      let pngWidth = 0;
      let pngHeight = 0;
      let target: CaptureRun['target'] = 'downloads';

      for (let index = 0; index < count; index += 1) {
        const position = range.from + ((range.to - range.from) * index) / (count - 1);
        const landed = await adapter.seek(position);

        // Recomputed every frame: the stage is frozen in viewport space, and
        // the document moves under it.
        const metrics = await session.send('Page.getLayoutMetrics');
        const clip = clipFor(stage, metrics.cssVisualViewport, scale);

        const { data } = await session.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
          clip,
        });

        if (index === 0) {
          const png = readPngSize(data);
          pngWidth = png.width;
          pngHeight = png.height;
          // One measurement decides the scale for the whole run, so every frame
          // comes out the same size — see geometry.calibrateScale.
          scale = calibrateScale(png.width, stage.width, 1);
        }

        const path = `${directory}/${frameName(index + 1, count)}`;
        const write = await writeArtifact(path, data);
        target = write.target;
        written.push(write.path);
        positions.push(landed);
        bytes += base64Bytes(data);
      }

      return {
        directory,
        frames: written.length,
        requested: count,
        range,
        stage,
        scale,
        pngWidth,
        pngHeight,
        bytes,
        positions,
        target,
        project: slug(project.name),
      };
    } finally {
      // Always. A run that threw has still moved the user's page.
      await adapter.resume();
    }
  });
}
