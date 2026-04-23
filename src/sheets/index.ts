import { sheets } from '@googleapis/sheets';
import type { OAuth2Client } from 'google-auth-library';
import { GoEasyError, NotFoundError, QuotaError } from '../errors.js';
import { parseSheetTab } from './helpers.js';
import type { SheetTab, GetValuesOptions, UpdateValuesOptions, SheetWriteResult } from './types.js';

export type { SheetTab, GetValuesOptions, UpdateValuesOptions, SheetWriteResult };

function sheetsApi(auth: OAuth2Client) {
  return sheets({ version: 'v4', auth });
}

function handleApiError(err: unknown, context: string): never {
  if (err instanceof GoEasyError) throw err;
  const gErr = err as { code?: number; message?: string };
  if (gErr.code === 404) throw new NotFoundError('spreadsheet', context, err);
  if (gErr.code === 429) throw new QuotaError('sheets', err);
  throw new GoEasyError(
    `Sheets ${context}: ${gErr.message ?? 'Unknown error'}`,
    'SHEETS_ERROR',
    err
  );
}

/**
 * List all sheet tabs in a spreadsheet.
 */
export async function listSheets(
  auth: OAuth2Client,
  spreadsheetId: string
): Promise<SheetTab[]> {
  const api = sheetsApi(auth);
  try {
    const res = await api.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });
    return (res.data.sheets ?? []).map(parseSheetTab);
  } catch (err) {
    handleApiError(err, spreadsheetId);
  }
}

/**
 * Read cell values from a range (e.g. "Sheet1!A1:Z" or just "Sheet1").
 *
 * The API omits trailing empty rows and trims trailing empty cells from each row,
 * so the returned array may be ragged — do not assume rectangular shape.
 *
 * Dates return as formatted strings with the default render options.
 * Use valueRenderOption: 'UNFORMATTED_VALUE' to get raw numbers (serial dates).
 */
export async function getValues(
  auth: OAuth2Client,
  spreadsheetId: string,
  range: string,
  opts: GetValuesOptions = {}
): Promise<string[][]> {
  const api = sheetsApi(auth);
  try {
    const res = await api.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: opts.valueRenderOption ?? 'FORMATTED_VALUE',
      dateTimeRenderOption: opts.dateTimeRenderOption ?? 'FORMATTED_STRING',
    });
    return (res.data.values ?? []) as string[][];
  } catch (err) {
    handleApiError(err, `${spreadsheetId}!${range}`);
  }
}

/**
 * Write values to a range. Only cells with corresponding entries in values[][] are written;
 * other cells in the range are untouched.
 *
 * WRITE operation — no safety gate.
 */
export async function updateValues(
  auth: OAuth2Client,
  spreadsheetId: string,
  range: string,
  values: string[][],
  opts: UpdateValuesOptions = {}
): Promise<SheetWriteResult> {
  const api = sheetsApi(auth);
  try {
    const res = await api.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: opts.valueInputOption ?? 'USER_ENTERED',
      requestBody: { values },
    });
    return {
      ok: true,
      updatedRows: res.data.updatedRows ?? undefined,
      updatedColumns: res.data.updatedColumns ?? undefined,
      updatedCells: res.data.updatedCells ?? undefined,
      updatedRange: res.data.updatedRange ?? undefined,
    };
  } catch (err) {
    handleApiError(err, `${spreadsheetId}!${range}`);
  }
}

/**
 * Clear all values in a range (leaves formatting intact).
 *
 * WRITE operation — no safety gate.
 */
export async function clearValues(
  auth: OAuth2Client,
  spreadsheetId: string,
  range: string
): Promise<SheetWriteResult> {
  const api = sheetsApi(auth);
  try {
    const res = await api.spreadsheets.values.clear({
      spreadsheetId,
      range,
      requestBody: {},
    });
    return {
      ok: true,
      updatedRange: res.data.clearedRange ?? range,
    };
  } catch (err) {
    handleApiError(err, `${spreadsheetId}!${range}`);
  }
}
