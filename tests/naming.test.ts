import { describe, expect, it } from 'vitest';
import { captureDirectory, frameName, slug, stamp } from '../src/shared/naming';

describe('slug', () => {
  it('collapses a CSS selector into a path segment', () => {
    expect(slug('.card-grid > .card:nth-child(2)')).toBe('card-grid-card-nth-child-2');
  });

  it('strips accents rather than dropping the characters', () => {
    expect(slug('animación')).toBe('animacion');
  });

  it('never returns an empty segment', () => {
    expect(slug('///')).toBe('page');
  });

  it('truncates without leaving a trailing dash', () => {
    expect(slug('a'.repeat(30) + ' ' + 'b'.repeat(30), 31)).toBe('a'.repeat(30));
  });
});

describe('stamp', () => {
  it('is sortable and filesystem safe', () => {
    expect(stamp(new Date(2026, 7, 29, 14, 22, 4))).toBe('20260829-142204');
  });
});

describe('captureDirectory', () => {
  const date = new Date(2026, 7, 29, 14, 22, 0);

  it('follows the SPEC 5.3 shape', () => {
    expect(captureDirectory('https://ejemplo.com/x', '.card:nth-child(2)', date)).toBe(
      'scrubframe_ejemplo-com_card-nth-child-2_20260829-142200',
    );
  });

  it('omits the selector segment when nothing is selected yet', () => {
    expect(captureDirectory('https://ejemplo.com/x', null, date)).toBe(
      'scrubframe_ejemplo-com_20260829-142200',
    );
  });

  it('survives a URL it cannot parse', () => {
    expect(captureDirectory('not a url', null, date)).toBe('scrubframe_local_20260829-142200');
  });
});

describe('frameName', () => {
  it('pads to at least two digits', () => {
    expect(frameName(1, 8)).toBe('frame-01.png');
  });

  it('widens padding so frames stay sorted', () => {
    expect(frameName(7, 120)).toBe('frame-007.png');
  });
});
