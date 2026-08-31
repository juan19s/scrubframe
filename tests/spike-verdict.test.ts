import { describe, expect, it } from 'vitest';
import { decide } from '../src/background/spike';
import type { FailureKind, SpikeProbe } from '../src/shared/types';

function probe(over: Partial<SpikeProbe> & { failureKind?: FailureKind }): SpikeProbe {
  const { failureKind, ...rest } = over;
  const base: SpikeProbe = {
    tabId: 1,
    url: 'https://ejemplo.com/',
    attachSucceeded: false,
    commandSucceeded: false,
    ...rest,
  };
  return failureKind
    ? { ...base, failure: { kind: failureKind, message: 'x', detail: 'x' } }
    : base;
}

const ok = probe({ attachSucceeded: true, commandSucceeded: true });

describe('decide', () => {
  it('needs the control tab to be refused before it will bless ADR-002', () => {
    expect(decide(ok, probe({ failureKind: 'no-tab-access' }))).toBe('adr-002-holds');
  });

  it('calls out the false premise when a never-invoked tab attaches just as well', () => {
    expect(decide(ok, ok)).toBe('debugger-permission-suffices');
  });

  it('never returns a verdict from the invoked tab alone', () => {
    // The whole point: one green attach is not evidence about activeTab.
    expect(decide(ok, null)).toBe('inconclusive');
  });

  it('reports a revision when even the invoked tab is refused for access', () => {
    expect(decide(probe({ failureKind: 'no-tab-access' }), null)).toBe('adr-002-needs-revision');
  });

  it('does not read an unrelated attach failure as evidence either way', () => {
    expect(decide(probe({ failureKind: 'devtools-open' }), null)).toBe('inconclusive');
    expect(decide(probe({ failureKind: 'restricted-url' }), null)).toBe('inconclusive');
  });

  it('stays inconclusive when the control failed for a reason that proves nothing', () => {
    expect(decide(ok, probe({ failureKind: 'restricted-url' }))).toBe('inconclusive');
    expect(decide(ok, probe({ failureKind: 'devtools-open' }))).toBe('inconclusive');
  });

  it('does not count a control that attached but could not run a command', () => {
    expect(decide(ok, probe({ attachSucceeded: true, commandSucceeded: false }))).toBe(
      'inconclusive',
    );
  });
});
