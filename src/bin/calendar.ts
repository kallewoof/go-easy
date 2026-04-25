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
import { getAuth, getCalendarDenyList } from '../auth.js';
import { setSafetyContext } from '../safety.js';
import { AccessDeniedError } from '../errors.js';
import * as calendar from '../calendar/index.js';

function usage(): never {
  console.log(JSON.stringify({
    error: 'USAGE',
    message: 'go-calendar <account> <command> [args...]',
    commands: {
      calendars: 'go-calendar <account> calendars',
      events: 'go-calendar <account> events <calendarId|id1,id2|*|own> [--from=<dt>] [--to=<dt>] [--max=N] [--query="..."] [--event-types=default,outOfOffice,workingLocation,focusTime,birthday]',
      event: 'go-calendar <account> event <calendarId> <eventId>',
      create: 'go-calendar <account> create <calendarId> --summary="..." --start=<dt> --end=<dt> [--description="..."] [--location="..."] [--attendees=a@b,c@d] [--all-day] [--tz=<tz>] [--type=outOfOffice|workingLocation|focusTime] [--recurrence=RRULE:FREQ=WEEKLY;BYDAY=MO] [--reminder=120|120:popup|120:email,30:popup|default|none]',
      'create (ooo)': 'go-calendar <account> create <calendarId> --type=outOfOffice --summary="..." --start=<dt> --end=<dt> [--auto-decline=declineAllConflictingInvitations] [--decline-message="..."]',
      'create (wl)': 'go-calendar <account> create <calendarId> --type=workingLocation --summary="..." --start=<dt> --end=<dt> --wl-type=homeOffice|officeLocation|customLocation [--wl-label="..."] [--wl-building=...] [--wl-floor=...] [--wl-desk=...]',
      'create (focus)': 'go-calendar <account> create <calendarId> --type=focusTime --summary="..." --start=<dt> --end=<dt> [--auto-decline=declineAllConflictingInvitations] [--chat-status=doNotDisturb] [--decline-message="..."]',
      update: 'go-calendar <account> update <calendarId> <eventId> --summary="..." --start=<dt> --end=<dt> [--description="..."] [--location="..."] [--attendees=a@b,c@d] [--all-day] [--tz=<tz>] [--recurrence=RRULE:FREQ=WEEKLY;BYDAY=MO] [--reminder=120|120:popup|120:email,30:popup|default|none]',
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

/** Parse --key=value and --key value flags from args */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (match) {
      if (match[2] !== undefined) {
        flags[match[1]] = match[2];
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[match[1]] = args[++i];
      } else {
        flags[match[1]] = 'true';
      }
    }
  }
  return flags;
}

/** Get positional args (non-flag), skipping values consumed by --key value pairs */
export function positional(args: string[]): string[] {
  const consumed = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    if (match[2] === undefined && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      consumed.add(++i);
    }
  }
  return args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
}

const EVENT_FLAGS = ['summary', 'description', 'start', 'end', 'tz', 'location', 'attendees',
  'all-day', 'type', 'recurrence', 'reminder', 'auto-decline', 'decline-message', 'chat-status',
  'wl-type', 'wl-label', 'wl-building', 'wl-floor', 'wl-desk'];

/** Valid flags per command (confirm is always allowed) */
export const VALID_FLAGS: Record<string, string[]> = {
  calendars: [],
  events: ['from', 'to', 'max', 'query', 'page-token', 'event-types'],
  event: [],
  create: EVENT_FLAGS,
  update: EVENT_FLAGS,
  delete: [],
  freebusy: ['from', 'to'],
};

/** Throw if any flag is not in the allowed set for this command */
export function assertKnownFlags(command: string, flags: Record<string, string>): void {
  const valid = VALID_FLAGS[command] ?? [];
  const allowed = new Set([...valid, 'confirm', 'pass']);
  const unknown = Object.keys(flags).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw Object.assign(
      new Error(`Unknown flag(s) for '${command}': ${unknown.map((f) => `--${f}`).join(', ')}. Allowed: ${valid.map((f) => `--${f}`).join(', ')}`),
      { code: 'UNKNOWN_FLAG' }
    );
  }
}

/**
 * Parse --reminder flag value into a reminders object.
 * Formats: "120" | "120:popup" | "120:email,30:popup" | "default" | "none"
 */
export function parseReminderFlag(value: string): calendar.EventOptions['reminders'] {
  if (value === 'default') return { useDefault: true };
  if (value === 'none') return { useDefault: false, overrides: [] };
  const overrides = value.split(',').map((part) => {
    const [mins, method = 'popup'] = part.split(':');
    return { method: method as 'email' | 'popup', minutes: parseInt(mins, 10) };
  });
  return { useDefault: false, overrides };
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

  try {
    const auth = await getAuth('calendar', account, flags.pass);
    const denyList = await getCalendarDenyList(account, flags.pass);
    assertKnownFlags(command, flags);
    let result: unknown;

    switch (command) {
      case 'calendars': {
        const all = await calendar.listCalendars(auth);
        result = denyList.length ? all.filter((c) => !denyList.includes(c.id)) : all;
        break;
      }

      case 'events': {
        if (!pos[0]) usage();
        const wildcard = pos[0] === '*';
        const ownOnly = pos[0] === 'own';
        const calIds = (wildcard || ownOnly)
          ? (await calendar.listCalendars(auth))
              .filter((c) => !denyList.includes(c.id))
              .filter((c) => !ownOnly || c.accessRole === 'owner')
              .map((c) => c.id)
          : pos[0].split(',');
        if (!wildcard && !ownOnly && denyList.length) {
          const denied = calIds.filter((id) => denyList.includes(id));
          if (denied.length) throw new AccessDeniedError(denied);
        }
        const toRfc3339 = (d: string) => d.includes('T') ? d : d + 'T00:00:00Z';
        const eventsOpts = {
          timeMin: toRfc3339(flags.from ?? new Date().toISOString().slice(0, 10)),
          timeMax: flags.to ? toRfc3339(flags.to) : undefined,
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
          const settled = (wildcard || ownOnly)
            ? await Promise.allSettled(calIds.map((id) => calendar.listEvents(auth, id, eventsOpts)))
            : await Promise.all(calIds.map((id) => calendar.listEvents(auth, id, eventsOpts))).then((r) => r.map((v) => ({ status: 'fulfilled' as const, value: v })));
          const calendarErrors: Array<{ calendarId: string; error: string }> = [];
          const items = settled
            .flatMap((r, i) => {
              if (r.status === 'fulfilled') return r.value.items;
              calendarErrors.push({ calendarId: calIds[i], error: r.reason?.message ?? String(r.reason) });
              return [];
            })
            .sort((a, b) => a.start.localeCompare(b.start));
          result = {
            items: eventsOpts.maxResults ? items.slice(0, eventsOpts.maxResults) : items,
            ...(calendarErrors.length ? { calendarErrors } : {}),
          };
        }
        break;
      }

      case 'event':
        if (!pos[0] || !pos[1]) usage();
        if (denyList.includes(pos[0])) throw new AccessDeniedError([pos[0]]);
        result = await calendar.getEvent(auth, pos[0], pos[1]);
        break;

      case 'create': {
        if (!pos[0]) usage();
        if (denyList.includes(pos[0])) throw new AccessDeniedError([pos[0]]);
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
          recurrence: flags.recurrence ? flags.recurrence.split('|') : undefined,
          reminders: flags.reminder ? parseReminderFlag(flags.reminder) : undefined,
          ...buildSpecialEventFlags(flags),
        };
        result = await calendar.createEvent(auth, pos[0], createOpts);
        break;
      }

      case 'update': {
        if (!pos[0] || !pos[1]) usage();
        if (denyList.includes(pos[0])) throw new AccessDeniedError([pos[0]]);
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
        if ('recurrence' in flags) updateOpts.recurrence = flags.recurrence.split('|');
        if ('reminder' in flags) updateOpts.reminders = parseReminderFlag(flags.reminder);
        if ('type' in flags) {
          updateOpts.eventType = flags.type as calendar.EventOptions['eventType'];
          Object.assign(updateOpts, buildSpecialEventFlags(flags));
        }
        result = await calendar.updateEvent(auth, pos[0], pos[1], updateOpts);
        break;
      }

      case 'delete':
        if (!pos[0] || !pos[1]) usage();
        if (denyList.includes(pos[0])) throw new AccessDeniedError([pos[0]]);
        result = await calendar.deleteEvent(auth, pos[0], pos[1]);
        break;

      case 'freebusy': {
        if (!pos[0] || !flags.from || !flags.to) usage();
        const calIds = pos[0].split(',');
        if (denyList.length) {
          const denied = calIds.filter((id) => denyList.includes(id));
          if (denied.length) throw new AccessDeniedError(denied);
        }
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
