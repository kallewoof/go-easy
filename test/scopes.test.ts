import { describe, it, expect } from 'vitest';
import { SCOPES, ALL_SCOPES, scopeToService, servicesToScopes } from '../src/scopes.js';

describe('SCOPES', () => {
  it('has entries for gmail, drive, calendar', () => {
    expect(SCOPES.gmail).toBe('https://mail.google.com/');
    expect(SCOPES.drive).toBe('https://www.googleapis.com/auth/drive');
    expect(SCOPES.calendar).toBe('https://www.googleapis.com/auth/calendar');
  });
});

describe('ALL_SCOPES', () => {
  it('contains all scope URLs', () => {
    expect(ALL_SCOPES).toHaveLength(5);
    expect(ALL_SCOPES).toContain('https://mail.google.com/');
    expect(ALL_SCOPES).toContain('https://www.googleapis.com/auth/drive');
    expect(ALL_SCOPES).toContain('https://www.googleapis.com/auth/calendar');
    expect(ALL_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets');
  });
});

describe('scopeToService', () => {
  it('maps scope URLs back to service names', () => {
    expect(scopeToService('https://mail.google.com/')).toBe('gmail');
    expect(scopeToService('https://www.googleapis.com/auth/drive')).toBe('drive');
    expect(scopeToService('https://www.googleapis.com/auth/calendar')).toBe('calendar');
  });

  it('returns undefined for unknown scopes', () => {
    expect(scopeToService('https://www.googleapis.com/auth/tasks')).toBe('tasks');
    expect(scopeToService('https://www.googleapis.com/auth/unknown')).toBeUndefined();
  });
});

describe('servicesToScopes', () => {
  it('maps service names to scope URLs', () => {
    expect(servicesToScopes(['gmail', 'drive'])).toEqual([
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/drive',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(servicesToScopes([])).toEqual([]);
  });
});
