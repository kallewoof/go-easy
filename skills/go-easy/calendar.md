# go-easy: Calendar Reference

## Gateway CLI: `npx go-calendar`

```
npx go-calendar <account> <command> [args...] [--pass <phrase>] [--flags]
```

`--pass <phrase>` is required when the account is passphrase-protected (see [SKILL.md](SKILL.md)).

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.

### Commands

#### calendars
List all calendars for the account.
```bash
npx go-calendar <account> calendars
```
Returns: `Array<{ id, summary, description?, primary?, timeZone?, backgroundColor?, accessRole? }>` (bare array)

`accessRole`: `'owner'` = your own calendar; `'writer'` = shared with edit rights; `'reader'`/`'freeBusyReader'` = shared read-only.

Use `primary` as calendarId for the main calendar in other commands.

#### events
List events on a calendar. By default returns ALL event types (regular, out-of-office,
working location, focus time, birthdays).
```bash
# Upcoming events (all types)
npx go-calendar <account> events primary

# Date range
npx go-calendar <account> events primary \
  --from=2026-02-01T00:00:00Z \
  --to=2026-02-28T23:59:59Z

# With text search and pagination
npx go-calendar <account> events primary --query="meeting" --max=10
npx go-calendar <account> events primary --max=50 --page-token=<token>

# Filter by event type
npx go-calendar <account> events primary --event-types=workingLocation
npx go-calendar <account> events primary --event-types=default,outOfOffice

# Multiple calendars — pass comma-separated IDs (no spaces)
# Results are fetched in parallel, merged, and sorted by start time.
# --max is applied after the merge, so it limits the combined total.
npx go-calendar <account> events primary,work@group.calendar.google.com \
  --from=2026-04-01T00:00:00Z --max=50

# All calendars — '*' expands to every calendar in the account (including shared ones)
npx go-calendar <account> events '*' --from=2026-04-01T00:00:00Z --max=50

# Own calendars only — 'own' expands to calendars with accessRole=owner
# Use this for work accounts with many shared coworker calendars
npx go-calendar <account> events 'own' --from=2026-04-01T00:00:00Z --max=50
```
Returns: `{ items: CalendarEvent[], nextPageToken? }`

Note: `nextPageToken` is only present for single-calendar calls. For multi-calendar merges
(including `*`) there is no pagination token — increase `--max` or narrow the date range instead.

**Defaults:**
- `--max`: 20 per page
- `--from`: now (if omitted, returns events from current time onward)
- `--to`: no upper bound (if omitted, returns all future events up to `--max`)
- Recurring events are expanded into individual instances (singleEvents=true)
- All event types included (the Google API hides workingLocation and birthday by default — go-easy includes them)

**Event types**: `default`, `outOfOffice`, `workingLocation`, `focusTime`, `birthday`

#### event
Get a single event by ID.
```bash
npx go-calendar <account> event <calendarId> <eventId>
```
Returns: `CalendarEvent`

For recurring events, this returns the recurring event definition, not individual instances.
Use the `recurringEventId` from a listed instance to find its parent.

#### create (WRITE)
Create a new event.

**Required flags:** `--summary`, `--start`, `--end`
**Optional flags:** `--description`, `--location`, `--tz`, `--attendees`, `--all-day`, `--recurrence`, `--reminder`, `--type` + type-specific flags

```bash
# Regular timed event
npx go-calendar <account> create primary \
  --summary="Team Meeting" \
  --start=2026-02-10T10:00:00+01:00 \
  --end=2026-02-10T11:00:00+01:00 \
  --description="Weekly sync" \
  --location="Office"

# All-day event (end date is EXCLUSIVE — Feb 14 only)
npx go-calendar <account> create primary \
  --summary="Company Holiday" \
  --start=2026-02-14 \
  --end=2026-02-15 \
  --all-day

# With attendees (invitation emails sent automatically)
npx go-calendar <account> create primary \
  --summary="Project Review" \
  --start=2026-02-12T14:00:00+01:00 \
  --end=2026-02-12T15:00:00+01:00 \
  --attendees=alice@example.com,bob@example.com

# Working location — home office
npx go-calendar <account> create primary \
  --type=workingLocation \
  --summary="Home" \
  --start=2026-02-10 --end=2026-02-11 --all-day \
  --wl-type=homeOffice

# Working location — office
npx go-calendar <account> create primary \
  --type=workingLocation \
  --summary="Barcelona" \
  --start=2026-02-10 --end=2026-02-11 --all-day \
  --wl-type=officeLocation --wl-label="Barcelona Office"

# Out of office ⚠️ --auto-decline sends decline emails to existing invitations
npx go-calendar <account> create primary \
  --type=outOfOffice \
  --summary="Vacation" \
  --start=2026-02-14T00:00:00+01:00 \
  --end=2026-02-21T00:00:00+01:00 \
  --auto-decline=declineAllConflictingInvitations \
  --decline-message="On vacation, back Feb 21"

# Focus time ⚠️ --auto-decline sends decline emails to existing invitations
npx go-calendar <account> create primary \
  --type=focusTime \
  --summary="Deep Work" \
  --start=2026-02-10T09:00:00+01:00 \
  --end=2026-02-10T12:00:00+01:00 \
  --auto-decline=declineOnlyNewConflictingInvitations \
  --chat-status=doNotDisturb
```
Returns: `{ ok: true, id, htmlLink? }`

#### update (WRITE)
Update an existing event. Uses PATCH — only provided fields are changed, others are preserved.

⚠️ If the event has attendees, update notifications will be sent automatically.

```bash
# Update just the summary (other fields unchanged)
npx go-calendar <account> update primary <eventId> \
  --summary="Updated Meeting"

# Reschedule
npx go-calendar <account> update primary <eventId> \
  --summary="Updated Meeting" \
  --start=2026-02-10T11:00:00+01:00 \
  --end=2026-02-10T12:00:00+01:00

# Update attendees
npx go-calendar <account> update primary <eventId> \
  --summary="Review" \
  --start=2026-02-10T14:00:00+01:00 \
  --end=2026-02-10T15:00:00+01:00 \
  --attendees=alice@example.com,bob@example.com,carol@example.com
```
Returns: `{ ok: true, id, htmlLink? }`

**Required flags:** `--summary`, `--start`, `--end` (always required even for PATCH — Google API needs them)
**Optional flags:** `--description`, `--location`, `--tz`, `--attendees`, `--all-day`, `--recurrence`, `--reminder`

#### delete ⚠️ DESTRUCTIVE
Delete an event. Requires `--confirm`.
```bash
npx go-calendar <account> delete primary <eventId> --confirm
```
Returns: `{ ok: true, id }`

⚠️ If the event has attendees, cancellation emails will be sent automatically.

Without `--confirm`:
```json
{ "blocked": true, "operation": "calendar.delete", "description": "Delete event \"Meeting\" with 3 attendees — cancellation emails will be sent", "hint": "Add --confirm" }
```

#### freebusy
Check availability across calendars.
```bash
# Single calendar
npx go-calendar <account> freebusy primary \
  --from=2026-02-10T00:00:00Z \
  --to=2026-02-10T23:59:59Z

# Multiple calendars
npx go-calendar <account> freebusy primary,colleague@example.com \
  --from=2026-02-10T08:00:00Z \
  --to=2026-02-10T18:00:00Z
```
Returns: `Array<{ calendarId, busy: [{ start, end }] }>`

**Required flags:** `--from`, `--to`

## Library API

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { listCalendars, listEvents, getEvent, createEvent,
         updateEvent, deleteEvent, queryFreeBusy
} from '@marcfargas/go-easy/calendar';
import { setSafetyContext } from '@marcfargas/go-easy';

const auth = await getAuth('calendar', '<account>');

// List calendars
const cals = await listCalendars(auth);

// List events (with pagination)
const page1 = await listEvents(auth, 'primary', {
  timeMin: '2026-02-01T00:00:00Z',
  timeMax: '2026-02-28T23:59:59Z',
  maxResults: 50,
});
if (page1.nextPageToken) {
  const page2 = await listEvents(auth, 'primary', {
    timeMin: '2026-02-01T00:00:00Z',
    timeMax: '2026-02-28T23:59:59Z',
    maxResults: 50,
    pageToken: page1.nextPageToken,
  });
}

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

// Update event (WRITE — PATCH semantics)
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

- **Timed events**: ISO 8601 with offset — `2026-02-10T10:00:00+01:00` or UTC `2026-02-10T09:00:00Z`
- **All-day events**: Date only — `2026-02-14` (with `--all-day` flag in CLI)
- **Timezone (`--tz`)**: IANA format — `Europe/Madrid`, `America/New_York`, etc.

### Timezone semantics

- If `--start`/`--end` include an offset (e.g. `+01:00`), that offset is used directly
- `--tz` sets the calendar display timezone (e.g. for recurring events or DST transitions)
- If `--start`/`--end` are UTC (`Z`) and `--tz` is set, the event displays in that timezone

### All-day event end date

All-day end dates are **exclusive** (Google Calendar convention):
- One day event on Feb 14: `--start=2026-02-14 --end=2026-02-15`
- Three day event Feb 14–16: `--start=2026-02-14 --end=2026-02-17`

### Recurring events

Use `--recurrence=<iCal>` on `create`/`update`. Pipe-separate multiple entries.
**`--tz` is required when using `--recurrence`** — the API needs a named timezone to compute future occurrences correctly.

```bash
--recurrence="RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" --tz=Asia/Tokyo
--recurrence="RRULE:FREQ=WEEKLY;BYDAY=MO|EXDATE:20260427T100000Z" --tz=Europe/Madrid
--recurrence=   # clears recurrence (makes event one-time, --tz not required)
```

Listed events are expanded into instances (`singleEvents=true`). Each instance carries `recurringEventId` pointing to the series master, which has the `recurrence` string array.

### Reminders

`--reminder=<value>` on `create`/`update`:

```
120          → popup 120 min before
120:email    → email 120 min before
120:popup,30:email  → two reminders
default      → use calendar's default reminders
none         → disable all reminders
```

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
  recurringEventId?: string;  // parent recurring event (for instances)
  recurrence?: string[];      // iCal rules — only on series master
  reminders?: { useDefault: boolean; overrides?: { method: 'email'|'popup'; minutes: number }[] };
  allDay?: boolean;
  organizer?: { email: string; displayName?: string };
  creator?: { email: string; displayName?: string };
  eventType?: EventType;
  workingLocation?: WorkingLocationProperties;
  outOfOffice?: OutOfOfficeProperties;
  focusTime?: FocusTimeProperties;
  birthday?: BirthdayProperties;  // read-only
}

interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
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

interface BirthdayProperties {  // read-only, cannot be created
  contact?: string;
  type?: 'birthday' | 'anniversary' | 'custom' | 'self';
  customTypeName?: string;
}

interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
  backgroundColor?: string;
  accessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
}

interface WriteResult {
  ok: true;
  id: string;
  htmlLink?: string;
  recurrence?: string[];  // echo of stored rules — absent means recurrence was not applied
}

interface FreeBusyResult {
  calendarId: string;
  busy: { start: string; end: string }[];
}
```

## Error Codes

| Code | Meaning | Exit Code |
|------|---------|-----------|
| `AUTH_NO_ACCOUNT` | Account not configured | 1 |
| `AUTH_PROTECTED` | Account exists but `--pass` was not supplied | 1 |
| `AUTH_PASS_WRONG` | `--pass` supplied but incorrect | 1 |
| `AUTH_MISSING_SCOPE` | Account exists but missing Calendar scope | 1 |
| `AUTH_TOKEN_REVOKED` | Refresh token revoked — re-auth needed | 1 |
| `AUTH_NO_CREDENTIALS` | OAuth credentials missing | 1 |
| `NOT_FOUND` | Event not found (404) | 1 |
| `QUOTA_EXCEEDED` | Calendar API rate limit (429) — wait 30s and retry | 1 |
| `SAFETY_BLOCKED` | Destructive op without `--confirm` | 2 |
| `CALENDAR_ERROR` | Other Calendar API error | 1 |

Auth errors include a `fix` field: `{ "error": "AUTH_NO_ACCOUNT", "fix": "npx go-easy auth add <email>" }`

## Available Accounts

```bash
npx go-easy auth list
```

If an account is missing, add it: `npx go-easy auth add <email>` (see [SKILL.md](SKILL.md) for the full auth workflow).
