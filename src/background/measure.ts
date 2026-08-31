import type { Measurement } from '../shared/types';
import { slug } from '../shared/naming';
import { base64Bytes, readPngSize } from './capture-engine';
import { writeArtifact } from './artifact-writer';
import { CdpError, withSession, type CdpSession } from './cdp-session';
import { calibrateScale } from './geometry';
import { clipFor, measureElement, resolveElement, stageFor } from './element-handle';
import { readSelection, selectionOf, writeMeasurement } from './selection';
import { projectStateFor } from './project';

/** How far a PNG width may drift from the prediction before we stop believing it. */
const SCALE_TOLERANCE_PX = 2;

/**
 * Measures the picked element and saves one cropped frame.
 *
 * This is the Phase 1 equivalent of the Phase 0 spike: one button that does one
 * thing and prints what it found, so the whole bridge — marker to node handle
 * to box to clip to PNG — is verifiable in a single click rather than debugged
 * inside a capture loop.
 *
 * It also settles a question nothing in the protocol documentation answers:
 * whether a clipped capture comes back at the surface's device scale factor.
 * We ask for scale 1, then compare the PNG's real width against the crop we
 * requested. Measuring beats guessing, and the guess was going to be wrong for
 * half of all users either way.
 */
export async function measureSelection(tabId: number): Promise<Measurement> {
  const selection = selectionOf(await readSelection(tabId));
  if (!selection) {
    throw new CdpError(
      'element-gone',
      'Nothing is selected. Use "Pick element" first.',
      'no stored selection',
    );
  }

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';
  const project = await projectStateFor(url);

  const result = await withSession(tabId, async (session) => {
    const { backendNodeId, nodeName } = await resolveElement(session, selection.marker);
    const { box, viewport } = await measureElement(session, backendNodeId);

    const stage = stageFor(box, viewport);
    const clip = clipFor(stage, viewport, 1);
    const devicePixelRatio = await readDevicePixelRatio(session);

    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      // Never true: it resizes the viewport to fit, which reflows the page,
      // moves position:fixed elements and changes the scroll range out from
      // under the adapter. Cropping keeps the capture faithful.
      captureBeyondViewport: false,
      clip,
    });

    const png = readPngSize(data);
    // One file, overwritten. A diagnostic that leaves a new timestamped folder
    // behind on every click buries the runs that actually matter.
    const filename = `${slug(project.name)}/measure.png`;
    const write = await writeArtifact(filename, data);

    const predictedAtDeviceScale = stage.width * devicePixelRatio;
    return {
      selector: selection.selector,
      nodeName,
      backendNodeId,
      box,
      stage,
      clip,
      scrollY: viewport.pageY,
      devicePixelRatio,
      pngWidth: png.width,
      pngHeight: png.height,
      inheritsDeviceScale:
        devicePixelRatio !== 1 &&
        Math.abs(png.width - predictedAtDeviceScale) <= SCALE_TOLERANCE_PX,
      scaleForOneToOne: calibrateScale(png.width, stage.width, 1),
      filename: write.path,
      write,
      bytes: base64Bytes(data),
    };
  });

  // Saved before returning, because the popup is very likely already gone: the
  // download bubble that this run just triggered takes focus, and that closes
  // the popup the result was headed for.
  await writeMeasurement(tabId, result);
  return result;
}

async function readDevicePixelRatio(session: CdpSession): Promise<number> {
  const evaluated = await session.send('Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
    returnByValue: true,
  });
  const value = evaluated.result.value;
  return typeof value === 'number' && value > 0 ? value : 1;
}
