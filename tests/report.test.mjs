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

function sampleModel() {
  const rows = parseCsv(readFileSync(join(root, 'examples/ctr-sample.csv'), 'utf8'));
  const { records } = normalizeRecords(rows, 'ctr', mappings, statusMappings);
  const months = rollingMonths(latestMonth(records), 13);
  const monthly = aggregateMonthly(records, months);
  return {
    monthly,
    months,
    summary: summarize(records),
    goals: goalsConfig.versions[goalsConfig.versions.length - 1].ctr,
    currentMonth: months[12],
    currentMonthLabel: monthly[12].label,
    dateRangeLabel: `${monthly[0].label} – ${monthly[12].label}`,
  };
}

async function loadMaster() {
  return JSZip.loadAsync(readFileSync(join(root, 'template/ctr-executive-master.pptx')));
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
