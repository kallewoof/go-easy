export interface SheetTab {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  colCount: number;
  sheetType: string;
  hidden: boolean;
}

export interface GetValuesOptions {
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
}

export interface UpdateValuesOptions {
  valueInputOption?: 'RAW' | 'USER_ENTERED';
}

export interface SheetWriteResult {
  ok: true;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
  updatedRange?: string;
}
