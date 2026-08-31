import type { AdapterId } from '../shared/types';
import type { AnimationSpec, TimelineRange } from '../adapters/types';

/**
 * Writes ANIMATION.md.
 *
 * The other half of the deliverable. ADR-004 says the artifact is the contact
 * sheet PLUS this file, and the split is deliberate: pixels carry what the
 * animation looks like, markdown carries what is known about it. Anything a
 * model would otherwise have to read back out of rendered text belongs here,
 * where it is cheap and exact.
 *
 * Written in English, like the rest of the project's output, because it is a
 * prompt destined for a model and an artifact of an English-language repo.
 *
 * Pure — no chrome APIs, no clock of its own — so the whole document can be
 * asserted in a test.
 */

export interface SpecInput {
  url: string;
  project: string;
  /** The readable path, for a human. */
  selector: string;
  /** The element itself: `div.container`. */
  label: string;
  adapter: AdapterId;
  range: TimelineRange;
  /** Where the page ACTUALLY landed for each frame. */
  positions: number[];
  frameSize: { width: number; height: number };
  frameNames: string[];
  sheetNames: string[];
  framesPerSheet: number;
  capturedAt: Date;
  /** Real timing, when the technology exposes it. Null is an honest answer. */
  spec: AnimationSpec | null;
}

export function writeAnimationMarkdown(input: SpecInput): string {
  const unit = input.range.unit;
  const span = Math.abs(input.range.to - input.range.from);
  const step = input.positions.length > 1 ? span / (input.positions.length - 1) : 0;

  return [
    '# Captured animation',
    '',
    ...facts(input, span, step, unit),
    '',
    ...timingSection(input),
    '',
    ...frameTable(input, unit),
    '',
    ...sheetSection(input),
    '',
    ...cropSection(),
    '',
  ].join('\n');
}

function facts(input: SpecInput, span: number, step: number, unit: 'ms' | 'px'): string[] {
  const deterministic = input.spec?.deterministic ?? input.adapter !== 'realtime';
  return [
    `- **URL:** ${input.url || '(unknown)'}`,
    `- **Element:** \`${input.selector}\``,
    `- **Adapter:** ${input.adapter}${deterministic ? '' : ' — NOT deterministic, see below'}`,
    `- **Range:** ${round(input.range.from)}${unit} → ${round(input.range.to)}${unit}` +
      ` (${round(span)}${unit} across ${input.positions.length} frames, ~${round(step)}${unit} per step)`,
    `- **Frame size:** ${input.frameSize.width}×${input.frameSize.height} px`,
    `- **Frames:** ${input.frameNames.length}`,
    `- **Captured:** ${localIso(input.capturedAt)}`,
    `- **Project:** ${input.project}`,
  ];
}

function timingSection(input: SpecInput): string[] {
  if (!input.spec) {
    return [
      '## Timing',
      '',
      // The SPEC is explicit that an adapter which cannot know the timing says
      // so rather than inventing one. A guessed cubic-bezier presented as fact
      // is worse than no cubic-bezier at all, because a model will believe it.
      input.adapter === 'scroll'
        ? 'Not available, and not missing by accident. The `scroll` adapter moves the ' +
          "page's scroll position; it never touches the document timeline, so there is no " +
          'duration and no easing to read. Do not infer one from the frame spacing — the ' +
          'frames are evenly spaced in SCROLL, which says nothing about how the animation ' +
          'is eased in time.'
        : 'Not available. This adapter cannot read the underlying timing, so none is ' +
          'reported rather than guessed.',
      '',
      'What *is* exact here is the scroll position of every frame, listed below.',
    ];
  }

  const rows = input.spec.properties.map(
    (property) =>
      `| ${property.property} | ${property.from} | ${property.to} | ${property.durationMs}ms` +
      ` | ${property.delayMs}ms | ${property.easing} |`,
  );

  const raw = input.spec.rawKeyframes
    ? ['', '### Raw keyframes', '', '```json', JSON.stringify(input.spec.rawKeyframes, null, 2), '```']
    : [];

  return [
    '## Timing',
    '',
    'Read from the page, not inferred from the pixels.',
    '',
    '| Property | From | To | Duration | Delay | Easing |',
    '|---|---|---|---|---|---|',
    ...rows,
    ...(input.spec.notes ? ['', input.spec.notes] : []),
    ...raw,
  ];
}

function frameTable(input: SpecInput, unit: 'ms' | 'px'): string[] {
  const axis = unit === 'ms' ? 'time' : 'scroll y';
  const rows = input.frameNames.map((name, index) => {
    const position = input.positions[index];
    const value = position === undefined ? '—' : `${round(position)}${unit}`;
    return `| ${String(index + 1).padStart(2, '0')} | \`${name}\` | ${value} |`;
  });

  return [
    '## Frames',
    '',
    `| # | file | ${axis} |`,
    '|---|---|---|',
    ...rows,
    '',
    // The distinction that makes the table trustworthy rather than decorative.
    'These are the positions the page **actually landed on**, read back after each step —' +
      ' not the positions that were requested. On a page that fights the scroll they would' +
      ' differ, and the capture would have been refused before reaching this file.',
  ];
}

function sheetSection(input: SpecInput): string[] {
  if (input.sheetNames.length === 0) {
    return ['## Contact sheet', '', 'None — the frames above are the whole output.'];
  }

  const list = input.sheetNames.map((name, index) => {
    const first = index * input.framesPerSheet + 1;
    const last = Math.min((index + 1) * input.framesPerSheet, input.frameNames.length);
    return `- \`${name}\` — frames ${pad(first)} to ${pad(last)}`;
  });

  return [
    '## How to read the sheet',
    '',
    ...list,
    '',
    `Each sheet holds up to ${input.framesPerSheet} frames in reading order: left to right,` +
      ' then top to bottom. Every cell is labelled with its frame number and position, and' +
      ' every frame on every sheet is drawn at the same scale — so a size difference between' +
      ' two cells is something the page did, never something the sheet did.',
  ];
}

function cropSection(): string[] {
  return [
    '## What is in the crop',
    '',
    'The crop is a fixed window on the viewport, not a cutout of the element as it moves' +
      ' through the document. Two consequences worth knowing before reading the frames:',
    '',
    '- The element travels **through** the frame. That is the point — a crop that followed' +
      ' the element would subtract exactly the motion being captured.',
    '- Anything overlapping that region is included, `position: fixed` page furniture' +
      ' among it. Deliberate: if fixed elements move during the animation, you want to see it.',
  ];
}

/** ISO 8601 with the local offset, the way the SPEC's example is written. */
export function localIso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${hours}:${minutes}`
  );
}

function round(value: number): number {
  return Math.round(value);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
