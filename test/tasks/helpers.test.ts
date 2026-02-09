import { describe, it, expect } from 'vitest';
import { parseTaskList, parseTask } from '../../src/tasks/helpers.js';

describe('parseTaskList', () => {
  it('parses a raw task list', () => {
    const result = parseTaskList({
      id: 'list-1',
      title: 'My Tasks',
      updated: '2026-02-09T10:00:00Z',
    });
    expect(result).toEqual({
      id: 'list-1',
      title: 'My Tasks',
      updated: '2026-02-09T10:00:00Z',
    });
  });

  it('handles missing fields', () => {
    const result = parseTaskList({});
    expect(result.id).toBe('');
    expect(result.title).toBe('');
    expect(result.updated).toBeUndefined();
  });
});

describe('parseTask', () => {
  it('parses a full task', () => {
    const result = parseTask({
      id: 'task-1',
      title: 'Buy milk',
      notes: 'Whole milk',
      status: 'needsAction',
      due: '2026-02-14T00:00:00.000Z',
      parent: 'parent-1',
      position: '00000001',
      hidden: false,
      deleted: false,
      updated: '2026-02-09T10:00:00Z',
    });
    expect(result.id).toBe('task-1');
    expect(result.title).toBe('Buy milk');
    expect(result.notes).toBe('Whole milk');
    expect(result.status).toBe('needsAction');
    expect(result.due).toBe('2026-02-14T00:00:00.000Z');
    expect(result.parent).toBe('parent-1');
  });

  it('parses a completed task', () => {
    const result = parseTask({
      id: 'task-2',
      title: 'Done task',
      status: 'completed',
      completed: '2026-02-09T12:00:00Z',
    });
    expect(result.status).toBe('completed');
    expect(result.completed).toBe('2026-02-09T12:00:00Z');
  });

  it('handles missing fields', () => {
    const result = parseTask({});
    expect(result.id).toBe('');
    expect(result.title).toBe('');
    expect(result.status).toBe('needsAction');
    expect(result.notes).toBeUndefined();
    expect(result.due).toBeUndefined();
  });

  it('parses links', () => {
    const result = parseTask({
      id: 'task-3',
      title: 'With links',
      links: [
        { type: 'email', description: 'Related email', link: 'https://mail.google.com/...' },
      ],
    });
    expect(result.links).toHaveLength(1);
    expect(result.links![0].type).toBe('email');
  });
});
