/**
 * Alerts Performance module (Phase 2): three executive dashboards mirroring
 * how alert work is actually performed, plus an outcomes funnel —
 *   1. Alert Review        (not investigated; Creation → Acknowledgement)
 *   2. Alert-to-Case       (investigated, no SAR; Creation → Disposition)
 *   3. Alert-to-SAR        (investigated, SAR filed; Creation → Disposition)
 * Investigation efficiency, not regulatory filing — no goal/deadline lines.
 */

import { el, fmt, kpiCard, chartPanel, filterBar, notifyToast, sectionHeader } from '../components/ui.js';
import { performanceTrend, stackedVolumeWithDaysLine } from '../charts/chartService.js';
import { uniqueValues, monthOptions } from './common.js';
import {
  filterRecords, rollingMonths, latestMonth, monthLabel,
  aggregateAlertsMonthly, alertWorkflowSeries, computePerformanceKpis,
} from '../engines/kpiEngine.js';
import { setFilters, can } from '../app/state.js';
import { generateExecutiveReport } from '../exports/reportEngine.js';
import { auditLog } from '../services/auditService.js';

const EMPTY_MSG = 'No alert records match the selected filters.';

const WORKFLOWS = [
  {
    key: 'review',
    reportType: 'alertReview',
    title: 'Alert Review Performance',
    subtitle: 'Alerts closed at the alert stage — Creation Date → Acknowledgement Date',
    volumeLabel: 'Alerts Completed',
  },
  {
    key: 'case',
    reportType: 'alertCase',
    title: 'Alert-to-Case Performance',
    subtitle: 'Investigated alerts that did not result in a SAR — Creation Date → Disposition Date',
    volumeLabel: 'Cases Closed',
  },
  {
    key: 'sar',
    reportType: 'alertSar',
    title: 'Alert-to-SAR Performance',
    subtitle: 'Investigated alerts that resulted in SAR filings — Creation Date → Disposition Date',
    volumeLabel: 'SAR-Producing Alerts',
  },
];

export function renderAlertsDashboard(container, state) {
  const S = state.config.themes.series;
  const dataset = state.data.alerts;

  container.append(sectionHeader('Alerts Dashboard',
    'Alert investigation performance across the three operational workflows'));

  if (!dataset) {
    container.append(el('div', { class: 'notice notice-info' },
      'No Alerts data loaded. Import a Verafin Alerts CSV export (or load the sample data) to begin.'));
    return;
  }

  // ---- global filters (Alerts module spec)
  const R = dataset.records;
  container.append(filterBar({
    defs: [
      { key: 'month', label: 'Reporting Month', kind: 'select', options: monthOptions(R) },
      { key: 'dates', label: 'Date Range', kind: 'daterange' },
      { key: 'owners', label: 'Owner Name', kind: 'multi', options: uniqueValues(R, 'owner') },
      { key: 'ownerUsername', label: 'Assigned Username', kind: 'select', options: uniqueValues(R, 'ownerUsername') },
      { key: 'product', label: 'Product', kind: 'select', options: uniqueValues(R, 'product') },
      { key: 'module', label: 'Module', kind: 'select', options: uniqueValues(R, 'module') },
      { key: 'analytic', label: 'Analytic', kind: 'select', options: uniqueValues(R, 'analytic') },
      { key: 'risk', label: 'Risk', kind: 'select', options: uniqueValues(R, 'risk') },
      { key: 'alertState', label: 'Alert State', kind: 'select', options: uniqueValues(R, 'alertState') },
      { key: 'resultState', label: 'Result State', kind: 'select', options: uniqueValues(R, 'resultState') },
      { key: 'branch', label: 'Branch', kind: 'select', options: uniqueValues(R, 'branch') },
    ],
    filters: state.filters.alerts,
    onChange: (f) => setFilters('alerts', f),
  }));

  // ---- model: month filter ends the 13-month window (same semantics as CTR/SAR)
  const filters = state.filters.alerts || {};
  const { month, ...restFilters } = filters;
  const records = filterRecords(R, restFilters);
  const endMonth = month || latestMonth(records) || latestMonth(R);
  const months = rollingMonths(endMonth, state.config.settings.rollingMonths || 13);
  const monthly = aggregateAlertsMonthly(records, months);
  const empty = records.length === 0;
  const currentMonthLabel = monthLabel(endMonth);
  const dateRangeLabel = `${monthLabel(months[0])} – ${currentMonthLabel}`;

  container.append(el('div', { class: 'subtitle-banner' },
    `Reporting Period: ${dateRangeLabel} · ${fmt.num(records.length)} alert records in scope`));

  const reportButton = (reportType, series, label) => {
    if (!can('export')) return null;
    return el('div', { class: 'action-row perf-action' },
      el('button', {
        class: 'btn-primary',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Generating report…';
          try {
            await generateExecutiveReport({
              monthly: series,
              currentMonth: endMonth,
              currentMonthLabel,
              dateRangeLabel,
            }, state.config, reportType);
            auditLog('GENERATE_REPORT', `${label} (template-driven)`, { user: state.role });
            notifyToast('Executive report generated from the corporate template.', 'success');
          } catch (err) {
            console.error(err);
            notifyToast(`Report generation failed: ${err.message}`, 'error');
            auditLog('GENERATE_REPORT_FAILED', label, { user: state.role, newValue: err.message });
          } finally {
            btn.disabled = false;
            btn.textContent = '⬇ Generate Executive Report';
          }
        },
      }, '⬇ Generate Executive Report'));
  };

  // ---- the three workflow dashboards
  for (const wf of WORKFLOWS) {
    const series = alertWorkflowSeries(monthly, wf.key);
    const perf = computePerformanceKpis(series, null);
    const currentVolume = series[series.length - 1]?.completedFilings ?? 0;

    const section = el('div', { class: 'perf-section' });
    section.append(chartPanel({
      title: wf.title,
      subtitle: wf.subtitle,
      height: 400,
      empty, emptyMessage: EMPTY_MSG,
      direction: { up: false, label: 'Fewer investigation days is better' },
      option: performanceTrend({
        months: series.map((x) => x.label),
        volume: { color: S.completedVolume, data: series.map((x) => x.completedFilings) },
        avgDays: { color: S.avgFilingDays, data: series.map((x) => x.avgFilingDaysEff) },
        volumeName: wf.volumeLabel,
        lineName: 'Avg Investigation Days',
        goalLines: [],
      }),
      tableModel: {
        headers: ['Month', wf.volumeLabel, 'Avg Investigation Days'],
        rows: series.map((x) => [x.label, x.completedFilings, x.avgFilingDaysEff]),
      },
    }));
    section.append(el('div', { class: 'perf-cards' },
      kpiCard({
        title: wf.volumeLabel,
        value: fmt.num(currentVolume),
        status: 'info',
        note: `${currentMonthLabel}`,
      }),
      kpiCard({
        title: 'Avg Investigation Days',
        value: perf.currentAvgDays == null ? '—' : `${perf.currentAvgDays} Days`,
        status: 'info',
        note: perf.currentAvgDays == null ? 'No completions this month' : `${currentVolume} completed this month`,
      }),
      kpiCard({
        title: 'MoM Variance',
        value: perf.momVariancePct == null ? '—'
          : `${perf.momImproving ? '▼' : perf.momVariancePct === 0 ? '■' : '▲'} ${Math.abs(perf.momVariancePct)}%`,
        status: perf.momVariancePct == null ? 'info' : perf.momImproving ? 'green' : perf.momVariancePct === 0 ? 'info' : 'red',
        note: perf.momDeltaDays == null ? undefined
          : perf.momImproving ? `Improved ${Math.abs(perf.momDeltaDays)} Days`
          : perf.momDeltaDays === 0 ? 'Unchanged vs prior month' : `Slower by ${Math.abs(perf.momDeltaDays)} Days`,
      }),
      kpiCard({
        title: '12-Month Historical',
        value: perf.historicalAvgDays == null ? '—' : `${perf.historicalAvgDays} Days`,
        status: 'info',
        note: 'Rolling average investigation time',
      }),
    ));
    container.append(section);
    const btn = reportButton(wf.reportType, series, `${wf.title} Report`);
    if (btn) container.append(btn);
  }

  // ---- executive trend analysis (optional fourth slide)
  const funnelSection = el('div', { class: 'perf-section' });
  funnelSection.append(chartPanel({
    title: 'Alert Outcomes Trend',
    subtitle: 'How each month’s alert volume progresses through the investigative process (by creation month)',
    height: 400,
    empty, emptyMessage: EMPTY_MSG,
    option: stackedVolumeWithDaysLine({
      months: monthly.map((x) => x.label),
      stacks: [
        { name: 'Closed at Alert Stage', color: S.completedVolume, data: monthly.map((x) => x.closedAtAlert) },
        { name: 'Escalated to Case', color: S.submitted, data: monthly.map((x) => x.escalatedToCase) },
        { name: 'Resulted in SAR', color: S.excluded, data: monthly.map((x) => x.resultedInSar) },
      ],
      line: { name: 'Avg Days to Completion', color: S.avgFilingDays, data: monthly.map((x) => x.totalAvgDays) },
    }),
    tableModel: {
      headers: ['Month', 'Created', 'Closed at Alert Stage', 'Escalated to Case', 'Resulted in SAR', 'Still Open', 'Avg Days to Completion'],
      rows: monthly.map((x) => [x.label, x.created, x.closedAtAlert, x.escalatedToCase, x.resultedInSar, x.stillOpen, x.totalAvgDays]),
    },
  }));
  const current = monthly[monthly.length - 1] || {};
  funnelSection.append(el('div', { class: 'perf-cards' },
    kpiCard({ title: 'Alerts Created', value: fmt.num(current.created ?? 0), status: 'info', note: currentMonthLabel }),
    kpiCard({ title: 'Closed at Alert Stage', value: fmt.num(current.closedAtAlert ?? 0), status: 'info', note: 'Never escalated' }),
    kpiCard({ title: 'Escalated to Case', value: fmt.num(current.escalatedToCase ?? 0), status: 'info', note: 'Investigated, no SAR' }),
    kpiCard({ title: 'Resulted in SAR', value: fmt.num(current.resultedInSar ?? 0), status: 'info', note: 'SAR-producing investigations' }),
  ));
  container.append(funnelSection);
  const funnelBtn = reportButton('alertFunnel', monthly, 'Alert Outcomes Trend Report');
  if (funnelBtn) container.append(funnelBtn);
}
