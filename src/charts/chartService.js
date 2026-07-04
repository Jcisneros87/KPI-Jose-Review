/**
 * Chart Service — presentation only (SRS Ch. 2/11): shared executive ECharts
 * styling, goal lines, and chart builders. No business logic; every builder
 * receives precomputed KPI models.
 */

let INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' };
let GOAL = { internalTarget: '#2e7d32', regulatoryThreshold: '#c62828' };

export function configureCharts(themes) {
  INK = { ...INK, ...(themes.ink || {}) };
  GOAL = { ...GOAL, ...(themes.goalLines || {}) };
}

const registry = new Map();

export function renderChart(el, option) {
  if (!window.echarts) return null;
  let chart = registry.get(el);
  if (!chart || chart.isDisposed()) {
    chart = window.echarts.init(el, null, { renderer: 'canvas' });
    registry.set(el, chart);
  }
  chart.setOption(option, true);
  return chart;
}

export function disposeCharts() {
  for (const [el, chart] of registry) {
    if (!document.body.contains(el)) {
      chart.dispose();
      registry.delete(el);
    }
  }
}

export function resizeCharts() {
  for (const chart of registry.values()) {
    if (!chart.isDisposed()) chart.resize();
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function base(months) {
  return {
    textStyle: { fontFamily: FONT, color: INK.secondary },
    grid: { left: 48, right: 56, top: 24, bottom: 64, containLabel: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#ffffff',
      borderColor: INK.grid,
      textStyle: { color: INK.primary, fontSize: 12 },
    },
    legend: {
      bottom: 0,
      left: 'center',
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: INK.secondary, fontSize: 12 },
    },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: INK.axis } },
      axisTick: { show: false },
      axisLabel: { color: INK.muted, fontSize: 11 },
    },
  };
}

function valueAxis(name, opts = {}) {
  return {
    type: 'value',
    name,
    nameTextStyle: { color: INK.muted, fontSize: 11 },
    axisLabel: { color: INK.muted, fontSize: 11, formatter: opts.percent ? '{value}%' : undefined },
    splitLine: { lineStyle: { color: INK.grid, width: 1 } },
    max: opts.percent ? 100 : undefined,
    ...opts.extra,
  };
}

const columnLabel = {
  show: true,
  position: 'top',
  fontSize: 10,
  color: INK.secondary,
  formatter: (p) => (p.value ? p.value : ''),
};

export function goalMarkLine(lines) {
  // lines: [{value, label, kind: 'internalTarget'|'regulatoryThreshold'}]
  const data = (lines || [])
    .filter((l) => l.value != null)
    .map((l) => ({
      yAxisIndex: l.yAxisIndex ?? 0,
      yAxis: l.value,
      lineStyle: { color: GOAL[l.kind] || INK.muted, type: 'dashed', width: 1.5 },
      label: {
        formatter: l.label,
        position: 'insideEndTop',
        color: GOAL[l.kind] || INK.muted,
        fontSize: 10,
      },
    }));
  if (!data.length) return undefined;
  return { symbol: 'none', silent: true, data };
}

function columnSeries(s, { stacked = false, showLabels = true } = {}) {
  return {
    name: s.name,
    type: 'bar',
    stack: stacked ? 'total' : undefined,
    data: s.data,
    barMaxWidth: 22,
    itemStyle: stacked
      ? { color: s.color, borderColor: '#ffffff', borderWidth: 1 }
      : { color: s.color, borderRadius: [4, 4, 0, 0] },
    label: stacked ? { show: false } : (showLabels ? columnLabel : { show: false }),
    emphasis: { focus: 'series' },
    markLine: s.markLine,
  };
}

function lineSeries(s, { yAxisIndex = 0 } = {}) {
  return {
    name: s.name,
    type: 'line',
    yAxisIndex,
    data: s.data,
    lineStyle: { width: 2, color: s.color },
    itemStyle: { color: s.color, borderColor: '#ffffff', borderWidth: 2 },
    symbol: 'circle',
    symbolSize: 8,
    connectNulls: true,
    emphasis: { focus: 'series' },
    markLine: s.markLine,
    label: s.endLabel
      ? { show: true, fontSize: 10, color: INK.secondary, formatter: (p) => (p.dataIndex === s.data.length - 1 && p.value != null ? p.value : '') }
      : { show: false },
  };
}

/** Clustered columns (Funnel, Accepted vs Excluded, Monthly Volume). */
export function clusteredColumns({ months, series, yName = 'Reports', overlayLines = [], goalLines, showLabels = true }) {
  const opt = base(months);
  opt.yAxis = [valueAxis(yName)];
  opt.series = series.map((s, i) =>
    columnSeries({ ...s, markLine: i === 0 ? goalMarkLine(goalLines) : undefined }, { showLabels })
  );
  for (const l of overlayLines) opt.series.push(lineSeries(l));
  return opt;
}

/**
 * Stacked columns with an On-Time % overlay (SLA / Filing Performance).
 * Counts on the left axis; the percentage overlay is explicitly labeled on a
 * 0–100% right axis (spec-mandated overlay; axes named to avoid ambiguity).
 */
export function stackedWithPercentLine({ months, stacks, line, goalLines }) {
  const opt = base(months);
  opt.yAxis = [valueAxis('Reports'), valueAxis('On-Time %', { percent: true, extra: { splitLine: { show: false } } })];
  opt.series = stacks.map((s) => columnSeries(s, { stacked: true }));
  if (line) {
    opt.series.push(lineSeries({ ...line, markLine: goalMarkLine(goalLines) }, { yAxisIndex: 1 }));
  }
  return opt;
}

/** Workflow timeline: volume columns + stage-duration lines (days axis). */
export function workflowTimeline({ months, columns, lines, goalLines }) {
  const opt = base(months);
  opt.yAxis = [valueAxis('Reports'), valueAxis('Days', { extra: { splitLine: { show: false } } })];
  opt.series = columns.map((s) => columnSeries(s, { showLabels: false }));
  lines.forEach((l, i) => {
    opt.series.push(lineSeries({ ...l, markLine: i === 0 ? goalMarkLine((goalLines || []).map((g) => ({ ...g, yAxisIndex: 1 }))) : undefined }, { yAxisIndex: 1 }));
  });
  return opt;
}

/** Stacked status breakdown with totals above each column. */
export function stackedStatus({ months, stacks, totals }) {
  const opt = base(months);
  opt.yAxis = [valueAxis('Reports')];
  opt.series = stacks.map((s) => columnSeries(s, { stacked: true }));
  opt.series.push({
    name: 'Total',
    type: 'bar',
    stack: 'total',
    data: totals.map(() => 0),
    barMaxWidth: 22,
    itemStyle: { color: 'transparent' },
    tooltip: { show: false },
    label: {
      show: true,
      position: 'top',
      fontSize: 10,
      fontWeight: 600,
      color: INK.primary,
      formatter: (p) => (totals[p.dataIndex] ? totals[p.dataIndex] : ''),
    },
    legendHoverLink: false,
  });
  opt.legend.data = stacks.map((s) => s.name);
  return opt;
}

/**
 * Executive Performance Trend: workload columns behind a prominent avg-days
 * line, with a constant regulatory target reference line. Volume labels sit
 * inside the columns; avg-days labels ride above the line points.
 */
export function performanceTrend({ months, volume, avgDays, goalLines = [], volumeName = 'CTRs Completed', lineName = 'Avg Filing Days' }) {
  const maxRef = Math.max(...goalLines.map((l) => l.value || 0), 0);
  const opt = base(months);
  opt.yAxis = [
    valueAxis('Reports'),
    valueAxis('Days', { extra: { splitLine: { show: false }, max: (v) => Math.ceil(Math.max(v.max, maxRef * 1.25)) } }),
  ];
  opt.series = [
    {
      name: volumeName,
      type: 'bar',
      data: volume.data,
      barMaxWidth: 26,
      itemStyle: { color: volume.color, borderRadius: [4, 4, 0, 0] },
      label: {
        show: true,
        position: 'insideBottom',
        distance: 6,
        fontSize: 9,
        color: '#1e3a5f',
        formatter: (p) => (p.value ? p.value : ''),
      },
      emphasis: { focus: 'series' },
    },
    {
      name: lineName,
      type: 'line',
      yAxisIndex: 1,
      data: avgDays.data,
      z: 10,
      lineStyle: { width: 2.5, color: avgDays.color },
      itemStyle: { color: avgDays.color, borderColor: '#ffffff', borderWidth: 2 },
      symbol: 'circle',
      symbolSize: 9,
      connectNulls: true,
      label: {
        show: true,
        position: 'top',
        distance: 8,
        fontSize: 10,
        fontWeight: 600,
        color: INK.primary,
        formatter: (p) => (p.value == null ? '' : p.value),
      },
      emphasis: { focus: 'series' },
      markLine: goalMarkLine(goalLines),
    },
  ];
  return opt;
}

/**
 * Alert outcomes funnel: stacked outcome columns with an average-days line
 * on the right axis (Alerts module executive trend slide).
 */
export function stackedVolumeWithDaysLine({ months, stacks, line }) {
  const opt = base(months);
  opt.yAxis = [valueAxis('Alerts'), valueAxis('Days', { extra: { splitLine: { show: false } } })];
  opt.series = stacks.map((s) => columnSeries(s, { stacked: true }));
  opt.series.push(lineSeries({ ...line }, { yAxisIndex: 1 }));
  return opt;
}

/** Multi-line chart (Executive filing-time performance). */
export function multiLine({ months, lines, yName = 'Days', goalLines }) {
  const opt = base(months);
  opt.tooltip.axisPointer = { type: 'line' };
  opt.yAxis = [valueAxis(yName)];
  opt.series = lines.map((l, i) =>
    lineSeries({ ...l, endLabel: true, markLine: i === 0 ? goalMarkLine(goalLines) : undefined })
  );
  return opt;
}

/** Horizontal stacked bars (Department Performance Scorecard). */
export function horizontalStacked({ categories, stacks }) {
  const opt = base([]);
  opt.xAxis = valueAxis('');
  opt.yAxis = {
    type: 'category',
    data: categories,
    axisLine: { lineStyle: { color: INK.axis } },
    axisTick: { show: false },
    axisLabel: { color: INK.secondary, fontSize: 12 },
  };
  opt.grid = { left: 110, right: 24, top: 12, bottom: 56, containLabel: false };
  opt.series = stacks.map((s) => ({
    name: s.name,
    type: 'bar',
    stack: 'total',
    data: s.data,
    barMaxWidth: 18,
    itemStyle: { color: s.color, borderColor: '#ffffff', borderWidth: 1 },
    label: {
      show: true,
      fontSize: 10,
      color: '#ffffff',
      formatter: (p) => (p.value ? p.value : ''),
    },
  }));
  return opt;
}
