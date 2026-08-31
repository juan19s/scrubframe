import type { CaptureRun } from '../shared/types';
import { frameName, runDirectory, slug } from '../shared/naming';
import { createScrollAdapter } from '../adapters/scroll';
import { decodeBase64, writeArtifact } from './artifact-writer';
import { createContactSheets } from '../output/contact-sheet';
import { base64Bytes, readPngSize } from './capture-engine';
import { CdpError, withSession, type CdpSession } from './cdp-session';
import { clipFor, resolveElement } from './element-handle';
import { projectStateFor } from './project';
import { readSelection, selectionOf } from './selection';

async function readDevicePixelRatio(session: CdpSession): Promise<number> {
  const evaluated = await session.send('Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
    returnByValue: true,
  });
  const value = evaluated.result.value;
  return typeof value === 'number' && value > 0 ? value : 1;
}

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
export async function captureScrollRun(
  tabId: number,
  frames: number,
  stepPx?: number,
): Promise<CaptureRun> {
  const count = Math.round(Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, frames)));
  const selection = selectionOf(await readSelection(tabId));
  if (!selection) {
    throw new CdpError('element-gone', 'Nothing is selected. Use "Pick element" first.', '');
  }

  const tab = await chrome.tabs.get(tabId);
  const project = await projectStateFor(tab.url ?? '');
  // The label, not the full path: a directory named
  // `section-section-clip-div-container-div-a` is not something anyone can scan.
  const directory = runDirectory(project.name, selection.label, new Date());

  return withSession(tabId, async (session) => {
    const { backendNodeId } = await resolveElement(session, selection.marker);
    const adapter = createScrollAdapter(session, backendNodeId);

    await adapter.pause();
    try {
      const range = await adapter.getRange({ frames: count, ...(stepPx ? { stepPx } : {}) });
      const stage = await adapter.stage(range);
      let builder: ReturnType<typeof createContactSheets> | null = null;
      const written: string[] = [];
      /** Where the page actually landed, which is not always where we asked. */
      const positions: number[] = [];
      let bytes = 0;
      let pngWidth = 0;
      let pngHeight = 0;
      let target: CaptureRun['target'] = 'downloads';
      let sizeDrift: string | undefined;
      const sheets: string[] = [];
      let sheetSkipped: string | undefined;

      // Decided BEFORE the first capture, and never changed again.
      //
      // The earlier version captured frame 1 at scale 1 purely to learn what
      // Chrome would return, then corrected — which shipped a first frame at
      // twice the size of every other one, breaking the one property a contact
      // sheet cannot do without. We measured the answer once (Measure's Retina
      // card): a clipped capture inherits the device scale factor. So predict
      // it, apply it uniformly, and verify rather than adapt.
      const devicePixelRatio = await readDevicePixelRatio(session);
      const scale = 1 / devicePixelRatio;

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
          // Built here, not before the loop: the layout depends on the frame's
          // real pixel size, which is only known once Chrome has returned one.
          builder = createContactSheets({
            frame: { width: png.width, height: png.height },
            totalFrames: count,
            legend: `${project.name} · ${selection.label} · scroll · ${count} frames`,
            unit: range.unit,
          });
          // Verified, not corrected. Changing scale here is what produced the
          // odd first frame; if the prediction is wrong we say so and keep
          // every frame consistent with every other one.
          if (Math.abs(png.width - stage.width) > 2) {
            sizeDrift = `asked ${stage.width}px wide at scale ${scale}, got ${png.width}px`;
          }
        }

        const path = `${directory}/${frameName(index + 1, count)}`;
        const write = await writeArtifact(path, data);
        target = write.target;
        written.push(write.path);
        positions.push(landed);
        bytes += base64Bytes(data);

        // The sheet is a convenience; the frames are the deliverable. A sheet
        // that fails must never take the frames down with it.
        if (builder && !sheetSkipped) {
          try {
            const ready = await builder.add(index, decodeBase64(data), landed);
            if (ready) {
              await writeArtifact(`${directory}/${ready.name}`, ready.blob);
              sheets.push(ready.name);
            }
          } catch (error) {
            sheetSkipped = error instanceof Error ? error.message : String(error);
          }
        }
      }

      if (builder && !sheetSkipped) {
        try {
          const last = await builder.finish();
          if (last) {
            await writeArtifact(`${directory}/${last.name}`, last.blob);
            sheets.push(last.name);
          }
        } catch (error) {
          sheetSkipped = error instanceof Error ? error.message : String(error);
        }
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
        sheets,
        ...(sheetSkipped ? { sheetSkipped } : {}),
        devicePixelRatio,
        ...(sizeDrift ? { sizeDrift } : {}),
        project: slug(project.name),
      };
    } finally {
      // Always. A run that threw has still moved the user's page.
      await adapter.resume();
    }
  });
}
