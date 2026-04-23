import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFlags, positional, main } from '../../src/bin/sheets.js';
import * as sheetsModule from '../../src/sheets/index.js';
import { setSafetyContext } from '../../src/safety.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn().mockResolvedValue('[[\"a\",\"b\"]]') }));
vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn().mockResolvedValue('fake-auth') }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/sheets/index.js', () => ({
  listSheets: vi.fn().mockResolvedValue([]),
  getValues: vi.fn().mockResolvedValue([['a', 'b'], ['c', 'd']]),
  updateValues: vi.fn().mockResolvedValue({ ok: true, updatedCells: 2 }),
  clearValues: vi.fn().mockResolvedValue({ ok: true, updatedRange: 'Sheet1!A1:B1' }),
}));

const ACC = 'user@example.com';
const SHEET_ID = 'spreadsheet-abc';

// ─── Utilities ─────────────────────────────────────────────

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--values-file=./data.json', '--render=FORMULA']))
      .toEqual({ 'values-file': './data.json', render: 'FORMULA' });
  });

  it('sets bare flags to "true"', () => {
    expect(parseFlags(['--confirm'])).toEqual({ confirm: 'true' });
  });
});

describe('positional', () => {
  it('returns non-flag args only', () => {
    expect(positional([SHEET_ID, 'Sheet1!A1:Z', '--render=FORMULA']))
      .toEqual([SHEET_ID, 'Sheet1!A1:Z']);
  });

  it('returns empty array when all args are flags', () => {
    expect(positional(['--confirm', '--render=FORMULA'])).toEqual([]);
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

  it('tabs — calls listSheets with spreadsheetId', async () => {
    await main([ACC, 'tabs', SHEET_ID]);
    expect(vi.mocked(sheetsModule.listSheets)).toHaveBeenCalledWith('fake-auth', SHEET_ID);
  });

  it('read — calls getValues with default render option', async () => {
    await main([ACC, 'read', SHEET_ID, 'Sheet1!A1:Z']);
    expect(vi.mocked(sheetsModule.getValues)).toHaveBeenCalledWith(
      'fake-auth', SHEET_ID, 'Sheet1!A1:Z',
      expect.objectContaining({ valueRenderOption: 'FORMATTED_VALUE' }),
    );
  });

  it('read --render=UNFORMATTED_VALUE — passes render option', async () => {
    await main([ACC, 'read', SHEET_ID, 'Sheet1', '--render=UNFORMATTED_VALUE']);
    expect(vi.mocked(sheetsModule.getValues)).toHaveBeenCalledWith(
      'fake-auth', SHEET_ID, 'Sheet1',
      expect.objectContaining({ valueRenderOption: 'UNFORMATTED_VALUE' }),
    );
  });

  it('write — reads values file and calls updateValues', async () => {
    const { readFile } = await import('node:fs/promises');
    await main([ACC, 'write', SHEET_ID, 'Sheet1!A1', '--values-file=./data.json']);
    expect(vi.mocked(readFile)).toHaveBeenCalledWith('./data.json', 'utf-8');
    expect(vi.mocked(sheetsModule.updateValues)).toHaveBeenCalledWith(
      'fake-auth', SHEET_ID, 'Sheet1!A1', [['a', 'b']], expect.anything(),
    );
  });

  it('write missing --values-file — exits with usage', async () => {
    await expect(main([ACC, 'write', SHEET_ID, 'Sheet1!A1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('clear — calls clearValues', async () => {
    await main([ACC, 'clear', SHEET_ID, 'Sheet1!A1:Z']);
    expect(vi.mocked(sheetsModule.clearValues)).toHaveBeenCalledWith('fake-auth', SHEET_ID, 'Sheet1!A1:Z');
  });

  it('unknown command — exits with usage', async () => {
    await expect(main([ACC, 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('outputs JSON result to stdout', async () => {
    await main([ACC, 'tabs', SHEET_ID]);
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(Array.isArray(out)).toBe(true);
  });

  it('service throws GoEasyError — outputs error JSON to stderr and exits 1', async () => {
    vi.mocked(sheetsModule.listSheets).mockRejectedValueOnce(
      Object.assign(new Error('fail'), { code: 'SHEETS_ERROR', toJSON: () => ({ error: 'SHEETS_ERROR', message: 'fail' }) }),
    );
    await expect(main([ACC, 'tabs', SHEET_ID])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it('safety context — blocks without --confirm', async () => {
    await main([ACC, 'tabs', SHEET_ID]);
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    await expect(
      ctx.confirm({ name: 'op', description: 'op', details: {} }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(JSON.parse(logSpy.mock.calls[1][0]).blocked).toBe(true);
  });

  it('safety context — allows with --confirm', async () => {
    await main([ACC, 'tabs', SHEET_ID, '--confirm']);
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    expect(await ctx.confirm({ name: 'op', description: 'op', details: {} })).toBe(true);
  });
});
