import { describe, it, expect, vi } from 'vitest';
import { handleRawOutput, positional } from '../../src/bin/gmail.js';

vi.mock('node:fs', () => ({ writeFileSync: vi.fn() }));
vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/gmail/index.js', () => ({}));
vi.mock('../../src/bin/gmail-flags.js', () => ({
  parseFlags: vi.fn(),
  readBodyFlags: vi.fn(),
}));

describe('positional', () => {
  it('filters out flag arguments', () => {
    expect(positional(['msg-id', '--format=eml', '--b64encode'])).toEqual(['msg-id']);
  });

  it('returns all args when none are flags', () => {
    expect(positional(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('handleRawOutput', () => {
  const buf = Buffer.from('raw content');

  it('writes to file and returns a result object when --output is set', async () => {
    const { writeFileSync } = await import('node:fs');
    const result = handleRawOutput(buf, 'eml', { output: '/tmp/out.eml' });
    expect(result).toMatchObject({ ok: true, format: 'eml', path: '/tmp/out.eml', bytes: buf.length });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith('/tmp/out.eml', buf);
  });

  it('returns base64 result when --b64encode is set', () => {
    const result = handleRawOutput(buf, 'eml', { b64encode: 'true' });
    expect(result).toMatchObject({
      format: 'eml',
      data: buf.toString('base64'),
      bytes: buf.length,
    });
  });

  it('writes raw bytes to stdout and returns undefined when neither flag is set', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = handleRawOutput(buf, 'eml', {});
    expect(result).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledWith(buf);
    writeSpy.mockRestore();
  });
});
