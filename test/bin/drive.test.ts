import { describe, it, expect, vi } from 'vitest';
import { parseFlags, positional } from '../../src/bin/drive.js';

vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/drive/index.js', () => ({}));

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--folder=abc123', '--name=file.pdf'])).toEqual({
      folder: 'abc123',
      name: 'file.pdf',
    });
  });

  it('sets bare flags to "true"', () => {
    expect(parseFlags(['--confirm'])).toEqual({ confirm: 'true' });
  });
});

describe('positional', () => {
  it('returns non-flag args only', () => {
    expect(positional(['file-id', 'dest/path', '--confirm'])).toEqual(['file-id', 'dest/path']);
  });

  it('returns empty array when all args are flags', () => {
    expect(positional(['--confirm', '--max=10'])).toEqual([]);
  });
});
