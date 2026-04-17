import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFlags, positional, main } from '../../src/bin/tasks.js';
import * as tasksModule from '../../src/tasks/index.js';
import { getAuth } from '../../src/auth.js';
import { setSafetyContext } from '../../src/safety.js';

vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn().mockResolvedValue('fake-auth') }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/tasks/index.js', () => ({
  listTaskLists: vi.fn().mockResolvedValue({ items: [] }),
  listTasks: vi.fn().mockResolvedValue({ items: [] }),
  getTask: vi.fn().mockResolvedValue({ id: 'task1', title: 'Buy milk' }),
  createTask: vi.fn().mockResolvedValue({ ok: true, id: 'task1' }),
  updateTask: vi.fn().mockResolvedValue({ ok: true, id: 'task1' }),
  completeTask: vi.fn().mockResolvedValue({ ok: true }),
  moveTask: vi.fn().mockResolvedValue({ ok: true }),
  deleteTask: vi.fn().mockResolvedValue({ ok: true }),
  createTaskList: vi.fn().mockResolvedValue({ ok: true, id: 'list1' }),
  deleteTaskList: vi.fn().mockResolvedValue({ ok: true }),
  clearCompleted: vi.fn().mockResolvedValue({ ok: true }),
}));

const ACC = 'user@example.com';

// ─── Utilities ─────────────────────────────────────────────

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--title=Buy milk', '--due=2026-04-30'])).toEqual({
      title: 'Buy milk', due: '2026-04-30',
    });
  });

  it('handles multiline flag values (s flag)', () => {
    const result = parseFlags(['--notes=line1\nline2']);
    expect(result.notes).toContain('line1');
  });

  it('sets bare flags to "true"', () => {
    expect(parseFlags(['--show-completed'])).toEqual({ 'show-completed': 'true' });
  });
});

describe('positional', () => {
  it('returns non-flag args only', () => {
    expect(positional(['list-id', 'task-id', '--confirm'])).toEqual(['list-id', 'task-id']);
  });
});

// ─── main() commands ───────────────────────────────────────

describe('main()', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); errSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('lists — lists all task lists', async () => {
    await main([ACC, 'lists']);
    expect(vi.mocked(tasksModule.listTaskLists)).toHaveBeenCalledWith('fake-auth');
  });

  it('tasks — lists tasks in a list', async () => {
    await main([ACC, 'tasks', 'list1', '--max=5', '--show-completed']);
    expect(vi.mocked(tasksModule.listTasks)).toHaveBeenCalledWith(
      'fake-auth', 'list1',
      expect.objectContaining({ maxResults: 5, showCompleted: true }),
    );
  });

  it('get — fetches single task', async () => {
    await main([ACC, 'get', 'list1', 'task1']);
    expect(vi.mocked(tasksModule.getTask)).toHaveBeenCalledWith('fake-auth', 'list1', 'task1');
  });

  it('add — creates task with parsed flags', async () => {
    await main([ACC, 'add', 'list1', '--title=Buy milk', '--due=2026-04-30']);
    expect(vi.mocked(tasksModule.createTask)).toHaveBeenCalledWith(
      'fake-auth', 'list1',
      expect.objectContaining({ title: 'Buy milk', due: '2026-04-30' }),
    );
  });

  it('add --parent — creates subtask', async () => {
    await main([ACC, 'add', 'list1', '--title=Sub', '--parent=task0']);
    expect(vi.mocked(tasksModule.createTask)).toHaveBeenCalledWith(
      'fake-auth', 'list1',
      expect.objectContaining({ parent: 'task0' }),
    );
  });

  it('update — updates task fields', async () => {
    await main([ACC, 'update', 'list1', 'task1', '--title=Updated', '--status=completed']);
    expect(vi.mocked(tasksModule.updateTask)).toHaveBeenCalledWith(
      'fake-auth', 'list1', 'task1',
      expect.objectContaining({ title: 'Updated', status: 'completed' }),
    );
  });

  it('complete — marks task complete', async () => {
    await main([ACC, 'complete', 'list1', 'task1']);
    expect(vi.mocked(tasksModule.completeTask)).toHaveBeenCalledWith('fake-auth', 'list1', 'task1');
  });

  it('move — moves task with optional parent/previous', async () => {
    await main([ACC, 'move', 'list1', 'task1', '--parent=task0', '--previous=task-prev']);
    expect(vi.mocked(tasksModule.moveTask)).toHaveBeenCalledWith(
      'fake-auth', 'list1', 'task1',
      expect.objectContaining({ parent: 'task0', previous: 'task-prev' }),
    );
  });

  it('delete --confirm — deletes task', async () => {
    await main([ACC, 'delete', 'list1', 'task1', '--confirm']);
    expect(vi.mocked(tasksModule.deleteTask)).toHaveBeenCalledWith('fake-auth', 'list1', 'task1');
  });

  it('create-list — creates a new task list', async () => {
    await main([ACC, 'create-list', '--title=Shopping']);
    expect(vi.mocked(tasksModule.createTaskList)).toHaveBeenCalledWith('fake-auth', 'Shopping');
  });

  it('delete-list --confirm — deletes a task list', async () => {
    await main([ACC, 'delete-list', 'list1', '--confirm']);
    expect(vi.mocked(tasksModule.deleteTaskList)).toHaveBeenCalledWith('fake-auth', 'list1');
  });

  it('clear --confirm — clears completed tasks', async () => {
    await main([ACC, 'clear', 'list1', '--confirm']);
    expect(vi.mocked(tasksModule.clearCompleted)).toHaveBeenCalledWith('fake-auth', 'list1');
  });

  it('unknown command — exits with usage', async () => {
    await expect(main([ACC, 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('safety context — blocks without --confirm', async () => {
    await main([ACC, 'delete', 'list1', 'task1']);
    logSpy.mockClear();
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    await expect(
      ctx.confirm({ name: 'tasks.delete', description: 'Delete task', details: {} }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(JSON.parse(logSpy.mock.calls[0][0]).blocked).toBe(true);
  });

  it('safety context — allows with --confirm', async () => {
    await main([ACC, 'delete', 'list1', 'task1', '--confirm']);
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    expect(await ctx.confirm({ name: 'op', description: 'op', details: {} })).toBe(true);
  });

  it('outputs error JSON and exits 1 when getAuth fails', async () => {
    vi.mocked(getAuth).mockRejectedValueOnce(
      Object.assign(new Error('no account'), { code: 'AUTH_NO_ACCOUNT' }),
    );
    await expect(main([ACC, 'lists'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it('outputs error JSON and exits 1 when service throws', async () => {
    vi.mocked(tasksModule.listTaskLists).mockRejectedValueOnce(
      Object.assign(new Error('fail'), { code: 'QUOTA_EXCEEDED' }),
    );
    await expect(main([ACC, 'lists'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
