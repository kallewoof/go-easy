import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────

const mockTasklistsList = vi.fn();
const mockTasklistsInsert = vi.fn();
const mockTasklistsGet = vi.fn();
const mockTasklistsDelete = vi.fn();
const mockTasksList = vi.fn();
const mockTasksGet = vi.fn();
const mockTasksInsert = vi.fn();
const mockTasksPatch = vi.fn();
const mockTasksMove = vi.fn();
const mockTasksDelete = vi.fn();
const mockTasksClear = vi.fn();

vi.mock('@googleapis/tasks', () => ({
  tasks: () => ({
    tasklists: {
      list: (args: unknown) => mockTasklistsList(args),
      insert: (args: unknown) => mockTasklistsInsert(args),
      get: (args: unknown) => mockTasklistsGet(args),
      delete: (args: unknown) => mockTasklistsDelete(args),
    },
    tasks: {
      list: (args: unknown) => mockTasksList(args),
      get: (args: unknown) => mockTasksGet(args),
      insert: (args: unknown) => mockTasksInsert(args),
      patch: (args: unknown) => mockTasksPatch(args),
      move: (args: unknown) => mockTasksMove(args),
      delete: (args: unknown) => mockTasksDelete(args),
      clear: (args: unknown) => mockTasksClear(args),
    },
  }),
}));

vi.mock('../../src/safety.js', () => ({
  guardOperation: vi.fn(async () => {}),
}));

// ─── Import after mocks ────────────────────────────────────

import {
  listTaskLists,
  createTaskList,
  deleteTaskList,
  listTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
  moveTask,
  deleteTask,
  clearCompleted,
} from '../../src/tasks/index.js';

const fakeAuth = {} as any;

// ─── Tests ─────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe('listTaskLists', () => {
  it('returns parsed task lists', async () => {
    mockTasklistsList.mockResolvedValue({
      data: {
        items: [
          { id: 'list-1', title: 'My Tasks', updated: '2026-02-09T10:00:00Z' },
          { id: 'list-2', title: 'Work', updated: '2026-02-09T11:00:00Z' },
        ],
      },
    });

    const result = await listTaskLists(fakeAuth);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('My Tasks');
    expect(result[1].title).toBe('Work');
  });
});

describe('createTaskList', () => {
  it('creates a task list', async () => {
    mockTasklistsInsert.mockResolvedValue({
      data: { id: 'new-list', title: 'Shopping' },
    });

    const result = await createTaskList(fakeAuth, 'Shopping');
    expect(result).toEqual({ ok: true, id: 'new-list' });
  });
});

describe('listTasks', () => {
  it('lists tasks with defaults', async () => {
    mockTasksList.mockResolvedValue({
      data: {
        items: [
          { id: 't-1', title: 'Buy milk', status: 'needsAction' },
          { id: 't-2', title: 'Done item', status: 'completed', completed: '2026-02-09T12:00:00Z' },
        ],
        nextPageToken: 'next-abc',
      },
    });

    const result = await listTasks(fakeAuth, 'list-1');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe('Buy milk');
    expect(result.items[1].status).toBe('completed');
    expect(result.nextPageToken).toBe('next-abc');
  });

  it('passes options to API', async () => {
    mockTasksList.mockResolvedValue({ data: { items: [] } });

    await listTasks(fakeAuth, 'list-1', {
      maxResults: 50,
      pageToken: 'token-123',
      showCompleted: false,
    });

    expect(mockTasksList).toHaveBeenCalledWith(expect.objectContaining({
      tasklist: 'list-1',
      maxResults: 50,
      pageToken: 'token-123',
      showCompleted: false,
    }));
  });
});

describe('getTask', () => {
  it('returns a parsed task', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 't-1', title: 'Buy milk', status: 'needsAction', notes: 'Whole' },
    });

    const result = await getTask(fakeAuth, 'list-1', 't-1');
    expect(result.id).toBe('t-1');
    expect(result.title).toBe('Buy milk');
    expect(result.notes).toBe('Whole');
  });
});

describe('createTask', () => {
  it('creates a task with title', async () => {
    mockTasksInsert.mockResolvedValue({ data: { id: 'new-task' } });

    const result = await createTask(fakeAuth, 'list-1', { title: 'New task' });
    expect(result).toEqual({ ok: true, id: 'new-task' });
  });

  it('normalizes date-only due to datetime', async () => {
    mockTasksInsert.mockResolvedValue({ data: { id: 'new-task' } });

    await createTask(fakeAuth, 'list-1', { title: 'Task', due: '2026-02-14' });

    expect(mockTasksInsert).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({
        due: '2026-02-14T00:00:00.000Z',
      }),
    }));
  });
});

describe('updateTask', () => {
  it('patches only provided fields', async () => {
    mockTasksPatch.mockResolvedValue({ data: { id: 't-1' } });

    await updateTask(fakeAuth, 'list-1', 't-1', { title: 'Updated' });

    expect(mockTasksPatch).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { title: 'Updated' },
    }));
  });
});

describe('completeTask', () => {
  it('sets status to completed', async () => {
    mockTasksPatch.mockResolvedValue({ data: { id: 't-1' } });

    await completeTask(fakeAuth, 'list-1', 't-1');

    expect(mockTasksPatch).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { status: 'completed' },
    }));
  });
});

describe('moveTask', () => {
  it('moves a task', async () => {
    mockTasksMove.mockResolvedValue({ data: { id: 't-1' } });

    const result = await moveTask(fakeAuth, 'list-1', 't-1', { parent: 'parent-1' });
    expect(result).toEqual({ ok: true, id: 't-1' });
  });
});

describe('deleteTask', () => {
  it('deletes after safety check', async () => {
    mockTasksGet.mockResolvedValue({ data: { id: 't-1', title: 'Old task' } });
    mockTasksDelete.mockResolvedValue({});

    const result = await deleteTask(fakeAuth, 'list-1', 't-1');
    expect(result).toEqual({ ok: true, id: 't-1' });
  });
});

describe('clearCompleted', () => {
  it('clears completed tasks', async () => {
    mockTasksClear.mockResolvedValue({});

    const result = await clearCompleted(fakeAuth, 'list-1');
    expect(result).toEqual({ ok: true, id: 'list-1' });
  });
});
