function getSourceMigrationSheetSpecs_() {
  return [
    { sheetName: 'Meta_데이터 항목 설명', headerRow: 2, dataStartRow: 3 },
    { sheetName: 'DB_일반', headerRow: 9, dataStartRow: 12 },
    { sheetName: 'DB_히스토리 누적', headerRow: 10, dataStartRow: 15 },
    { sheetName: 'DB_자산', headerRow: 1, dataStartRow: 2 },
    { sheetName: 'DB_기업', headerRow: 1, dataStartRow: 2 },
    { sheetName: '이슈 리스트', headerRow: 1, dataStartRow: 2 },
    { sheetName: 'Log', headerRow: 4, dataStartRow: 5 },
    { sheetName: '펀드-자산-담당자 연결', headerRow: 1, dataStartRow: 2 },
    { sheetName: '자산_담당자 연결', headerRow: 3, dataStartRow: 4 },
  ];
}

function getSourceMigrationSheetSpecMap_() {
  const map = {};
  getSourceMigrationSheetSpecs_().forEach(function (spec) {
    map[spec.sheetName] = spec;
  });
  return map;
}

function buildSourceMigrationHash_(value) {
  return hashText_(JSON.stringify(value || {}));
}

function columnIndexToLetter_(columnIndex) {
  let value = Math.max(1, Number(columnIndex || 1));
  let text = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    text = String.fromCharCode(65 + remainder) + text;
    value = Math.floor((value - 1) / 26);
  }
  return text || 'A';
}

function normalizeSourceMigrationHeader_(value, columnIndex) {
  const text = safeString_(value).trim().toLowerCase();
  if (!text) return 'blank_col_' + String(columnIndex).padStart(3, '0');
  const normalized = text
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || ('col_' + String(columnIndex).padStart(3, '0'));
}

function inferSourceMigrationValueType_(value, formula) {
  if (safeString_(formula)) return 'formula';
  if (value === '' || value == null) return 'blank';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Object.prototype.toString.call(value) === '[object Date]') return 'date';
  return 'text';
}

function getSourceMigrationUsedRange_(sheet) {
  const maxRow = Math.max(1, sheet.getLastRow());
  const maxColumn = Math.max(1, sheet.getLastColumn());
  return sheet.getRange(1, 1, maxRow, maxColumn);
}

function buildLiveSheetsSourceExtract_(options) {
  const normalizedOptions = options || {};
  const includeCells = normalizedOptions.includeCells !== false;
  const spreadsheet = getSpreadsheet_();
  const generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const specMap = getSourceMigrationSheetSpecMap_();
  const specs = spreadsheet.getSheets().map(function (sheet) {
    return specMap[sheet.getName()] || { sheetName: sheet.getName(), headerRow: 1, dataStartRow: 2 };
  });
  const extract = {
    source_kind: 'live_google_sheets',
    source_system: 'google_sheets',
    source_name: spreadsheet.getName(),
    spreadsheet_id: getConfig_().spreadsheetId,
    extracted_at: generatedAt,
    sheets: [],
    columns: [],
    rows: [],
    cells: [],
    summary: {
      sheet_count: 0,
      row_count: 0,
      column_count: 0,
      cell_count: 0,
      formula_cell_count: 0,
      non_empty_cell_count: 0,
    },
  };

  specs.forEach(function (spec, sheetOffset) {
    const sheet = spreadsheet.getSheetByName(spec.sheetName);
    if (!sheet) return;
    const range = getSourceMigrationUsedRange_(sheet);
    const rowCount = range.getNumRows();
    const columnCount = range.getNumColumns();
    const displayValues = range.getDisplayValues();
    const rawValues = range.getValues();
    const formulas = range.getFormulas();
    const numberFormats = range.getNumberFormats();
    const notes = range.getNotes();
    const sheetId = 'sheet_' + String(sheetOffset + 1).padStart(2, '0') + '_' + buildSourceMigrationHash_(spec.sheetName).slice(0, 10);
    const headerRow = Math.min(Math.max(1, Number(spec.headerRow || 1)), rowCount);
    const headerValues = displayValues[headerRow - 1] || [];
    const columnIds = {};
    const sheetCellCount = rowCount * columnCount;

    extract.sheets.push({
      sheet_id: sheetId,
      import_id: null,
      sheet_name: spec.sheetName,
      source_file: 'live_google_sheets',
      row_count: rowCount,
      column_count: columnCount,
      cell_count: sheetCellCount,
      header_row: headerRow,
      data_start_row: Number(spec.dataStartRow || headerRow + 1),
      source_hash: buildSourceMigrationHash_({ sheet: spec.sheetName, rows: rowCount, cols: columnCount }),
    });

    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const columnLetter = columnIndexToLetter_(columnIndex);
      const headerValue = safeString_(headerValues[columnIndex - 1]);
      const columnId = sheetId + '_c' + String(columnIndex).padStart(4, '0');
      columnIds[columnIndex] = columnId;
      extract.columns.push({
        column_id: columnId,
        sheet_id: sheetId,
        column_index: columnIndex,
        column_letter: columnLetter,
        header_value: headerValue,
        normalized_header: normalizeSourceMigrationHeader_(headerValue, columnIndex),
        column_role: headerValue ? 'business_value' : 'blank_header',
      });
    }

    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
      const rowId = sheetId + '_r' + String(rowIndex).padStart(6, '0');
      let nonEmptyCellCount = 0;
      const rowHashParts = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const columnOffset = columnIndex - 1;
        const displayValue = safeString_(displayValues[rowIndex - 1][columnOffset]);
        const rawValue = safeString_(rawValues[rowIndex - 1][columnOffset]);
        const formula = safeString_(formulas[rowIndex - 1][columnOffset]);
        const isBlank = !displayValue && !formula;
        if (!isBlank) nonEmptyCellCount += 1;
        rowHashParts.push(displayValue + (formula ? '|' + formula : ''));
        if (includeCells) {
          const columnLetter = columnIndexToLetter_(columnIndex);
          const cellPayload = {
            sheet_name: spec.sheetName,
            row_number: rowIndex,
            column_index: columnIndex,
            column_letter: columnLetter,
            a1_ref: spec.sheetName + '!' + columnLetter + rowIndex,
            display_value: displayValue,
            raw_value: rawValue,
            formula: formula,
            is_blank: isBlank,
            number_format: safeString_(numberFormats[rowIndex - 1][columnOffset]),
            note: safeString_(notes[rowIndex - 1][columnOffset]),
            value_type: inferSourceMigrationValueType_(rawValues[rowIndex - 1][columnOffset], formula),
          };
          cellPayload.source_hash = buildSourceMigrationHash_(cellPayload);
          cellPayload.cell_id = rowId + '_c' + String(columnIndex).padStart(4, '0');
          cellPayload.row_id = rowId;
          cellPayload.column_id = columnIds[columnIndex];
          extract.cells.push(cellPayload);
        }
      }
      extract.rows.push({
        row_id: rowId,
        sheet_id: sheetId,
        row_number: rowIndex,
        row_hash: buildSourceMigrationHash_(rowHashParts),
        non_empty_cell_count: nonEmptyCellCount,
      });
    }

    extract.summary.row_count += rowCount;
    extract.summary.column_count += columnCount;
    extract.summary.cell_count += sheetCellCount;
  });

  extract.summary.sheet_count = extract.sheets.length;
  extract.summary.formula_cell_count = extract.cells.filter(function (cell) { return !!cell.formula; }).length;
  extract.summary.non_empty_cell_count = extract.cells.filter(function (cell) { return !cell.is_blank; }).length;
  return extract;
}

function adminExportLiveSheetsSourceExtract(request) {
  assertAdmin_(request);
  const includeCells = !request || request.includeCells !== false;
  return buildLiveSheetsSourceExtract_({ includeCells: includeCells });
}

function buildFieldDictionaryRowsFromSourceExtract_(extract, importId) {
  const normalizedExtract = extract || {};
  const metaSheet = (normalizedExtract.sheets || []).find(function (sheet) {
    return safeString_(sheet.sheet_name) === 'Meta_데이터 항목 설명';
  });
  if (!metaSheet) return [];
  const cells = (normalizedExtract.cells || []).filter(function (cell) {
    return safeString_(cell.sheet_name) === 'Meta_데이터 항목 설명';
  });
  const cellsByRow = {};
  cells.forEach(function (cell) {
    const rowNumber = Number(cell.row_number || 0);
    if (!cellsByRow[rowNumber]) cellsByRow[rowNumber] = {};
    cellsByRow[rowNumber][Number(cell.column_index || 0)] = cell;
  });
  const headerRow = Number(metaSheet.header_row || 2);
  const dataStartRow = Number(metaSheet.data_start_row || headerRow + 1);
  const headerCells = cellsByRow[headerRow] || {};
  const headerMap = {};
  Object.keys(headerCells).forEach(function (columnIndex) {
    const text = safeString_(headerCells[columnIndex].display_value);
    if (/항목\s*번호/.test(text)) headerMap.fieldNo = Number(columnIndex);
    else if (text === '항목') headerMap.fieldName = Number(columnIndex);
    else if (/data\s*type/i.test(text)) headerMap.dataType = Number(columnIndex);
    else if (text === '단위') headerMap.unit = Number(columnIndex);
    else if (/시계열/.test(text)) headerMap.isTimeSeries = Number(columnIndex);
    else if (/샘플/.test(text)) headerMap.sampleValue = Number(columnIndex);
    else if (/설명|고려사항/.test(text)) headerMap.description = Number(columnIndex);
  });
  const rows = [];
  Object.keys(cellsByRow).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rowNumber) {
    if (rowNumber < dataStartRow) return;
    const row = cellsByRow[rowNumber] || {};
    function cellValue(key) {
      const cell = row[headerMap[key]];
      return safeString_(cell && cell.display_value);
    }
    const fieldName = cellValue('fieldName');
    if (!fieldName) return;
    const sourcePk = safeString_(rowNumber);
    rows.push({
      field_id: makeDeterministicId_('field_dictionary', [fieldName, rowNumber]),
      field_no: cellValue('fieldNo') || null,
      field_name: fieldName,
      data_type: cellValue('dataType') || null,
      unit: cellValue('unit') || null,
      is_time_series: cellValue('isTimeSeries') || null,
      sample_value: cellValue('sampleValue') || null,
      description: cellValue('description') || null,
      source_system: 'google_sheets',
      source_table: 'Meta_데이터 항목 설명',
      source_pk: sourcePk,
      source_ref: 'Meta_데이터 항목 설명!' + rowNumber + ':' + rowNumber,
      source_row_hash: buildSourceMigrationHash_(row),
      source_payload: { source: { system: 'google_sheets', table: 'Meta_데이터 항목 설명', pk: sourcePk }, raw_row: row },
      last_etl_run_id: importId,
    });
  });
  return rows;
}

function buildLlSourceTablesFromExtract_(extract, importId) {
  const normalizedExtract = extract || {};
  const runId = safeString_(importId) || ('source_import_' + buildSourceMigrationHash_(normalizedExtract.extracted_at || Date.now()).slice(0, 16));
  const sourceKind = safeString_(normalizedExtract.source_kind || 'live_google_sheets');
  const sourceName = safeString_(normalizedExtract.source_name || normalizedExtract.spreadsheet_id || 'google_sheets');
  const summary = normalizedExtract.summary || {};
  const sheets = (normalizedExtract.sheets || []).map(function (row) {
    return {
      sheet_id: safeString_(row.sheet_id),
      import_id: runId,
      source_system: 'google_sheets',
      sheet_name: safeString_(row.sheet_name),
      source_file: safeString_(row.source_file || sourceName),
      row_count: Number(row.row_count || 0),
      column_count: Number(row.column_count || 0),
      cell_count: Number(row.cell_count || 0),
      header_hash: safeString_(row.source_hash || ''),
      data_hash: safeString_(row.source_hash || ''),
      header_row: Number(row.header_row || 1),
      data_start_row: Number(row.data_start_row || 2),
      source_hash: safeString_(row.source_hash || ''),
      source_payload: {
        source_kind: sourceKind,
        source_name: sourceName,
        extracted_at: safeString_(normalizedExtract.extracted_at),
      },
      last_etl_run_id: runId,
    };
  });
  const sheetNameById = {};
  sheets.forEach(function (sheet) {
    sheetNameById[sheet.sheet_id] = sheet.sheet_name;
  });
  const columns = (normalizedExtract.columns || []).map(function (row) {
    const columnId = safeString_(row.column_id);
    const sheetName = sheetNameById[safeString_(row.sheet_id)] || '';
    return {
      column_uid: columnId,
      column_id: columnId,
      sheet_id: safeString_(row.sheet_id),
      source_system: 'google_sheets',
      sheet_name: sheetName,
      column_index: Number(row.column_index || 0),
      column_letter: safeString_(row.column_letter),
      header_name: safeString_(row.header_value),
      header_value: safeString_(row.header_value),
      normalized_header: safeString_(row.normalized_header),
      column_role: safeString_(row.column_role || 'business_value'),
      value_type_guess: 'text',
      is_blank_header: !safeString_(row.header_value),
      sample_values: [],
      source_ref: sheetName + '!' + safeString_(row.column_letter) + '1',
      source_payload: {},
      last_etl_run_id: runId,
    };
  });
  const rows = (normalizedExtract.rows || []).map(function (row) {
    const rowId = safeString_(row.row_id);
    const sheetName = sheetNameById[safeString_(row.sheet_id)] || '';
    return {
      row_uid: rowId,
      row_id: rowId,
      sheet_id: safeString_(row.sheet_id),
      source_system: 'google_sheets',
      sheet_name: sheetName,
      row_index: Number(row.row_number || 0),
      row_number: Number(row.row_number || 0),
      source_ref: sheetName + '!' + Number(row.row_number || 0) + ':' + Number(row.row_number || 0),
      source_row_hash: safeString_(row.row_hash),
      row_hash: safeString_(row.row_hash),
      non_empty_cell_count: Number(row.non_empty_cell_count || 0),
      row_values: [],
      raw_row_payload: {},
      source_payload: {},
      last_etl_run_id: runId,
    };
  });
  const cells = (normalizedExtract.cells || []).map(function (row) {
    return {
      cell_id: safeString_(row.cell_id),
      row_id: safeString_(row.row_id),
      column_id: safeString_(row.column_id),
      sheet_name: safeString_(row.sheet_name),
      row_number: Number(row.row_number || 0),
      column_index: Number(row.column_index || 0),
      column_letter: safeString_(row.column_letter),
      a1_ref: safeString_(row.a1_ref),
      display_value: safeString_(row.display_value),
      raw_value: safeString_(row.raw_value),
      formula: safeString_(row.formula),
      is_blank: row.is_blank === true,
      number_format: safeString_(row.number_format),
      note: safeString_(row.note),
      value_type: safeString_(row.value_type || 'text'),
      source_hash: safeString_(row.source_hash),
      source_payload: {},
    };
  });
  const importRow = {
    import_id: runId,
    source_system: 'google_sheets',
    source_kind: sourceKind,
    source_name: sourceName,
    started_at: safeString_(normalizedExtract.extracted_at) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    finished_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    status: 'prepared',
    row_counts: {
      sheets: sheets.length,
      columns: columns.length,
      rows: rows.length,
      cells: cells.length,
      nonEmptyCells: Number(summary.non_empty_cell_count || 0),
      formulaCells: Number(summary.formula_cell_count || 0),
    },
    diff_summary: {},
    metadata: {
      source_kind: sourceKind,
      source_name: sourceName,
      spreadsheet_id: safeString_(normalizedExtract.spreadsheet_id),
    },
  };
  return {
    ll_source_imports: [importRow],
    ll_source_sheets: sheets,
    ll_source_columns: columns,
    ll_source_rows: rows,
    ll_source_cells: cells,
    ll_source_diffs: [],
    ll_field_dictionary: buildFieldDictionaryRowsFromSourceExtract_(normalizedExtract, runId),
  };
}

function attachLiveSourceMigrationTablesToDataset_(dataset, options) {
  const normalized = dataset || {};
  normalized.tables = normalized.tables || {};
  const extract = buildLiveSheetsSourceExtract_({ includeCells: true });
  const sourceTables = buildLlSourceTablesFromExtract_(extract, normalized.syncRunId || '');
  Object.keys(sourceTables).forEach(function (tableName) {
    normalized.tables[tableName] = sourceTables[tableName];
  });
  normalized.sourceExtractSummary = extract.summary;
  if (normalized.tables.ll_etl_runs && normalized.tables.ll_etl_runs[0]) {
    normalized.tables.ll_etl_runs[0].metadata = Object.assign({}, normalized.tables.ll_etl_runs[0].metadata || {}, {
      sourceExtractSummary: extract.summary,
      sourceExtractMode: 'live_google_sheets_all_sheets',
    });
    normalized.tables.ll_etl_runs[0].row_counts = Object.assign({}, normalized.tables.ll_etl_runs[0].row_counts || {}, {
      ll_source_imports: sourceTables.ll_source_imports.length,
      ll_source_sheets: sourceTables.ll_source_sheets.length,
      ll_source_columns: sourceTables.ll_source_columns.length,
      ll_source_rows: sourceTables.ll_source_rows.length,
      ll_source_cells: sourceTables.ll_source_cells.length,
      ll_source_diffs: sourceTables.ll_source_diffs.length,
    });
  }
  return normalized;
}
