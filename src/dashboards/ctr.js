/**
 * CTR Dashboard — flagship module (SRS Ch. 12 / Part 4).
 * Five executive visualizations + KPI cards + compliance benchmarks +
 * editable PowerPoint export (Phase 1).
 */

import { el, fmt, kpiCard, kpiRail, chartPanel, filterBar, notifyToast, sectionHeader } from '../components/ui.js';
import { clusteredColumns, stackedWithPercentLine, workflowTimeline, stackedStatus, performanceTrend } from '../charts/chartService.js';
import { buildModel, uniqueValues, monthOptions, STATUS_OPTIONS, momVariance } from './common.js';
import { computePerformanceKpis } from '../engines/kpiEngine.js';
import { classify, evaluate } from '../engines/goalEngine.js';
import { setFilters, can } from '../app/state.js';
import { exportCtrPptx } from '../exports/pptxExport.js';
import { downloadJson } from '../exports/jsonExport.js';
import { auditLog } from '../services/auditService.js';

const EMPTY_MSG = 'No CTR records match the selected filters.';

export function renderCtrDashboard(container, state) {
  const S = state.config.themes.series;
  const dataset = state.data.ctr;

  container.append(sectionHeader('CTR Dashboard',
    'Currency Transaction Report workflow performance, regulatory compliance, and filing volume'));

  if (!dataset) {
    container.append(el('div', { class: 'notice notice-info' },
      'No CTR data loaded. Import a Verafin CTR CSV export (or load the sample data) to begin.'));
    return;
  }

  const model = buildModel('ctr', state);
  const g = model.goals || { internalTargetDays: 5, regulatoryThresholdDays: 15, timelineGoalLineDays: 2 };

  // ---- filter bar (SRS 12.3)
  container.append(filterBar({
    defs: [
      { key: 'month', label: 'Reporting Month', kind: 'select', options: monthOptions(dataset.records) },
      { key: 'dates', label: 'Date Range', kind: 'daterange' },
      { key: 'owners', label: 'Assigned Owner', kind: 'multi', options: uniqueValues(dataset.records, 'owner') },
      { key: 'status', label: 'Status', kind: 'select', options: STATUS_OPTIONS },
      { key: 'branch', label: 'Branch', kind: 'select', options: uniqueValues(dataset.records, 'branch') },
      { key: 'queuedBy', label: 'Queued By', kind: 'select', options: uniqueValues(dataset.records, 'queuedBy') },
    ],
    filters: state.filters.ctr,
    onChange: (f) => setFilters('ctr', f),
  }));

  container.append(el('div', { class: 'subtitle-banner' },
    `Reporting Period: ${model.dateRangeLabel} · ${fmt.num(model.records.length)} CTR records in scope`));

  const layout = el('div', { class: 'dash-layout' });
  const main = el('div', { class: 'dash-main' });

  const m = model.monthly;
  const labels = m.map((x) => x.label);

  // ---- CTR Performance Trend (executive lead section):
  // workload volume + avg filing days vs the regulatory 15-day objective,
  // with its own Monthly / MoM / 12-Month KPI cards.
  const perf = computePerformanceKpis(m, g.regulatoryThresholdDays);
  const perfSection = el('div', { class: 'perf-section' });
  perfSection.append(chartPanel({
    title: 'CTR Performance Trend',
    subtitle: `Monthly filing volume and average filing days vs the ${g.regulatoryThresholdDays}-day regulatory objective`,
    height: 420,
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: false, label: 'Fewer filing days is better' },
    option: performanceTrend({
      months: labels,
      volume: { color: S.completedVolume, data: m.map((x) => x.completed) },
      avgDays: { color: S.avgFilingDays, data: m.map((x) => x.avgFilingDaysEff) },
      targetDays: g.regulatoryThresholdDays,
    }),
    tableModel: {
      headers: ['Month', 'Avg Filing Days', 'Target', 'CTRs Completed'],
      rows: m.map((x) => [x.label, x.avgFilingDaysEff, g.regulatoryThresholdDays, x.completed]),
    },
  }));
  perfSection.append(el('div', { class: 'perf-cards' },
    kpiCard({
      title: 'Monthly Performance',
      value: perf.monthlyPerformancePct == null ? '—' : `${perf.monthlyPerformancePct}%`,
      status: perf.monthlyPerformanceStatus,
      note: perf.currentAvgDays == null
        ? 'No completed filings this month'
        : `${perf.currentAvgDays} days vs ${perf.targetDays}-day objective`,
    }),
    kpiCard({
      title: 'MoM Variance',
      value: perf.momVariancePct == null ? '—'
        : `${perf.momImproving ? '▼' : perf.momVariancePct === 0 ? '■' : '▲'} ${Math.abs(perf.momVariancePct)}%`,
      status: perf.momVariancePct == null ? 'info' : perf.momImproving ? 'green' : perf.momVariancePct === 0 ? 'info' : 'red',
      note: perf.momImproving == null ? undefined : perf.momImproving ? 'Improving vs prior month' : perf.momVariancePct === 0 ? 'Unchanged vs prior month' : 'Slower vs prior month',
    }),
    kpiCard({
      title: '12-Month Historical',
      value: perf.historicalPct == null ? '—' : `${perf.historicalPct}%`,
      status: perf.historicalStatus,
      note: perf.historicalAvgDays == null
        ? undefined
        : `Rolling avg ${perf.historicalAvgDays} days vs ${perf.targetDays}-day objective`,
    }),
  ));
  main.append(perfSection);

  // ---- Dashboard 1: Funnel by month
  main.append(chartPanel({
    title: 'CTR Funnel Numbers Broken Out By Month',
    subtitle: 'Workflow volume throughout the reporting lifecycle',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: true, label: 'Higher accepted volume is better' },
    option: clusteredColumns({
      months: labels,
      series: [
        { name: 'CTRs Created', color: S.created, data: m.map((x) => x.created) },
        { name: 'CTRs Queued', color: S.queued, data: m.map((x) => x.queued) },
        { name: 'CTRs Submitted', color: S.submitted, data: m.map((x) => x.submitted) },
        { name: 'CTRs Accepted', color: S.accepted, data: m.map((x) => x.accepted) },
        { name: 'CTRs Excluded', color: S.excluded, data: m.map((x) => x.excluded) },
      ],
      showLabels: false,
    }),
    tableModel: {
      headers: ['Month', 'Created', 'Queued', 'Submitted', 'Accepted', 'Excluded'],
      rows: m.map((x) => [x.label, x.created, x.queued, x.submitted, x.accepted, x.excluded]),
    },
  }));

  // ---- Dashboard 2: SLA performance
  main.append(chartPanel({
    title: 'CTR SLA Performance',
    subtitle: 'Filing compliance and SLA performance — goal: 100% on-time',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: true, label: 'Higher on-time filing is better' },
    option: stackedWithPercentLine({
      months: labels,
      stacks: [
        { name: 'Accepted', color: S.accepted, data: m.map((x) => x.acceptedByStart) },
        { name: 'Excluded', color: S.excluded, data: m.map((x) => x.excluded) },
        { name: 'Pending / In Progress', color: S.pending, data: m.map((x) => x.pending) },
        { name: 'Queue Failed', color: S.queueFailed, data: m.map((x) => x.queueFailed) },
      ],
      line: { name: 'On-Time Filing %', color: S.onTimePct, data: m.map((x) => x.onTimePct) },
      goalLines: [{ value: 100, label: 'Goal 100%', kind: 'internalTarget', yAxisIndex: 1 }],
    }),
    tableModel: {
      headers: ['Month', 'Accepted', 'Excluded', 'Pending', 'Queue Failed', 'On-Time %'],
      rows: m.map((x) => [x.label, x.acceptedByStart, x.excluded, x.pending, x.queueFailed, x.onTimePct]),
    },
  }));

  // ---- Dashboard 3: Workflow timeline
  main.append(chartPanel({
    title: 'CTR Workflow Timeline',
    subtitle: `Workflow efficiency by stage — goal line ${g.timelineGoalLineDays ?? 2} days (configurable)`,
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: false, label: 'Fewer processing days is better' },
    option: workflowTimeline({
      months: labels,
      columns: [
        { name: 'CTRs Created', color: S.created, data: m.map((x) => x.created) },
        { name: 'CTRs Accepted', color: S.accepted, data: m.map((x) => x.accepted) },
      ],
      lines: [
        { name: 'Creation → Queue', color: S.durationStartToQueue, data: m.map((x) => x.avgStartToQueue) },
        { name: 'Queue → Submitted', color: S.durationQueueToSubmit, data: m.map((x) => x.avgQueueToSubmit) },
        { name: 'Submitted → Accepted', color: S.durationSubmitToAccept, data: m.map((x) => x.avgSubmitToAccept) },
        { name: 'Creation → Accepted', color: S.durationStartToAccept, data: m.map((x) => x.avgFilingDays) },
      ],
      goalLines: [{ value: g.timelineGoalLineDays ?? 2, label: `Goal ${g.timelineGoalLineDays ?? 2}d`, kind: 'internalTarget' }],
    }),
    tableModel: {
      headers: ['Month', 'Created', 'Accepted', 'Creation→Queue', 'Queue→Submitted', 'Submitted→Accepted', 'Creation→Accepted'],
      rows: m.map((x) => [x.label, x.created, x.accepted, x.avgStartToQueue, x.avgQueueToSubmit, x.avgSubmitToAccept, x.avgFilingDays]),
    },
  }));

  // ---- Dashboard 4: Status breakdown
  main.append(chartPanel({
    title: 'CTR Status Breakdown',
    subtitle: 'Operational distribution and filing outcomes by creation month',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    option: stackedStatus({
      months: labels,
      stacks: [
        { name: 'Accepted', color: S.accepted, data: m.map((x) => x.acceptedByStart) },
        { name: 'Excluded', color: S.excluded, data: m.map((x) => x.excluded) },
        { name: 'Pending', color: S.pending, data: m.map((x) => x.pending) },
        { name: 'Queue Failed', color: S.queueFailed, data: m.map((x) => x.queueFailed) },
        { name: 'Other', color: S.other, data: m.map((x) => x.other) },
      ],
      totals: m.map((x) => x.created),
    }),
    tableModel: {
      headers: ['Month', 'Accepted', 'Excluded', 'Pending', 'Queue Failed', 'Other', 'Total'],
      rows: m.map((x) => [x.label, x.acceptedByStart, x.excluded, x.pending, x.queueFailed, x.other, x.created]),
    },
  }));

  // ---- Dashboard 5: Accepted vs Excluded trend
  main.append(chartPanel({
    title: 'CTR Accepted vs Excluded Trend',
    subtitle: 'Completed filings versus exclusions over time',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    option: clusteredColumns({
      months: labels,
      series: [
        { name: 'Accepted', color: S.accepted, data: m.map((x) => x.accepted) },
        { name: 'Excluded', color: S.excluded, data: m.map((x) => x.excluded) },
      ],
      overlayLines: [{ name: 'Total Created', color: S.created, data: m.map((x) => x.created) }],
      showLabels: true,
    }),
    tableModel: {
      headers: ['Month', 'Accepted', 'Excluded', 'Total Created'],
      rows: m.map((x) => [x.label, x.accepted, x.excluded, x.created]),
    },
  }));

  // ---- Compliance benchmarks (SRS 12.6)
  const filingEval = evaluate('CTR Average Filing Time', model.summary.avgFilingDays, g.internalTargetDays, g.regulatoryThresholdDays);
  main.append(el('div', { class: 'benchmark-strip' },
    el('div', { class: `benchmark benchmark-${filingEval.status}` },
      el('div', { class: 'benchmark-label' }, 'Actual Average Filing Time'),
      el('div', { class: 'benchmark-value' }, fmt.days(model.summary.avgFilingDays))),
    el('div', { class: 'benchmark benchmark-target' },
      el('div', { class: 'benchmark-label' }, 'Internal Target'),
      el('div', { class: 'benchmark-value' }, `${g.internalTargetDays} Days`)),
    el('div', { class: 'benchmark benchmark-threshold' },
      el('div', { class: 'benchmark-label' }, 'Regulatory Threshold'),
      el('div', { class: 'benchmark-value' }, `${g.regulatoryThresholdDays} Days`)),
  ));

  // ---- Export actions (SRS 12.10 / Ch. 9)
  if (can('export')) {
    const actions = el('div', { class: 'action-row' });
    actions.append(el('button', {
      class: 'btn-primary',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Generating…';
        try {
          await exportCtrPptx(model, state.config);
          auditLog('EXPORT_PPTX', 'CTR Dashboard', { user: state.role });
          notifyToast('PowerPoint export complete — charts are natively editable.', 'success');
        } catch (err) {
          console.error(err);
          notifyToast(`PowerPoint export failed: ${err.message}`, 'error');
          auditLog('EXPORT_PPTX_FAILED', 'CTR Dashboard', { user: state.role, newValue: err.message });
        } finally {
          btn.disabled = false;
          btn.textContent = '⬇ Export Editable PowerPoint';
        }
      },
    }, '⬇ Export Editable PowerPoint'));
    actions.append(el('button', {
      class: 'btn-ghost',
      onclick: () => {
        downloadJson(`ctr-dashboard-${model.currentMonth}.json`, {
          generatedAt: new Date().toISOString(),
          filters: model.filters,
          months: model.months,
          monthly: model.monthly,
          summary: model.summary,
          goals: g,
        });
        auditLog('EXPORT_JSON', 'CTR Dashboard', { user: state.role });
      },
    }, '⬇ Export JSON'));
    main.append(actions);
  }

  // ---- KPI cards (SRS 12.4) — status colors follow goal classification
  const varDays = momVariance(model.current, model.previous, 'avgFilingDays');
  const cards = kpiRail([
    kpiCard({ title: `CTRs Accepted — ${model.currentMonthLabel}`, value: fmt.num(model.summary.accepted), status: 'info' }),
    kpiCard({ title: `CTRs Excluded — ${model.currentMonthLabel}`, value: fmt.num(model.summary.excluded), status: 'info' }),
    kpiCard({ title: `CTRs Submitted — ${model.currentMonthLabel}`, value: fmt.num(model.summary.submitted), status: 'info' }),
    kpiCard({
      title: 'Average Filing Time',
      value: fmt.days(model.summary.avgFilingDays),
      status: filingEval.status === 'info' ? 'info' : filingEval.status,
      variance: varDays,
      varianceLabel: 'days vs prior month',
    }),
    kpiCard({
      title: 'On-Time Filing %',
      value: fmt.pct(model.summary.onTimePct),
      status: classify(model.summary.onTimePct, g.onTimeTargetPct ?? 100, 90, { higherIsBetter: true }),
    }),
    kpiCard({ title: 'Rolling 13-Month Avg Filing Time', value: fmt.days(model.rollingAvgDays), status: 'info' }),
    kpiCard({ title: 'Internal Target', value: `${g.internalTargetDays} Days`, status: 'info' }),
    kpiCard({ title: 'Regulatory Threshold', value: `${g.regulatoryThresholdDays} Days`, status: 'info' }),
    kpiCard({ title: 'Selected Date Range', value: model.dateRangeLabel, status: 'info' }),
  ]);

  layout.append(main, cards);
  container.append(layout);
}
