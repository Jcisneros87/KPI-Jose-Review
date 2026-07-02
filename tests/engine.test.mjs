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
  summarize, latestMonth,
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
