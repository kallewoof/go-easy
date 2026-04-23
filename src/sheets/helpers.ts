import type { sheets_v4 } from '@googleapis/sheets';
import type { SheetTab } from './types.js';

export function parseSheetTab(raw: sheets_v4.Schema$Sheet): SheetTab {
  const props = raw.properties ?? {};
  const grid = props.gridProperties ?? {};
  return {
    sheetId: props.sheetId ?? 0,
    title: props.title ?? '',
    index: props.index ?? 0,
    rowCount: grid.rowCount ?? 0,
    colCount: grid.columnCount ?? 0,
    sheetType: props.sheetType ?? 'GRID',
    hidden: props.hidden ?? false,
  };
}
