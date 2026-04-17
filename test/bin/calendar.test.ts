import { describe, it, expect, vi } from 'vitest';
import { parseFlags, positional, buildSpecialEventFlags } from '../../src/bin/calendar.js';

vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/calendar/index.js', () => ({}));

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--from=2026-01-01', '--max=10'])).toEqual({ from: '2026-01-01', max: '10' });
  });

  it('sets bare flags to "true"', () => {
    expect(parseFlags(['--all-day'])).toEqual({ 'all-day': 'true' });
  });

  it('preserves values containing equals signs', () => {
    expect(parseFlags(['--summary=Meet=Greet'])).toEqual({ summary: 'Meet=Greet' });
  });
});

describe('positional', () => {
  it('returns non-flag args only', () => {
    expect(positional(['primary', '--from=2026-01-01', '--max=5'])).toEqual(['primary']);
  });
});

describe('buildSpecialEventFlags', () => {
  it('returns empty object for standard event type', () => {
    expect(buildSpecialEventFlags({ type: 'default' })).toEqual({});
  });

  it('builds outOfOffice properties', () => {
    const result = buildSpecialEventFlags({
      type: 'outOfOffice',
      'auto-decline': 'declineAllConflictingInvitations',
      'decline-message': 'OOO',
    });
    expect(result.outOfOffice).toMatchObject({
      autoDeclineMode: 'declineAllConflictingInvitations',
      declineMessage: 'OOO',
    });
  });

  it('builds focusTime properties', () => {
    const result = buildSpecialEventFlags({
      type: 'focusTime',
      'chat-status': 'doNotDisturb',
    });
    expect(result.focusTime).toMatchObject({ chatStatus: 'doNotDisturb' });
  });

  it('builds workingLocation homeOffice properties', () => {
    const result = buildSpecialEventFlags({ type: 'workingLocation', 'wl-type': 'homeOffice' });
    expect(result.workingLocation).toMatchObject({ type: 'homeOffice', homeOffice: true });
  });

  it('builds workingLocation officeLocation properties', () => {
    const result = buildSpecialEventFlags({
      type: 'workingLocation',
      'wl-type': 'officeLocation',
      'wl-building': 'HQ',
      'wl-floor': '3',
    });
    expect(result.workingLocation?.officeLocation).toMatchObject({ buildingId: 'HQ', floorId: '3' });
  });

  it('builds workingLocation customLocation properties', () => {
    const result = buildSpecialEventFlags({
      type: 'workingLocation',
      'wl-type': 'customLocation',
      'wl-label': 'Home Studio',
    });
    expect(result.workingLocation?.customLocation).toMatchObject({ label: 'Home Studio' });
  });
});
