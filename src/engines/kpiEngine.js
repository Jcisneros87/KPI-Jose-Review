/**
 * KPI Engine — the computational core of Altura BSA KPI.
 * One calculation engine, many presentation layers (SRS Ch. 12):
 * all dashboards, KPI cards, employee analytics, and exports derive
 * their values exclusively from the functions in this module.
 * Pure JavaScript: no DOM, no chart, no UI logic.
 */

export const DAY_MS = 86400000;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

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
  // Known formats terminate here (parsed or rejected) — only an actual
  // HH:MM time component may follow the date, never arbitrary junk.
  // Reaching the Date-constructor fallback with a near-miss would roll
  // over invalid days and guess two-digit centuries.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]\d{1,2}:\d{2}|$)/);
  if (m) return calendarDate(+m[1], +m[2], +m[3]);
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return null;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s\d{1,2}:\d{2}|$)/);
  if (m) return calendarDate(+m[3], +m[1], +m[2]);
  // Anything else slash-shaped is malformed (2-digit year, junk suffix) —
  // never let the Date fallback century-guess or roll it over (02/31/26
  // would otherwise become March 3, 2026).
  if (/^\d{1,2}\/\d{1,2}\//.test(s)) return null;
  // Verafin DD-Mon format (engine-independent parse). Alerts exports use
  // 4-digit years (30-Jun-2026); CTR/SAR exports use 2-digit (30-Jun-26),
  // pivoted at 50 (26 → 2026, 99 → 1999). Month must be the exact
  // abbreviation or full English name.
  m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d+)$/);
  if (m) {
    if (m[3].length !== 4 && m[3].length !== 2) return null;
    const y = m[3].length === 2 ? +m[3] + (+m[3] < 50 ? 2000 : 1900) : +m[3];
    const name = m[2].toLowerCase();
    const mo = MONTH_NAMES.findIndex((n, i) =>
      name === n.toLowerCase() || name === MONTH_FULL[i].toLowerCase()) + 1;
    return mo ? calendarDate(y, mo, +m[1]) : null;
  }
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
  if (type === 'alerts') {
    // Three alert workflows (Alerts module spec):
    //  review — never investigated; complete at Acknowledgement Date
    //  case   — investigated, no SAR; complete at Disposition Date
    //  sar    — investigated, SAR filed; complete at Disposition Date
    rec.workflowStart = rec.creationDate;
    rec.alertWorkflow = !rec.investigated ? 'review' : rec.sarFiled ? 'sar' : 'case';
    // Review completion falls back to Disposition Date when Acknowledgement
    // is absent — a disposed-but-uninvestigated row is closed, not still
    // open (codex review fix for inconsistent source data).
    rec.completionDate = rec.alertWorkflow === 'review'
      ? (rec.acknowledgementDate || rec.dispositionDate)
      : rec.dispositionDate;
    rec.dInvestigationDays = daysBetween(rec.creationDate, rec.completionDate);
    rec.statusCategory = rec.completionDate ? 'completed' : 'open';
    return rec;
  }
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
    if (type !== 'alerts') rec.statusCategory = classifyStatus(rec, statusMappings);
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
    if (f.ownerUsername && r.ownerUsername !== f.ownerUsername) return false;
    if (f.product && r.product !== f.product) return false;
    if (f.module && r.module !== f.module) return false;
    if (f.analytic && r.analytic !== f.analytic) return false;
    if (f.risk && r.risk !== f.risk) return false;
    if (f.alertState && r.alertState !== f.alertState) return false;
    if (f.resultState && r.resultState !== f.resultState) return false;
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
    excluded: 0, pending: 0, queueFailed: 0, other: 0, completedFilings: 0,
    _startToQueue: [], _queueToSubmit: [], _submitToAccept: [], _startToAccept: [], _effDays: [],
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
    // "Completed filings" cohort (Performance Trend): accepted records bucket
    // by Accepted Date (falling back to Submitted Date only if acceptance has
    // no date); pending records that reached FinCEN bucket by Submitted Date.
    // Excluded / queue-failed / other rows never count as completed filings —
    // the date fallback must not resurrect non-filings that happen to carry a
    // Submitted Date.
    let completionDate = null;
    let effDays = null;
    if (r.statusCategory === 'accepted') {
      completionDate = r.acceptedDate || r.submittedDate;
      effDays = r.dStartToAccept ?? r.dStartToSubmit;
    } else if (r.statusCategory === 'pending' && r.submittedDate) {
      completionDate = r.submittedDate;
      effDays = r.dStartToSubmit;
    }
    const cBucket = byMonth.get(monthKey(completionDate));
    if (cBucket) {
      cBucket.completedFilings++;
      if (effDays != null) cBucket._effDays.push(effDays);
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
      // Distinct from employee-analytics "completed" (status-driven
      // accepted+excluded): this is the filing-event cohort defined above.
      completedFilings: b.completedFilings,
      avgFilingDaysEff: avg(b._effDays),
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

/**
 * Alerts monthly aggregation (Alerts module spec — three workflows).
 * Per-workflow performance series bucket by COMPLETION month (like the
 * CTR/SAR completed-filings cohort); funnel outcome counts bucket by
 * CREATION month cohort so leadership sees how each month's alert volume
 * ultimately resolved; totalAvgDays is the all-workflow average for alerts
 * completed in the month.
 */
export function aggregateAlertsMonthly(records, months) {
  const byMonth = new Map(months.map((k) => [k, {
    month: k, label: monthLabel(k), created: 0,
    closedAtAlert: 0, escalatedToCase: 0, resultedInSar: 0, stillOpen: 0,
    reviewCompleted: 0, caseCompleted: 0, sarCompleted: 0,
    _review: [], _case: [], _sar: [], _all: [],
  }]));

  for (const r of records) {
    const createdBucket = byMonth.get(monthKey(r.workflowStart));
    if (createdBucket) {
      createdBucket.created++;
      if (!r.completionDate) createdBucket.stillOpen++;
      else if (r.alertWorkflow === 'review') createdBucket.closedAtAlert++;
      else if (r.alertWorkflow === 'case') createdBucket.escalatedToCase++;
      else createdBucket.resultedInSar++;
    }
    const doneBucket = byMonth.get(monthKey(r.completionDate));
    if (doneBucket) {
      if (r.alertWorkflow === 'review') doneBucket.reviewCompleted++;
      else if (r.alertWorkflow === 'case') doneBucket.caseCompleted++;
      else doneBucket.sarCompleted++;
      if (r.dInvestigationDays != null) {
        doneBucket[`_${r.alertWorkflow}`].push(r.dInvestigationDays);
        doneBucket._all.push(r.dInvestigationDays);
      }
    }
  }

  return months.map((k) => {
    const b = byMonth.get(k);
    return {
      month: b.month, label: b.label, created: b.created,
      closedAtAlert: b.closedAtAlert, escalatedToCase: b.escalatedToCase,
      resultedInSar: b.resultedInSar, stillOpen: b.stillOpen,
      reviewCompleted: b.reviewCompleted, reviewAvgDays: avg(b._review),
      caseCompleted: b.caseCompleted, caseAvgDays: avg(b._case),
      sarCompleted: b.sarCompleted, sarAvgDays: avg(b._sar),
      totalAvgDays: avg(b._all),
    };
  });
}

/**
 * Map one alert workflow's series into the shape computePerformanceKpis and
 * the reporting engine consume ({completedFilings, avgFilingDaysEff}).
 */
export function alertWorkflowSeries(alertMonthly, workflow) {
  const volKey = `${workflow}Completed`;
  const avgKey = `${workflow}AvgDays`;
  return alertMonthly.map((m) => ({
    month: m.month,
    label: m.label,
    completedFilings: m[volKey],
    avgFilingDaysEff: m[avgKey],
  }));
}

/**
 * Performance Trend KPI cards (template-driven reporting revision):
 * measured against the INTERNAL goal (5 days), with the regulatory deadline
 * as the outer compliance bound.
 *  - Monthly Performance: current avg filing days + % of internal goal
 *    consumed (76% = 3.8 of 5 allowed days). Green ≤ goal, amber ≤
 *    regulatory deadline, red beyond it.
 *  - MoM Variance: % change and absolute day delta vs prior month
 *    (down = improving).
 *  - 12-Month Historical: rolling average of the 12 months before the
 *    current one, in days and as % of goal.
 * Accepts (monthly, goalDays, regulatoryDays); the legacy 2-arg call
 * treats the second argument as both bounds.
 */
export function computePerformanceKpis(monthly, goalDays, regulatoryDays = goalDays) {
  const dayStatus = (days) =>
    days == null || goalDays == null ? 'info'
      : days <= goalDays ? 'green'
      : regulatoryDays != null && days <= regulatoryDays ? 'yellow'
      : 'red';
  const pctOfGoal = (days) =>
    days == null || !goalDays ? null : Math.round((days / goalDays) * 100);

  const current = monthly[monthly.length - 1] || null;
  const previous = monthly[monthly.length - 2] || null;
  const currentAvg = current?.avgFilingDaysEff ?? null;
  const previousAvg = previous?.avgFilingDaysEff ?? null;

  let momVariancePct = null;
  let momDeltaDays = null;
  if (currentAvg != null && previousAvg != null && previousAvg !== 0) {
    momVariancePct = Math.round(((currentAvg - previousAvg) / previousAvg) * 100);
    momDeltaDays = Math.round((currentAvg - previousAvg) * 10) / 10;
  }

  const historyDays = monthly.slice(0, -1).slice(-12)
    .map((m) => m.avgFilingDaysEff)
    .filter((v) => v != null);
  const historicalAvgDays = historyDays.length
    ? Math.round((historyDays.reduce((a, b) => a + b, 0) / historyDays.length) * 10) / 10
    : null;

  return {
    goalDays,
    regulatoryDays,
    currentAvgDays: currentAvg,
    monthlyPerformancePct: pctOfGoal(currentAvg),
    monthlyPerformanceStatus: dayStatus(currentAvg),
    meetsGoal: currentAvg == null ? null : currentAvg <= goalDays,
    momVariancePct,
    momDeltaDays,
    momImproving: momVariancePct == null ? null : momVariancePct < 0,
    historicalAvgDays,
    historicalPct: pctOfGoal(historicalAvgDays),
    historicalStatus: dayStatus(historicalAvgDays),
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
