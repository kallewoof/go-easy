#!/usr/bin/env node
/**
 * go-calendar — Gateway CLI for Google Calendar operations.
 *
 * Always outputs JSON. Designed for agent consumption.
 *
 * Usage:
 *   go-calendar <account> <command> [args...]
 *   go-calendar marc@blegal.eu calendars
 *   go-calendar marc@blegal.eu events primary --from=2026-02-01T00:00:00Z
 *   go-calendar marc@blegal.eu create primary --summary="Meeting" --start=... --end=...
 *
 * Safety:
 *   Destructive operations (delete) require --confirm flag.
 */

import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { getAuth } from '../auth.js';
import { setSafetyContext } from '../safety.js';
import * as calendar from '../calendar/index.js';

function usage(): never {
  console.log(JSON.stringify({
    error: 'USAGE',
    message: 'go-calendar <account> <command> [args...]',
    commands: {
      calendars: 'go-calendar <account> calendars',
      events: 'go-calendar <account> events <calendarId|id1,id2|*> [--from=<dt>] [--to=<dt>] [--max=N] [--query="..."] [--event-types=default,outOfOffice,workingLocation,focusTime,birthday]',
      event: 'go-calendar <account> event <calendarId> <eventId>',
      create: 'go-calendar <account> create <calendarId> --summary="..." --start=<dt> --end=<dt> [--description="..."] [--location="..."] [--attendees=a@b,c@d] [--all-day] [--tz=<tz>] [--type=outOfOffice|workingLocation|focusTime]',
      'create (ooo)': 'go-calendar <account> create <calendarId> --type=outOfOffice --summary="..." --start=<dt> --end=<dt> [--auto-decline=declineAllConflictingInvitations] [--decline-message="..."]',
      'create (wl)': 'go-calendar <account> create <calendarId> --type=workingLocation --summary="..." --start=<dt> --end=<dt> --wl-type=homeOffice|officeLocation|customLocation [--wl-label="..."] [--wl-building=...] [--wl-floor=...] [--wl-desk=...]',
      'create (focus)': 'go-calendar <account> create <calendarId> --type=focusTime --summary="..." --start=<dt> --end=<dt> [--auto-decline=declineAllConflictingInvitations] [--chat-status=doNotDisturb] [--decline-message="..."]',
      update: 'go-calendar <account> update <calendarId> <eventId> --summary="..." --start=<dt> --end=<dt> [--description="..."] [--location="..."] [--attendees=a@b,c@d] [--all-day] [--tz=<tz>]',
      delete: 'go-calendar <account> delete <calendarId> <eventId> [--confirm]',
      freebusy: 'go-calendar <account> freebusy <calendarId1,calendarId2> --from=<dt> --to=<dt>',
    },
    eventTypes: {
      description: 'Events are listed with all types by default. Use --event-types to filter.',
      types: ['default (regular events)', 'outOfOffice', 'workingLocation', 'focusTime', 'birthday (read-only)'],
    },
  }, null, 2));
  process.exit(1);
}

/** Parse --key=value flags from args */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) {
      flags[match[1]] = match[2] ?? 'true';
    }
  }
  return flags;
}

/** Get positional args (non-flag) */
export function positional(args: string[]): string[] {
  return args.filter((a) => !a.startsWith('--'));
}

/** Build special event type properties from CLI flags */
export function buildSpecialEventFlags(flags: Record<string, string>): Partial<calendar.EventOptions> {
  const result: Partial<calendar.EventOptions> = {};

  if (flags.type === 'outOfOffice') {
    result.outOfOffice = {
      autoDeclineMode: (flags['auto-decline'] as calendar.OutOfOfficeProperties['autoDeclineMode']) ?? undefined,
      declineMessage: flags['decline-message'] ?? undefined,
    };
  }

  if (flags.type === 'focusTime') {
    result.focusTime = {
      autoDeclineMode: (flags['auto-decline'] as calendar.FocusTimeProperties['autoDeclineMode']) ?? undefined,
      chatStatus: flags['chat-status'] ?? undefined,
      declineMessage: flags['decline-message'] ?? undefined,
    };
  }

  if (flags.type === 'workingLocation') {
    const wlType = (flags['wl-type'] ?? 'homeOffice') as calendar.WorkingLocationProperties['type'];
    const wl: calendar.WorkingLocationProperties = { type: wlType };

    if (wlType === 'homeOffice') {
      wl.homeOffice = true;
    } else if (wlType === 'officeLocation') {
      wl.officeLocation = {
        label: flags['wl-label'] ?? undefined,
        buildingId: flags['wl-building'] ?? undefined,
        floorId: flags['wl-floor'] ?? undefined,
        deskId: flags['wl-desk'] ?? undefined,
      };
    } else if (wlType === 'customLocation') {
      wl.customLocation = {
        label: flags['wl-label'] ?? undefined,
      };
    }

    result.workingLocation = wl;
  }

  return result;
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (args.length < 2) usage();

  const account = args[0];
  const command = args[1];
  const rest = args.slice(2);
  const flags = parseFlags(rest);
  const pos = positional(rest);

  // Set up safety context: --confirm flag allows destructive ops
  const hasConfirm = 'confirm' in flags;
  setSafetyContext({
    confirm: async (op) => {
      if (!hasConfirm) {
        console.log(JSON.stringify({
          blocked: true,
          operation: op.name,
          description: op.description,
          details: op.details,
          hint: 'Add --confirm to execute this operation',
        }, null, 2));
        process.exit(2);
      }
      return true;
    },
  });

  const auth = await getAuth('calendar', account);

  try {
    let result: unknown;

    switch (command) {
      case 'calendars':
        result = await calendar.listCalendars(auth);
        break;

      case 'events': {
        if (!pos[0]) usage();
        const wildcard = pos[0] === '*';
        const calIds = wildcard
          ? (await calendar.listCalendars(auth)).map((c) => c.id)
          : pos[0].split(',');
        const eventsOpts = {
          timeMin: flags.from ?? new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
          timeMax: flags.to,
          maxResults: flags.max ? parseInt(flags.max) : undefined,
          query: flags.query,
          pageToken: flags['page-token'],
          eventTypes: flags['event-types']
            ? flags['event-types'].split(',') as calendar.EventType[]
            : undefined,
        };
        if (calIds.length === 1 && !wildcard) {
          result = await calendar.listEvents(auth, calIds[0], eventsOpts);
        } else {
          // For wildcard expansion, skip calendars that reject event listing (e.g. holiday feeds).
          const settled = wildcard
            ? await Promise.allSettled(calIds.map((id) => calendar.listEvents(auth, id, eventsOpts)))
            : await Promise.all(calIds.map((id) => calendar.listEvents(auth, id, eventsOpts))).then((r) => r.map((v) => ({ status: 'fulfilled' as const, value: v })));
          const items = settled
            .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof calendar.listEvents>>> => r.status === 'fulfilled')
            .flatMap((r) => r.value.items)
            .sort((a, b) => a.start.localeCompare(b.start));
          result = { items: eventsOpts.maxResults ? items.slice(0, eventsOpts.maxResults) : items };
        }
        break;
      }

      case 'event':
        if (!pos[0] || !pos[1]) usage();
        result = await calendar.getEvent(auth, pos[0], pos[1]);
        break;

      case 'create': {
        if (!pos[0]) usage();
        const createOpts: calendar.EventOptions = {
          summary: flags.summary ?? '',
          description: flags.description,
          start: flags.start ?? '',
          end: flags.end ?? '',
          timeZone: flags.tz,
          location: flags.location,
          attendees: flags.attendees?.split(','),
          allDay: 'all-day' in flags,
          eventType: flags.type as calendar.EventOptions['eventType'],
          ...buildSpecialEventFlags(flags),
        };
        result = await calendar.createEvent(auth, pos[0], createOpts);
        break;
      }

      case 'update': {
        if (!pos[0] || !pos[1]) usage();
        // Only include fields the user actually provided (PATCH semantics)
        const updateOpts: calendar.EventOptions = {
          summary: flags.summary ?? '',
          start: flags.start ?? '',
          end: flags.end ?? '',
        };
        if ('description' in flags) updateOpts.description = flags.description;
        if ('tz' in flags) updateOpts.timeZone = flags.tz;
        if ('location' in flags) updateOpts.location = flags.location;
        if ('attendees' in flags) updateOpts.attendees = flags.attendees.split(',');
        if ('all-day' in flags) updateOpts.allDay = true;
        if ('type' in flags) {
          updateOpts.eventType = flags.type as calendar.EventOptions['eventType'];
          Object.assign(updateOpts, buildSpecialEventFlags(flags));
        }
        result = await calendar.updateEvent(auth, pos[0], pos[1], updateOpts);
        break;
      }

      case 'delete':
        if (!pos[0] || !pos[1]) usage();
        result = await calendar.deleteEvent(auth, pos[0], pos[1]);
        break;

      case 'freebusy': {
        if (!pos[0] || !flags.from || !flags.to) usage();
        const calIds = pos[0].split(',');
        result = await calendar.queryFreeBusy(auth, calIds, flags.from, flags.to);
        break;
      }

      default:
        usage();
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const e = err as { toJSON?: () => unknown; message?: string; code?: string };
    if (typeof e.toJSON === 'function') {
      console.error(JSON.stringify(e.toJSON(), null, 2));
    } else {
      console.error(JSON.stringify({
        error: e.code ?? 'UNKNOWN',
        message: e.message ?? String(err),
      }, null, 2));
    }
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(() => process.exit(1));
}
