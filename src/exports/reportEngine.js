/**
 * Template-Driven Reporting Engine (replaces programmatic PPTX generation).
 *
 * Philosophy: the application never recreates chart styling. The corporate
 * master template (template/ctr-executive-master.pptx — derived from the
 * supplied "Example KPI Template.pptx") is opened as a zip and ONLY data is
 * injected:
 *   1. the chart's cached category/value points (what PowerPoint renders),
 *   2. the embedded Excel workbook (what Chart Design → Edit Data opens),
 *   3. the {{TOKEN}} text placeholders (title, subtitle, KPI cards).
 * All fonts, colors, markers, axes, legends, branding, and slide layout come
 * from the template and are left untouched.
 *
 * The patch helpers are environment-agnostic (Node tests + browser); the
 * generateExecutiveReport() entry point is browser-only and serves both
 * report types via the REPORT_TYPES registry.
 */

import { computePerformanceKpis } from '../engines/kpiEngine.js';

/**
 * Report types share one engine; only labels, goals wording, and the master
 * template differ. Both masters derive from the same corporate template, so
 * the internal part paths are identical.
 */
export const REPORT_TYPES = {
  ctr: {
    kind: 'filing',
    fileLabel: 'CTR',
    volumeLabel: 'CTRs Completed',
    subject: 'CTR Filing Performance',
    template: 'template/ctr-executive-master.pptx',
    defaultGoals: { internalTargetDays: 5, regulatoryThresholdDays: 15 },
  },
  sar: {
    kind: 'filing',
    fileLabel: 'SAR',
    volumeLabel: 'SARs Completed',
    subject: 'SAR Filing Performance',
    template: 'template/sar-executive-master.pptx',
    defaultGoals: { internalTargetDays: 21, regulatoryThresholdDays: 30 },
  },
  // Alerts measure investigation efficiency, not regulatory filing — no
  // goal/deadline reference series; all three workflows share one master.
  alertReview: {
    kind: 'investigation',
    fileLabel: 'Alert-Review',
    volumeLabel: 'Alerts Completed',
    subject: 'Alert Review Performance',
    template: 'template/alerts-executive-master.pptx',
  },
  alertCase: {
    kind: 'investigation',
    fileLabel: 'Alert-Case',
    volumeLabel: 'Cases Closed',
    subject: 'Alert-to-Case Performance',
    template: 'template/alerts-executive-master.pptx',
  },
  alertSar: {
    kind: 'investigation',
    fileLabel: 'Alert-SAR',
    volumeLabel: 'SAR Alerts',
    subject: 'Alert-to-SAR Performance',
    template: 'template/alerts-executive-master.pptx',
  },
  alertFunnel: {
    kind: 'funnel',
    fileLabel: 'Alert-Outcomes',
    subject: 'Alert Outcomes Trend',
    template: 'template/alerts-funnel-executive-master.pptx',
  },
};

// Part paths inside the master templates (see tools/build-master-template.mjs)
export const CHART_PART = 'ppt/charts/chart4.xml';
export const WORKBOOK_PART = 'ppt/embeddings/Microsoft_Excel_Worksheet3.xlsx';
export const SLIDE_PART = 'ppt/slides/slide1.xml';

export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Replace the cached data of every <c:ser> in a chart XML part, in document
 * order. seriesData[i] = { name?, values } — values entries that are not
 * finite numbers render as gaps; when name is given the series-name cache
 * (<c:tx>, i.e. the legend / Edit Data header) is rewritten too, keeping
 * legend labels in sync with configurable goal values. Styling and axes are
 * untouched; formula ranges are re-rowed to the data length.
 *
 * Throws if any provided series cannot be fully patched (fewer <c:ser>
 * nodes than expected, or missing cat/val cache structures) — a partially
 * injected report must never be produced silently.
 */
export function patchChartXml(chartXml, months, seriesData) {
  let si = 0;
  const result = chartXml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const s = seriesData[si];
    if (!s) { si++; return ser; }
    const idx = si++;
    const pts = months.map((mm, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(mm)}</c:v></c:pt>`).join('');
    let out = ser;

    // Matched flags (not string comparison — an injected value identical to
    // the existing one must not read as "structure missing").
    if (s.name != null) {
      let nameMatched = false;
      out = out.replace(
        /(<c:tx>[\s\S]*?)<c:strCache>[\s\S]*?<\/c:strCache>([\s\S]*?<\/c:tx>)/,
        (whole, a, b) => {
          nameMatched = true;
          return `${a}<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(s.name)}</c:v></c:pt></c:strCache>${b}`;
        }
      );
      if (!nameMatched) throw new Error(`Chart XML incompatible: series ${idx + 1} has no name cache (<c:tx>) to patch`);
    }

    // Categories may be cached as plain strCache or (PptxGenJS) multiLvlStrCache
    let catMatched = false;
    out = out.replace(
      /(<c:cat>[\s\S]*?)<c:strCache>[\s\S]*?<\/c:strCache>([\s\S]*?<\/c:cat>)/,
      (whole, before, after) => {
        catMatched = true;
        return `${before}<c:strCache><c:ptCount val="${months.length}"/>${pts}</c:strCache>${after}`;
      }
    );
    out = out.replace(
      /(<c:cat>[\s\S]*?)<c:multiLvlStrCache>[\s\S]*?<\/c:multiLvlStrCache>([\s\S]*?<\/c:cat>)/,
      (whole, before, after) => {
        catMatched = true;
        return `${before}<c:multiLvlStrCache><c:ptCount val="${months.length}"/><c:lvl>${pts}</c:lvl></c:multiLvlStrCache>${after}`;
      }
    );
    if (!catMatched) throw new Error(`Chart XML incompatible: series ${idx + 1} has no category cache to patch`);

    let valMatched = false;
    out = out.replace(
      /(<c:val>[\s\S]*?<c:numCache>)[\s\S]*?(<\/c:numCache>[\s\S]*?<\/c:val>)/,
      (whole, before, after) => {
        valMatched = true;
        const fmt = (whole.match(/<c:formatCode>[^<]*<\/c:formatCode>/) || ['<c:formatCode>General</c:formatCode>'])[0];
        return before + fmt +
          `<c:ptCount val="${s.values.length}"/>` +
          s.values.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('') +
          after;
      }
    );
    if (!valMatched) throw new Error(`Chart XML incompatible: series ${idx + 1} has no value cache (numCache) to patch`);

    // data ranges always start at row 2 (row 1 = headers)
    out = out.replace(/(\$[A-Z]+\$)2:(\$[A-Z]+\$)\d+/g, (whole, a, b) => `${a}2:${b}${months.length + 1}`);
    return out;
  });
  if (si < seriesData.length) {
    throw new Error(`Chart XML incompatible: expected ${seriesData.length} series, found ${si}`);
  }
  return result;
}

/** Replace {{TOKEN}} placeholders in slide XML with escaped values. */
export function patchSlideTokens(slideXml, tokens) {
  let out = slideXml;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(xmlEscape(value ?? ''));
  }
  return out;
}

/**
 * Build the minimal embedded workbook PowerPoint opens via Edit Data:
 * ONE sheet, header row + data rows, no helper columns, no hidden sheets,
 * no extra calculations (per the template-integration spec).
 * columns: [{ header, values: (string|number|null)[] }] — first column is
 * Month (strings), the rest numeric.
 */
export async function buildEmbeddedWorkbook(JSZipClass, columns) {
  const colLetter = (i) => String.fromCharCode(65 + i); // A..Z (5 columns used)
  const rowCount = Math.max(...columns.map((c) => c.values.length)) + 1;

  let sheetRows = `<row r="1">` + columns.map((c, ci) =>
    `<c r="${colLetter(ci)}1" t="inlineStr"><is><t>${xmlEscape(c.header)}</t></is></c>`).join('') + '</row>';
  for (let r = 0; r < rowCount - 1; r++) {
    sheetRows += `<row r="${r + 2}">` + columns.map((c, ci) => {
      const v = c.values[r];
      if (v == null || v === '') return '';
      // non-finite numbers (NaN/Infinity) would corrupt numeric cells — omit
      if (typeof v === 'number') {
        return Number.isFinite(v) ? `<c r="${colLetter(ci)}${r + 2}"><v>${v}</v></c>` : '';
      }
      return `<c r="${colLetter(ci)}${r + 2}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`;
    }).join('') + '</row>';
  }

  const zip = new JSZipClass();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  zip.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>');
  zip.file('xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="1"><xf/></cellXfs>' +
    '</styleSheet>');
  zip.file('xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetRows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array' });
}

const momToken = (perf) => perf.momVariancePct == null ? '—'
  : `${perf.momImproving ? '▼' : perf.momVariancePct === 0 ? '■' : '▲'} ${Math.abs(perf.momVariancePct)}%`;
const momNote = (perf) => perf.momDeltaDays == null ? ''
  : perf.momImproving ? `Improved ${Math.abs(perf.momDeltaDays)} Days`
  : perf.momDeltaDays === 0 ? 'Unchanged vs prior month' : `Slower by ${Math.abs(perf.momDeltaDays)} Days`;

/** Assemble everything a report injection needs from the dashboard model. */
export function buildReportData(model, config, type = 'ctr') {
  const T = REPORT_TYPES[type];
  if (!T) throw new Error(`Unknown report type: ${type}`);
  const m = model.monthly;
  const months = m.map((x) => x.label);
  const baseTokens = {
    REPORT_TITLE: 'BSA/AML Department',
    REPORT_SUBTITLE: `${T.subject} – ${model.currentMonthLabel || ''}`,
  };

  if (T.kind === 'funnel') {
    // Alert outcomes trend: stacked outcome columns + avg-days line.
    // Expects aggregateAlertsMonthly() rows.
    const seriesData = [
      { name: 'Closed at Alert Stage', values: m.map((x) => x.closedAtAlert ?? 0) },
      { name: 'Escalated to Case', values: m.map((x) => x.escalatedToCase ?? 0) },
      { name: 'Resulted in SAR', values: m.map((x) => x.resultedInSar ?? 0) },
      { name: 'Avg Days to Completion', values: m.map((x) => x.totalAvgDays) },
    ];
    const columns = [
      { header: 'Month', values: months },
      ...seriesData.map((s) => ({ header: s.name, values: s.values })),
    ];
    const current = m[m.length - 1] || {};
    const previous = m[m.length - 2] || {};
    const momPct = previous.created ? Math.round(((current.created - previous.created) / previous.created) * 100) : null;
    const history = m.slice(0, -1).slice(-12).map((x) => x.created).filter((v) => v != null);
    const histAvg = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null;
    const tokens = {
      ...baseTokens,
      KPI_MONTHLY: `${current.created ?? 0} Alerts`,
      KPI_MONTHLY_NOTE: `${current.closedAtAlert ?? 0} closed · ${current.escalatedToCase ?? 0} cases · ${current.resultedInSar ?? 0} SARs`,
      KPI_MOM: momPct == null ? '—' : `${momPct <= 0 ? '▼' : '▲'} ${Math.abs(momPct)}%`,
      KPI_MOM_NOTE: 'Alert volume vs prior month',
      KPI_HIST: histAvg == null ? '—' : `${histAvg} Alerts`,
      KPI_HIST_NOTE: 'Rolling 12-month average volume',
    };
    return { months, seriesData, columns, tokens, perf: null };
  }

  if (T.kind === 'investigation') {
    // Alert workflow performance: volume columns + avg investigation days
    // line, no goal/deadline series (investigation, not filing).
    const perf = computePerformanceKpis(m, null);
    const currentVolume = m[m.length - 1]?.completedFilings ?? 0;
    const seriesData = [
      { name: T.volumeLabel, values: m.map((x) => x.completedFilings ?? 0) },
      { name: 'Avg Investigation Days', values: m.map((x) => x.avgFilingDaysEff) },
    ];
    const columns = [
      { header: 'Month', values: months },
      ...seriesData.map((s) => ({ header: s.name, values: s.values })),
    ];
    const tokens = {
      ...baseTokens,
      KPI_MONTHLY: perf.currentAvgDays == null ? '—' : `${perf.currentAvgDays} Days`,
      KPI_MONTHLY_NOTE: `${currentVolume} completed this month`,
      KPI_MOM: momToken(perf),
      KPI_MOM_NOTE: momNote(perf),
      KPI_HIST: perf.historicalAvgDays == null ? '—' : `${perf.historicalAvgDays} Days`,
      KPI_HIST_NOTE: 'Rolling 12-month average',
    };
    return { months, seriesData, columns, tokens, perf };
  }

  // kind === 'filing' (CTR/SAR): volume + avg days + goal/deadline series.
  // Fallback goals must match the report type (a goal-less SAR model must
  // never inherit CTR's 5/15-day bounds) — codex review fix.
  const g = model.goals || T.defaultGoals;
  const perf = computePerformanceKpis(m, g.internalTargetDays, g.regulatoryThresholdDays);

  // Series names double as legend labels AND workbook headers — injected on
  // every export so they always reflect the goal values active in config.
  const seriesData = [
    { name: T.volumeLabel, values: m.map((x) => x.completedFilings ?? 0) },
    { name: 'Avg Filing Days', values: m.map((x) => x.avgFilingDaysEff) },
    { name: `Regulatory Deadline (${g.regulatoryThresholdDays} Days)`, values: months.map(() => g.regulatoryThresholdDays) },
    { name: `Internal Goal (${g.internalTargetDays} Days)`, values: months.map(() => g.internalTargetDays) },
  ];
  const columns = [
    { header: 'Month', values: months },
    ...seriesData.map((s) => ({ header: s.name, values: s.values })),
  ];
  const tokens = {
    ...baseTokens,
    KPI_MONTHLY: perf.currentAvgDays == null ? '—' : `${perf.currentAvgDays} Days`,
    KPI_MONTHLY_NOTE: perf.currentAvgDays == null
      ? 'No completed filings this month'
      : `${perf.monthlyPerformancePct}% of ${g.internalTargetDays}-day goal ${perf.meetsGoal ? '✓' : '✗'}`,
    KPI_MOM: momToken(perf),
    KPI_MOM_NOTE: momNote(perf),
    KPI_HIST: perf.historicalAvgDays == null ? '—' : `${perf.historicalAvgDays} Days`,
    KPI_HIST_NOTE: perf.historicalAvgDays == null ? '' : `Rolling average · ${perf.historicalPct}% of goal`,
  };
  return { months, seriesData, columns, tokens, perf };
}

/**
 * Inject report data into a loaded template zip (JSZip instance).
 * Shared by the browser entry point and Node verification.
 */
export async function injectReport(zip, JSZipClass, model, config, type = 'ctr') {
  const { months, seriesData, columns, tokens } = buildReportData(model, config, type);

  const chartXml = await zip.file(CHART_PART).async('string');
  zip.file(CHART_PART, patchChartXml(chartXml, months, seriesData));

  zip.file(WORKBOOK_PART, await buildEmbeddedWorkbook(JSZipClass, columns));

  const slideXml = await zip.file(SLIDE_PART).async('string');
  zip.file(SLIDE_PART, patchSlideTokens(slideXml, tokens));

  return zip;
}

/** Browser entry point: Generate Executive Report (CTR or SAR). */
export async function generateExecutiveReport(model, config, type = 'ctr') {
  const T = REPORT_TYPES[type];
  if (!T) throw new Error(`Unknown report type: ${type}`);
  const JSZipClass = window.JSZip;
  if (!JSZipClass) throw new Error('JSZip library is not loaded.');
  const res = await fetch(T.template);
  if (!res.ok) throw new Error(`Master template not found at ${T.template} — run: node tools/build-master-template.mjs`);
  const zip = await JSZipClass.loadAsync(await res.arrayBuffer());
  await injectReport(zip, JSZipClass, model, config, type);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${T.fileLabel || type.toUpperCase()}-Executive-Report-${model.currentMonth || 'export'}.pptx`;
  a.click();
  URL.revokeObjectURL(url);
}
