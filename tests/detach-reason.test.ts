import { describe, expect, it } from 'vitest';
import { detachError } from '../src/background/cdp-session';

describe('detachError', () => {
  it('names the yellow-banner Cancel, because that is the kill switch we advertise', () => {
    const error = detachError('canceled_by_user');
    expect(error.kind).toBe('canceled-by-user');
    expect(error.message).toMatch(/yellow banner/i);
  });

  it('distinguishes a closed tab from a user cancelling', () => {
    expect(detachError('target_closed').kind).toBe('tab-closed');
  });

  /**
   * @types/chrome declares only canceled_by_user and target_closed, so these
   * two would be invisible to a switch typed against the enum. Chrome sends
   * them anyway.
   */
  it('handles the reasons @types/chrome does not declare', () => {
    expect(detachError('replaced_with_devtools').kind).toBe('devtools-open');
    expect(detachError('render_process_gone').kind).toBe('page-crashed');
  });

  it('falls back without throwing when Chrome sends something new', () => {
    const error = detachError('some_future_reason');
    expect(error.kind).toBe('tab-closed');
    expect(error.detail).toContain('some_future_reason');
  });

  it('keeps the raw reason for bug reports', () => {
    expect(detachError('canceled_by_user', 'Page.captureScreenshot').detail).toBe(
      'canceled_by_user · Page.captureScreenshot',
    );
  });

  it('says something sane when there is no reason at all', () => {
    expect(detachError(null).detail).toBe('no reason given');
  });
});
