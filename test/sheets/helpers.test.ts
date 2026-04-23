import { describe, it, expect } from 'vitest';
import { parseSheetTab } from '../../src/sheets/helpers.js';

describe('parseSheetTab', () => {
  it('parses full sheet properties', () => {
    const tab = parseSheetTab({
      properties: {
        sheetId: 42,
        title: 'Revenue',
        index: 1,
        sheetType: 'GRID',
        hidden: false,
        gridProperties: { rowCount: 1000, columnCount: 26 },
      },
    });
    expect(tab).toEqual({
      sheetId: 42,
      title: 'Revenue',
      index: 1,
      sheetType: 'GRID',
      hidden: false,
      rowCount: 1000,
      colCount: 26,
    });
  });

  it('defaults all fields when properties are missing', () => {
    const tab = parseSheetTab({});
    expect(tab.sheetId).toBe(0);
    expect(tab.title).toBe('');
    expect(tab.index).toBe(0);
    expect(tab.rowCount).toBe(0);
    expect(tab.colCount).toBe(0);
    expect(tab.sheetType).toBe('GRID');
    expect(tab.hidden).toBe(false);
  });

  it('defaults rowCount/colCount for chart sheets (no gridProperties)', () => {
    const tab = parseSheetTab({
      properties: { sheetId: 1, title: 'Chart 1', index: 0, sheetType: 'OBJECT' },
    });
    expect(tab.rowCount).toBe(0);
    expect(tab.colCount).toBe(0);
    expect(tab.sheetType).toBe('OBJECT');
  });

  it('defaults hidden to false when not set', () => {
    const tab = parseSheetTab({ properties: { sheetId: 0, title: 'Sheet1' } });
    expect(tab.hidden).toBe(false);
  });
});
