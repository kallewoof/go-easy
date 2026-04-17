import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFlags, positional, buildSpecialEventFlags, main } from '../../src/bin/calendar.js';
import * as calendarModule from '../../src/calendar/index.js';
import { setSafetyContext } from '../../src/safety.js';

vi.mock('../../src/auth.js', () => ({
  getAuth: vi.fn().mockResolvedValue('fake-auth'),
}));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/calendar/index.js', () => ({
  listCalendars: vi.fn().mockResolvedValue([{ id: 'primary', summary: 'My Calendar' }]),
  listEvents: vi.fn().mockResolvedValue({ items: [] }),
  getEvent: vi.fn().mockResolvedValue({ id: 'evt1', summary: 'Meeting' }),
  createEvent: vi.fn().mockResolvedValue({ ok: true, id: 'evt1' }),
  updateEvent: vi.fn().mockResolvedValue({ ok: true, id: 'evt1' }),
  deleteEvent: vi.fn().mockResolvedValue({ ok: true }),
  queryFreeBusy: vi.fn().mockResolvedValue({ calendars: {} }),
}));

const ACC = 'user@example.com';

// ─── Utilities ─────────────────────────────────────────────

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
    const result = buildSpecialEventFlags({ type: 'focusTime', 'chat-status': 'doNotDisturb' });
    expect(result.focusTime).toMatchObject({ chatStatus: 'doNotDisturb' });
  });

  it('builds workingLocation homeOffice properties', () => {
    const result = buildSpecialEventFlags({ type: 'workingLocation', 'wl-type': 'homeOffice' });
    expect(result.workingLocation).toMatchObject({ type: 'homeOffice', homeOffice: true });
  });

  it('builds workingLocation officeLocation properties', () => {
    const result = buildSpecialEventFlags({
      type: 'workingLocation', 'wl-type': 'officeLocation', 'wl-building': 'HQ', 'wl-floor': '3',
    });
    expect(result.workingLocation?.officeLocation).toMatchObject({ buildingId: 'HQ', floorId: '3' });
  });

  it('builds workingLocation customLocation properties', () => {
    const result = buildSpecialEventFlags({
      type: 'workingLocation', 'wl-type': 'customLocation', 'wl-label': 'Home Studio',
    });
    expect(result.workingLocation?.customLocation).toMatchObject({ label: 'Home Studio' });
  });
});

// ─── main() commands ───────────────────────────────────────

describe('main()', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); errSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('calendars — lists calendars', async () => {
    await main([ACC, 'calendars']);
    expect(vi.mocked(calendarModule.listCalendars)).toHaveBeenCalledWith('fake-auth');
    expect(logSpy).toHaveBeenCalled();
  });

  it('events — passes options to listEvents', async () => {
    await main([ACC, 'events', 'primary', '--from=2026-01-01', '--max=5']);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith(
      'fake-auth', 'primary',
      expect.objectContaining({ timeMin: '2026-01-01', maxResults: 5 }),
    );
  });

  it('events --event-types — passes event type filter', async () => {
    await main([ACC, 'events', 'primary', '--event-types=outOfOffice,focusTime']);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith(
      'fake-auth', 'primary',
      expect.objectContaining({ eventTypes: ['outOfOffice', 'focusTime'] }),
    );
  });

  it('event — fetches single event', async () => {
    await main([ACC, 'event', 'primary', 'evt1']);
    expect(vi.mocked(calendarModule.getEvent)).toHaveBeenCalledWith('fake-auth', 'primary', 'evt1');
  });

  it('create — creates event with parsed flags', async () => {
    await main([ACC, 'create', 'primary', '--summary=Meeting', '--start=2026-01-01', '--end=2026-01-02']);
    expect(vi.mocked(calendarModule.createEvent)).toHaveBeenCalledWith(
      'fake-auth', 'primary',
      expect.objectContaining({ summary: 'Meeting' }),
    );
  });

  it('create with --type=outOfOffice — includes OOO properties', async () => {
    await main([ACC, 'create', 'primary', '--summary=OOO', '--start=2026-01-01', '--end=2026-01-02',
      '--type=outOfOffice', '--auto-decline=declineAllConflictingInvitations']);
    expect(vi.mocked(calendarModule.createEvent)).toHaveBeenCalledWith(
      'fake-auth', 'primary',
      expect.objectContaining({ outOfOffice: expect.any(Object) }),
    );
  });

  it('update — updates event fields', async () => {
    await main([ACC, 'update', 'primary', 'evt1', '--summary=Updated', '--start=2026-02-01', '--end=2026-02-02']);
    expect(vi.mocked(calendarModule.updateEvent)).toHaveBeenCalledWith(
      'fake-auth', 'primary', 'evt1',
      expect.objectContaining({ summary: 'Updated' }),
    );
  });

  it('update --description — patches description only', async () => {
    await main([ACC, 'update', 'primary', 'evt1', '--summary=S', '--start=2026-01-01', '--end=2026-01-02',
      '--description=New desc']);
    expect(vi.mocked(calendarModule.updateEvent)).toHaveBeenCalledWith(
      'fake-auth', 'primary', 'evt1',
      expect.objectContaining({ description: 'New desc' }),
    );
  });

  it('delete --confirm — deletes event', async () => {
    await main([ACC, 'delete', 'primary', 'evt1', '--confirm']);
    expect(vi.mocked(calendarModule.deleteEvent)).toHaveBeenCalledWith('fake-auth', 'primary', 'evt1');
  });

  it('freebusy — queries freebusy', async () => {
    await main([ACC, 'freebusy', 'primary,secondary', '--from=2026-01-01', '--to=2026-01-31']);
    expect(vi.mocked(calendarModule.queryFreeBusy)).toHaveBeenCalledWith(
      'fake-auth', ['primary', 'secondary'], '2026-01-01', '2026-01-31',
    );
  });

  it('unknown command — exits with usage', async () => {
    await expect(main([ACC, 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('safety context — blocks without --confirm', async () => {
    await main([ACC, 'delete', 'primary', 'evt1']);
    logSpy.mockClear();
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    await expect(
      ctx.confirm({ name: 'calendar.delete', description: 'Delete event', details: {} }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(JSON.parse(logSpy.mock.calls[0][0]).blocked).toBe(true);
  });

  it('safety context — allows with --confirm', async () => {
    await main([ACC, 'delete', 'primary', 'evt1', '--confirm']);
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    expect(await ctx.confirm({ name: 'op', description: 'op', details: {} })).toBe(true);
  });

  it('outputs error JSON and exits 1 when service throws', async () => {
    vi.mocked(calendarModule.listCalendars).mockRejectedValueOnce(
      Object.assign(new Error('fail'), { code: 'NOT_FOUND' }),
    );
    await expect(main([ACC, 'calendars'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
