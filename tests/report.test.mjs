/**
 * Template reporting engine validation: runs the full injection pipeline
 * against the master template with sample-data KPIs and verifies that only
 * data changed — chart caches, embedded workbook, and text tokens — while
 * everything else in the package is preserved.
 * Run: node --test tests/report.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import {
  patchChartXml, patchSlideTokens, buildEmbeddedWorkbook, buildReportData,
  injectReport, CHART_PART, WORKBOOK_PART, SLIDE_PART,
} from '../src/exports/reportEngine.js';
import { normalizeRecords, aggregateMonthly, rollingMonths, latestMonth, summarize } from '../src/engines/kpiEngine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mappings = JSON.parse(readFileSync(join(root, 'config/header-mappings.json'), 'utf8'));
const statusMappings = JSON.parse(readFileSync(join(root, 'config/status-mappings.json'), 'utf8'));
const goalsConfig = JSON.parse(readFileSync(join(root, 'config/goals.json'), 'utf8'));

function parseCsv(text) {
  const [head, ...lines] = text.trim().split('\n');
  const headers = head.split(',');
  return lines.map((l) => Object.fromEntries(headers.map((h, i) => [h, l.split(',')[i] ?? ''])));
}

function sampleModel(type = 'ctr') {
  const rows = parseCsv(readFileSync(join(root, `examples/${type}-sample.csv`), 'utf8'));
  const { records } = normalizeRecords(rows, type, mappings, statusMappings);
  const months = rollingMonths(latestMonth(records), 13);
  const monthly = aggregateMonthly(records, months);
  return {
    monthly,
    months,
    summary: summarize(records),
    goals: goalsConfig.versions[goalsConfig.versions.length - 1][type],
    currentMonth: months[12],
    currentMonthLabel: monthly[12].label,
    dateRangeLabel: `${monthly[0].label} – ${monthly[12].label}`,
  };
}

async function loadMaster(type = 'ctr') {
  return JSZip.loadAsync(readFileSync(join(root, `template/${type}-executive-master.pptx`)));
}

test('injectReport patches chart caches with sample data (4 series, 13 points)', async () => {
  const model = sampleModel();
  const zip = await injectReport(await loadMaster(), JSZip, model, {});
  const chart = await zip.file(CHART_PART).async('string');

  const sers = chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g);
  assert.equal(sers.length, 4);
  for (const ser of sers) {
    assert.match(ser, /<c:(multiLvlStrCache|strCache)><c:ptCount val="13"\/>/, 'category cache should hold 13 months');
    assert.ok(ser.includes(model.currentMonthLabel), 'real month labels injected into categories');
  }
  assert.ok(!chart.includes('PLACEHOLDER-M'), 'no builder placeholders survive injection');
  // volume series carries the sample's completed counts
  const vol = model.monthly.map((x) => x.completedFilings);
  for (const v of vol) assert.ok(sers[0].includes(`<c:v>${v}</c:v>`), `volume ${v} missing from series 1`);
  // reference series are constant goal values
  assert.equal((sers[2].match(/<c:v>15<\/c:v>/g) || []).length, 13, 'regulatory line should be 13×15');
  assert.equal((sers[3].match(/<c:v>5<\/c:v>/g) || []).length, 13, 'goal line should be 13×5');
  // formula ranges re-rowed to 14 (header + 13 data rows)
  assert.match(chart, /\$A\$2:\$A\$14/);
});

test('embedded workbook: one sheet, exactly the five spec columns, no helpers', async () => {
  const model = sampleModel();
  const zip = await injectReport(await loadMaster(), JSZip, model, {});
  const wb = await JSZip.loadAsync(await zip.file(WORKBOOK_PART).async('uint8array'));

  const sheets = Object.keys(wb.files).filter((f) => /worksheets\/.*\.xml$/.test(f));
  assert.deepEqual(sheets, ['xl/worksheets/sheet1.xml'], 'exactly one worksheet');
  const sheet = await wb.file('xl/worksheets/sheet1.xml').async('string');
  const headers = [...sheet.matchAll(/<c r="[A-E]1" t="inlineStr"><is><t>([^<]*)<\/t>/g)].map((m) => m[1]);
  assert.deepEqual(headers, [
    'Month', 'CTRs Completed', 'Avg Filing Days', 'Regulatory Deadline (15 Days)', 'Internal Goal (5 Days)',
  ]);
  assert.equal((sheet.match(/<row /g) || []).length, 14, 'header + 13 data rows');
  assert.ok(!sheet.includes('F1'), 'no sixth column');
});

test('slide tokens are fully resolved and KPI labels preserved', async () => {
  const model = sampleModel();
  const zip = await injectReport(await loadMaster(), JSZip, model, {});
  const slide = await zip.file(SLIDE_PART).async('string');

  assert.ok(!/\{\{[A-Z_]+\}\}/.test(slide), 'no unresolved {{tokens}}');
  for (const label of ['Monthly Performance', 'MoM Variance', '12-Month Historical']) {
    assert.ok(slide.includes(label), `${label} label preserved`);
  }
  assert.ok(slide.includes('CTR Filing Performance'), 'report subtitle injected');
  assert.match(slide, /\d(\.\d)? Days/, 'day-based KPI values injected');
});

test('only data parts change — template formatting is untouched', async () => {
  const model = sampleModel();
  const before = await loadMaster();
  const after = await injectReport(await loadMaster(), JSZip, model, {});
  const changed = [];
  for (const name of Object.keys(before.files)) {
    if (before.files[name].dir) continue;
    const a = await before.file(name).async('uint8array');
    const b = after.file(name) ? await after.file(name).async('uint8array') : null;
    if (!b || Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0) changed.push(name);
  }
  assert.deepEqual(changed.sort(), [CHART_PART, WORKBOOK_PART, SLIDE_PART].sort(),
    'exactly the chart, workbook, and slide text may change');
});

const MINI_SER = (name) =>
  `<c:ser><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
  '<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>x</c:v></c:pt></c:strCache></c:strRef></c:cat>' +
  '<c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:formatCode>0.0</c:formatCode><c:ptCount val="2"/></c:numCache></c:numRef></c:val></c:ser>';

test('patch helpers: escaping, gaps, and legend-name injection', async () => {
  const out = patchChartXml(MINI_SER('Old Name'), ['A & B', 'C<D'], [{ name: 'Goal (4 & 5 Days)', values: [1.5, null] }]);
  assert.ok(out.includes('A &amp; B') && out.includes('C&lt;D'), 'months are XML-escaped');
  assert.ok(out.includes('Goal (4 &amp; 5 Days)') && !out.includes('Old Name'), 'series name/legend rewritten');
  assert.ok(out.includes('<c:v>1.5</c:v>'));
  assert.ok(!out.includes('idx="1"><c:v></c:v>'), 'null renders as a gap, not an empty value');
  assert.ok(out.includes('<c:formatCode>0.0</c:formatCode>'), 'format code preserved');
  assert.equal(patchSlideTokens('<a:t>{{X}}</a:t>', { X: 'a<b&c' }), '<a:t>a&lt;b&amp;c</a:t>');
  const wb = await buildEmbeddedWorkbook(JSZip, [{ header: 'Month', values: ['Jan'] }, { header: 'N', values: [3] }]);
  assert.ok(wb.length > 500, 'workbook builds');
});

test('non-finite numbers never reach chart caches or workbook cells (codex fix)', async () => {
  const out = patchChartXml(MINI_SER('S'), ['a', 'b', 'c'], [{ values: [NaN, Infinity, 2] }]);
  assert.ok(!out.includes('NaN') && !out.includes('Infinity'), 'non-finite values omitted from cache');
  assert.ok(out.includes('<c:pt idx="2"><c:v>2</c:v></c:pt>'), 'finite value survives at its index');
  const wb = await JSZip.loadAsync(await buildEmbeddedWorkbook(JSZip, [
    { header: 'Month', values: ['Jan', 'Feb'] }, { header: 'N', values: [NaN, 4] },
  ]));
  const sheet = await wb.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok(!sheet.includes('NaN'), 'NaN omitted from workbook');
  assert.ok(sheet.includes('<c r="B3"><v>4</v></c>'));
});

test('incompatible chart XML fails hard, never a silent partial patch (codex fix)', () => {
  // more expected series than the chart has
  assert.throws(() => patchChartXml(MINI_SER('S'), ['a'], [{ values: [1] }, { values: [2] }]),
    /expected 2 series, found 1/);
  // missing numCache
  const noVal = MINI_SER('S').replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, '');
  assert.throws(() => patchChartXml(noVal, ['a'], [{ values: [1] }]), /no value cache/);
  // missing category cache
  const noCat = MINI_SER('S').replace(/<c:cat>[\s\S]*?<\/c:cat>/, '<c:cat></c:cat>');
  assert.throws(() => patchChartXml(noCat, ['a'], [{ values: [1] }]), /no category cache/);
});

test('configurable goals flow into legend labels, workbook headers, and constants (codex fix)', async () => {
  const model = sampleModel();
  model.goals = { ...model.goals, internalTargetDays: 4, regulatoryThresholdDays: 12 };
  const zip = await injectReport(await loadMaster(), JSZip, model, {});
  const chart = await zip.file(CHART_PART).async('string');
  assert.ok(chart.includes('Regulatory Deadline (12 Days)') && chart.includes('Internal Goal (4 Days)'),
    'legend labels track configured goals');
  assert.ok(!chart.includes('(15 Days)') && !chart.includes('(5 Days)'), 'template default labels replaced');
  const sers = chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g);
  assert.equal((sers[2].match(/<c:v>12<\/c:v>/g) || []).length, 13);
  assert.equal((sers[3].match(/<c:v>4<\/c:v>/g) || []).length, 13);
  const wb = await JSZip.loadAsync(await zip.file(WORKBOOK_PART).async('uint8array'));
  const sheet = await wb.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok(sheet.includes('Regulatory Deadline (12 Days)') && sheet.includes('Internal Goal (4 Days)'),
    'workbook headers match legend labels');
});

test('SAR report: 21/30-day bounds, SAR labels, Determination-based data (mirrors CTR)', async () => {
  const model = sampleModel('sar');
  const zip = await injectReport(await loadMaster('sar'), JSZip, model, {}, 'sar');
  const chart = await zip.file(CHART_PART).async('string');

  const sers = chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g);
  assert.equal(sers.length, 4);
  assert.ok(sers[0].includes('SARs Completed'), 'volume series labeled for SARs');
  assert.ok(chart.includes('Regulatory Deadline (30 Days)') && chart.includes('Internal Goal (21 Days)'));
  assert.equal((sers[2].match(/<c:v>30<\/c:v>/g) || []).length, 13, 'regulatory line = 13×30');
  assert.equal((sers[3].match(/<c:v>21<\/c:v>/g) || []).length, 13, 'goal line = 13×21');
  assert.ok(!chart.includes('PLACEHOLDER-M'), 'no builder placeholders survive');
  for (const v of model.monthly.map((x) => x.completedFilings)) {
    assert.ok(sers[0].includes(`<c:v>${v}</c:v>`), `SAR volume ${v} missing`);
  }

  const wb = await JSZip.loadAsync(await zip.file(WORKBOOK_PART).async('uint8array'));
  const sheet = await wb.file('xl/worksheets/sheet1.xml').async('string');
  const headers = [...sheet.matchAll(/<c r="[A-E]1" t="inlineStr"><is><t>([^<]*)<\/t>/g)].map((x) => x[1]);
  assert.deepEqual(headers, [
    'Month', 'SARs Completed', 'Avg Filing Days', 'Regulatory Deadline (30 Days)', 'Internal Goal (21 Days)',
  ]);

  const slide = await zip.file(SLIDE_PART).async('string');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(slide), 'no unresolved tokens');
  assert.ok(slide.includes('SAR Filing Performance'), 'SAR subtitle injected');
  assert.match(slide, /% of 21-day goal/, 'KPI note references the 21-day goal');
});

test('goal-less SAR model falls back to SAR bounds, never CTR (codex fix)', () => {
  const bare = { monthly: [{ label: 'Jan 2026', completedFilings: 1, avgFilingDaysEff: 22 }], currentMonthLabel: 'Jan 2026' };
  const sar = buildReportData(bare, {}, 'sar');
  assert.ok(sar.columns.some((c) => c.header === 'Regulatory Deadline (30 Days)'));
  assert.ok(sar.columns.some((c) => c.header === 'Internal Goal (21 Days)'));
  assert.match(sar.tokens.KPI_MONTHLY_NOTE, /21-day goal/);
  assert.ok(!JSON.stringify(sar.columns).includes('(15 Days)'), 'no CTR bounds leak into SAR');
  const ctr = buildReportData(bare, {}, 'ctr');
  assert.ok(ctr.columns.some((c) => c.header === 'Regulatory Deadline (15 Days)'));
});

test('unknown report type throws (codex coverage gap)', async () => {
  const bare = { monthly: [{ label: 'Jan 2026', completedFilings: 1, avgFilingDaysEff: 5 }] };
  assert.throws(() => buildReportData(bare, {}, 'alerts'), /Unknown report type/);
  await assert.rejects(() => injectReport(null, JSZip, bare, {}, 'alerts'), /Unknown report type/);
});

test('template builder regenerates both masters independently (codex coverage gap)', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync: rf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  let outDir;
  try {
    outDir = mkdtempSync(join(tmpdir(), 'altura-templates-'));
  } catch (err) {
    t.skip(`sandbox forbids temp dirs (${err.code}) — builder regeneration not testable here`);
    return;
  }
  execFileSync('node', [join(root, 'tools/build-master-template.mjs')], {
    env: { ...process.env, TEMPLATE_OUT_DIR: outDir },
    stdio: 'pipe',
  });
  for (const [type, vol, reg, goal] of [['ctr', 'CTRs Completed', 15, 5], ['sar', 'SARs Completed', 30, 21]]) {
    const zip = await JSZip.loadAsync(rf(join(outDir, `template/${type}-executive-master.pptx`)));
    const chart = await zip.file(CHART_PART).async('string');
    assert.ok(chart.includes(vol), `${type}: volume series present`);
    assert.ok(chart.includes(`Regulatory Deadline (${reg} Days)`) && chart.includes(`Internal Goal (${goal} Days)`),
      `${type}: reference series named for its own bounds`);
    const slide = await zip.file(SLIDE_PART).async('string');
    assert.ok(slide.includes('{{KPI_MONTHLY}}'), `${type}: slide tokens present`);
  }
});

// ---------------------------------------------------------------- CTR/SAR parity
// Standardization contract: the two exports must be identical in layout,
// object hierarchy, series order, workbook column order, and KPI structure —
// differing ONLY in labels, goal values, and the underlying data.

const normalizeChart = (chart) => chart
  .replace(/CTRs Completed|SARs Completed/g, 'VOLUME')
  .replace(/Regulatory Deadline \(\d+ Days\)/g, 'REG')
  .replace(/Internal Goal \(\d+ Days\)/g, 'GOAL')
  .replace(/<c:v>[^<]*<\/c:v>/g, '<c:v>V</c:v>');

test('parity: CTR and SAR masters share identical slide layout and structure', async () => {
  const ctr = await loadMaster('ctr');
  const sar = await loadMaster('sar');
  assert.equal(
    await ctr.file(SLIDE_PART).async('string'),
    await sar.file(SLIDE_PART).async('string'),
    'slide XML (layout, typography, KPI cards, object hierarchy) must be byte-identical'
  );
  assert.equal(
    normalizeChart(await ctr.file(CHART_PART).async('string')),
    normalizeChart(await sar.file(CHART_PART).async('string')),
    'chart XML must be structurally identical after label/value normalization'
  );
  const parts = (z) => Object.keys(z.files).filter((f) => !z.files[f].dir).sort().join(',');
  assert.equal(parts(ctr), parts(sar), 'package part inventories must match');

  // Embedded workbook structure must match too (codex: name-only inventory
  // comparison would miss workbook divergence/corruption)
  const wbStructure = async (zip) => {
    const wb = await JSZip.loadAsync(await zip.file(WORKBOOK_PART).async('uint8array'));
    const sheet = await wb.file('xl/worksheets/sheet1.xml').async('string');
    return {
      parts: Object.keys(wb.files).filter((f) => !wb.files[f].dir).sort().join(','),
      sheetSkeleton: sheet
        .replace(/<t>[^<]*<\/t>/g, '<t>T</t>')
        .replace(/<v>[^<]*<\/v>/g, '<v>N</v>'),
    };
  };
  assert.deepEqual(await wbStructure(ctr), await wbStructure(sar),
    'embedded workbook part inventory and sheet structure must match');
});

test('parity: generated CTR and SAR reports share order, structure, and token set', async () => {
  const outputs = {};
  for (const type of ['ctr', 'sar']) {
    const model = sampleModel(type);
    const zip = await injectReport(await loadMaster(type), JSZip, model, {}, type);
    const chart = await zip.file(CHART_PART).async('string');
    const wb = await JSZip.loadAsync(await zip.file(WORKBOOK_PART).async('uint8array'));
    const sheet = await wb.file('xl/worksheets/sheet1.xml').async('string');
    const catCache = chart.match(/<c:cat>[\s\S]*?<\/c:cat>/)[0];
    outputs[type] = {
      seriesOrder: [...chart.matchAll(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1]),
      headers: [...sheet.matchAll(/<c r="[A-E]1" t="inlineStr"><is><t>([^<]*)<\/t>/g)].map((m) => m[1]),
      // month labels asserted explicitly — the chart normalizer masks all
      // <c:v> values, so category divergence needs its own check (codex)
      monthLabels: [...catCache.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1]),
      tokens: buildReportData(model, {}, type).tokens,
      chartSkeleton: normalizeChart(chart),
    };
  }
  const generic = (arr) => arr.map((s) => s
    .replace(/CTRs Completed|SARs Completed/, 'VOLUME')
    .replace(/Regulatory Deadline \(\d+ Days\)/, 'REG')
    .replace(/Internal Goal \(\d+ Days\)/, 'GOAL'));
  // Required order: Volume → Avg Filing Days → Regulatory Deadline → Internal Goal
  assert.deepEqual(generic(outputs.ctr.seriesOrder), ['VOLUME', 'Avg Filing Days', 'REG', 'GOAL']);
  assert.deepEqual(generic(outputs.ctr.seriesOrder), generic(outputs.sar.seriesOrder), 'chart/legend series order identical');
  assert.deepEqual(generic(outputs.ctr.headers), ['Month', 'VOLUME', 'Avg Filing Days', 'REG', 'GOAL']);
  assert.deepEqual(generic(outputs.ctr.headers), generic(outputs.sar.headers), 'workbook column order identical');
  assert.equal(outputs.ctr.monthLabels.length, 13);
  assert.deepEqual(outputs.ctr.monthLabels, outputs.sar.monthLabels, 'category month labels identical');
  // Token VALUES compared after masking type-specific words/numbers — catches
  // wording, symbol, and structure drift the key-set check would miss (codex).
  // Direction arrows/verbs and goal-met marks are data-driven, so they
  // normalize too — structure, not outcomes, must match.
  const normTokens = (tokens) => Object.fromEntries(Object.entries(tokens).map(([k, v]) => [
    k, String(v)
      .replace(/CTR|SAR/g, 'T')
      .replace(/[\d.]+/g, 'N')
      .replace(/[▲▼■]/g, 'DIR')
      .replace(/Improved N Days|Slower by N Days|Unchanged vs prior month/g, 'DELTA')
      .replace(/[✓✗]/g, 'MARK'),
  ]));
  assert.deepEqual(normTokens(outputs.ctr.tokens), normTokens(outputs.sar.tokens),
    'KPI card token values structurally identical');
  assert.equal(outputs.ctr.chartSkeleton, outputs.sar.chartSkeleton, 'injected chart structure identical');
});

test('buildReportData produces the spec token set', () => {
  const model = sampleModel();
  const { tokens, columns } = buildReportData(model, {});
  assert.deepEqual(Object.keys(tokens), [
    'REPORT_TITLE', 'REPORT_SUBTITLE', 'KPI_MONTHLY', 'KPI_MONTHLY_NOTE',
    'KPI_MOM', 'KPI_MOM_NOTE', 'KPI_HIST', 'KPI_HIST_NOTE',
  ]);
  assert.equal(columns.length, 5);
  assert.match(tokens.KPI_MONTHLY, /Days$/);
  assert.match(tokens.KPI_MONTHLY_NOTE, /% of 5-day goal [✓✗]/u);
});
