/**
 * KPI Engine validation (SRS Ch. 14): benchmark records with manually
 * calculated expected values, plus an integration pass over the bundled
 * sample CSVs. Run: node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseDate, parseNumber, parseBool, daysBetween, monthKey, rollingMonths,
  validateHeaders, normalizeRecords, filterRecords, aggregateMonthly,
  summarize, latestMonth, computePerformanceKpis,
  aggregateAlertsMonthly, alertWorkflowSeries,
} from '../src/engines/kpiEngine.js';
import { activeGoalVersion, classify, evaluate } from '../src/engines/goalEngine.js';
import { computeEmployeeStats } from '../src/engines/employeeAnalytics.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mappings = JSON.parse(readFileSync(join(root, 'config/header-mappings.json'), 'utf8'));
const statusMappings = JSON.parse(readFileSync(join(root, 'config/status-mappings.json'), 'utf8'));
const goalsConfig = JSON.parse(readFileSync(join(root, 'config/goals.json'), 'utf8'));

// Minimal CSV parser for tests (handles quoted fields)
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.some((v) => v !== '')).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

// ---------------------------------------------------------------- parsing

test('date parsing handles Verafin MM/DD/YYYY and ISO formats', () => {
  assert.equal(monthKey(parseDate('05/06/2025')), '2025-05');
  assert.equal(monthKey(parseDate('2025-05-06')), '2025-05');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
});

test('invalid calendar dates are rejected, not rolled over (codex fix)', () => {
  assert.equal(parseDate('02/31/2026'), null);
  assert.equal(parseDate('2026-02-31'), null);
  assert.equal(parseDate('13/01/2026'), null);
  assert.equal(parseDate('00/10/2026'), null);
  assert.equal(monthKey(parseDate('02/29/2024')), '2024-02'); // real leap day still parses
  assert.equal(parseDate('02/29/2026'), null);                // non-leap year
});

test('number and boolean parsing', () => {
  assert.equal(parseNumber('$12,500.50'), 12500.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseBool('Yes'), true);
  assert.equal(parseBool('No'), false);
});

test('daysBetween computes calendar-day durations', () => {
  assert.equal(daysBetween(parseDate('01/01/2026'), parseDate('01/06/2026')), 5);
  assert.equal(daysBetween(null, parseDate('01/06/2026')), null);
});

test('rollingMonths returns a 13-month window ending at the given month', () => {
  const months = rollingMonths('2026-06', 13);
  assert.equal(months.length, 13);
  assert.equal(months[0], '2025-06');
  assert.equal(months[12], '2026-06');
});

// ---------------------------------------------------------------- benchmark CTR record (hand-calculated)

const benchmarkCtrRow = {
  'Entity Names': 'Test Entity', 'Activity End Date': '01/01/2026',
  'Total Cash In': '15000', 'Total Cash Out': '0',
  'Assigned Owner Name': 'Analyst A', 'Status': 'Accepted',
  'Due Date': '01/16/2026', 'Creation Date': '01/02/2026',
  'Document Control Number': 'DCN-1', 'Report Number': 'CTR-1',
  'Accepted Date': '01/06/2026', 'Queue Failed': 'No',
  'Queued By': 'Analyst B', 'Queued Date': '01/03/2026',
  'Submitted Date': '01/05/2026', 'Branch Number': '101',
};

test('CTR benchmark: workflow durations match manual calculation (SRS 14.4)', () => {
  const { records } = normalizeRecords([benchmarkCtrRow], 'ctr', mappings, statusMappings);
  const r = records[0];
  assert.equal(r.dStartToQueue, 1);    // 01/02 → 01/03
  assert.equal(r.dQueueToSubmit, 2);   // 01/03 → 01/05
  assert.equal(r.dSubmitToAccept, 1);  // 01/05 → 01/06
  assert.equal(r.dStartToAccept, 4);   // 01/02 → 01/06
  assert.equal(r.dStartToDue, 14);
  assert.equal(r.daysRemaining, 10);   // accepted 10 days before due
  assert.equal(r.onTime, true);
  assert.equal(r.statusCategory, 'accepted');
});

test('late filing is flagged past due and classified red', () => {
  const late = { ...benchmarkCtrRow, 'Report Number': 'CTR-2', 'Accepted Date': '01/20/2026', 'Submitted Date': '01/19/2026' };
  const { records } = normalizeRecords([late], 'ctr', mappings, statusMappings);
  assert.equal(records[0].onTime, false);
  assert.equal(records[0].dStartToAccept, 18);
  assert.equal(classify(18, 5, 15), 'red');
  assert.equal(classify(4, 5, 15), 'green');
  assert.equal(classify(10, 5, 15), 'yellow');
});

test('status normalization is configuration-driven (SRS 11.6)', () => {
  const rows = [
    { ...benchmarkCtrRow, 'Report Number': 'A', 'Status': 'Cancelled' },
    { ...benchmarkCtrRow, 'Report Number': 'B', 'Status': 'In Progress' },
    { ...benchmarkCtrRow, 'Report Number': 'C', 'Status': 'Weird Status' },
    { ...benchmarkCtrRow, 'Report Number': 'D', 'Queue Failed': 'Yes' },
  ];
  const { records } = normalizeRecords(rows, 'ctr', mappings, statusMappings);
  assert.deepEqual(records.map((r) => r.statusCategory), ['excluded', 'pending', 'other', 'queueFailed']);
});

test('duplicate report numbers are skipped; blank rows ignored (SRS 11.8)', () => {
  const rows = [
    benchmarkCtrRow,
    { ...benchmarkCtrRow },                       // duplicate report number
    Object.fromEntries(Object.keys(benchmarkCtrRow).map((k) => [k, ''])), // blank
  ];
  const { records, duplicates, blankRows } = normalizeRecords(rows, 'ctr', mappings, statusMappings);
  assert.equal(records.length, 1);
  assert.equal(duplicates, 1);
  assert.equal(blankRows, 1);
});

test('rows missing mandatory fields are blocked from KPI models (codex fix)', () => {
  const rows = [
    benchmarkCtrRow,
    { ...benchmarkCtrRow, 'Report Number': 'CTR-3', 'Creation Date': '' },  // no workflow anchor
    { ...benchmarkCtrRow, 'Report Number': '' },                            // no report number
  ];
  const { records, errors } = normalizeRecords(rows, 'ctr', mappings, statusMappings);
  assert.equal(records.length, 1);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Creation Date/);
  assert.match(errors[1], /Report Number/);
});

test('missing required header is detected (SRS 12.16 acceptance test)', () => {
  const headers = mappings.ctr.required.filter((h) => h !== 'Accepted Date');
  const check = validateHeaders(headers, 'ctr', mappings);
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ['Accepted Date']);
});

test('SAR workflow starts at Date of Determination; Queued Date is optional', () => {
  const sarRow = {
    'Entity Names': 'E', 'Activity End Date': '01/01/2026', 'Total Value': '50000',
    'Assigned Owner Name': 'Analyst A', 'Status': 'Accepted', 'Due Date': '02/09/2026',
    'Creation Date': '01/05/2026', 'Document Control Number': 'D', 'Report Number': 'SAR-1',
    'Queued By': '', 'Date of Determination': '01/10/2026', 'Accepted Date': '02/04/2026',
    'Primary Activity Subtype': 'Check Fraud', 'Primary Activity Type': 'Fraud',
    'Queue Failed': 'No', 'Submitted Date': '02/01/2026', 'Type of Filing': 'Initial',
    // no 'Queued Date' column at all
  };
  const headerCheck = validateHeaders(Object.keys(sarRow), 'sar', mappings);
  assert.equal(headerCheck.ok, true);
  const { records } = normalizeRecords([sarRow], 'sar', mappings, statusMappings);
  const r = records[0];
  assert.equal(r.dStartToAccept, 25);  // determination 01/10 → accepted 02/04
  assert.equal(r.dStartToQueue, null); // queued date absent
  assert.equal(r.onTime, true);        // accepted 02/04 ≤ due 02/09
  assert.equal(classify(25, 21, 30), 'yellow');
});

// ---------------------------------------------------------------- performance trend

test('completed-filings cohort: Accepted Date, pending-Submitted fallback, non-filings excluded (codex fix)', () => {
  const rows = [
    benchmarkCtrRow,                                                                        // accepted 01/06
    { ...benchmarkCtrRow, 'Report Number': 'CTR-SUB', 'Status': 'Open', 'Accepted Date': '', 'Submitted Date': '02/03/2026' },
    { ...benchmarkCtrRow, 'Report Number': 'CTR-NONE', 'Status': 'Open', 'Accepted Date': '', 'Submitted Date': '', 'Queued Date': '' },
    // Excluded/queue-failed rows carrying a Submitted Date must NOT count as completed filings
    { ...benchmarkCtrRow, 'Report Number': 'CTR-EXC', 'Status': 'Excluded', 'Accepted Date': '', 'Submitted Date': '02/10/2026' },
    { ...benchmarkCtrRow, 'Report Number': 'CTR-QF', 'Queue Failed': 'Yes', 'Accepted Date': '', 'Submitted Date': '02/12/2026' },
  ];
  const { records } = normalizeRecords(rows, 'ctr', mappings, statusMappings);
  const monthly = aggregateMonthly(records, ['2026-01', '2026-02']);
  assert.equal(monthly[0].completedFilings, 1);     // accepted in Jan
  assert.equal(monthly[1].completedFilings, 1);     // pending submitted-only lands in Feb; excluded/QF ignored
  assert.equal(monthly[0].avgFilingDaysEff, 4);     // Creation→Accepted
  assert.equal(monthly[1].avgFilingDaysEff, 32);    // fallback Creation→Submitted (01/02→02/03), no pollution from non-filings
});

test('goal-based performance KPIs: % of internal goal, day deltas, dual-bound status', () => {
  const mk = (avg) => ({ avgFilingDaysEff: avg, completedFilings: 10 });
  const perf = computePerformanceKpis([mk(4.2), mk(3.8)], 5, 15);
  assert.equal(perf.currentAvgDays, 3.8);
  assert.equal(perf.monthlyPerformancePct, 76);        // 3.8 / 5
  assert.equal(perf.monthlyPerformanceStatus, 'green'); // ≤ 5-day goal
  assert.equal(perf.meetsGoal, true);
  assert.equal(perf.momDeltaDays, -0.4);                // improved 0.4 days
  assert.equal(perf.momImproving, true);
  // between goal and regulatory deadline → yellow; beyond deadline → red
  assert.equal(computePerformanceKpis([mk(5), mk(9)], 5, 15).monthlyPerformanceStatus, 'yellow');
  assert.equal(computePerformanceKpis([mk(5), mk(16)], 5, 15).monthlyPerformanceStatus, 'red');
  assert.equal(computePerformanceKpis([mk(5), mk(9)], 5, 15).meetsGoal, false);
});

test('missing goal config yields info status, not a compliance color (codex fix)', () => {
  const mk = (avg) => ({ avgFilingDaysEff: avg, completedFilings: 10 });
  const perf = computePerformanceKpis([mk(4), mk(6)], null, null);
  assert.equal(perf.monthlyPerformanceStatus, 'info');
  assert.equal(perf.historicalStatus, 'info');
  assert.equal(perf.monthlyPerformancePct, null);
  assert.equal(computePerformanceKpis([mk(4), mk(6)], undefined).monthlyPerformanceStatus, 'info');
});

test('performance KPI cards: monthly %, MoM variance, 12-month historical', () => {
  const mk = (avg) => ({ avgFilingDaysEff: avg, completedFilings: 10 });
  // 13 months: twelve at 12 days, current at 13.8 days, target 15
  const monthly = [...Array.from({ length: 12 }, () => mk(12)), mk(13.8)];
  const perf = computePerformanceKpis(monthly, 15);
  assert.equal(perf.monthlyPerformancePct, 92);            // 13.8 / 15
  assert.equal(perf.monthlyPerformanceStatus, 'green');    // ≤95%
  assert.equal(perf.momVariancePct, 15);                   // (13.8-12)/12
  assert.equal(perf.momImproving, false);
  assert.equal(perf.historicalAvgDays, 12);
  assert.equal(perf.historicalPct, 80);
  assert.equal(perf.historicalStatus, 'green');
  // exceeding target goes red; improving MoM is flagged
  const worse = computePerformanceKpis([mk(10), mk(16.5)], 15);
  assert.equal(worse.monthlyPerformancePct, 110);
  assert.equal(worse.monthlyPerformanceStatus, 'red');
  const better = computePerformanceKpis([mk(10), mk(9)], 15);
  assert.equal(better.momImproving, true);
  assert.equal(better.momVariancePct, -10);
  // no data → info, no compliance color
  const empty = computePerformanceKpis([mk(null), mk(null)], 15);
  assert.equal(empty.monthlyPerformanceStatus, 'info');
  assert.equal(empty.momVariancePct, null);
});

// ---------------------------------------------------------------- alerts module

const alertRow = (overrides = {}) => ({
  'Alert ID': 'A-1', 'Creation Date': '01/02/2026', 'Acknowledgement Date': '',
  'Disposition Date': '', 'Owner Name': 'Analyst A', 'Assigned Owner Username': 'aanalyst',
  'Product': 'Verafin', 'Module': 'Structuring', 'Analytic': 'Cash Structuring Detection',
  'Risk': 'High', 'Alert State': 'Closed', 'Result State': 'Not Suspicious',
  'Branch Number': '101', 'SAR Filed': 'No', 'Investigated': 'No', ...overrides,
});

test('alert workflows classify per spec: review / case / sar / open', () => {
  const rows = [
    alertRow({ 'Alert ID': 'R1', 'Acknowledgement Date': '01/05/2026' }),                                      // review: 3 days
    alertRow({ 'Alert ID': 'C1', 'Investigated': 'Yes', 'Disposition Date': '02/01/2026' }),                    // case: 30 days
    alertRow({ 'Alert ID': 'S1', 'Investigated': 'Yes', 'SAR Filed': 'Yes', 'Disposition Date': '02/21/2026' }),// sar: 50 days
    alertRow({ 'Alert ID': 'O1', 'Alert State': 'Open' }),                                                      // open
  ];
  const { records } = normalizeRecords(rows, 'alerts', mappings, statusMappings);
  const by = Object.fromEntries(records.map((r) => [r.reportNumber, r]));
  assert.equal(by.R1.alertWorkflow, 'review');
  assert.equal(by.R1.dInvestigationDays, 3);   // Creation → Acknowledgement
  assert.equal(by.C1.alertWorkflow, 'case');
  assert.equal(by.C1.dInvestigationDays, 30);  // Creation → Disposition
  assert.equal(by.S1.alertWorkflow, 'sar');
  assert.equal(by.S1.dInvestigationDays, 50);
  assert.equal(by.O1.statusCategory, 'open');
  assert.equal(by.O1.dInvestigationDays, null);
});

test('alert edge cases: inconsistent date/flag combinations (codex fix)', () => {
  const rows = [
    // Disposition without Investigated: closed at review via fallback, not still-open
    alertRow({ 'Alert ID': 'DISP_NO_INV', 'Disposition Date': '02/10/2026' }),
    // Ack + disposition + investigated: case, completion = disposition, no double count
    alertRow({ 'Alert ID': 'ACK_THEN_CASE', 'Acknowledgement Date': '01/03/2026', 'Investigated': 'Yes', 'Disposition Date': '02/10/2026' }),
    // Ack + disposition, NOT investigated: review, completion = acknowledgement
    alertRow({ 'Alert ID': 'ACK_AND_DISP', 'Acknowledgement Date': '01/04/2026', 'Disposition Date': '02/15/2026' }),
  ];
  const { records } = normalizeRecords(rows, 'alerts', mappings, statusMappings);
  const by = Object.fromEntries(records.map((r) => [r.reportNumber, r]));

  assert.equal(by.DISP_NO_INV.alertWorkflow, 'review');
  assert.equal(by.DISP_NO_INV.statusCategory, 'completed', 'disposed row is not still-open');
  assert.equal(by.DISP_NO_INV.dInvestigationDays, 39);      // 01/02 → 02/10 fallback

  assert.equal(by.ACK_THEN_CASE.alertWorkflow, 'case');
  assert.equal(by.ACK_THEN_CASE.dInvestigationDays, 39);    // disposition governs, ack ignored

  assert.equal(by.ACK_AND_DISP.alertWorkflow, 'review');
  assert.equal(by.ACK_AND_DISP.dInvestigationDays, 2);      // acknowledgement governs

  // funnel: nothing lands in stillOpen; each row buckets exactly once
  const monthly = aggregateAlertsMonthly(records, ['2026-01', '2026-02']);
  const jan = monthly[0];
  assert.equal(jan.created, 3);
  assert.equal(jan.stillOpen, 0);
  assert.equal(jan.closedAtAlert, 2);
  assert.equal(jan.escalatedToCase, 1);
  // completion-month buckets: reviews split Jan/Feb, case in Feb
  assert.equal(monthly[0].reviewCompleted + monthly[1].reviewCompleted, 2);
  assert.equal(monthly[1].caseCompleted, 1);
});

test('alert aggregation: perf series by completion month, funnel by creation cohort', () => {
  const rows = [
    alertRow({ 'Alert ID': 'R1', 'Acknowledgement Date': '01/05/2026' }),                                       // created+done Jan
    alertRow({ 'Alert ID': 'C1', 'Investigated': 'Yes', 'Disposition Date': '02/10/2026' }),                    // created Jan, done Feb
    alertRow({ 'Alert ID': 'S1', 'Investigated': 'Yes', 'SAR Filed': 'Yes', 'Disposition Date': '02/20/2026' }),
    alertRow({ 'Alert ID': 'O1', 'Alert State': 'Open' }),
  ];
  const { records } = normalizeRecords(rows, 'alerts', mappings, statusMappings);
  const monthly = aggregateAlertsMonthly(records, ['2026-01', '2026-02']);
  const [jan, feb] = monthly;
  // funnel: all four bucket to their January creation cohort by outcome
  assert.equal(jan.created, 4);
  assert.equal(jan.closedAtAlert, 1);
  assert.equal(jan.escalatedToCase, 1);
  assert.equal(jan.resultedInSar, 1);
  assert.equal(jan.stillOpen, 1);
  assert.equal(jan.closedAtAlert + jan.escalatedToCase + jan.resultedInSar + jan.stillOpen, jan.created);
  // performance: completions land in their completion months
  assert.equal(jan.reviewCompleted, 1);
  assert.equal(jan.reviewAvgDays, 3);
  assert.equal(feb.caseCompleted, 1);
  assert.equal(feb.caseAvgDays, 39);   // 01/02 → 02/10
  assert.equal(feb.sarCompleted, 1);
  assert.equal(feb.sarAvgDays, 49);    // 01/02 → 02/20
  assert.equal(feb.totalAvgDays, 44);  // (39+49)/2
  // workflow series mapper produces the perf-KPI shape
  const caseSeries = alertWorkflowSeries(monthly, 'case');
  assert.deepEqual(caseSeries.map((x) => x.completedFilings), [0, 1]);
  assert.deepEqual(caseSeries.map((x) => x.avgFilingDaysEff), [null, 39]);
});

test('sample Alerts CSV: outcomes partition every creation cohort', () => {
  const rows = parseCsv(readFileSync(join(root, 'examples/alerts-sample.csv'), 'utf8'));
  const { records, errors } = normalizeRecords(rows, 'alerts', mappings, statusMappings);
  assert.ok(records.length > 2000, `expected >2000 alerts, got ${records.length}`);
  assert.equal(errors.length, 0);
  const months = rollingMonths(latestMonth(records), 13);
  const monthly = aggregateAlertsMonthly(records, months);
  for (const m of monthly) {
    assert.equal(m.closedAtAlert + m.escalatedToCase + m.resultedInSar + m.stillOpen, m.created,
      `month ${m.month} outcomes must partition the creation cohort`);
  }
  // workload ordering sanity: reviews resolve faster than cases, cases faster than SAR investigations
  const avgOf = (key) => {
    const v = monthly.map((x) => x[key]).filter((x) => x != null);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  assert.ok(avgOf('reviewAvgDays') < avgOf('caseAvgDays'), 'review faster than case');
  assert.ok(avgOf('caseAvgDays') < avgOf('sarAvgDays'), 'case faster than SAR investigation');
  // alert-specific filters narrow the set
  const highRisk = filterRecords(records, { risk: 'High' });
  assert.ok(highRisk.length > 0 && highRisk.length < records.length);
  assert.ok(highRisk.every((r) => r.risk === 'High'));
});

// ---------------------------------------------------------------- goal engine

test('goal versions are effective-dated — history preserved (SRS 8.9)', () => {
  const cfg = {
    versions: [
      { version: 1, effectiveDate: '2025-01-01', ctr: { internalTargetDays: 5 }, sar: {} },
      { version: 2, effectiveDate: '2026-03-01', ctr: { internalTargetDays: 4 }, sar: {} },
    ],
  };
  assert.equal(activeGoalVersion(cfg, '2026-01').version, 1);
  assert.equal(activeGoalVersion(cfg, '2026-03').version, 2);
  assert.equal(activeGoalVersion(cfg, null).version, 2);
});

test('evaluate returns variance and status', () => {
  const e = evaluate('CTR Average Filing Time', 3.8, 5, 15);
  assert.equal(e.variance, -1.2);
  assert.equal(e.status, 'green');
});

test('no goal version is active before the first effective date (codex fix)', () => {
  const cfg = { versions: [{ version: 1, effectiveDate: '2025-01-01', ctr: {}, sar: {} }] };
  assert.equal(activeGoalVersion(cfg, '2024-12'), null);
  assert.equal(activeGoalVersion(cfg, '2025-01').version, 1);
});

test('expired and disabled goal versions are not selected (codex fix)', () => {
  const cfg = {
    versions: [
      { version: 1, effectiveDate: '2025-01-01', expirationDate: '2025-12-31', ctr: {}, sar: {} },
      { version: 2, effectiveDate: '2026-02-01', status: 'disabled', ctr: {}, sar: {} },
    ],
  };
  assert.equal(activeGoalVersion(cfg, '2025-06').version, 1);
  assert.equal(activeGoalVersion(cfg, '2026-01'), null);  // v1 expired, v2 not yet effective
  assert.equal(activeGoalVersion(cfg, '2026-03'), null);  // v2 disabled
});

test('classify returns info (not a compliance color) when goal config is missing (codex fix)', () => {
  assert.equal(classify(1, null, null), 'info');
  assert.equal(classify(1, undefined, undefined), 'info');
  assert.equal(classify(null, 5, 15), 'info');
  assert.equal(classify(7, 5, null), 'yellow'); // target without threshold still classifies
});

// ---------------------------------------------------------------- sample CSV integration

function loadSample(type) {
  const text = readFileSync(join(root, `examples/${type}-sample.csv`), 'utf8');
  return normalizeRecords(parseCsv(text), type, mappings, statusMappings);
}

test('sample CTR CSV imports cleanly and aggregates a full 13-month window', () => {
  const { records, duplicates } = loadSample('ctr');
  assert.ok(records.length > 800, `expected >800 records, got ${records.length}`);
  assert.equal(duplicates, 0);
  const months = rollingMonths(latestMonth(records), 13);
  const monthly = aggregateMonthly(records, months);
  assert.equal(monthly.length, 13);
  for (const m of monthly) assert.ok(m.created > 0, `month ${m.month} has no created records`);
  // month status buckets partition the created cohort
  for (const m of monthly) {
    assert.equal(m.acceptedByStart + m.excluded + m.pending + m.queueFailed + m.other, m.created);
  }
  const s = summarize(records);
  assert.ok(s.avgFilingDays > 0 && s.avgFilingDays < 15, `implausible CTR avg filing days ${s.avgFilingDays}`);
  assert.ok(s.onTimePct > 50 && s.onTimePct <= 100);
});

test('sample SAR CSV: filing-type filters partition records', () => {
  const { records } = loadSample('sar');
  const initial = filterRecords(records, { filingType: 'initial' });
  const continuing = filterRecords(records, { filingType: 'continuing' });
  assert.equal(initial.length + continuing.length, records.length);
  assert.ok(initial.length > continuing.length);
  const s = summarize(records);
  assert.ok(s.avgFilingDays > 10 && s.avgFilingDays < 30, `implausible SAR avg filing days ${s.avgFilingDays}`);
});

test('filters: owner + month narrow the record set consistently', () => {
  const { records } = loadSample('ctr');
  const owner = records[0].owner;
  const month = latestMonth(records);
  const filtered = filterRecords(records, { owners: [owner], month });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((r) => r.owner === owner));
  assert.ok(filtered.every((r) => monthKey(r.workflowStart) === month));
});

test('productivity rewards completed work, not assigned rows (codex fix)', () => {
  const mk = (rn, owner, status, extra = {}) => ({
    ...benchmarkCtrRow, 'Report Number': rn, 'Assigned Owner Name': owner, 'Status': status, ...extra,
  });
  const rows = [
    mk('P1', 'Pending Pat', 'Open', { 'Queued Date': '', 'Submitted Date': '', 'Accepted Date': '' }),
    mk('P2', 'Pending Pat', 'Open', { 'Queued Date': '', 'Submitted Date': '', 'Accepted Date': '' }),
    mk('P3', 'Pending Pat', 'Open', { 'Queued Date': '', 'Submitted Date': '', 'Accepted Date': '' }),
    mk('A1', 'Finisher Fran', 'Accepted'),
  ];
  const { records } = normalizeRecords(rows, 'ctr', mappings, statusMappings);
  const stats = computeEmployeeStats({ ctrRecords: records, sarRecords: [], goalsConfig, scoring: goalsConfig.scoring });
  const pat = stats.find((s) => s.name === 'Pending Pat');
  const fran = stats.find((s) => s.name === 'Finisher Fran');
  assert.equal(pat.productivityIndex, 0, 'pending-only analyst must not score productivity');
  assert.equal(fran.productivityIndex, 100);
  assert.ok(pat.workloadIndex > pat.productivityIndex, 'workload (assigned) is distinct from productivity (completed)');
});

test('employee analytics produce reproducible 0–100 indexes (SRS 7.14)', () => {
  const ctr = loadSample('ctr').records;
  const sar = loadSample('sar').records;
  const run = () => computeEmployeeStats({
    ctrRecords: ctr, sarRecords: sar, goalsConfig, scoring: goalsConfig.scoring,
    months: rollingMonths(latestMonth(ctr), 13),
  });
  const stats = run();
  assert.equal(stats.length, 8, 'expected 8 analysts');
  for (const s of stats) {
    assert.ok(s.overallIndex >= 0 && s.overallIndex <= 100, `${s.name} overall ${s.overallIndex}`);
    assert.ok(s.productivityIndex >= 0 && s.productivityIndex <= 100);
    assert.equal(s.trend.length, 13);
  }
  // reproducible: same input → same ranking (SRS 14.11)
  assert.deepEqual(run().map((s) => [s.name, s.overallIndex]), stats.map((s) => [s.name, s.overallIndex]));
  // sorted by overall index descending
  for (let i = 1; i < stats.length; i++) assert.ok(stats[i - 1].overallIndex >= stats[i].overallIndex);
});
