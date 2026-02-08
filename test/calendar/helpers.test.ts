import { describe, it, expect } from 'vitest';
import {
  parseEvent,
  parseAttendee,
  parseCalendar,
  buildEventBody,
  parseWorkingLocation,
  parseOutOfOffice,
  parseFocusTime,
  parseBirthday,
} from '../../src/calendar/helpers.js';

describe('parseEvent', () => {
  it('parses a timed event', () => {
    const event = parseEvent({
      id: 'evt-1',
      summary: 'Team Meeting',
      description: 'Weekly sync',
      start: { dateTime: '2026-02-10T10:00:00+01:00', timeZone: 'Europe/Madrid' },
      end: { dateTime: '2026-02-10T11:00:00+01:00', timeZone: 'Europe/Madrid' },
      location: 'Office',
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/...',
      organizer: { email: 'org@example.com', displayName: 'Organizer' },
      creator: { email: 'creator@example.com' },
      attendees: [
        { email: 'a@example.com', responseStatus: 'accepted' },
      ],
    });

    expect(event.id).toBe('evt-1');
    expect(event.summary).toBe('Team Meeting');
    expect(event.description).toBe('Weekly sync');
    expect(event.start).toBe('2026-02-10T10:00:00+01:00');
    expect(event.end).toBe('2026-02-10T11:00:00+01:00');
    expect(event.timeZone).toBe('Europe/Madrid');
    expect(event.location).toBe('Office');
    expect(event.allDay).toBe(false);
    expect(event.status).toBe('confirmed');
    expect(event.organizer?.email).toBe('org@example.com');
    expect(event.attendees).toHaveLength(1);
  });

  it('parses an all-day event', () => {
    const event = parseEvent({
      id: 'evt-2',
      summary: 'Holiday',
      start: { date: '2026-02-14' },
      end: { date: '2026-02-15' },
    });

    expect(event.start).toBe('2026-02-14');
    expect(event.end).toBe('2026-02-15');
    expect(event.allDay).toBe(true);
  });

  it('handles missing fields', () => {
    const event = parseEvent({});
    expect(event.id).toBe('');
    expect(event.summary).toBe('(no title)');
    expect(event.start).toBe('');
    expect(event.allDay).toBe(false);
    expect(event.attendees).toBeUndefined();
    expect(event.eventType).toBe('default');
  });

  it('parses a working location event (home office)', () => {
    const event = parseEvent({
      id: 'wl-1',
      summary: 'Working from home',
      eventType: 'workingLocation',
      start: { date: '2026-02-10' },
      end: { date: '2026-02-11' },
      workingLocationProperties: {
        type: 'homeOffice',
        homeOffice: {},
      },
    });

    expect(event.eventType).toBe('workingLocation');
    expect(event.workingLocation).toBeDefined();
    expect(event.workingLocation!.type).toBe('homeOffice');
    expect(event.workingLocation!.homeOffice).toBe(true);
  });

  it('parses a working location event (office)', () => {
    const event = parseEvent({
      id: 'wl-2',
      summary: 'Office — Barcelona',
      eventType: 'workingLocation',
      start: { date: '2026-02-10' },
      end: { date: '2026-02-11' },
      workingLocationProperties: {
        type: 'officeLocation',
        officeLocation: {
          buildingId: 'BCN-1',
          floorId: '3',
          label: 'Barcelona Office',
        },
      },
    });

    expect(event.workingLocation!.type).toBe('officeLocation');
    expect(event.workingLocation!.officeLocation!.label).toBe('Barcelona Office');
    expect(event.workingLocation!.officeLocation!.buildingId).toBe('BCN-1');
    expect(event.workingLocation!.officeLocation!.floorId).toBe('3');
  });

  it('parses a working location event (custom)', () => {
    const event = parseEvent({
      id: 'wl-3',
      summary: 'Coworking space',
      eventType: 'workingLocation',
      start: { date: '2026-02-10' },
      end: { date: '2026-02-11' },
      workingLocationProperties: {
        type: 'customLocation',
        customLocation: { label: 'WeWork Diagonal' },
      },
    });

    expect(event.workingLocation!.type).toBe('customLocation');
    expect(event.workingLocation!.customLocation!.label).toBe('WeWork Diagonal');
  });

  it('parses an out-of-office event', () => {
    const event = parseEvent({
      id: 'ooo-1',
      summary: 'Vacation',
      eventType: 'outOfOffice',
      start: { dateTime: '2026-02-14T00:00:00Z' },
      end: { dateTime: '2026-02-21T00:00:00Z' },
      outOfOfficeProperties: {
        autoDeclineMode: 'declineAllConflictingInvitations',
        declineMessage: 'On vacation, back Feb 21',
      },
    });

    expect(event.eventType).toBe('outOfOffice');
    expect(event.outOfOffice).toBeDefined();
    expect(event.outOfOffice!.autoDeclineMode).toBe('declineAllConflictingInvitations');
    expect(event.outOfOffice!.declineMessage).toBe('On vacation, back Feb 21');
  });

  it('parses a focus time event', () => {
    const event = parseEvent({
      id: 'ft-1',
      summary: 'Focus Time',
      eventType: 'focusTime',
      start: { dateTime: '2026-02-10T09:00:00+01:00' },
      end: { dateTime: '2026-02-10T12:00:00+01:00' },
      focusTimeProperties: {
        autoDeclineMode: 'declineOnlyNewConflictingInvitations',
        chatStatus: 'doNotDisturb',
        declineMessage: 'In focus mode',
      },
    });

    expect(event.eventType).toBe('focusTime');
    expect(event.focusTime).toBeDefined();
    expect(event.focusTime!.chatStatus).toBe('doNotDisturb');
    expect(event.focusTime!.autoDeclineMode).toBe('declineOnlyNewConflictingInvitations');
  });

  it('parses a birthday event', () => {
    const event = parseEvent({
      id: 'bday-1',
      summary: "Alice's Birthday",
      eventType: 'birthday',
      start: { date: '2026-03-15' },
      end: { date: '2026-03-16' },
      birthdayProperties: {
        contact: 'people/c12345',
        type: 'birthday',
      },
    });

    expect(event.eventType).toBe('birthday');
    expect(event.birthday).toBeDefined();
    expect(event.birthday!.contact).toBe('people/c12345');
    expect(event.birthday!.type).toBe('birthday');
  });

  it('regular events have eventType default', () => {
    const event = parseEvent({
      id: 'evt-3',
      summary: 'Meeting',
      start: { dateTime: '2026-02-10T10:00:00Z' },
      end: { dateTime: '2026-02-10T11:00:00Z' },
    });

    expect(event.eventType).toBe('default');
    expect(event.workingLocation).toBeUndefined();
    expect(event.outOfOffice).toBeUndefined();
    expect(event.focusTime).toBeUndefined();
    expect(event.birthday).toBeUndefined();
  });
});

describe('parseAttendee', () => {
  it('parses attendee', () => {
    const att = parseAttendee({
      email: 'user@example.com',
      displayName: 'User',
      responseStatus: 'accepted',
      organizer: true,
      self: false,
    });

    expect(att.email).toBe('user@example.com');
    expect(att.displayName).toBe('User');
    expect(att.responseStatus).toBe('accepted');
    expect(att.organizer).toBe(true);
    expect(att.self).toBe(false);
  });

  it('handles missing fields', () => {
    const att = parseAttendee({});
    expect(att.email).toBe('');
    expect(att.displayName).toBeUndefined();
  });
});

describe('parseCalendar', () => {
  it('parses calendar info', () => {
    const cal = parseCalendar({
      id: 'cal-1',
      summary: 'My Calendar',
      description: 'Personal',
      primary: true,
      timeZone: 'Europe/Madrid',
      backgroundColor: '#4285f4',
    });

    expect(cal.id).toBe('cal-1');
    expect(cal.summary).toBe('My Calendar');
    expect(cal.primary).toBe(true);
    expect(cal.timeZone).toBe('Europe/Madrid');
  });
});

describe('buildEventBody', () => {
  it('builds timed event body', () => {
    const body = buildEventBody({
      summary: 'Meeting',
      description: 'Discuss project',
      start: '2026-02-10T10:00:00+01:00',
      end: '2026-02-10T11:00:00+01:00',
      timeZone: 'Europe/Madrid',
      location: 'Office',
      attendees: ['a@example.com', 'b@example.com'],
    });

    expect(body.summary).toBe('Meeting');
    expect(body.description).toBe('Discuss project');
    expect(body.start?.dateTime).toBe('2026-02-10T10:00:00+01:00');
    expect(body.start?.timeZone).toBe('Europe/Madrid');
    expect(body.end?.dateTime).toBe('2026-02-10T11:00:00+01:00');
    expect(body.location).toBe('Office');
    expect(body.attendees).toHaveLength(2);
    expect(body.attendees![0].email).toBe('a@example.com');
  });

  it('builds all-day event body', () => {
    const body = buildEventBody({
      summary: 'Holiday',
      start: '2026-02-14',
      end: '2026-02-15',
      allDay: true,
    });

    expect(body.start?.date).toBe('2026-02-14');
    expect(body.start?.dateTime).toBeUndefined();
    expect(body.end?.date).toBe('2026-02-15');
  });

  it('omits attendees when empty', () => {
    const body = buildEventBody({
      summary: 'Solo',
      start: '2026-02-10T10:00:00Z',
      end: '2026-02-10T11:00:00Z',
    });

    expect(body.attendees).toBeUndefined();
  });

  it('builds out-of-office event body', () => {
    const body = buildEventBody({
      summary: 'Vacation',
      start: '2026-02-14T00:00:00Z',
      end: '2026-02-21T00:00:00Z',
      eventType: 'outOfOffice',
      outOfOffice: {
        autoDeclineMode: 'declineAllConflictingInvitations',
        declineMessage: 'On vacation',
      },
    });

    expect(body.eventType).toBe('outOfOffice');
    expect(body.outOfOfficeProperties).toBeDefined();
    expect(body.outOfOfficeProperties!.autoDeclineMode).toBe('declineAllConflictingInvitations');
    expect(body.outOfOfficeProperties!.declineMessage).toBe('On vacation');
  });

  it('builds working location event (home office)', () => {
    const body = buildEventBody({
      summary: 'Home',
      start: '2026-02-10',
      end: '2026-02-11',
      allDay: true,
      eventType: 'workingLocation',
      workingLocation: { type: 'homeOffice', homeOffice: true },
    });

    expect(body.eventType).toBe('workingLocation');
    expect(body.workingLocationProperties).toBeDefined();
    expect(body.workingLocationProperties!.type).toBe('homeOffice');
    expect(body.workingLocationProperties!.homeOffice).toEqual({});
    expect(body.visibility).toBe('public');
    expect(body.transparency).toBe('transparent');
  });

  it('builds working location event (office)', () => {
    const body = buildEventBody({
      summary: 'Barcelona Office',
      start: '2026-02-10',
      end: '2026-02-11',
      allDay: true,
      eventType: 'workingLocation',
      workingLocation: {
        type: 'officeLocation',
        officeLocation: { label: 'Barcelona Office', buildingId: 'BCN-1' },
      },
    });

    expect(body.workingLocationProperties!.type).toBe('officeLocation');
    expect(body.workingLocationProperties!.officeLocation!.label).toBe('Barcelona Office');
    expect(body.workingLocationProperties!.officeLocation!.buildingId).toBe('BCN-1');
  });

  it('builds working location event (custom)', () => {
    const body = buildEventBody({
      summary: 'Coworking',
      start: '2026-02-10',
      end: '2026-02-11',
      allDay: true,
      eventType: 'workingLocation',
      workingLocation: {
        type: 'customLocation',
        customLocation: { label: 'WeWork Diagonal' },
      },
    });

    expect(body.workingLocationProperties!.type).toBe('customLocation');
    expect(body.workingLocationProperties!.customLocation!.label).toBe('WeWork Diagonal');
  });

  it('builds focus time event body', () => {
    const body = buildEventBody({
      summary: 'Focus Time',
      start: '2026-02-10T09:00:00+01:00',
      end: '2026-02-10T12:00:00+01:00',
      eventType: 'focusTime',
      focusTime: {
        autoDeclineMode: 'declineOnlyNewConflictingInvitations',
        chatStatus: 'doNotDisturb',
        declineMessage: 'In focus mode',
      },
    });

    expect(body.eventType).toBe('focusTime');
    expect(body.focusTimeProperties).toBeDefined();
    expect(body.focusTimeProperties!.chatStatus).toBe('doNotDisturb');
    expect(body.focusTimeProperties!.autoDeclineMode).toBe('declineOnlyNewConflictingInvitations');
  });

  it('does not set eventType for default events', () => {
    const body = buildEventBody({
      summary: 'Meeting',
      start: '2026-02-10T10:00:00Z',
      end: '2026-02-10T11:00:00Z',
    });

    expect(body.eventType).toBeUndefined();
  });
});
