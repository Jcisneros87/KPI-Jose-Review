/**
 * PowerPoint Export Engine (SRS Ch. 9, revised): exports ONE executive slide —
 * the CTR Performance Trend — that tells the whole CTR story for monthly BSA
 * leadership meetings.
 *
 * The chart is a native, editable Office combo chart (Chart Design → Edit
 * Data opens the embedded Excel workbook); the KPI cards are native
 * PowerPoint shapes and text boxes. Nothing is exported as an image.
 *
 * The embedded workbook carries exactly four columns —
 * Month | CTRs Completed | Avg Filing Days | Target Days — one series per
 * chart group, no helper columns or hidden sheets.
 *
 * buildCtrSlide() is environment-agnostic (also runs under Node for testing);
 * exportCtrPptx() is the browser entry point.
 */

import { computePerformanceKpis } from '../engines/kpiEngine.js';

const hex = (c) => String(c || '888888').replace('#', '');
const FONT = 'Segoe UI';

function execCard(pptx, slide, theme, { title, value, note, color }, y) {
  const x = 10.35;
  const w = 2.48;
  const h = 1.62;
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: 'D8DEE9', width: 0.75 }, rectRadius: 0.05,
  });
  // status strip mirroring the dashboard card's colored top border
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.06, y: y + 0.035, w: w - 0.12, h: 0.05, fill: { color: hex(color || theme.brand.info) }, line: { type: 'none' },
  });
  slide.addText(title, {
    x: x + 0.08, y: y + 0.13, w: w - 0.16, h: 0.28, fontSize: 10, color: hex(theme.ink.secondary),
    underline: true, align: 'center', fontFace: FONT,
  });
  slide.addText(String(value ?? '—'), {
    x: x + 0.08, y: y + 0.42, w: w - 0.16, h: 0.62, fontSize: 26, bold: true, align: 'center',
    color: hex(color || theme.brand.info), fontFace: FONT,
  });
  if (note) {
    slide.addText(note, {
      x: x + 0.08, y: y + 1.06, w: w - 0.16, h: 0.46, fontSize: 9, align: 'center',
      color: hex(theme.ink.secondary), fontFace: FONT,
    });
  }
}

/**
 * Build the single-slide executive export from the precomputed dashboard
 * model: { monthly, summary, goals, currentMonth, dateRangeLabel }.
 */
export function buildCtrSlide(PptxGenJS, model, config, generatedAt = new Date()) {
  const theme = config.themes;
  const S = theme.series;
  const g = model.goals || { internalTargetDays: 5, regulatoryThresholdDays: 15 };
  const m = model.monthly;
  const labels = m.map((x) => x.label);
  const target = g.regulatoryThresholdDays;
  const perf = computePerformanceKpis(m, target);
  const statusColor = (status) =>
    ({ green: theme.brand.success, yellow: theme.brand.warning, red: theme.brand.danger }[status] || theme.brand.info);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  const s = pptx.addSlide();
  s.background = { color: hex(theme.brand.background) };

  // ---- chrome: logo placeholder, title, subtitle banner, footer
  s.addText('ALTURA', { x: 0.35, y: 0.22, w: 1.6, h: 0.4, fontSize: 14, bold: true, color: 'FFFFFF', fontFace: FONT });
  s.addText('CREDIT UNION', { x: 0.35, y: 0.52, w: 1.6, h: 0.25, fontSize: 7, color: 'B9C6DA', charSpacing: 2, fontFace: FONT });
  s.addText('CTR Performance Trend', {
    x: 1.2, y: 0.18, w: 10.9, h: 0.6, align: 'center', fontSize: 26, bold: true, color: 'FFFFFF', fontFace: FONT,
  });
  s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.86, w: 12.33, h: 0.38, fill: { color: 'FFFFFF' } });
  s.addText(`Monthly filing volume and average filing days vs the ${target}-day regulatory objective`, {
    x: 0.5, y: 0.86, w: 12.33, h: 0.38, align: 'center', fontSize: 12, color: hex(theme.brand.info), fontFace: FONT,
  });
  s.addText(`Reporting Period: ${model.dateRangeLabel}   ·   Generated ${generatedAt.toLocaleString('en-US')}`, {
    x: 0.5, y: 7.05, w: 12.33, h: 0.3, align: 'center', fontSize: 9, color: 'B9C6DA', fontFace: FONT,
  });

  // ---- the executive combo chart (native, editable)
  // Three groups → three worksheet columns after Month: clustered columns
  // (CTRs Completed), the avg-days line (smooth, circular markers, labels),
  // and the constant red dashed target line as its own series so it carries
  // no per-point labels.
  s.addChart([
    {
      type: pptx.charts.BAR,
      data: [{ name: 'CTRs Completed', labels, values: m.map((x) => x.completedFilings ?? 0) }],
      options: {
        barDir: 'col',
        barGrouping: 'clustered',
        chartColors: [hex(S.completedVolume)],
        showValue: true,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 8,
        dataLabelColor: hex(theme.ink.muted),
      },
    },
    {
      type: pptx.charts.LINE,
      data: [{ name: 'Avg Filing Days', labels, values: m.map((x) => x.avgFilingDaysEff ?? null) }],
      options: {
        chartColors: [hex(S.avgFilingDays)],
        secondaryValAxis: true,
        secondaryCatAxis: true,
        lineSize: 2.5,
        lineSmooth: true,
        lineDataSymbol: 'circle',
        lineDataSymbolSize: 9,
        showValue: true,
        dataLabelPosition: 't',
        dataLabelFontSize: 9,
        dataLabelColor: hex(theme.ink.primary),
        dataLabelFormatCode: '0.0',
      },
    },
    {
      type: pptx.charts.LINE,
      data: [{ name: 'Target Days', labels, values: labels.map(() => target) }],
      options: {
        chartColors: [hex(theme.goalLines?.regulatoryThreshold || theme.brand.danger)],
        secondaryValAxis: true,
        secondaryCatAxis: true,
        lineSize: 1.5,
        lineDash: 'dash',
        lineSmooth: false,
        lineDataSymbol: 'none',
        showValue: false,
      },
    },
  ], {
    x: 0.5, y: 1.45, w: 9.6, h: 5.35,
    plotArea: { fill: { color: 'FFFFFF' } },
    chartArea: { fill: { color: 'FFFFFF' }, roundedCorners: false },
    catAxisLabelColor: hex(theme.ink.muted),
    catAxisLabelFontSize: 9,
    valAxisLabelColor: hex(theme.ink.muted),
    valAxisLabelFontSize: 9,
    catGridLine: { style: 'none' },
    legendPos: 'b',
    showLegend: true,
    legendFontSize: 9,
    legendColor: hex(theme.ink.secondary),
    fontFace: FONT,
    valAxes: [
      { showValAxisTitle: true, valAxisTitle: 'CTRs Completed', valGridLine: { color: 'E1E0D9', style: 'solid', size: 0.5 } },
      { showValAxisTitle: true, valAxisTitle: 'Avg Filing Days', valGridLine: { style: 'none' }, valAxisMinVal: 0 },
    ],
    catAxes: [{ catAxisLabelColor: hex(theme.ink.muted) }, { catAxisHidden: true }],
  });

  // ---- KPI cards as native shapes + text boxes (fully editable)
  execCard(pptx, s, theme, {
    title: 'Monthly Performance',
    value: perf.monthlyPerformancePct == null ? '—' : `${perf.monthlyPerformancePct}%`,
    note: perf.currentAvgDays == null
      ? 'No completed filings this month'
      : `${perf.currentAvgDays} days vs ${target}-day objective`,
    color: statusColor(perf.monthlyPerformanceStatus),
  }, 1.45);
  execCard(pptx, s, theme, {
    title: 'MoM Variance',
    value: perf.momVariancePct == null ? '—'
      : `${perf.momImproving ? '▼' : perf.momVariancePct === 0 ? '■' : '▲'} ${Math.abs(perf.momVariancePct)}%`,
    note: perf.momImproving == null ? undefined
      : perf.momImproving ? 'Improving vs prior month'
      : perf.momVariancePct === 0 ? 'Unchanged vs prior month' : 'Slower vs prior month',
    color: perf.momVariancePct == null ? theme.brand.info
      : perf.momImproving ? theme.brand.success
      : perf.momVariancePct === 0 ? theme.brand.info : theme.brand.danger,
  }, 3.32);
  execCard(pptx, s, theme, {
    title: '12-Month Historical',
    value: perf.historicalPct == null ? '—' : `${perf.historicalPct}%`,
    note: perf.historicalAvgDays == null ? undefined : `Rolling Avg ${perf.historicalAvgDays} Days`,
    color: statusColor(perf.historicalStatus),
  }, 5.19);

  return pptx;
}

/** Browser entry point — under 5s for typical 13-month datasets (SRS 9.10). */
export async function exportCtrPptx(model, config) {
  const PptxGenJS = window.PptxGenJS;
  if (!PptxGenJS) throw new Error('PptxGenJS library is not loaded.');
  const pptx = buildCtrSlide(PptxGenJS, model, config);
  await pptx.writeFile({ fileName: `Altura-CTR-Performance-Trend-${model.currentMonth || 'export'}.pptx` });
}
