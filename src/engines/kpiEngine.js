/**
 * KPI Engine — the computational core of Altura BSA KPI.
 * One calculation engine, many presentation layers (SRS Ch. 12):
 * all dashboards, KPI cards, employee analytics, and exports derive
 * their values exclusively from the functions in this module.
 * Pure JavaScript: no DOM, no chart, no UI logic.
 */

export const DAY_MS = 86400000;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- parsing

// Rejects rolled-over calendar dates (e.g. 02/31) instead of letting the
// Date constructor silently shift them into the next month.
function calendarDate(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

export function parseDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return calendarDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return calendarDate(+m[3], +m[1], +m[2]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function parseNumber(value) {
  if (value == null) return null;
  const s = String(value).replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseBool(value) {
  return /^(y|yes|true|1)$/i.test(String(value == null ? '' : value).trim());
}

export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round(((b - a) / DAY_MS) * 10) / 10;
}

// ---------------------------------------------------------------- months

export function monthKey(d) {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
}

export function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[+m - 1]} ${y}`;
}

/** Rolling window of month keys ending at endKey (inclusive). */
export function rollingMonths(endKey, count) {
  if (!endKey) return [];
  const [y, m] = endKey.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(monthKey(d));
  }
  return out;
}

export function latestMonth(records) {
  let latest = null;
  for (const r of records) {
    const k = monthKey(r.workflowStart);
    if (k && (!latest || k > latest)) latest = k;
  }
  return latest;
}

// ---------------------------------------------------------------- validation

export function validateHeaders(actualHeaders, type, mappings) {
  const spec = mappings[type];
  const actual = new Set((actualHeaders || []).map((h) => String(h).trim()));
  const missing = spec.required.filter((h) => !actual.has(h));
  const known = new Set([...spec.required, ...spec.optional]);
  const extra = [...actual].filter((h) => h && !known.has(h));
  return { ok: missing.length === 0, missing, extra };
}

// ---------------------------------------------------------------- normalization

export function classifyStatus(record, statusMappings) {
  if (record.queueFailed) return 'queueFailed';
  const s = String(record.status || '').trim().toLowerCase();
  if (statusMappings.accepted.includes(s)) return 'accepted';
  if (statusMappings.excluded.includes(s)) return 'excluded';
  if (statusMappings.pending.includes(s)) return 'pending';
  return 'other';
}

export function computeDurations(rec, type) {
  const start = type === 'ctr' ? rec.creationDate : rec.determinationDate;
  rec.workflowStart = start;
  rec.dStartToQueue = daysBetween(start, rec.queuedDate);
  rec.dQueueToSubmit = daysBetween(rec.queuedDate, rec.submittedDate);
  rec.dSubmitToAccept = daysBetween(rec.submittedDate, rec.acceptedDate);
  rec.dStartToSubmit = daysBetween(start, rec.submittedDate);
  rec.dStartToAccept = daysBetween(start, rec.acceptedDate);
  rec.dStartToDue = daysBetween(start, rec.dueDate);
  // Positive = accepted with days to spare; negative = past due.
  rec.daysRemaining = rec.acceptedDate && rec.dueDate ? daysBetween(rec.acceptedDate, rec.dueDate) : null;
  // On-time (glossary): completed within the regulatory deadline.
  rec.onTime = rec.acceptedDate && rec.dueDate ? rec.acceptedDate <= rec.dueDate : null;
  return rec;
}

/**
 * Normalize parsed CSV rows into immutable-by-convention record objects.
 * Raw rows are never mutated (SRS 13.7 — source data stays immutable).
 */
export function normalizeRecords(rows, type, mappings, statusMappings) {
  const spec = mappings[type];
  const fields = Object.entries(spec.fields);
  const anchorHeader = fields.find(([, def]) => def.key === spec.anchorField)?.[0] || spec.anchorField;
  const records = [];
  const warnings = [];
  const errors = []; // rows blocked from KPI calculation (SRS 11.8)
  const seen = new Set();
  let blankRows = 0;
  let duplicates = 0;
  let invalidDates = 0;

  rows.forEach((row, i) => {
    const values = Object.values(row || {});
    if (!values.some((v) => v != null && String(v).trim() !== '')) {
      blankRows++;
      return;
    }
    const rec = { _row: i + 2, type };
    for (const [header, def] of fields) {
      const raw = row[header];
      if (def.type === 'date') {
        rec[def.key] = parseDate(raw);
        if (raw != null && String(raw).trim() !== '' && rec[def.key] === null) {
          invalidDates++;
          warnings.push(`Row ${i + 2}: invalid date "${raw}" in "${header}"`);
        }
      } else if (def.type === 'number') {
        rec[def.key] = parseNumber(raw);
      } else if (def.type === 'boolean') {
        rec[def.key] = parseBool(raw);
      } else {
        rec[def.key] = raw == null ? '' : String(raw).trim();
      }
    }
    // Mandatory per-row fields: without a Report Number and the workflow
    // anchor date the record cannot enter KPI models (SRS 11.8 — missing
    // required fields prevent KPI calculations until corrected).
    const missing = [];
    if (!rec.reportNumber) missing.push('Report Number');
    if (!rec[spec.anchorField]) missing.push(anchorHeader);
    if (missing.length) {
      errors.push(`Row ${i + 2}: missing required ${missing.join(' and ')} — record excluded until corrected`);
      return;
    }
    if (statusMappings.skipDuplicateReportNumbers) {
      if (seen.has(rec.reportNumber)) {
        duplicates++;
        return;
      }
      seen.add(rec.reportNumber);
    }
    rec.statusCategory = classifyStatus(rec, statusMappings);
    computeDurations(rec, type);
    records.push(rec);
  });

  return { records, warnings, errors, blankRows, duplicates, invalidDates };
}

// ---------------------------------------------------------------- filtering

/**
 * filters: { month, dateFrom, dateTo, owners[], status, branch, queuedBy,
 *            filingType, activityType, activitySubtype }
 */
export function filterRecords(records, f) {
  if (!f) return records;
  return records.filter((r) => {
    if (f.month && monthKey(r.workflowStart) !== f.month) return false;
    if (f.dateFrom && (!r.workflowStart || r.workflowStart < f.dateFrom)) return false;
    if (f.dateTo && (!r.workflowStart || r.workflowStart > f.dateTo)) return false;
    if (f.owners && f.owners.length && !f.owners.includes(r.owner)) return false;
    if (f.status && r.statusCategory !== f.status) return false;
    if (f.branch && String(r.branch) !== String(f.branch)) return false;
    if (f.queuedBy && r.queuedBy !== f.queuedBy) return false;
    if (f.filingType && f.filingType !== 'combined') {
      const ft = String(r.filingType || '').toLowerCase();
      if (f.filingType === 'initial' && !ft.startsWith('initial')) return false;
      if (f.filingType === 'continuing' && !ft.startsWith('continuing')) return false;
    }
    if (f.activityType && r.activityType !== f.activityType) return false;
    if (f.activitySubtype && r.activitySubtype !== f.activitySubtype) return false;
    return true;
  });
}

// ---------------------------------------------------------------- aggregation

const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

/**
 * Aggregate records over a list of month keys (rolling 13 by default).
 * "Created" volume is bucketed by workflow start month (CTR: Creation Date;
 * SAR: Date of Determination — spec assumption A1). Queued/Submitted/Accepted
 * are bucketed by their own event months. Filing-time and on-time metrics use
 * the cohort accepted in each month.
 */
export function aggregateMonthly(records, months) {
  const byMonth = new Map(months.map((k) => [k, {
    month: k,
    label: monthLabel(k),
    created: 0, queued: 0, submitted: 0, accepted: 0, acceptedByStart: 0,
    excluded: 0, pending: 0, queueFailed: 0, other: 0,
    _startToQueue: [], _queueToSubmit: [], _submitToAccept: [], _startToAccept: [],
    _onTime: 0, _onTimeDen: 0,
  }]));

  for (const r of records) {
    const startKey = monthKey(r.workflowStart);
    const startBucket = byMonth.get(startKey);
    if (startBucket) {
      startBucket.created++;
      if (r.statusCategory === 'accepted') startBucket.acceptedByStart++;
      else if (r.statusCategory === 'excluded') startBucket.excluded++;
      else if (r.statusCategory === 'pending') startBucket.pending++;
      else if (r.statusCategory === 'queueFailed') startBucket.queueFailed++;
      else if (r.statusCategory === 'other') startBucket.other++;
    }
    const qBucket = byMonth.get(monthKey(r.queuedDate));
    if (qBucket) qBucket.queued++;
    const sBucket = byMonth.get(monthKey(r.submittedDate));
    if (sBucket) sBucket.submitted++;
    const aBucket = byMonth.get(monthKey(r.acceptedDate));
    if (aBucket) {
      aBucket.accepted++;
      if (r.dStartToQueue != null) aBucket._startToQueue.push(r.dStartToQueue);
      if (r.dQueueToSubmit != null) aBucket._queueToSubmit.push(r.dQueueToSubmit);
      if (r.dSubmitToAccept != null) aBucket._submitToAccept.push(r.dSubmitToAccept);
      if (r.dStartToAccept != null) aBucket._startToAccept.push(r.dStartToAccept);
      if (r.onTime != null) {
        aBucket._onTimeDen++;
        if (r.onTime) aBucket._onTime++;
      }
    }
  }

  return months.map((k) => {
    const b = byMonth.get(k);
    return {
      month: b.month,
      label: b.label,
      created: b.created,
      queued: b.queued,
      submitted: b.submitted,
      accepted: b.accepted,
      acceptedByStart: b.acceptedByStart,
      excluded: b.excluded,
      pending: b.pending,
      queueFailed: b.queueFailed,
      other: b.other,
      avgStartToQueue: avg(b._startToQueue),
      avgQueueToSubmit: avg(b._queueToSubmit),
      avgSubmitToAccept: avg(b._submitToAccept),
      avgFilingDays: avg(b._startToAccept),
      onTimePct: pct(b._onTime, b._onTimeDen),
    };
  });
}

/** Summary KPIs over a filtered record set (drives KPI cards). */
export function summarize(records) {
  const accepted = records.filter((r) => r.statusCategory === 'accepted');
  const withFiling = records.filter((r) => r.dStartToAccept != null);
  const onTimeDen = records.filter((r) => r.onTime != null);
  const onTimeNum = onTimeDen.filter((r) => r.onTime);
  return {
    total: records.length,
    accepted: accepted.length,
    excluded: records.filter((r) => r.statusCategory === 'excluded').length,
    pending: records.filter((r) => r.statusCategory === 'pending').length,
    queueFailed: records.filter((r) => r.statusCategory === 'queueFailed').length,
    other: records.filter((r) => r.statusCategory === 'other').length,
    submitted: records.filter((r) => r.submittedDate).length,
    avgFilingDays: avg(withFiling.map((r) => r.dStartToAccept)),
    onTimePct: pct(onTimeNum.length, onTimeDen.length),
    pastDue: onTimeDen.length - onTimeNum.length,
  };
}

/** Group summary rows by an arbitrary field (activity type, branch, …). */
export function groupBy(records, field) {
  const map = new Map();
  for (const r of records) {
    const k = r[field] || '(blank)';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()]
    .map(([key, recs]) => ({ key, ...summarize(recs) }))
    .sort((a, b) => b.total - a.total);
}
