# go-easy: Calendar Reference

## Gateway CLI: `npx go-calendar`

```
npx go-calendar <account> <command> [args...] [--flags]
```

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.

### Commands

#### calendars
List all calendars for the account.
```bash
npx go-calendar marc@blegal.eu calendars
```
Returns: `[{ id, summary, description?, primary?, timeZone?, backgroundColor? }]`

Use `primary` as calendarId for the main calendar in other commands.

#### events
List events on a calendar. By default returns ALL event types (regular, out-of-office,
working location, focus time, birthdays).
```bash
# Upcoming events (all types)
npx go-calendar marc@blegal.eu events primary

# Date range
npx go-calendar marc@blegal.eu events primary \
  --from=2026-02-01T00:00:00Z \
  --to=2026-02-28T23:59:59Z

# With text search
npx go-calendar marc@blegal.eu events primary --query="meeting" --max=10

# Filter by event type
npx go-calendar marc@blegal.eu events primary --event-types=workingLocation
npx go-calendar marc@blegal.eu events primary --event-types=default,outOfOffice

# On a specific calendar
npx go-calendar marc@blegal.eu events <calendarId> --from=2026-02-10T00:00:00Z
```
Returns: `{ items: CalendarEvent[], nextPageToken? }`

**Event types**: `default`, `outOfOffice`, `workingLocation`, `focusTime`, `birthday`

#### event
Get a single event by ID.
```bash
npx go-calendar marc@blegal.eu event <calendarId> <eventId>
```
Returns: `CalendarEvent`

#### create (WRITE)
Create a new event. Supports all writable event types.
```bash
# Regular timed event
npx go-calendar marc@blegal.eu create primary \
  --summary="Team Meeting" \
  --start=2026-02-10T10:00:00+01:00 \
  --end=2026-02-10T11:00:00+01:00 \
  --description="Weekly sync" \
  --location="Office" \
  --tz=Europe/Madrid

# All-day event
npx go-calendar marc@blegal.eu create primary \
  --summary="Company Holiday" \
  --start=2026-02-14 \
  --end=2026-02-15 \
  --all-day

# With attendees
npx go-calendar marc@blegal.eu create primary \
  --summary="Project Review" \
  --start=2026-02-12T14:00:00+01:00 \
  --end=2026-02-12T15:00:00+01:00 \
  --attendees=alice@example.com,bob@example.com

# Working location — home office
npx go-calendar marc@blegal.eu create primary \
  --type=workingLocation \
  --summary="Home" \
  --start=2026-02-10 --end=2026-02-11 --all-day \
  --wl-type=homeOffice

# Working location — office
npx go-calendar marc@blegal.eu create primary \
  --type=workingLocation \
  --summary="Barcelona" \
  --start=2026-02-10 --end=2026-02-11 --all-day \
  --wl-type=officeLocation --wl-label="Barcelona Office"

# Working location — custom
npx go-calendar marc@blegal.eu create primary \
  --type=workingLocation \
  --summary="Coworking" \
  --start=2026-02-10 --end=2026-02-11 --all-day \
  --wl-type=customLocation --wl-label="WeWork Diagonal"

# Out of office
npx go-calendar marc@blegal.eu create primary \
  --type=outOfOffice \
  --summary="Vacation" \
  --start=2026-02-14T00:00:00+01:00 \
  --end=2026-02-21T00:00:00+01:00 \
  --auto-decline=declineAllConflictingInvitations \
  --decline-message="On vacation, back Feb 21"

# Focus time
npx go-calendar marc@blegal.eu create primary \
  --type=focusTime \
  --summary="Deep Work" \
  --start=2026-02-10T09:00:00+01:00 \
  --end=2026-02-10T12:00:00+01:00 \
  --auto-decline=declineOnlyNewConflictingInvitations \
  --chat-status=doNotDisturb \
  --decline-message="In focus mode"
```
Returns: `{ ok: true, id, htmlLink? }`

#### update (WRITE)
Update an existing event. This is a **full replace** — any field you omit will be cleared.

⚠️ If the event has attendees, update notifications will be sent automatically.

**Best practice**: Fetch the event first with `event`, then pass back all fields with your changes.

```bash
# 1. Fetch current state
npx go-calendar marc@blegal.eu event primary <eventId>
# 2. Update with all fields preserved
npx go-calendar marc@blegal.eu update primary <eventId> \
  --summary="Updated Meeting" \
  --start=2026-02-10T11:00:00+01:00 \
  --end=2026-02-10T12:00:00+01:00 \
  --description="Weekly sync" \
  --attendees=alice@example.com,bob@example.com
```
Returns: `{ ok: true, id, htmlLink? }`

#### delete ⚠️ DESTRUCTIVE
Delete an event. Requires `--confirm`.
```bash
npx go-calendar marc@blegal.eu delete primary <eventId> --confirm
```
⚠️ If the event has attendees, cancellation emails will be sent automatically.

Without `--confirm`:
```json
{ "blocked": true, "operation": "calendar.delete", "description": "Delete event \"Meeting\" with 3 attendees — cancellation emails will be sent", "hint": "Add --confirm" }
```

#### freebusy
Check availability across calendars.
```bash
# Single calendar
npx go-calendar marc@blegal.eu freebusy primary \
  --from=2026-02-10T00:00:00Z \
  --to=2026-02-10T23:59:59Z

# Multiple calendars
npx go-calendar marc@blegal.eu freebusy primary,colleague@example.com \
  --from=2026-02-10T08:00:00Z \
  --to=2026-02-10T18:00:00Z
```
Returns: `[{ calendarId, busy: [{ start, end }] }]`

## Library API

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { listCalendars, listEvents, getEvent, createEvent,
         updateEvent, deleteEvent, queryFreeBusy
} from '@marcfargas/go-easy/calendar';
import { setSafetyContext } from '@marcfargas/go-easy';

const auth = await getAuth('calendar', 'marc@blegal.eu');

// List calendars
const cals = await listCalendars(auth);

// List events
const events = await listEvents(auth, 'primary', {
  timeMin: '2026-02-01T00:00:00Z',
  timeMax: '2026-02-28T23:59:59Z',
  maxResults: 50,
});

// Get single event
const event = await getEvent(auth, 'primary', 'eventId');

// Create event (WRITE — no safety gate)
const created = await createEvent(auth, 'primary', {
  summary: 'Meeting',
  start: '2026-02-10T10:00:00+01:00',
  end: '2026-02-10T11:00:00+01:00',
  timeZone: 'Europe/Madrid',
  location: 'Office',
  attendees: ['alice@example.com'],
});

// Update event (WRITE)
await updateEvent(auth, 'primary', 'eventId', {
  summary: 'Updated',
  start: '2026-02-10T11:00:00+01:00',
  end: '2026-02-10T12:00:00+01:00',
});

// Delete event (DESTRUCTIVE — needs safety context)
setSafetyContext({ confirm: async (op) => { /* ... */ return true; } });
await deleteEvent(auth, 'primary', 'eventId');

// Free/busy
const availability = await queryFreeBusy(
  auth,
  ['primary', 'colleague@example.com'],
  '2026-02-10T08:00:00Z',
  '2026-02-10T18:00:00Z'
);
```

## Date/Time Formats

- **Timed events**: ISO 8601 with timezone — `2026-02-10T10:00:00+01:00` or UTC `2026-02-10T09:00:00Z`
- **All-day events**: Date only — `2026-02-14` (with `--all-day` flag in CLI)
- **Timezone**: IANA format — `Europe/Madrid`, `America/New_York`, etc.

## Types

```typescript
type EventType = 'default' | 'outOfOffice' | 'workingLocation' | 'focusTime' | 'birthday';

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;              // ISO 8601 datetime or date
  end: string;
  timeZone?: string;
  location?: string;
  attendees?: Attendee[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  recurringEventId?: string;
  allDay?: boolean;
  organizer?: { email: string; displayName?: string };
  creator?: { email: string; displayName?: string };
  eventType?: EventType;      // 'default' for regular events
  workingLocation?: WorkingLocationProperties;  // when eventType is 'workingLocation'
  outOfOffice?: OutOfOfficeProperties;          // when eventType is 'outOfOffice'
  focusTime?: FocusTimeProperties;              // when eventType is 'focusTime'
  birthday?: BirthdayProperties;                // when eventType is 'birthday'
}

interface WorkingLocationProperties {
  type: 'homeOffice' | 'officeLocation' | 'customLocation';
  homeOffice?: true;
  officeLocation?: { buildingId?; deskId?; floorId?; floorSectionId?; label? };
  customLocation?: { label? };
}

interface OutOfOfficeProperties {
  autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
  declineMessage?: string;
}

interface FocusTimeProperties {
  autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
  chatStatus?: string;        // 'available' or 'doNotDisturb'
  declineMessage?: string;
}

interface BirthdayProperties {  // read-only
  contact?: string;             // People API resource: "people/c12345"
  type?: 'birthday' | 'anniversary' | 'custom' | 'self';
  customTypeName?: string;
}

interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
  backgroundColor?: string;
}

interface FreeBusyResult {
  calendarId: string;
  busy: { start: string; end: string }[];
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| `AUTH_ERROR` | Token expired/missing |
| `NOT_FOUND` | Event not found (404) |
| `QUOTA_EXCEEDED` | Calendar API rate limit (429) |
| `SAFETY_BLOCKED` | Destructive op without `--confirm` |
| `CALENDAR_ERROR` | Other Calendar API error |

## Available Accounts

Calendar tokens at `~/.gccli/accounts.json`. Currently: `marc@blegal.eu` only.
