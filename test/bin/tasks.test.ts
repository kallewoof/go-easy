import { describe, it, expect, vi } from 'vitest';
import { parseFlags, positional } from '../../src/bin/tasks.js';

vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/tasks/index.js', () => ({}));

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--title=Buy milk', '--due=2026-04-30'])).toEqual({
      title: 'Buy milk',
      due: '2026-04-30',
    });
  });

  it('handles multiline flag values (s flag)', () => {
    // The tasks parseFlags uses /s flag allowing newlines in values
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
