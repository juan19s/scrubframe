import { describe, expect, it } from 'vitest';
import { projectNameFor } from '../src/shared/naming';

describe('projectNameFor', () => {
  const cases: Array<[string, string]> = [
    // The case that started this
    ['https://www.era-residence.com/', 'era-residence'],
    ['https://era-residence.com/', 'era-residence'],

    // Plain
    ['https://example.com/some/path?q=1', 'example'],
    ['https://stripe.com', 'stripe'],

    // Subdomains are kept: two folders called `example` help nobody
    ['https://blog.example.com/', 'blog-example'],
    ['https://app.staging.example.com/', 'app-staging-example'],
    ['https://www.blog.example.com/', 'blog-example'],

    // Two-part suffixes — the naive "second-to-last label" rule returns `co`
    ['https://example.co.uk/', 'example'],
    ['https://www.example.co.uk/', 'example'],
    ['https://docs.example.co.uk/', 'docs-example'],
    ['https://tienda.com.mx/', 'tienda'],
    ['https://www.gob.mx/', 'gob'],
    ['https://example.com.br/', 'example'],
    ['https://example.co.jp/', 'example'],

    // Local development
    ['http://localhost:3000/', 'localhost'],
    ['http://localhost/', 'localhost'],
    ['http://192.168.1.5:8080/', '192-168-1-5'],
    ['http://my-mac.local/', 'my-mac'],

    // Chrome hands back punycode for an internationalised domain and there is
    // no decoder in the platform. slug() then collapses the double dash, which
    // is fine: still unique, still identifiable, and editable if it bothers you.
    ['https://xn--maana-pta.com/', 'xn-maana-pta'],

    // Nothing usable
    ['not a url', 'project'],
    ['about:blank', 'project'],
  ];

  for (const [url, expected] of cases) {
    it(`${url} -> ${expected}`, () => {
      expect(projectNameFor(url)).toBe(expected);
    });
  }

  it('is honest about the suffix it does not know', () => {
    // .co.za is not in the curated list, so it splits one label. Documented in
    // naming.ts, and survivable because the name is editable.
    expect(projectNameFor('https://example.co.za/')).toBe('example');
  });
});
