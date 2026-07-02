/**
 * Shared dashboard model builder: applies filters, resolves the reporting
 * window (rolling 13 months), and precomputes monthly aggregates + KPI
 * summaries so dashboard views only render.
 */

import {
  filterRecords, aggregateMonthly, summarize, rollingMonths, latestMonth, monthLabel,
} from '../engines/kpiEngine.js';
import { goalsFor } from '../engines/goalEngine.js';

/**
 * The Reporting Month filter sets the current month for KPI cards and ends
 * the 13-month trend window there; all other filters apply to both charts
 * and cards.
 */
export function buildModel(type, state) {
  const dataset = state.data[type];
  if (!dataset) return null;
  const filters = state.filters[type] || {};
  const { month, ...restFilters } = filters;

  const trendRecords = filterRecords(dataset.records, restFilters);
  const endMonth = month || latestMonth(trendRecords) || latestMonth(dataset.records);
  const monthsCount = state.config.settings.rollingMonths || 13;
  const months = rollingMonths(endMonth, monthsCount);
  const monthly = aggregateMonthly(trendRecords, months);

  const currentMonth = endMonth;
  const prevMonth = months[months.length - 2] || null;
  const current = monthly[monthly.length - 1] || null;
  const previous = monthly[monthly.length - 2] || null;

  const currentRecords = filterRecords(trendRecords, { month: currentMonth });
  const summary = summarize(currentRecords);
  const totalSummary = summarize(trendRecords);

  const rollingAvgDays = avgOf(monthly.map((m) => m.avgFilingDays));
  const goals = goalsFor(state.config.goals, type, currentMonth);

  return {
    type,
    filters,
    records: trendRecords,
    currentRecords,
    months,
    monthly,
    currentMonth,
    currentMonthLabel: monthLabel(currentMonth),
    prevMonth,
    current,
    previous,
    summary,
    totalSummary,
    rollingAvgDays,
    goals,
    empty: trendRecords.length === 0,
    dateRangeLabel: filters.dateFromStr || filters.dateToStr
      ? `${filters.dateFromStr || '…'} → ${filters.dateToStr || '…'}`
      : `${monthLabel(months[0])} – ${monthLabel(endMonth)}`,
  };
}

function avgOf(values) {
  const v = values.filter((x) => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

export function uniqueValues(records, field) {
  return [...new Set(records.map((r) => r[field]).filter((v) => v !== '' && v != null))].sort();
}

export function monthOptions(records) {
  const keys = [...new Set(records.map((r) => r.workflowStart)
    .filter(Boolean)
    .map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`))].sort().reverse();
  return keys.map((k) => ({ value: k, label: monthLabel(k) }));
}

export const STATUS_OPTIONS = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'pending', label: 'Pending' },
  { value: 'queueFailed', label: 'Queue Failed' },
  { value: 'other', label: 'Other' },
];

export function momVariance(current, previous, field) {
  if (!current || !previous || current[field] == null || previous[field] == null) return null;
  return Math.round((current[field] - previous[field]) * 10) / 10;
}
