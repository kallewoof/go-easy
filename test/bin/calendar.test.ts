import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFlags, positional, buildSpecialEventFlags, assertKnownFlags, VALID_FLAGS, parseReminderFlag, main } from '../../src/bin/calendar.js';
import * as calendarModule from '../../src/calendar/index.js';
import { setSafetyContext } from '../../src/safety.js';
import { getAuth, getCalendarDenyList } from '../../src/auth.js';

vi.mock('../../src/auth.js', () => ({
  getAuth: vi.fn().mockResolvedValue('fake-auth'),
  getCalendarDenyList: vi.fn().mockResolvedValue([]),
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

  it('parses --key value (space-separated)', () => {
    expect(parseFlags(['--max', '10'])).toEqual({ max: '10' });
    expect(parseFlags(['*', '--max', '10'])).toEqual({ max: '10' });
    expect(parseFlags(['--from', '2026-01-01', '--to', '2026-01-31'])).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('does not consume next --flag as value for bare flag', () => {
    expect(parseFlags(['--all-day', '--summary=Test'])).toEqual({ 'all-day': 'true', summary: 'Test' });
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

// ─── parseReminderFlag ─────────────────────────────────────

describe('parseReminderFlag', () => {
  it('"default" → useDefault: true', () => {
    expect(parseReminderFlag('default')).toEqual({ useDefault: true });
  });

  it('"none" → empty overrides', () => {
    expect(parseReminderFlag('none')).toEqual({ useDefault: false, overrides: [] });
  });

  it('"120" → popup override at 120 min', () => {
    expect(parseReminderFlag('120')).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 120 }],
    });
  });

  it('"120:email" → email override', () => {
    expect(parseReminderFlag('120:email')).toEqual({
      useDefault: false,
      overrides: [{ method: 'email', minutes: 120 }],
    });
  });

  it('"120:popup,30:email" → two overrides', () => {
    const result = parseReminderFlag('120:popup,30:email');
    expect(result.overrides).toHaveLength(2);
    expect(result.overrides![0]).toEqual({ method: 'popup', minutes: 120 });
    expect(result.overrides![1]).toEqual({ method: 'email', minutes: 30 });
  });
});

// ─── assertKnownFlags ──────────────────────────────────────

describe('assertKnownFlags', () => {
  it('passes when all flags are valid', () => {
    expect(() => assertKnownFlags('events', { from: '2026-01-01', max: '10' })).not.toThrow();
  });

  it('always allows --confirm regardless of command', () => {
    expect(() => assertKnownFlags('calendars', { confirm: 'true' })).not.toThrow();
  });

  it('throws UNKNOWN_FLAG for unrecognised flag', () => {
    expect(() => assertKnownFlags('events', { bogus: 'x' }))
      .toThrow('Unknown flag(s)');
    try { assertKnownFlags('events', { bogus: 'x' }); } catch (e: unknown) {
      expect((e as { code: string }).code).toBe('UNKNOWN_FLAG');
    }
  });

  it('lists the unknown flag name in the error message', () => {
    expect(() => assertKnownFlags('create', { bogus: 'x' }))
      .toThrow('--bogus');
  });

  it('VALID_FLAGS covers all known commands', () => {
    for (const cmd of ['calendars', 'events', 'event', 'create', 'update', 'delete', 'freebusy']) {
      expect(VALID_FLAGS).toHaveProperty(cmd);
    }
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

  it('events — defaults timeMin to today when --from is omitted', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await main([ACC, 'events', 'primary']);
    const opts = vi.mocked(calendarModule.listEvents).mock.calls[0][2];
    // Without a default, timeMin would be undefined — causing birthdays from 1931
    // to bleed through because the API returns all events from the beginning of time.
    expect(opts.timeMin).toBeDefined();
    expect(opts.timeMin).toContain(today);
  });

  it('events — 1931 birthday excluded unless --from predates it', async () => {
    // Simulate: user has a contact born 1931-03-15; Google surfaces this as a
    // birthday event with start = 1931-03-15. Without a default timeMin the API
    // returns it; with timeMin = today it must be filtered out server-side.
    const today = new Date().toISOString().slice(0, 10);
    await main([ACC, 'events', 'primary']);
    const opts = vi.mocked(calendarModule.listEvents).mock.calls[0][2];
    expect(new Date(opts.timeMin!).getFullYear()).toBeGreaterThanOrEqual(
      new Date(today).getFullYear(),
    );

    vi.mocked(calendarModule.listEvents).mockClear();
    await main([ACC, 'events', 'primary', '--from=1930-01-01']);
    const optsWithFrom = vi.mocked(calendarModule.listEvents).mock.calls[0][2];
    expect(optsWithFrom.timeMin).toBe('1930-01-01'); // explicit past date passes through
  });

  it('events --event-types — passes event type filter', async () => {
    await main([ACC, 'events', 'primary', '--event-types=outOfOffice,focusTime']);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith(
      'fake-auth', 'primary',
      expect.objectContaining({ eventTypes: ['outOfOffice', 'focusTime'] }),
    );
  });

  it('events * — expands to all calendars from listCalendars', async () => {
    vi.mocked(calendarModule.listCalendars).mockResolvedValueOnce([
      { id: 'primary', summary: 'My Calendar' },
      { id: 'work@group.calendar.google.com', summary: 'Work' },
    ]);
    await main([ACC, 'events', '*', '--from=2026-01-01']);
    expect(vi.mocked(calendarModule.listCalendars)).toHaveBeenCalledWith('fake-auth');
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith('fake-auth', 'primary', expect.any(Object));
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith('fake-auth', 'work@group.calendar.google.com', expect.any(Object));
  });

  it('events * — skips calendars that return errors (e.g. holiday feeds)', async () => {
    vi.mocked(calendarModule.listCalendars).mockResolvedValueOnce([
      { id: 'primary', summary: 'My Calendar' },
      { id: 'holidays@group.v.calendar.google.com', summary: 'Holidays' },
    ]);
    vi.mocked(calendarModule.listEvents)
      .mockResolvedValueOnce({ items: [{ id: 'e1', summary: 'Event', start: '2026-01-01', end: '2026-01-02' }] })
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code: 404 }));
    await main([ACC, 'events', '*', '--from=2026-01-01']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.items).toHaveLength(1);
    expect(output.items[0].id).toBe('e1');
  });

  it('events — multi-calendar: calls listEvents once per calendar ID', async () => {
    await main([ACC, 'events', 'primary,work@example.com', '--from=2026-01-01']);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith('fake-auth', 'primary', expect.any(Object));
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith('fake-auth', 'work@example.com', expect.any(Object));
  });

  it('events — multi-calendar: merges and sorts by start date', async () => {
    vi.mocked(calendarModule.listEvents)
      .mockResolvedValueOnce({ items: [
        { id: 'b', summary: 'B', start: '2026-01-03', end: '2026-01-03' },
        { id: 'd', summary: 'D', start: '2026-01-05', end: '2026-01-05' },
      ] })
      .mockResolvedValueOnce({ items: [
        { id: 'a', summary: 'A', start: '2026-01-01', end: '2026-01-01' },
        { id: 'c', summary: 'C', start: '2026-01-04', end: '2026-01-04' },
      ] });
    await main([ACC, 'events', 'primary,work@example.com', '--from=2026-01-01']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.items.map((e: { id: string }) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('events — multi-calendar: respects --max as overall cap after aggregation', async () => {
    vi.mocked(calendarModule.listEvents)
      .mockResolvedValueOnce({ items: [
        { id: 'b', summary: 'B', start: '2026-01-03', end: '2026-01-03' },
        { id: 'd', summary: 'D', start: '2026-01-05', end: '2026-01-05' },
      ] })
      .mockResolvedValueOnce({ items: [
        { id: 'a', summary: 'A', start: '2026-01-01', end: '2026-01-01' },
        { id: 'c', summary: 'C', start: '2026-01-04', end: '2026-01-04' },
      ] });
    await main([ACC, 'events', 'primary,work@example.com', '--from=2026-01-01', '--max=2']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.items).toHaveLength(2);
    expect(output.items[0].id).toBe('a');
    expect(output.items[1].id).toBe('b');
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

  it('create --reminder — passes reminders to createEvent', async () => {
    await main([ACC, 'create', 'primary', '--summary=Meeting', '--start=2026-01-01', '--end=2026-01-02',
      '--reminder=120:popup']);
    expect(vi.mocked(calendarModule.createEvent)).toHaveBeenCalledWith(
      'fake-auth', 'primary',
      expect.objectContaining({ reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 120 }] } }),
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

  // ─── Unknown flag rejection per command ───────────────────
  const unknownFlagCases: [string, string[]][] = [
    ['calendars', []],
    ['events',   ['primary']],
    ['event',    ['primary', 'evt1']],
    ['create',   ['primary', '--summary=X', '--start=S', '--end=E']],
    ['update',   ['primary', 'evt1', '--summary=X', '--start=S', '--end=E']],
    ['delete',   ['primary', 'evt1']],
    ['freebusy', ['primary', '--from=2026-01-01', '--to=2026-01-31']],
  ];

  for (const [cmd, baseArgs] of unknownFlagCases) {
    it(`${cmd} — rejects unknown flag with UNKNOWN_FLAG error`, async () => {
      await expect(main([ACC, cmd, ...baseArgs, '--bogus=value'])).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const err = JSON.parse(errSpy.mock.calls[0][0]);
      expect(err.error).toBe('UNKNOWN_FLAG');
      expect(err.message).toContain('--bogus');
    });
  }

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

  // ─── --pass forwarded to getAuth for every command ─────────
  const passCases: [string, string[]][] = [
    ['calendars', []],
    ['events',    ['primary']],
    ['event',     ['primary', 'evt1']],
    ['create',    ['primary', '--summary=X', '--start=2026-01-01', '--end=2026-01-02']],
    ['update',    ['primary', 'evt1', '--summary=X', '--start=2026-01-01', '--end=2026-01-02']],
    ['delete',    ['primary', 'evt1', '--confirm']],
    ['freebusy',  ['primary', '--from=2026-01-01', '--to=2026-01-31']],
  ];

  for (const [cmd, baseArgs] of passCases) {
    it(`${cmd} — forwards --pass to getAuth`, async () => {
      await main([ACC, cmd, ...baseArgs, '--pass=secret']);
      expect(vi.mocked(getAuth)).toHaveBeenCalledWith('calendar', ACC, 'secret');
    });
  }
});

// ─── deny-list enforcement ─────────────────────────────────

describe('deny-list enforcement', () => {
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

  it('calendars — filters denied calendars from result', async () => {
    vi.mocked(calendarModule.listCalendars).mockResolvedValueOnce([
      { id: 'primary', summary: 'My Calendar' },
      { id: 'private@group.calendar.google.com', summary: 'Private' },
    ]);
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['private@group.calendar.google.com']);
    await main([ACC, 'calendars']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveLength(1);
    expect(output[0].id).toBe('primary');
  });

  it('calendars — empty deny list shows all calendars', async () => {
    vi.mocked(calendarModule.listCalendars).mockResolvedValueOnce([
      { id: 'primary', summary: 'My Calendar' },
      { id: 'work', summary: 'Work' },
    ]);
    await main([ACC, 'calendars']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveLength(2);
  });

  it('events * — skips denied calendars during expansion', async () => {
    vi.mocked(calendarModule.listCalendars).mockResolvedValueOnce([
      { id: 'primary', summary: 'My Calendar' },
      { id: 'private@group.calendar.google.com', summary: 'Private' },
    ]);
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['private@group.calendar.google.com']);
    await main([ACC, 'events', '*', '--from=2026-01-01']);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith('fake-auth', 'primary', expect.any(Object));
  });

  it('events own — skips denied calendars even if user owns them', async () => {
    vi.mocked(calendarModule.listCalendars).mockResolvedValueOnce([
      { id: 'primary', summary: 'My Calendar', accessRole: 'owner' },
      { id: 'private@group.calendar.google.com', summary: 'Private', accessRole: 'owner' },
      { id: 'shared@group.calendar.google.com', summary: 'Shared', accessRole: 'reader' },
    ]);
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['private@group.calendar.google.com']);
    await main([ACC, 'events', 'own', '--from=2026-01-01']);
    // Only 'primary' remains: 'private' is denied, 'shared' is not owner
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(calendarModule.listEvents)).toHaveBeenCalledWith('fake-auth', 'primary', expect.any(Object));
  });

  it('events <denied-id> — exits with ACCESS_DENIED', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(main([ACC, 'events', 'denied@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.listEvents)).not.toHaveBeenCalled();
  });

  it('events primary,denied — exits with ACCESS_DENIED for denied subset', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(main([ACC, 'events', 'primary,denied@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.listEvents)).not.toHaveBeenCalled();
  });

  it('event <denied-id> <eventId> — exits with ACCESS_DENIED', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(main([ACC, 'event', 'denied@example.com', 'evt1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.getEvent)).not.toHaveBeenCalled();
  });

  it('create <denied-id> — exits with ACCESS_DENIED', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(
      main([ACC, 'create', 'denied@example.com', '--summary=X', '--start=2026-01-01', '--end=2026-01-02'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.createEvent)).not.toHaveBeenCalled();
  });

  it('update <denied-id> — exits with ACCESS_DENIED', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(
      main([ACC, 'update', 'denied@example.com', 'evt1', '--summary=X', '--start=2026-01-01', '--end=2026-01-02'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.updateEvent)).not.toHaveBeenCalled();
  });

  it('delete <denied-id> — exits with ACCESS_DENIED', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(main([ACC, 'delete', 'denied@example.com', 'evt1', '--confirm'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.deleteEvent)).not.toHaveBeenCalled();
  });

  it('freebusy — exits with ACCESS_DENIED when any calendar is denied', async () => {
    vi.mocked(getCalendarDenyList).mockResolvedValueOnce(['denied@example.com']);
    await expect(
      main([ACC, 'freebusy', 'primary,denied@example.com', '--from=2026-01-01', '--to=2026-01-31'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = JSON.parse(errSpy.mock.calls[0][0]);
    expect(err.error).toBe('ACCESS_DENIED');
    expect(vi.mocked(calendarModule.queryFreeBusy)).not.toHaveBeenCalled();
  });

  it('freebusy — succeeds when no denied calendars', async () => {
    await main([ACC, 'freebusy', 'primary,work', '--from=2026-01-01', '--to=2026-01-31']);
    expect(vi.mocked(calendarModule.queryFreeBusy)).toHaveBeenCalledWith(
      'fake-auth', ['primary', 'work'], '2026-01-01', '2026-01-31',
    );
  });

  it('--pass is forwarded to getCalendarDenyList', async () => {
    await main([ACC, 'calendars', '--pass=agent-secret']);
    expect(vi.mocked(getCalendarDenyList)).toHaveBeenCalledWith(ACC, 'agent-secret');
  });
});
