/**
 * Generates deterministic sample Verafin-style CTR/SAR CSV exports into
 * examples/ so the application is demoable without real data.
 * Run: node tools/generate-samples.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Mulberry32 seeded PRNG — deterministic output
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260701);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const OWNERS = ['Maria Delgado', 'James Whitfield', 'Priya Natarajan', 'Kevin O’Rourke', 'Dana Kim', 'Luis Herrera', 'Ashley Tran', 'Robert Ellison'];
const QUEUERS = OWNERS.slice(0, 5);
const BRANCHES = ['101', '102', '104', '107', '110', '112', '115', '118', '121', '125'];
const ENTITIES = ['Sunrise Market LLC', 'Golden State Autos', 'Rivera & Sons Trucking', 'Desert Bloom Nursery', 'Pacific Coast Vending', 'Inland Empire Liquor', 'Canyon Ridge Motors', 'Mesa Verde Grocers', 'High Desert Storage', 'Citrus Valley Farms', 'Redlands Pawn & Jewelry', 'Moreno Valley Transport'];
const SAR_TYPES = {
  'Structuring': ['Cash Structuring', 'Funnel Account Activity'],
  'Fraud': ['Check Fraud', 'Wire Fraud', 'ACH Fraud'],
  'Money Laundering': ['Layering', 'Trade-Based Laundering'],
  'Identity Theft': ['Account Takeover', 'Synthetic Identity'],
  'Elder Financial Exploitation': ['Caregiver Abuse', 'Romance Scam'],
};

// Months May 2025 → Jun 2026 (rolling 13 ending Jun 2026 is fully populated)
const MONTHS = [];
for (let i = 0; i < 14; i++) MONTHS.push(new Date(2025, 4 + i, 1));

const fmtDate = (d) => d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}` : '';
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))].join('\n') + '\n';

// Performance drifts by month so trends are visible: mid-year slump, recovery.
const drift = (i) => (i >= 5 && i <= 8 ? 1.8 : i >= 12 ? 0.7 : 1.0);

// ------------------------------------------------------------------ CTR

const ctrHeaders = ['Entity Names', 'Activity End Date', 'Total Cash In', 'Total Cash Out', 'Assigned Owner Name', 'Status', 'Due Date', 'Creation Date', 'Document Control Number', 'Report Number', 'Accepted Date', 'Queue Failed', 'Queued By', 'Queued Date', 'Submitted Date', 'Branch Number'];
const ctrRows = [];
let ctrSeq = 40001;

MONTHS.forEach((monthStart, mi) => {
  const volume = between(58, 104);
  const isCurrentish = mi >= 12; // recent months have more pending work
  for (let n = 0; n < volume; n++) {
    const creation = addDays(monthStart, between(0, 27));
    const activityEnd = addDays(creation, -between(1, 3));
    const due = addDays(activityEnd, 15);
    const roll = rand();
    let status, queued = null, submitted = null, accepted = null, queueFailed = false;
    if (roll < 0.05) {
      status = 'Excluded';
    } else if (roll < 0.08 && !isCurrentish) {
      status = 'Queue Failed'; queueFailed = true;
      queued = addDays(creation, between(1, 3));
    } else if (isCurrentish && roll < 0.18) {
      status = pick(['Open', 'In Progress', 'Queued']);
      if (status === 'Queued') queued = addDays(creation, between(0, 3));
    } else {
      status = 'Accepted';
      const slow = rand() < 0.12 * drift(mi);
      queued = addDays(creation, slow ? between(3, 7) : between(0, 2));
      submitted = addDays(queued, slow ? between(2, 6) : between(0, 2));
      accepted = addDays(submitted, slow ? between(2, 8) : between(0, 2));
    }
    ctrRows.push({
      'Entity Names': pick(ENTITIES),
      'Activity End Date': fmtDate(activityEnd),
      'Total Cash In': between(10500, 240000),
      'Total Cash Out': rand() < 0.35 ? between(10500, 90000) : 0,
      'Assigned Owner Name': pick(OWNERS),
      'Status': status,
      'Due Date': fmtDate(due),
      'Creation Date': fmtDate(creation),
      'Document Control Number': `DCN-${ctrSeq}`,
      'Report Number': `CTR-2026-${ctrSeq++}`,
      'Accepted Date': fmtDate(accepted),
      'Queue Failed': queueFailed ? 'Yes' : 'No',
      'Queued By': queued ? pick(QUEUERS) : '',
      'Queued Date': fmtDate(queued),
      'Submitted Date': fmtDate(submitted),
      'Branch Number': pick(BRANCHES),
    });
  }
});

// ------------------------------------------------------------------ SAR

const sarHeaders = ['Entity Names', 'Activity End Date', 'Total Value', 'Assigned Owner Name', 'Status', 'Due Date', 'Creation Date', 'Document Control Number', 'Report Number', 'Queued By', 'Date of Determination', 'Accepted Date', 'FI Note to FinCEN', 'Primary Activity Subtype', 'Primary Activity Type', 'Queue Failed', 'Submitted Date', 'Type of Filing'];
const sarRows = [];
let sarSeq = 7001;

MONTHS.forEach((monthStart, mi) => {
  const volume = between(13, 27);
  const isCurrentish = mi >= 12;
  for (let n = 0; n < volume; n++) {
    const determination = addDays(monthStart, between(0, 27));
    const creation = addDays(determination, -between(2, 12));
    const activityEnd = addDays(determination, -between(5, 40));
    const due = addDays(determination, 30);
    const activityType = pick(Object.keys(SAR_TYPES));
    const filingType = rand() < 0.72 ? 'Initial' : 'Continuing Activity Report';
    const roll = rand();
    let status, queued = null, submitted = null, accepted = null, queueFailed = false;
    if (roll < 0.06) {
      status = 'Excluded';
    } else if (roll < 0.09 && !isCurrentish) {
      status = 'Queue Failed'; queueFailed = true;
      queued = addDays(determination, between(5, 15));
    } else if (isCurrentish && roll < 0.25) {
      status = pick(['Open', 'In Progress']);
    } else {
      status = 'Accepted';
      const slow = rand() < 0.15 * drift(mi);
      queued = addDays(determination, slow ? between(15, 24) : between(6, 15));
      submitted = addDays(queued, slow ? between(4, 9) : between(1, 4));
      accepted = addDays(submitted, slow ? between(3, 7) : between(1, 3));
    }
    sarRows.push({
      'Entity Names': pick(ENTITIES),
      'Activity End Date': fmtDate(activityEnd),
      'Total Value': between(9000, 480000),
      'Assigned Owner Name': pick(OWNERS),
      'Status': status,
      'Due Date': fmtDate(due),
      'Creation Date': fmtDate(creation),
      'Document Control Number': `DCN-S${sarSeq}`,
      'Report Number': `SAR-2026-${sarSeq++}`,
      'Queued By': queued ? pick(QUEUERS) : '',
      'Date of Determination': fmtDate(determination),
      'Accepted Date': fmtDate(accepted),
      'FI Note to FinCEN': rand() < 0.1 ? 'See attached narrative.' : '',
      'Primary Activity Subtype': pick(SAR_TYPES[activityType]),
      'Primary Activity Type': activityType,
      'Queue Failed': queueFailed ? 'Yes' : 'No',
      'Submitted Date': fmtDate(submitted),
      'Type of Filing': filingType,
    });
  }
});

// ------------------------------------------------------------------ Alerts

const MODULES = {
  'Structuring': ['Cash Structuring Detection', 'Funnel Account Analytic'],
  'Wire Fraud': ['High-Risk Wire Pattern', 'Unusual Wire Velocity'],
  'ACH Fraud': ['ACH Return Anomaly', 'New Payee Burst'],
  'Cash Intensive Business': ['Cash Deposit Deviation', 'Business Cash Ratio'],
  'Human Trafficking': ['Late-Night Card Pattern', 'Multi-City Cash Activity'],
  'Terrorist Financing': ['High-Risk Geography Transfer', 'Charity Flow Anomaly'],
};
const RISKS = ['High', 'Medium', 'Low'];
const RESULT_STATES = {
  review: ['Not Suspicious', 'Expected Activity', 'False Positive'],
  caseNoSar: ['Case Closed - No SAR', 'Investigated - Not Reportable'],
  caseSar: ['SAR Filed'],
};

const alertHeaders = ['Alert ID', 'Creation Date', 'Acknowledgement Date', 'Disposition Date', 'Owner Name', 'Assigned Owner Username', 'Product', 'Module', 'Analytic', 'Risk', 'Alert State', 'Result State', 'Branch Number', 'SAR Filed', 'Investigated'];
const alertRows = [];
let alertSeq = 90001;
const username = (name) => name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').map((w, i) => i === 0 ? w[0] : w).join('');

MONTHS.forEach((monthStart, mi) => {
  const volume = between(160, 260);
  const isCurrentish = mi >= 12;
  for (let n = 0; n < volume; n++) {
    const creation = addDays(monthStart, between(0, 27));
    const owner = pick(OWNERS);
    const module_ = pick(Object.keys(MODULES));
    const roll = rand();
    let investigated = false, sarFiled = false, ack = null, disp = null, alertState = 'Closed', resultState = '';
    if (isCurrentish && roll < 0.12) {
      alertState = 'Open';                                   // still in queue
    } else if (roll < 0.78) {
      ack = addDays(creation, between(0, rand() < 0.15 * drift(mi) ? 14 : 6));   // review-only
      resultState = pick(RESULT_STATES.review);
    } else if (roll < 0.93) {
      investigated = true;                                    // case, no SAR
      disp = addDays(creation, between(12, rand() < 0.2 * drift(mi) ? 60 : 45));
      resultState = pick(RESULT_STATES.caseNoSar);
    } else {
      investigated = true; sarFiled = true;                   // SAR-producing
      disp = addDays(creation, between(20, rand() < 0.2 * drift(mi) ? 85 : 65));
      resultState = pick(RESULT_STATES.caseSar);
    }
    alertRows.push({
      'Alert ID': `ALERT-${alertSeq++}`,
      'Creation Date': fmtDate(creation),
      'Acknowledgement Date': fmtDate(ack),
      'Disposition Date': fmtDate(disp),
      'Owner Name': owner,
      'Assigned Owner Username': username(owner),
      'Product': 'Verafin',
      'Module': module_,
      'Analytic': pick(MODULES[module_]),
      'Risk': pick(RISKS),
      'Alert State': alertState,
      'Result State': resultState,
      'Branch Number': pick(BRANCHES),
      'SAR Filed': sarFiled ? 'Yes' : 'No',
      'Investigated': investigated ? 'Yes' : 'No',
    });
  }
});

mkdirSync(join(root, 'examples'), { recursive: true });
writeFileSync(join(root, 'examples', 'ctr-sample.csv'), toCsv(ctrHeaders, ctrRows));
writeFileSync(join(root, 'examples', 'sar-sample.csv'), toCsv(sarHeaders, sarRows));
writeFileSync(join(root, 'examples', 'alerts-sample.csv'), toCsv(alertHeaders, alertRows));
console.log(`Wrote examples/ctr-sample.csv (${ctrRows.length} rows), examples/sar-sample.csv (${sarRows.length} rows), examples/alerts-sample.csv (${alertRows.length} rows)`);
