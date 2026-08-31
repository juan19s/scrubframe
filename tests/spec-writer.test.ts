import { describe, expect, it } from 'vitest';
import { localIso, writeAnimationMarkdown, type SpecInput } from '../src/output/spec-writer';

const base: SpecInput = {
  url: 'https://era-residence.com/',
  project: 'era-residence',
  selector: 'div.hero-s > div.grid > div.container',
  label: 'div.container',
  adapter: 'scroll',
  range: { from: 14587, to: 16173, unit: 'px' },
  positions: [14587, 14905, 15222, 15539, 15856, 16173],
  frameSize: { width: 1111, height: 704 },
  frameNames: ['frame-01.png', 'frame-02.png', 'frame-03.png', 'frame-04.png', 'frame-05.png', 'frame-06.png'],
  sheetNames: ['contact-sheet.png'],
  framesPerSheet: 6,
  capturedAt: new Date(2026, 7, 31, 16, 13, 36),
  spec: null,
};

describe('writeAnimationMarkdown', () => {
  it('leads with the facts a model needs to orient itself', () => {
    const markdown = writeAnimationMarkdown(base);
    expect(markdown).toContain('**URL:** https://era-residence.com/');
    expect(markdown).toContain('`div.hero-s > div.grid > div.container`');
    expect(markdown).toContain('**Adapter:** scroll');
    expect(markdown).toContain('14587px → 16173px');
    expect(markdown).toContain('1111×704 px');
  });

  it('refuses to invent timing the scroll adapter cannot know', () => {
    const markdown = writeAnimationMarkdown(base);
    expect(markdown).toContain('Not available, and not missing by accident');
    // The trap this guards against: a model reading evenly spaced frames and
    // concluding the easing is linear.
    expect(markdown).toContain('Do not infer one from the frame spacing');
    expect(markdown).not.toMatch(/cubic-bezier/);
  });

  it('lists the positions the page actually landed on', () => {
    const markdown = writeAnimationMarkdown(base);
    expect(markdown).toContain('| 01 | `frame-01.png` | 14587px |');
    expect(markdown).toContain('| 06 | `frame-06.png` | 16173px |');
    expect(markdown).toContain('actually landed on');
  });

  it('maps frames to sheets so nothing is ambiguous', () => {
    const markdown = writeAnimationMarkdown({
      ...base,
      frameNames: Array.from({ length: 12 }, (_, i) => `frame-${String(i + 1).padStart(2, '0')}.png`),
      positions: Array.from({ length: 12 }, (_, i) => 14587 + i * 144),
      sheetNames: ['contact-sheet-01.png', 'contact-sheet-02.png'],
    });
    expect(markdown).toContain('`contact-sheet-01.png` — frames 01 to 06');
    expect(markdown).toContain('`contact-sheet-02.png` — frames 07 to 12');
  });

  it('explains the crop instead of letting it be read as a bug', () => {
    const markdown = writeAnimationMarkdown(base);
    expect(markdown).toContain('travels **through** the frame');
    expect(markdown).toContain('position: fixed');
  });

  it('renders a real timing table when the adapter has one', () => {
    const markdown = writeAnimationMarkdown({
      ...base,
      adapter: 'waapi',
      spec: {
        adapter: 'waapi',
        deterministic: true,
        properties: [
          {
            property: 'transform',
            from: 'translateY(0)',
            to: 'translateY(-8px)',
            durationMs: 300,
            delayMs: 0,
            easing: 'cubic-bezier(.22,1,.36,1)',
          },
        ],
        rawKeyframes: [{ transform: 'translateY(0)' }],
      },
    });
    expect(markdown).toContain('Read from the page, not inferred from the pixels');
    expect(markdown).toContain('| transform | translateY(0) | translateY(-8px) | 300ms | 0ms | cubic-bezier(.22,1,.36,1) |');
    expect(markdown).toContain('### Raw keyframes');
  });

  it('says so plainly when there is no sheet', () => {
    expect(writeAnimationMarkdown({ ...base, sheetNames: [] })).toContain(
      'None — the frames above are the whole output.',
    );
  });

  it('survives a run with a single frame', () => {
    const markdown = writeAnimationMarkdown({
      ...base,
      positions: [14587],
      frameNames: ['frame-01.png'],
      range: { from: 14587, to: 14587, unit: 'px' },
    });
    expect(markdown).toContain('~0px per step');
  });
});

describe('localIso', () => {
  it('keeps the local offset rather than shifting to UTC', () => {
    const stamped = localIso(new Date(2026, 7, 31, 16, 13, 36));
    expect(stamped).toMatch(/^2026-08-31T16:13:36[+-]\d{2}:\d{2}$/);
  });
});
