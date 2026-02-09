/**
 * Calendar helpers — event parsing and date handling.
 */

import type { calendar_v3 } from '@googleapis/calendar';
import type {
  CalendarEvent,
  Attendee,
  CalendarInfo,
  EventType,
  WorkingLocationProperties,
  OutOfOfficeProperties,
  FocusTimeProperties,
  BirthdayProperties,
} from './types.js';

/** Parse a raw Calendar API event into our CalendarEvent shape */
export function parseEvent(raw: calendar_v3.Schema$Event): CalendarEvent {
  const isAllDay = !!raw.start?.date;
  const eventType = (raw.eventType ?? 'default') as EventType;

  const event: CalendarEvent = {
    id: raw.id ?? '',
    summary: raw.summary ?? '(no title)',
    description: raw.description ?? undefined,
    start: isAllDay ? (raw.start?.date ?? '') : (raw.start?.dateTime ?? ''),
    end: isAllDay ? (raw.end?.date ?? '') : (raw.end?.dateTime ?? ''),
    timeZone: raw.start?.timeZone ?? undefined,
    location: raw.location ?? undefined,
    attendees: raw.attendees?.map(parseAttendee) ?? undefined,
    status: raw.status as CalendarEvent['status'] ?? undefined,
    htmlLink: raw.htmlLink ?? undefined,
    recurringEventId: raw.recurringEventId ?? undefined,
    allDay: isAllDay,
    organizer: raw.organizer
      ? { email: raw.organizer.email ?? '', displayName: raw.organizer.displayName ?? undefined }
      : undefined,
    creator: raw.creator
      ? { email: raw.creator.email ?? '', displayName: raw.creator.displayName ?? undefined }
      : undefined,
    eventType,
  };

  // Parse type-specific properties
  if (raw.workingLocationProperties) {
    event.workingLocation = parseWorkingLocation(raw.workingLocationProperties);
  }
  if (raw.outOfOfficeProperties) {
    event.outOfOffice = parseOutOfOffice(raw.outOfOfficeProperties);
  }
  if (raw.focusTimeProperties) {
    event.focusTime = parseFocusTime(raw.focusTimeProperties);
  }
  if (raw.birthdayProperties) {
    event.birthday = parseBirthday(raw.birthdayProperties);
  }

  return event;
}

/** Parse working location properties */
export function parseWorkingLocation(
  raw: calendar_v3.Schema$EventWorkingLocationProperties
): WorkingLocationProperties {
  const result: WorkingLocationProperties = {
    type: (raw.type as WorkingLocationProperties['type']) ?? 'customLocation',
  };

  if (raw.homeOffice !== undefined && raw.homeOffice !== null) {
    result.homeOffice = true;
  }
  if (raw.officeLocation) {
    result.officeLocation = {
      buildingId: raw.officeLocation.buildingId ?? undefined,
      deskId: raw.officeLocation.deskId ?? undefined,
      floorId: raw.officeLocation.floorId ?? undefined,
      floorSectionId: raw.officeLocation.floorSectionId ?? undefined,
      label: raw.officeLocation.label ?? undefined,
    };
  }
  if (raw.customLocation) {
    result.customLocation = {
      label: raw.customLocation.label ?? undefined,
    };
  }

  return result;
}

/** Parse out-of-office properties */
export function parseOutOfOffice(
  raw: calendar_v3.Schema$EventOutOfOfficeProperties
): OutOfOfficeProperties {
  return {
    autoDeclineMode: raw.autoDeclineMode as OutOfOfficeProperties['autoDeclineMode'] ?? undefined,
    declineMessage: raw.declineMessage ?? undefined,
  };
}

/** Parse focus time properties */
export function parseFocusTime(
  raw: calendar_v3.Schema$EventFocusTimeProperties
): FocusTimeProperties {
  return {
    autoDeclineMode: raw.autoDeclineMode as FocusTimeProperties['autoDeclineMode'] ?? undefined,
    chatStatus: raw.chatStatus ?? undefined,
    declineMessage: raw.declineMessage ?? undefined,
  };
}

/** Parse birthday properties */
export function parseBirthday(
  raw: calendar_v3.Schema$EventBirthdayProperties
): BirthdayProperties {
  return {
    contact: raw.contact ?? undefined,
    type: raw.type as BirthdayProperties['type'] ?? undefined,
    customTypeName: raw.customTypeName ?? undefined,
  };
}

/** Parse an attendee */
export function parseAttendee(raw: calendar_v3.Schema$EventAttendee): Attendee {
  return {
    email: raw.email ?? '',
    displayName: raw.displayName ?? undefined,
    responseStatus: raw.responseStatus as Attendee['responseStatus'] ?? undefined,
    organizer: raw.organizer ?? undefined,
    self: raw.self ?? undefined,
  };
}

/** Parse a calendar list entry */
export function parseCalendar(raw: calendar_v3.Schema$CalendarListEntry): CalendarInfo {
  return {
    id: raw.id ?? '',
    summary: raw.summary ?? '',
    description: raw.description ?? undefined,
    primary: raw.primary ?? undefined,
    timeZone: raw.timeZone ?? undefined,
    backgroundColor: raw.backgroundColor ?? undefined,
  };
}

/** Build event request body from EventOptions */
export function buildEventBody(
  opts: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    timeZone?: string;
    location?: string;
    attendees?: string[];
    allDay?: boolean;
    eventType?: 'default' | 'outOfOffice' | 'workingLocation' | 'focusTime';
    outOfOffice?: OutOfOfficeProperties;
    workingLocation?: WorkingLocationProperties;
    focusTime?: FocusTimeProperties;
  }
): calendar_v3.Schema$Event {
  const event: calendar_v3.Schema$Event = {
    summary: opts.summary,
  };

  // Only include optional fields when explicitly provided (PATCH-safe)
  if (opts.description !== undefined) event.description = opts.description;
  if (opts.location !== undefined) event.location = opts.location;

  if (opts.allDay) {
    event.start = { date: opts.start };
    event.end = { date: opts.end };
  } else {
    event.start = { dateTime: opts.start, timeZone: opts.timeZone };
    event.end = { dateTime: opts.end, timeZone: opts.timeZone };
  }

  if (opts.attendees?.length) {
    event.attendees = opts.attendees.map((email) => ({ email }));
  }

  // Special event types
  if (opts.eventType && opts.eventType !== 'default') {
    event.eventType = opts.eventType;

    if (opts.eventType === 'outOfOffice' && opts.outOfOffice) {
      event.outOfOfficeProperties = {
        autoDeclineMode: opts.outOfOffice.autoDeclineMode ?? null,
        declineMessage: opts.outOfOffice.declineMessage ?? null,
      };
    }

    if (opts.eventType === 'focusTime' && opts.focusTime) {
      event.focusTimeProperties = {
        autoDeclineMode: opts.focusTime.autoDeclineMode ?? null,
        chatStatus: opts.focusTime.chatStatus ?? null,
        declineMessage: opts.focusTime.declineMessage ?? null,
      };
    }

    if (opts.eventType === 'workingLocation' && opts.workingLocation) {
      const wlProps: calendar_v3.Schema$EventWorkingLocationProperties = {
        type: opts.workingLocation.type,
      };

      if (opts.workingLocation.type === 'homeOffice') {
        wlProps.homeOffice = {};
      } else if (opts.workingLocation.type === 'officeLocation' && opts.workingLocation.officeLocation) {
        wlProps.officeLocation = {
          buildingId: opts.workingLocation.officeLocation.buildingId,
          deskId: opts.workingLocation.officeLocation.deskId,
          floorId: opts.workingLocation.officeLocation.floorId,
          floorSectionId: opts.workingLocation.officeLocation.floorSectionId,
          label: opts.workingLocation.officeLocation.label,
        };
      } else if (opts.workingLocation.type === 'customLocation' && opts.workingLocation.customLocation) {
        wlProps.customLocation = {
          label: opts.workingLocation.customLocation.label,
        };
      }

      event.workingLocationProperties = wlProps;
      // Working location events are visibility 'public' and show as 'free'
      event.visibility = 'public';
      event.transparency = 'transparent';
    }
  }

  return event;
}
