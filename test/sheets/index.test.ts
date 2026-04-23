import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { NotFoundError, QuotaError, GoEasyError } from '../../src/errors.js';

// ─── Sheets API Mock ───────────────────────────────────────

const mockSpreadsheetsGet = vi.fn();
const mockValuesGet = vi.fn();
const mockValuesUpdate = vi.fn();
const mockValuesClear = vi.fn();

vi.mock('@googleapis/sheets', () => ({
  sheets: () => ({
    spreadsheets: {
      get: (args: unknown) => mockSpreadsheetsGet(args),
      values: {
        get: (args: unknown) => mockValuesGet(args),
        update: (args: unknown) => mockValuesUpdate(args),
        clear: (args: unknown) => mockValuesClear(args),
      },
    },
  }),
}));

import { listSheets, getValues, updateValues, clearValues } from '../../src/sheets/index.js';

const fakeAuth = {} as OAuth2Client;

// ─── listSheets ────────────────────────────────────────────

describe('listSheets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed SheetTab array', async () => {
    mockSpreadsheetsGet.mockResolvedValue({
      data: {
        sheets: [
          { properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 26 } } },
          { properties: { sheetId: 1, title: 'Data', index: 1, sheetType: 'GRID', gridProperties: { rowCount: 500, columnCount: 10 } } },
        ],
      },
    });

    const tabs = await listSheets(fakeAuth, 'spreadsheet-1');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].title).toBe('Sheet1');
    expect(tabs[1].title).toBe('Data');
    expect(tabs[1].sheetId).toBe(1);
  });

  it('returns empty array when no sheets', async () => {
    mockSpreadsheetsGet.mockResolvedValue({ data: {} });
    const tabs = await listSheets(fakeAuth, 'spreadsheet-1');
    expect(tabs).toEqual([]);
  });

  it('requests only sheets.properties field', async () => {
    mockSpreadsheetsGet.mockResolvedValue({ data: { sheets: [] } });
    await listSheets(fakeAuth, 'spreadsheet-1');
    expect(mockSpreadsheetsGet).toHaveBeenCalledWith(
      expect.objectContaining({ fields: 'sheets.properties' })
    );
  });

  it('throws NotFoundError for 404', async () => {
    mockSpreadsheetsGet.mockRejectedValue({ code: 404 });
    await expect(listSheets(fakeAuth, 'bad-id')).rejects.toThrow(NotFoundError);
  });

  it('throws QuotaError for 429', async () => {
    mockSpreadsheetsGet.mockRejectedValue({ code: 429 });
    await expect(listSheets(fakeAuth, 'spreadsheet-1')).rejects.toThrow(QuotaError);
  });
});

// ─── getValues ─────────────────────────────────────────────

describe('getValues', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns string[][] from response', async () => {
    mockValuesGet.mockResolvedValue({
      data: { values: [['a', 'b'], ['c', 'd']] },
    });

    const values = await getValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1:B2');
    expect(values).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('returns empty array when no values in response', async () => {
    mockValuesGet.mockResolvedValue({ data: {} });
    const values = await getValues(fakeAuth, 'spreadsheet-1', 'Sheet1');
    expect(values).toEqual([]);
  });

  it('defaults to FORMATTED_VALUE and FORMATTED_STRING', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [] } });
    await getValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1:Z');
    expect(mockValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      })
    );
  });

  it('passes custom valueRenderOption', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [] } });
    await getValues(fakeAuth, 'spreadsheet-1', 'Sheet1', { valueRenderOption: 'UNFORMATTED_VALUE' });
    expect(mockValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({ valueRenderOption: 'UNFORMATTED_VALUE' })
    );
  });

  it('throws NotFoundError for 404', async () => {
    mockValuesGet.mockRejectedValue({ code: 404 });
    await expect(getValues(fakeAuth, 'bad-id', 'Sheet1')).rejects.toThrow(NotFoundError);
  });

  it('throws GoEasyError with SHEETS_ERROR for other errors', async () => {
    mockValuesGet.mockRejectedValue({ code: 403, message: 'Forbidden' });
    await expect(getValues(fakeAuth, 'spreadsheet-1', 'Sheet1')).rejects.toThrow(GoEasyError);
  });
});

// ─── updateValues ──────────────────────────────────────────

describe('updateValues', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns SheetWriteResult with counts', async () => {
    mockValuesUpdate.mockResolvedValue({
      data: { updatedRows: 2, updatedColumns: 3, updatedCells: 6, updatedRange: 'Sheet1!A1:C2' },
    });

    const result = await updateValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1:C2', [['a', 'b', 'c'], ['d', 'e', 'f']]);
    expect(result.ok).toBe(true);
    expect(result.updatedRows).toBe(2);
    expect(result.updatedCells).toBe(6);
    expect(result.updatedRange).toBe('Sheet1!A1:C2');
  });

  it('defaults to USER_ENTERED valueInputOption', async () => {
    mockValuesUpdate.mockResolvedValue({ data: {} });
    await updateValues(fakeAuth, 'spreadsheet-1', 'A1', [['=SUM(B1:B5)']]);
    expect(mockValuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ valueInputOption: 'USER_ENTERED' })
    );
  });

  it('passes values as requestBody.values', async () => {
    mockValuesUpdate.mockResolvedValue({ data: {} });
    const values = [['hello', 'world']];
    await updateValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1', values);
    expect(mockValuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { values } })
    );
  });

  it('passes RAW valueInputOption when specified', async () => {
    mockValuesUpdate.mockResolvedValue({ data: {} });
    await updateValues(fakeAuth, 'spreadsheet-1', 'A1', [['=formula']], { valueInputOption: 'RAW' });
    expect(mockValuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ valueInputOption: 'RAW' })
    );
  });

  it('throws QuotaError for 429', async () => {
    mockValuesUpdate.mockRejectedValue({ code: 429 });
    await expect(updateValues(fakeAuth, 'spreadsheet-1', 'A1', [[]])).rejects.toThrow(QuotaError);
  });
});

// ─── clearValues ───────────────────────────────────────────

describe('clearValues', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok with clearedRange from response', async () => {
    mockValuesClear.mockResolvedValue({
      data: { clearedRange: 'Sheet1!A1:B2' },
    });

    const result = await clearValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1:B2');
    expect(result.ok).toBe(true);
    expect(result.updatedRange).toBe('Sheet1!A1:B2');
  });

  it('falls back to input range when clearedRange missing', async () => {
    mockValuesClear.mockResolvedValue({ data: {} });
    const result = await clearValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1:Z');
    expect(result.updatedRange).toBe('Sheet1!A1:Z');
  });

  it('passes empty requestBody', async () => {
    mockValuesClear.mockResolvedValue({ data: {} });
    await clearValues(fakeAuth, 'spreadsheet-1', 'Sheet1!A1:Z');
    expect(mockValuesClear).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: {} })
    );
  });

  it('throws NotFoundError for 404', async () => {
    mockValuesClear.mockRejectedValue({ code: 404 });
    await expect(clearValues(fakeAuth, 'bad-id', 'Sheet1')).rejects.toThrow(NotFoundError);
  });
});
