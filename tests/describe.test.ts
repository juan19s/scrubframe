import { beforeEach, describe, expect, it } from 'vitest';
import { describeElement, describeOne, describePath, newToken } from '../src/content/describe';

function html(markup: string): Element {
  document.body.innerHTML = markup;
  return document.body.firstElementChild!;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('describeOne', () => {
  it('prefers an id, because that is what a person would say', () => {
    expect(describeOne(html('<section id="hero" class="a b">x</section>'))).toBe('section#hero');
  });

  it('falls back to at most two classes', () => {
    expect(describeOne(html('<div class="card grid dense wide">x</div>'))).toBe('div.card.grid');
  });

  it('drops hashed class names instead of printing noise', () => {
    // styled-components and CSS modules produce these; they are unreadable and
    // change on every build, so they make a worse label than the bare tag.
    expect(describeOne(html('<div class="sc-a1b2c3">x</div>'))).toBe('div');
    expect(describeOne(html('<div class="Button_root__x7f2q">x</div>'))).toBe('div');
  });

  it('keeps a readable class that happens to contain a dash', () => {
    expect(describeOne(html('<div class="card-grid">x</div>'))).toBe('div.card-grid');
  });

  it('does not mistake utility classes with digits for hashes', () => {
    // Dropping these would be worse than keeping a hash: the label would point
    // at the wrong thing instead of merely looking ugly.
    expect(describeOne(html('<div class="col-span-2">x</div>'))).toBe('div.col-span-2');
    expect(describeOne(html('<div class="text-2xl">x</div>'))).toBe('div.text-2xl');
    expect(describeOne(html('<div class="hero-2024">x</div>'))).toBe('div.hero-2024');
  });

  it('drops emotion and styled-jsx hashes too', () => {
    expect(describeOne(html('<div class="css-1a2b3c">x</div>'))).toBe('div');
    expect(describeOne(html('<div class="jsx-2841096372">x</div>'))).toBe('div');
  });

  it('ignores an id that is not a usable identifier', () => {
    expect(describeOne(html('<div id="2 weird">x</div>'))).toBe('div');
  });

  it('falls back to the tag when there is nothing else', () => {
    expect(describeOne(html('<article>x</article>'))).toBe('article');
  });
});

describe('describePath', () => {
  it('gives enough ancestry to place the element', () => {
    document.body.innerHTML = `
      <main class="page">
        <section class="card-grid">
          <article class="card">pick me</article>
        </section>
      </main>`;
    const target = document.querySelector('.card')!;
    expect(describePath(target)).toBe('main.page > section.card-grid > article.card');
  });

  it('stops at the requested depth', () => {
    document.body.innerHTML = `<div class="a"><div class="b"><div class="c"><i>x</i></div></div></div>`;
    expect(describePath(document.querySelector('i')!, 1)).toBe('div.c > i');
  });

  it('handles an element with no ancestors above body', () => {
    expect(describePath(html('<p class="lead">x</p>'))).toContain('p.lead');
  });
});

describe('describeElement', () => {
  it('returns both the path and the short form', () => {
    document.body.innerHTML = `<section class="card-grid"><article class="card">x</article></section>`;
    const described = describeElement(document.querySelector('.card')!);
    expect(described.label).toBe('article.card');
    expect(described.selector).toContain('section.card-grid');
  });
});

describe('newToken', () => {
  it('produces distinct tokens', () => {
    expect(newToken()).not.toBe(newToken());
  });

  it('works without crypto.randomUUID, which http pages do not have', () => {
    const original = globalThis.crypto;
    // A plain http:// page is not a secure context, so randomUUID is absent —
    // and localhost aliases and LAN addresses are exactly where people test.
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
      expect(newToken().length).toBeGreaterThan(8);
      expect(newToken()).not.toBe(newToken());
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
