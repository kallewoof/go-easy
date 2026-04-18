/**
 * Calendar types — agent-friendly shapes, not raw API types.
 *
 * Google Calendar has several event types beyond regular events:
 * - default: Regular events (meetings, appointments, etc.)
 * - outOfOffice: Out-of-office blocks
 * - workingLocation: Where the user is working from (home, office, custom)
 * - focusTime: Focus/do-not-disturb blocks
 * - birthday: Birthday events from Contacts (read-only)
 */

/** All supported event types */
export type EventType = 'default' | 'outOfOffice' | 'workingLocation' | 'focusTime' | 'birthday';

/** Working location: where the user is working from */
export interface WorkingLocationProperties {
  /** Type of working location */
  type: 'homeOffice' | 'officeLocation' | 'customLocation';
  /** Label for home office (always undefined — homeOffice has no sub-fields) */
  homeOffice?: true;
  /** Office location details */
  officeLocation?: {
    buildingId?: string;
    deskId?: string;
    floorId?: string;
    floorSectionId?: string;
    label?: string;
  };
  /** Custom location label */
  customLocation?: {
    label?: string;
  };
}

/** Out-of-office event properties */
export interface OutOfOfficeProperties {
  /** How to handle conflicting invitations */
  autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
  /** Auto-decline message */
  declineMessage?: string;
}

/** Focus time event properties */
export interface FocusTimeProperties {
  /** How to handle conflicting invitations */
  autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
  /** Chat status: 'available' or 'doNotDisturb' */
  chatStatus?: string;
  /** Auto-decline message */
  declineMessage?: string;
}

/** Birthday event properties (read-only) */
export interface BirthdayProperties {
  /** People API resource name (e.g. "people/c12345") */
  contact?: string;
  /** Type of birthday event */
  type?: 'birthday' | 'anniversary' | 'custom' | 'self';
  /** Custom type name (when type is 'custom') */
  customTypeName?: string;
}

/** A simplified calendar event */
export interface CalendarEvent {
  id: string;
  /** Calendar this event belongs to — use this as calendarId when updating */
  calendarId?: string;
  summary: string;
  description?: string;
  /** ISO 8601 datetime or date (for all-day events) */
  start: string;
  /** ISO 8601 datetime or date (for all-day events) */
  end: string;
  /** Timezone (e.g. 'Europe/Madrid') */
  timeZone?: string;
  location?: string;
  attendees?: Attendee[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
  /** Link to open in browser */
  htmlLink?: string;
  /** For recurring event instances */
  recurringEventId?: string;
  /** Whether this is an all-day event */
  allDay?: boolean;
  /** Organizer */
  organizer?: { email: string; displayName?: string };
  /** Creator */
  creator?: { email: string; displayName?: string };
  /** Event type — 'default' for regular events */
  eventType?: EventType;
  /** Working location details (when eventType is 'workingLocation') */
  workingLocation?: WorkingLocationProperties;
  /** Out-of-office details (when eventType is 'outOfOffice') */
  outOfOffice?: OutOfOfficeProperties;
  /** Focus time details (when eventType is 'focusTime') */
  focusTime?: FocusTimeProperties;
  /** Birthday details (when eventType is 'birthday') */
  birthday?: BirthdayProperties;
}

/** An event attendee */
export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

/** Calendar metadata */
export interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
  backgroundColor?: string;
  /** Your access level: 'owner' = your own calendar, 'writer' = shared with edit rights, 'reader'/'freeBusyReader' = shared read-only */
  accessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
}

/** A busy slot in free/busy query results */
export interface FreeBusySlot {
  start: string;
  end: string;
}

/** Free/busy result per calendar */
export interface FreeBusyResult {
  calendarId: string;
  busy: FreeBusySlot[];
}

/** Options for listing events */
export interface ListEventsOptions {
  /** Start of time range (ISO 8601) */
  timeMin?: string;
  /** End of time range (ISO 8601) */
  timeMax?: string;
  /** Maximum results (default: 20) */
  maxResults?: number;
  /** Page token for pagination */
  pageToken?: string;
  /** Text search query */
  query?: string;
  /** Whether to expand recurring events into instances (default: true) */
  singleEvents?: boolean;
  /** Order by (default: 'startTime' when singleEvents=true) */
  orderBy?: string;
  /**
   * Filter by event types. Default: all types.
   *
   * By default we request ALL event types (including workingLocation and birthday
   * which the API excludes by default). Pass specific types to filter.
   *
   * Valid values: 'default', 'outOfOffice', 'workingLocation', 'focusTime', 'birthday'
   */
  eventTypes?: EventType[];
}

/** Options for creating/updating an event */
export interface EventOptions {
  summary: string;
  description?: string;
  /** ISO 8601 datetime or date */
  start: string;
  /** ISO 8601 datetime or date */
  end: string;
  /** Timezone (default: account's timezone) */
  timeZone?: string;
  location?: string;
  /** Attendee emails */
  attendees?: string[];
  /** Whether this is an all-day event */
  allDay?: boolean;
  /**
   * Event type. Defaults to 'default' (regular event).
   * Set to 'outOfOffice', 'workingLocation', or 'focusTime' for special events.
   * 'birthday' is read-only and cannot be created via this API.
   */
  eventType?: 'default' | 'outOfOffice' | 'workingLocation' | 'focusTime';
  /** Out-of-office properties (required when eventType is 'outOfOffice') */
  outOfOffice?: OutOfOfficeProperties;
  /** Working location properties (required when eventType is 'workingLocation') */
  workingLocation?: WorkingLocationProperties;
  /** Focus time properties (required when eventType is 'focusTime') */
  focusTime?: FocusTimeProperties;
}

/** Paginated list result */
export interface ListResult<T> {
  items: T[];
  nextPageToken?: string;
}

/** Result of a write operation */
export interface WriteResult {
  ok: true;
  id: string;
  htmlLink?: string;
}
