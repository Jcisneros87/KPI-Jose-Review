/**
 * SAR Dashboard (SRS Ch. 13 / Part 5): filing workflow analytics,
 * Initial vs Continuing Activity analysis, activity-type analysis,
 * and compliance monitoring.
 */

import { el, fmt, kpiCard, kpiRail, chartPanel, filterBar, sectionHeader, dataTable, notifyToast } from '../components/ui.js';
import { clusteredColumns, stackedWithPercentLine, workflowTimeline, performanceTrend } from '../charts/chartService.js';
import { buildModel, uniqueValues, monthOptions, STATUS_OPTIONS, momVariance } from './common.js';
import { classify, evaluate } from '../engines/goalEngine.js';
import { filterRecords, summarize, groupBy, computePerformanceKpis } from '../engines/kpiEngine.js';
import { setFilters, can } from '../app/state.js';
import { downloadJson } from '../exports/jsonExport.js';
import { generateExecutiveReport } from '../exports/reportEngine.js';
import { auditLog } from '../services/auditService.js';

const EMPTY_MSG = 'No SAR records match the selected filters.';

export function renderSarDashboard(container, state) {
  const S = state.config.themes.series;
  const dataset = state.data.sar;

  container.append(sectionHeader('SAR Dashboard',
    'Suspicious Activity Report investigative efficiency and regulatory filing compliance'));

  if (!dataset) {
    container.append(el('div', { class: 'notice notice-info' },
      'No SAR data loaded. Import a Verafin SAR CSV export (or load the sample data) to begin.'));
    return;
  }

  const model = buildModel('sar', state);
  const g = model.goals || { internalTargetDays: 21, regulatoryThresholdDays: 30 };

  // ---- filter bar (SRS 13.3)
  container.append(filterBar({
    defs: [
      { key: 'month', label: 'Reporting Month', kind: 'select', options: monthOptions(dataset.records) },
      { key: 'dates', label: 'Date Range', kind: 'daterange' },
      { key: 'owners', label: 'Assigned Owner', kind: 'multi', options: uniqueValues(dataset.records, 'owner') },
      { key: 'status', label: 'Status', kind: 'select', options: STATUS_OPTIONS },
      {
        key: 'filingType', label: 'Type of Filing', kind: 'select',
        options: [
          { value: 'combined', label: 'Combined View' },
          { value: 'initial', label: 'Initial SARs' },
          { value: 'continuing', label: 'Continuing Activity SARs' },
        ],
      },
      { key: 'activityType', label: 'Activity Type', kind: 'select', options: uniqueValues(dataset.records, 'activityType') },
      { key: 'activitySubtype', label: 'Activity Subtype', kind: 'select', options: uniqueValues(dataset.records, 'activitySubtype') },
    ],
    filters: state.filters.sar,
    onChange: (f) => setFilters('sar', f),
  }));

  container.append(el('div', { class: 'subtitle-banner' },
    `Reporting Period: ${model.dateRangeLabel} · ${fmt.num(model.records.length)} SAR records in scope`));

  const layout = el('div', { class: 'dash-layout' });
  const main = el('div', { class: 'dash-main' });
  const m = model.monthly;
  const labels = m.map((x) => x.label);

  // ---- SAR Performance Trend (executive lead section, mirrors CTR):
  // filing volume + avg filing days (Determination → Accepted, Submitted
  // fallback) vs the 21-day internal goal and 30-day regulatory deadline.
  const perf = computePerformanceKpis(m, g.internalTargetDays, g.regulatoryThresholdDays);
  const perfSection = el('div', { class: 'perf-section' });
  perfSection.append(chartPanel({
    title: 'SAR Performance Trend',
    subtitle: `Monthly filing volume and average filing days vs the ${g.internalTargetDays}-day internal goal and ${g.regulatoryThresholdDays}-day regulatory deadline`,
    height: 420,
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: false, label: 'Fewer filing days is better' },
    option: performanceTrend({
      months: labels,
      volume: { color: S.completedVolume, data: m.map((x) => x.completedFilings) },
      avgDays: { color: S.avgFilingDays, data: m.map((x) => x.avgFilingDaysEff) },
      volumeName: 'SARs Completed',
      goalLines: [
        { value: g.regulatoryThresholdDays, label: `Regulatory ${g.regulatoryThresholdDays} Days`, kind: 'regulatoryThreshold' },
        { value: g.internalTargetDays, label: `Goal ${g.internalTargetDays} Days`, kind: 'internalTarget' },
      ],
    }),
    tableModel: {
      headers: ['Month', 'SARs Completed', 'Avg Filing Days', `Regulatory Deadline (${g.regulatoryThresholdDays} Days)`, `Internal Goal (${g.internalTargetDays} Days)`],
      rows: m.map((x) => [x.label, x.completedFilings, x.avgFilingDaysEff, g.regulatoryThresholdDays, g.internalTargetDays]),
    },
  }));
  perfSection.append(el('div', { class: 'perf-cards' },
    kpiCard({
      title: 'Monthly Performance',
      value: perf.currentAvgDays == null ? '—' : `${perf.currentAvgDays} Days`,
      status: perf.monthlyPerformanceStatus,
      note: perf.currentAvgDays == null
        ? 'No completed filings this month'
        : `${perf.monthlyPerformancePct}% of ${perf.goalDays}-day goal ${perf.meetsGoal ? '✓' : '✗'}`,
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
      status: perf.historicalStatus,
      note: perf.historicalAvgDays == null
        ? undefined
        : `Rolling average · ${perf.historicalPct}% of ${perf.goalDays}-day goal`,
    }),
  ));
  main.append(perfSection);

  // ---- Dashboard 1: Filing volume by month
  main.append(chartPanel({
    title: 'SAR Filing Volume by Month',
    subtitle: 'Filing volume across the reporting period',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    option: clusteredColumns({
      months: labels,
      series: [
        { name: 'Created', color: S.created, data: m.map((x) => x.created) },
        { name: 'Submitted', color: S.submitted, data: m.map((x) => x.submitted) },
        { name: 'Accepted', color: S.accepted, data: m.map((x) => x.accepted) },
        { name: 'Excluded', color: S.excluded, data: m.map((x) => x.excluded) },
      ],
      showLabels: true,
    }),
    tableModel: {
      headers: ['Month', 'Created', 'Submitted', 'Accepted', 'Excluded'],
      rows: m.map((x) => [x.label, x.created, x.submitted, x.accepted, x.excluded]),
    },
  }));

  // ---- Dashboard 2: Filing performance
  main.append(chartPanel({
    title: 'SAR Filing Performance',
    subtitle: 'Filing outcomes with on-time percentage — goal: 100% on-time',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: true, label: 'Higher on-time filing is better' },
    option: stackedWithPercentLine({
      months: labels,
      stacks: [
        { name: 'Accepted', color: S.accepted, data: m.map((x) => x.acceptedByStart) },
        { name: 'Excluded', color: S.excluded, data: m.map((x) => x.excluded) },
        { name: 'Pending', color: S.pending, data: m.map((x) => x.pending) },
        { name: 'Queue Failed', color: S.queueFailed, data: m.map((x) => x.queueFailed) },
      ],
      line: { name: 'On-Time Filing %', color: S.onTimePct, data: m.map((x) => x.onTimePct) },
      goalLines: [{ value: 100, label: '100% On-Time', kind: 'internalTarget', yAxisIndex: 1 }],
    }),
    tableModel: {
      headers: ['Month', 'Accepted', 'Excluded', 'Pending', 'Queue Failed', 'On-Time %'],
      rows: m.map((x) => [x.label, x.acceptedByStart, x.excluded, x.pending, x.queueFailed, x.onTimePct]),
    },
  }));

  // ---- Dashboard 3: Workflow timeline
  main.append(chartPanel({
    title: 'SAR Workflow Timeline',
    subtitle: `Determination-to-acceptance efficiency — target ${g.internalTargetDays}d, regulatory ${g.regulatoryThresholdDays}d`,
    empty: model.empty, emptyMessage: EMPTY_MSG,
    direction: { up: false, label: 'Fewer processing days is better' },
    option: workflowTimeline({
      months: labels,
      columns: [
        { name: 'SARs Created', color: S.created, data: m.map((x) => x.created) },
        { name: 'SARs Accepted', color: S.accepted, data: m.map((x) => x.accepted) },
      ],
      lines: [
        { name: 'Determination → Queue', color: S.durationStartToQueue, data: m.map((x) => x.avgStartToQueue) },
        { name: 'Queue → Submitted', color: S.durationQueueToSubmit, data: m.map((x) => x.avgQueueToSubmit) },
        { name: 'Submitted → Accepted', color: S.durationSubmitToAccept, data: m.map((x) => x.avgSubmitToAccept) },
        { name: 'Determination → Accepted', color: S.durationStartToAccept, data: m.map((x) => x.avgFilingDays) },
      ],
      goalLines: [
        { value: g.internalTargetDays, label: `Target ${g.internalTargetDays}d`, kind: 'internalTarget' },
        { value: g.regulatoryThresholdDays, label: `Regulatory ${g.regulatoryThresholdDays}d`, kind: 'regulatoryThreshold' },
      ],
    }),
    tableModel: {
      headers: ['Month', 'Created', 'Accepted', 'Det→Queue', 'Queue→Submitted', 'Submitted→Accepted', 'Det→Accepted'],
      rows: m.map((x) => [x.label, x.created, x.accepted, x.avgStartToQueue, x.avgQueueToSubmit, x.avgSubmitToAccept, x.avgFilingDays]),
    },
  }));

  // ---- Dashboard 4: Filing type analysis (SRS 13.6 #4)
  const initial = filterRecords(model.records, { filingType: 'initial' });
  const continuing = filterRecords(model.records, { filingType: 'continuing' });
  const typeRows = [
    { label: 'Initial SARs', ...summarize(initial) },
    { label: 'Continuing Activity SARs', ...summarize(continuing) },
    { label: 'Combined', ...summarize(model.records) },
  ];
  const initialByMonth = countByMonth(initial, model.months);
  const continuingByMonth = countByMonth(continuing, model.months);

  main.append(chartPanel({
    title: 'Filing Type Analysis',
    subtitle: 'Initial vs Continuing Activity SARs — use the Type of Filing filter to isolate either view',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    option: clusteredColumns({
      months: labels,
      series: [
        { name: 'Initial SARs', color: S.created, data: initialByMonth },
        { name: 'Continuing Activity SARs', color: S.submitted, data: continuingByMonth },
      ],
      showLabels: true,
    }),
    tableModel: {
      headers: ['Filing Type', 'Filings', 'Accepted', 'Avg Filing Time (days)', 'On-Time %'],
      rows: typeRows.map((r) => [r.label, r.total, r.accepted, r.avgFilingDays, r.onTimePct]),
    },
  }));
  main.append(el('div', { class: 'panel-aux' },
    dataTable({
      headers: ['Filing Type', 'Filings', 'Accepted', 'Avg Filing Time (days)', 'On-Time %'],
      rows: typeRows.map((r) => [r.label, fmt.num(r.total), fmt.num(r.accepted), r.avgFilingDays ?? '—', r.onTimePct == null ? '—' : `${r.onTimePct}%`]),
    })));

  // ---- Continuing Activity reference panel (SRS 13.7 — informational only)
  main.append(el('div', { class: 'notice notice-info' },
    el('strong', {}, 'Continuing Activity SAR reference: '),
    'Initial filing target is 30 days from Date of Determination. Continuing Activity follows an approximately ',
    '90-day review period, with continuing filings generally submitted within 30 days after the review period. ',
    'These reference values are informational and do not alter KPI calculations.'));

  // ---- Dashboard 5: Activity type analysis
  const byType = groupBy(model.records, 'activityType').slice(0, 12);
  const bySubtype = groupBy(model.records, 'activitySubtype').slice(0, 12);
  main.append(chartPanel({
    title: 'Activity Type Analysis',
    subtitle: 'Primary Activity Type volume — use the Activity Type/Subtype filters to drill into trends',
    empty: model.empty, emptyMessage: EMPTY_MSG,
    height: Math.max(240, byType.length * 40 + 80),
    option: activityBarOption(byType, S, state.config.themes.ink),
    tableModel: {
      headers: ['Primary Activity Type', 'Filings', 'Accepted', 'Avg Filing Time (days)', 'On-Time %'],
      rows: byType.map((r) => [r.key, r.total, r.accepted, r.avgFilingDays, r.onTimePct]),
    },
  }));
  main.append(el('div', { class: 'panel-aux' },
    el('h4', { class: 'aux-title' }, 'Primary Activity Subtypes'),
    dataTable({
      headers: ['Subtype', 'Filings', 'Accepted', 'Avg Days', 'On-Time %'],
      rows: bySubtype.map((r) => [r.key, fmt.num(r.total), fmt.num(r.accepted), r.avgFilingDays ?? '—', r.onTimePct == null ? '—' : `${r.onTimePct}%`]),
    })));

  // ---- Compliance benchmarks (SRS 13.8)
  const filingEval = evaluate('SAR Average Filing Time', model.summary.avgFilingDays, g.internalTargetDays, g.regulatoryThresholdDays);
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

  if (can('export')) {
    main.append(el('div', { class: 'action-row' },
      el('button', {
        class: 'btn-primary',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Generating report…';
          try {
            await generateExecutiveReport(model, state.config, 'sar');
            auditLog('GENERATE_REPORT', 'SAR Executive Report (template-driven)', { user: state.role });
            notifyToast('Executive report generated from the corporate template — chart data and KPI text injected, all formatting preserved.', 'success');
          } catch (err) {
            console.error(err);
            notifyToast(`Report generation failed: ${err.message}`, 'error');
            auditLog('GENERATE_REPORT_FAILED', 'SAR Executive Report', { user: state.role, newValue: err.message });
          } finally {
            btn.disabled = false;
            btn.textContent = '⬇ Generate Executive Report';
          }
        },
      }, '⬇ Generate Executive Report'),
      el('button', {
        class: 'btn-ghost',
        onclick: () => {
          downloadJson(`sar-dashboard-${model.currentMonth}.json`, {
            generatedAt: new Date().toISOString(),
            filters: model.filters,
            monthly: model.monthly,
            summary: model.summary,
            goals: g,
          });
          auditLog('EXPORT_JSON', 'SAR Dashboard', { user: state.role });
        },
      }, '⬇ Export JSON'),
    ));
  }

  // ---- KPI cards (SRS 13.5)
  const varDays = momVariance(model.current, model.previous, 'avgFilingDays');
  layout.append(main, kpiRail([
    kpiCard({ title: `SARs Accepted — ${model.currentMonthLabel}`, value: fmt.num(model.summary.accepted), status: 'info' }),
    kpiCard({ title: `SARs Excluded — ${model.currentMonthLabel}`, value: fmt.num(model.summary.excluded), status: 'info' }),
    kpiCard({
      title: 'Average Filing Time',
      value: fmt.days(model.summary.avgFilingDays),
      status: filingEval.status,
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
  ]));
  container.append(layout);
}

function countByMonth(records, months) {
  const map = new Map(months.map((k) => [k, 0]));
  for (const r of records) {
    const d = r.workflowStart;
    if (!d) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (map.has(k)) map.set(k, map.get(k) + 1);
  }
  return months.map((k) => map.get(k));
}

function activityBarOption(byType, S, ink) {
  return {
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: ink.secondary },
    grid: { left: 170, right: 60, top: 12, bottom: 32 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: ink.grid, width: 1 } },
      axisLabel: { color: ink.muted, fontSize: 11 },
    },
    yAxis: {
      type: 'category',
      data: byType.map((r) => r.key).reverse(),
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.secondary, fontSize: 11, width: 150, overflow: 'truncate' },
    },
    series: [{
      name: 'Filings',
      type: 'bar',
      data: byType.map((r) => r.total).reverse(),
      barMaxWidth: 18,
      itemStyle: { color: S.sar, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 10, color: ink.secondary },
    }],
  };
}
