/**
 * CSV Import Service — reads uploaded Verafin CSV exports via Papa Parse,
 * validates headers, and hands normalized records to the KPI Engine.
 * The uploaded CSVs are the single source of truth; raw values are preserved
 * on the parsed rows and never mutated.
 */

import { validateHeaders, normalizeRecords } from '../engines/kpiEngine.js';

function parseCsvText(text) {
  return new Promise((resolve, reject) => {
    window.Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => String(h).trim(),
      complete: (results) => resolve(results),
      error: reject,
    });
  });
}

export async function importCsv({ file, text, type, config }) {
  const started = performance.now();
  const csvText = text ?? (await file.text());
  const parsed = await parseCsvText(csvText);
  const headers = parsed.meta.fields || [];
  const headerCheck = validateHeaders(headers, type, config.headerMappings);
  if (!headerCheck.ok) {
    return {
      ok: false,
      type,
      fileName: file?.name || 'inline',
      error: `Missing required header${headerCheck.missing.length > 1 ? 's' : ''}: ${headerCheck.missing.join(', ')}`,
      headerCheck,
    };
  }
  const { records, warnings, blankRows, duplicates, invalidDates } = normalizeRecords(
    parsed.data, type, config.headerMappings, config.statusMappings
  );
  if (!records.length) {
    return { ok: false, type, fileName: file?.name || 'inline', error: 'The file contains no data rows.', headerCheck };
  }
  return {
    ok: true,
    type,
    fileName: file?.name || 'inline',
    importedAt: new Date(),
    elapsedMs: Math.round(performance.now() - started),
    records,
    warnings,
    blankRows,
    duplicates,
    invalidDates,
    extraHeaders: headerCheck.extra,
  };
}
