/**
 * Executive Dashboard (SRS Ch. 14 / Part 6) — landing page: consolidated
 * department view, cross-dashboard trends, employee leaderboard, goal
 * progress, and data upload entry point.
 */

import { el, fmt, kpiCard, chartPanel, filterBar, sectionHeader, progressBar } from '../components/ui.js';
import { clusteredColumns, multiLine, horizontalStacked } from '../charts/chartService.js';
import { buildModel, uniqueValues, monthOptions, STATUS_OPTIONS } from './common.js';
import { classify } from '../engines/goalEngine.js';
import { filterRecords, summarize } from '../engines/kpiEngine.js';
import { computeEmployeeStats } from '../engines/employeeAnalytics.js';
import { setFilters, can } from '../app/state.js';

export function renderExecutiveDashboard(container, state) {
  const S = state.config.themes.series;
  const hasCtr = !!state.data.ctr;
  const hasSar = !!state.data.sar;

  container.append(sectionHeader('Executive Dashboard',
    'Consolidated BSA/AML department performance for monthly leadership reporting'));

  if (!hasCtr && !hasSar) {
    container.append(el('div', { class: 'notice notice-warning' },
      'No data loaded yet. Use "Import CSV" in the header to upload Verafin CTR/SAR exports, or load the bundled sample data.'));
    return;
  }
  if (!hasCtr) container.append(el('div', { class: 'notice notice-info' }, 'CTR data has not been uploaded — CTR metrics are unavailable.'));
  if (!hasSar) container.append(el('div', { class: 'notice notice-info' }, 'SAR data has not been uploaded — SAR metrics are unavailable.'));

  // ---- global filters (SRS 14.8) applied to both datasets
  const allOwners = [...new Set([
    ...(hasCtr ? uniqueValues(state.data.ctr.records, 'owner') : []),
    ...(hasSar ? uniqueValues(state.data.sar.records, 'owner') : []),
  ])].sort();
  const allMonths = monthOptions([
    ...(hasCtr ? state.data.ctr.records : []),
    ...(hasSar ? state.data.sar.records : []),
  ]);

  container.append(filterBar({
    defs: [
      { key: 'month', label: 'Reporting Month', kind: 'select', options: allMonths },
      { key: 'dates', label: 'Date Range', kind: 'daterange' },
      { key: 'owners', label: 'Assigned Owner', kind: 'multi', options: allOwners },
      { key: 'branch', label: 'Branch (CTR)', kind: 'select', options: hasCtr ? uniqueValues(state.data.ctr.records, 'branch') : [] },
      { key: 'status', label: 'Status', kind: 'select', options: STATUS_OPTIONS },
      {
        key: 'filingType', label: 'Type of Filing (SAR)', kind: 'select',
        options: [
          { value: 'combined', label: 'Combined View' },
          { value: 'initial', label: 'Initial SARs' },
          { value: 'continuing', label: 'Continuing Activity SARs' },
        ],
      },
    ],
    filters: state.filters.executive,
    onChange: (f) => setFilters('executive', f),
  }));

  // Build per-module models sharing the executive filter set
  const execFilters = state.filters.executive || {};
  const scoped = { ...state, filters: { ctr: stripFor('ctr', execFilters), sar: stripFor('sar', execFilters), executive: execFilters } };
  const ctrModel = hasCtr ? buildModel('ctr', scoped) : null;
  const sarModel = hasSar ? buildModel('sar', scoped) : null;

  container.append(el('div', { class: 'subtitle-banner' },
    `Reporting Period: ${(ctrModel || sarModel).dateRangeLabel}`));

  // ---- summary KPI cards (SRS 14.4)
  const cardsGrid = el('div', { class: 'exec-cards' });
  if (ctrModel) {
    const g = ctrModel.goals;
    cardsGrid.append(execGroup('CTR Summary', [
      kpiCard({ title: 'Total Created', value: fmt.num(ctrModel.summary.total), status: 'info', variance: mom(ctrModel, 'created') }),
      kpiCard({ title: 'Total Accepted', value: fmt.num(ctrModel.summary.accepted), status: 'info', variance: mom(ctrModel, 'accepted') }),
      kpiCard({
        title: 'Average Filing Time', value: fmt.days(ctrModel.summary.avgFilingDays),
        status: classify(ctrModel.summary.avgFilingDays, g.internalTargetDays, g.regulatoryThresholdDays),
        variance: mom(ctrModel, 'avgFilingDays'), varianceLabel: 'days vs prior month',
      }),
      kpiCard({
        title: 'On-Time Filing %', value: fmt.pct(ctrModel.summary.onTimePct),
        status: classify(ctrModel.summary.onTimePct, 100, 90, { higherIsBetter: true }),
      }),
    ]));
  }
  if (sarModel) {
    const g = sarModel.goals;
    cardsGrid.append(execGroup('SAR Summary', [
      kpiCard({ title: 'Total Filed', value: fmt.num(sarModel.summary.total), status: 'info', variance: mom(sarModel, 'created') }),
      kpiCard({ title: 'Total Accepted', value: fmt.num(sarModel.summary.accepted), status: 'info', variance: mom(sarModel, 'accepted') }),
      kpiCard({
        title: 'Average Filing Time', value: fmt.days(sarModel.summary.avgFilingDays),
        status: classify(sarModel.summary.avgFilingDays, g.internalTargetDays, g.regulatoryThresholdDays),
        variance: mom(sarModel, 'avgFilingDays'), varianceLabel: 'days vs prior month',
      }),
      kpiCard({
        title: 'On-Time Filing %', value: fmt.pct(sarModel.summary.onTimePct),
        status: classify(sarModel.summary.onTimePct, 100, 90, { higherIsBetter: true }),
      }),
    ]));
  }
  const deptRecords = [...(ctrModel?.records || []), ...(sarModel?.records || [])];
  const dept = summarize(deptRecords);
  cardsGrid.append(execGroup('Department Summary', [
    kpiCard({ title: 'Total Reports Processed', value: fmt.num(dept.total), status: 'info' }),
    kpiCard({
      title: 'Overall Compliance %', value: fmt.pct(dept.onTimePct),
      status: classify(dept.onTimePct, 100, 90, { higherIsBetter: true }),
    }),
    kpiCard({ title: 'Avg Department Processing Time', value: fmt.days(dept.avgFilingDays), status: 'info' }),
    kpiCard({
      title: 'Total Queue Failures', value: fmt.num(dept.queueFailed),
      status: dept.queueFailed === 0 ? 'green' : dept.queueFailed > 5 ? 'red' : 'yellow',
    }),
  ]));
  container.append(cardsGrid);

  // ---- trend charts (SRS 14.5)
  const months = (ctrModel || sarModel).months;
  const mLabels = (ctrModel || sarModel).monthly.map((x) => x.label);

  container.append(chartPanel({
    title: 'Monthly Filing Volume',
    subtitle: 'Regulatory reporting volume — CTRs and SARs accepted by month',
    option: clusteredColumns({
      months: mLabels,
      series: [
        ctrModel ? { name: 'CTRs Accepted', color: S.ctr, data: ctrModel.monthly.map((x) => x.accepted) } : null,
        sarModel ? { name: 'SARs Accepted', color: S.sar, data: sarModel.monthly.map((x) => x.accepted) } : null,
      ].filter(Boolean),
      showLabels: true,
    }),
    tableModel: {
      headers: ['Month', 'CTRs Accepted', 'SARs Accepted'],
      rows: months.map((k, i) => [
        mLabels[i],
        ctrModel ? ctrModel.monthly[i].accepted : '—',
        sarModel ? sarModel.monthly[i].accepted : '—',
      ]),
    },
  }));

  const goalLines = [];
  if (ctrModel) {
    goalLines.push({ value: ctrModel.goals.internalTargetDays, label: `CTR Target ${ctrModel.goals.internalTargetDays}d`, kind: 'internalTarget' });
    goalLines.push({ value: ctrModel.goals.regulatoryThresholdDays, label: `CTR Reg ${ctrModel.goals.regulatoryThresholdDays}d`, kind: 'regulatoryThreshold' });
  }
  if (sarModel) {
    goalLines.push({ value: sarModel.goals.internalTargetDays, label: `SAR Target ${sarModel.goals.internalTargetDays}d`, kind: 'internalTarget' });
    goalLines.push({ value: sarModel.goals.regulatoryThresholdDays, label: `SAR Reg ${sarModel.goals.regulatoryThresholdDays}d`, kind: 'regulatoryThreshold' });
  }
  container.append(chartPanel({
    title: 'Filing Time Performance',
    subtitle: 'Average filing time vs internal targets and regulatory thresholds',
    option: multiLine({
      months: mLabels,
      lines: [
        ctrModel ? { name: 'CTR Avg Filing Time', color: S.ctr, data: ctrModel.monthly.map((x) => x.avgFilingDays) } : null,
        sarModel ? { name: 'SAR Avg Filing Time', color: S.sar, data: sarModel.monthly.map((x) => x.avgFilingDays) } : null,
      ].filter(Boolean),
      goalLines,
    }),
    tableModel: {
      headers: ['Month', 'CTR Avg Days', 'SAR Avg Days'],
      rows: months.map((k, i) => [
        mLabels[i],
        ctrModel ? ctrModel.monthly[i].avgFilingDays : '—',
        sarModel ? sarModel.monthly[i].avgFilingDays : '—',
      ]),
    },
  }));

  // ---- department scorecard (composition of all records in scope)
  const scoreRows = [];
  if (ctrModel) scoreRows.push({ label: 'CTR', ...composition(ctrModel.records) });
  if (sarModel) scoreRows.push({ label: 'SAR', ...composition(sarModel.records) });
  container.append(chartPanel({
    title: 'Department Performance Scorecard',
    subtitle: 'Operational health — share of records on-time, late, pending, and queue-failed',
    height: 220,
    option: horizontalStacked({
      categories: scoreRows.map((r) => r.label),
      stacks: [
        { name: 'On-Time %', color: S.accepted, data: scoreRows.map((r) => r.onTime) },
        { name: 'Late %', color: S.queueFailed, data: scoreRows.map((r) => r.late) },
        { name: 'Pending %', color: S.pending, data: scoreRows.map((r) => r.pending) },
        { name: 'Queue Failures %', color: S.other, data: scoreRows.map((r) => r.queueFailed) },
      ],
    }),
    tableModel: {
      headers: ['Module', 'On-Time %', 'Late %', 'Pending %', 'Queue Failures %'],
      rows: scoreRows.map((r) => [r.label, r.onTime, r.late, r.pending, r.queueFailed]),
    },
  }));

  // ---- employee leaderboard (SRS 14.6 / Ch. 7)
  const metricsAccess = state.config.settings.roles[state.role]?.viewEmployeeMetrics || 'summary';
  const stats = computeEmployeeStats({
    ctrRecords: ctrModel?.records || [],
    sarRecords: sarModel?.records || [],
    goalsConfig: state.config.goals,
    scoring: state.config.goals.scoring,
    months,
  });
  container.append(leaderboard(stats, metricsAccess));

  // ---- goal summary (SRS 14.7)
  const goalPanel = el('section', { class: 'chart-panel' },
    el('div', { class: 'panel-head' }, el('div', {},
      el('h3', { class: 'panel-title' }, 'Goal Summary'),
      el('div', { class: 'panel-subtitle' }, 'Departmental progress toward internal filing-time targets'))),
    el('div', { class: 'panel-body goal-summary' },
      ctrModel ? goalRow('CTR', ctrModel) : null,
      sarModel ? goalRow('SAR', sarModel) : null,
    ),
  );
  container.append(goalPanel);
}

function stripFor(type, f) {
  const out = { ...f };
  if (type === 'sar') delete out.branch;      // SAR export has no Branch Number
  if (type === 'ctr') delete out.filingType;  // CTR has no Type of Filing
  return out;
}

function mom(model, field) {
  if (!model.current || !model.previous) return null;
  const a = model.current[field];
  const b = model.previous[field];
  if (a == null || b == null) return null;
  return Math.round((a - b) * 10) / 10;
}

function execGroup(title, cards) {
  return el('div', { class: 'exec-group' },
    el('h4', { class: 'exec-group-title' }, title),
    el('div', { class: 'exec-group-cards' }, cards));
}

function composition(records) {
  const s = summarize(records);
  const total = s.total || 1;
  const p = (n) => Math.round((n / total) * 100);
  const onTimeCount = records.filter((r) => r.onTime === true).length;
  const lateCount = records.filter((r) => r.onTime === false).length;
  return {
    onTime: p(onTimeCount),
    late: p(lateCount),
    pending: p(s.pending),
    queueFailed: p(s.queueFailed),
  };
}

function goalRow(label, model) {
  const g = model.goals;
  const actual = model.summary.avgFilingDays;
  const achievement = actual == null || !actual ? null : Math.min(100, (g.internalTargetDays / actual) * 100);
  const status = classify(actual, g.internalTargetDays, g.regulatoryThresholdDays);
  return el('div', { class: 'goal-row' },
    el('div', { class: 'goal-meta' },
      el('strong', {}, `${label}: `),
      `Target ${g.internalTargetDays}d · Actual ${actual == null ? '—' : actual + 'd'} · Variance ${actual == null ? '—' : fmt.signed(Math.round((actual - g.internalTargetDays) * 10) / 10) + 'd'}`),
    progressBar({ label: `${label} goal attainment`, valuePct: achievement, status: status === 'info' ? 'green' : status }),
  );
}

function leaderboard(stats, access) {
  const cols = access === 'summary'
    ? [['name', 'Analyst'], ['volume', 'Reports Completed'], ['onTimePct', 'On-Time %']]
    : [
      ['name', 'Analyst'], ['volume', 'Reports Completed'], ['avgFilingDays', 'Avg Processing (days)'],
      ['onTimePct', 'On-Time %'], ['productivityIndex', 'Productivity'], ['workloadIndex', 'Workload'],
      ['overallIndex', 'Overall Index'],
    ];
  let sortKey = 'overallIndex';
  let sortDir = -1;

  const panel = el('section', { class: 'chart-panel' });
  const body = el('div', { class: 'panel-body' });
  panel.append(
    el('div', { class: 'panel-head' }, el('div', {},
      el('h3', { class: 'panel-title' }, 'Employee Leaderboard'),
      el('div', { class: 'panel-subtitle' }, access === 'summary'
        ? 'Department summary view (role-limited)'
        : 'Balanced performance model — click a column header to sort'))),
    body,
  );

  function draw() {
    const sorted = [...stats].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return typeof av === 'string' ? av.localeCompare(bv) * -sortDir : (av - bv) * sortDir;
    });
    body.innerHTML = '';
    if (!stats.length) {
      body.append(el('div', { class: 'empty-state' }, 'No analyst activity in the selected scope.'));
      return;
    }
    const thead = el('thead', {}, el('tr', {}, cols.map(([key, label]) =>
      el('th', {
        class: 'sortable' + (key === sortKey ? ' sorted' : ''),
        onclick: () => { sortDir = key === sortKey ? -sortDir : -1; sortKey = key; draw(); },
      }, label + (key === sortKey ? (sortDir === -1 ? ' ↓' : ' ↑') : '')))));
    const tbody = el('tbody', {}, sorted.map((s, i) => el('tr', {},
      cols.map(([key], ci) => {
        if (ci === 0) {
          return el('td', {},
            `${i + 1}. ${s.name}`,
            s.recognitionFlags?.length ? el('span', { class: 'flag flag-recognition', title: s.recognitionFlags.join('; ') }, ' ★') : null,
            s.coachingFlags?.length && access !== 'summary' ? el('span', { class: 'flag flag-coaching', title: s.coachingFlags.join('; ') }, ' ⚑') : null,
          );
        }
        return el('td', { class: 'num' }, s[key] == null ? '—' : s[key]);
      }))));
    body.append(el('div', { class: 'table-wrap' }, el('table', { class: 'data-table' }, thead, tbody)));
  }
  draw();
  return panel;
}
