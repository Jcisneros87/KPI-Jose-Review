/**
 * PowerPoint Export Engine (SRS Ch. 9) — generates native, editable Office
 * chart objects via PptxGenJS. Every KPI chart carries an embedded worksheet
 * (Chart Design → Edit Data works in PowerPoint); no screenshots or images.
 *
 * buildCtrDeck() is environment-agnostic (also runs under Node for testing);
 * exportCtrPptx() is the browser entry point.
 */

const hex = (c) => String(c || '888888').replace('#', '');

function slideChrome(pptx, slide, theme, { title, subtitle, period, footer }) {
  slide.background = { color: hex(theme.brand.background) };
  // Logo placeholder (SRS 12.2)
  slide.addText('ALTURA', {
    x: 0.35, y: 0.22, w: 1.6, h: 0.4, fontSize: 14, bold: true, color: 'FFFFFF',
    fontFace: 'Segoe UI',
  });
  slide.addText('CREDIT UNION', {
    x: 0.35, y: 0.52, w: 1.6, h: 0.25, fontSize: 7, color: 'B9C6DA', charSpacing: 2,
    fontFace: 'Segoe UI',
  });
  slide.addText(title, {
    x: 1.2, y: 0.18, w: 10.9, h: 0.6, align: 'center', fontSize: 26, bold: true,
    color: 'FFFFFF', fontFace: 'Segoe UI',
  });
  if (subtitle) {
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.86, w: 12.33, h: 0.38, fill: { color: 'FFFFFF' } });
    slide.addText(subtitle, {
      x: 0.5, y: 0.86, w: 12.33, h: 0.38, align: 'center', fontSize: 12,
      color: hex(theme.brand.info), fontFace: 'Segoe UI',
    });
  }
  slide.addText(`${period}   ·   Generated ${footer}`, {
    x: 0.5, y: 7.05, w: 12.33, h: 0.3, align: 'center', fontSize: 9, color: 'B9C6DA',
    fontFace: 'Segoe UI',
  });
}

function kpiBoxes(pptx, slide, theme, cards) {
  const x = 10.35;
  let y = 1.45;
  for (const c of cards.slice(0, 6)) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: 2.45, h: 0.82, fill: { color: 'FFFFFF' }, line: { color: 'D8DEE9', width: 0.75 }, rectRadius: 0.05,
    });
    slide.addText(c.title, {
      x: x + 0.08, y: y + 0.06, w: 2.3, h: 0.24, fontSize: 8.5, color: hex(theme.ink.secondary),
      underline: true, align: 'center', fontFace: 'Segoe UI',
    });
    slide.addText(String(c.value ?? '—'), {
      x: x + 0.08, y: y + 0.3, w: 2.3, h: 0.45, fontSize: 17, bold: true, align: 'center',
      color: hex(c.color || theme.brand.info), fontFace: 'Segoe UI',
    });
    y += 0.95;
  }
}

const CHART_AREA = { x: 0.5, y: 1.45, w: 9.6, h: 5.35 };

function baseChartOpts(theme) {
  return {
    ...CHART_AREA,
    plotArea: { fill: { color: 'FFFFFF' } },
    chartArea: { fill: { color: 'FFFFFF' }, roundedCorners: false },
    catAxisLabelColor: hex(theme.ink.muted),
    catAxisLabelFontSize: 9,
    valAxisLabelColor: hex(theme.ink.muted),
    valAxisLabelFontSize: 9,
    valGridLine: { color: 'E1E0D9', style: 'solid', size: 0.5 },
    catGridLine: { style: 'none' },
    legendPos: 'b',
    showLegend: true,
    legendFontSize: 9,
    legendColor: hex(theme.ink.secondary),
    dataLabelColor: hex(theme.ink.secondary),
    dataLabelFontSize: 8,
    fontFace: 'Segoe UI',
  };
}

// Count series coerce blanks to 0; measure/line series keep nulls so a
// missing month exports as an empty worksheet cell, not a false 0 (SRS 9.6).
const series = (name, labels, values) => ({ name, labels, values: values.map((v) => (v == null ? 0 : v)) });
const lineSeries = (name, labels, values) => ({ name, labels, values: values.map((v) => (v == null ? null : v)) });
const constSeries = (name, labels, value) => ({ name, labels, values: labels.map(() => value) });

/**
 * Build the CTR deck from a precomputed dashboard model:
 * model = { monthly, months, summary, goals, currentMonthLabel, dateRangeLabel }
 */
export function buildCtrDeck(PptxGenJS, model, config, generatedAt = new Date()) {
  const theme = config.themes;
  const S = theme.series;
  const g = model.goals || { internalTargetDays: 5, regulatoryThresholdDays: 15 };
  const m = model.monthly;
  const labels = m.map((x) => x.label);
  const period = `Reporting Period: ${model.dateRangeLabel}`;
  const footer = generatedAt.toLocaleString('en-US');

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  const cards = [
    { title: 'CTRs Accepted (Month)', value: model.summary.accepted },
    { title: 'CTRs Excluded (Month)', value: model.summary.excluded },
    {
      title: 'Avg Filing Time',
      value: model.summary.avgFilingDays == null ? '—' : `${model.summary.avgFilingDays} d`,
      color: model.summary.avgFilingDays == null ? theme.brand.info
        : model.summary.avgFilingDays <= g.internalTargetDays ? theme.brand.success
        : model.summary.avgFilingDays <= g.regulatoryThresholdDays ? theme.brand.warning
        : theme.brand.danger,
    },
    { title: 'On-Time Filing %', value: model.summary.onTimePct == null ? '—' : `${model.summary.onTimePct}%` },
    { title: 'Internal Target', value: `${g.internalTargetDays} Days` },
    { title: 'Regulatory Threshold', value: `${g.regulatoryThresholdDays} Days` },
  ];

  // ---- Title slide
  const title = pptx.addSlide();
  title.background = { color: hex(theme.brand.background) };
  title.addText('Altura BSA KPI', { x: 0.5, y: 2.4, w: 12.33, h: 1, align: 'center', fontSize: 44, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' });
  title.addText('CTR Executive Dashboard', { x: 0.5, y: 3.5, w: 12.33, h: 0.6, align: 'center', fontSize: 24, color: 'B9C6DA', fontFace: 'Segoe UI' });
  title.addText(period, { x: 0.5, y: 4.3, w: 12.33, h: 0.4, align: 'center', fontSize: 14, color: 'B9C6DA', fontFace: 'Segoe UI' });
  title.addText('BSA/AML Department — Monthly Executive Reporting', { x: 0.5, y: 6.8, w: 12.33, h: 0.4, align: 'center', fontSize: 11, color: '8FA3BF', fontFace: 'Segoe UI' });

  // ---- Slide 1: Funnel
  {
    const s = pptx.addSlide();
    slideChrome(pptx, s, theme, { title: 'CTR Funnel Numbers Broken Out By Month', subtitle: 'Workflow volume throughout the reporting lifecycle', period, footer });
    s.addChart(pptx.charts.BAR, [
      series('CTRs Created', labels, m.map((x) => x.created)),
      series('CTRs Queued', labels, m.map((x) => x.queued)),
      series('CTRs Submitted', labels, m.map((x) => x.submitted)),
      series('CTRs Accepted', labels, m.map((x) => x.accepted)),
      series('CTRs Excluded', labels, m.map((x) => x.excluded)),
    ], {
      ...baseChartOpts(theme),
      barDir: 'col',
      barGrouping: 'clustered',
      chartColors: [S.created, S.queued, S.submitted, S.accepted, S.excluded].map(hex),
      showValue: false,
      valAxisTitle: 'Reports',
      showValAxisTitle: true,
    });
    kpiBoxes(pptx, s, theme, cards);
  }

  // ---- Slide 2: SLA performance (stacked + on-time % line, secondary axis)
  {
    const s = pptx.addSlide();
    slideChrome(pptx, s, theme, { title: 'CTR SLA Performance', subtitle: 'Filing compliance and SLA performance — goal: 100% on-time', period, footer });
    s.addChart([
      {
        type: pptx.charts.BAR,
        data: [
          series('Accepted', labels, m.map((x) => x.acceptedByStart)),
          series('Excluded', labels, m.map((x) => x.excluded)),
          series('Pending / In Progress', labels, m.map((x) => x.pending)),
          series('Queue Failed', labels, m.map((x) => x.queueFailed)),
        ],
        options: { barDir: 'col', barGrouping: 'stacked', chartColors: [S.accepted, S.excluded, S.pending, S.queueFailed].map(hex) },
      },
      {
        type: pptx.charts.LINE,
        data: [
          lineSeries('On-Time Filing %', labels, m.map((x) => x.onTimePct)),
          constSeries('Goal 100%', labels, 100),
        ],
        options: {
          chartColors: [hex(S.onTimePct), hex(theme.goalLines?.internalTarget || theme.brand.success)],
          secondaryValAxis: true, secondaryCatAxis: true, lineSize: 2, lineSmooth: false,
          lineDataSymbol: 'circle',
        },
      },
    ], {
      ...baseChartOpts(theme),
      valAxes: [
        { showValAxisTitle: true, valAxisTitle: 'Reports' },
        { showValAxisTitle: true, valAxisTitle: 'On-Time %', valAxisMaxVal: 100, valGridLine: { style: 'none' } },
      ],
      catAxes: [{ catAxisLabelColor: hex(theme.ink.muted) }, { catAxisHidden: true }],
    });
    kpiBoxes(pptx, s, theme, cards);
  }

  // ---- Slide 3: Workflow timeline (columns + duration lines on days axis)
  {
    const s = pptx.addSlide();
    slideChrome(pptx, s, theme, { title: 'CTR Workflow Timeline', subtitle: `Workflow efficiency by stage — internal goal line ${g.timelineGoalLineDays ?? 2} days`, period, footer });
    s.addChart([
      {
        type: pptx.charts.BAR,
        data: [
          series('CTRs Created', labels, m.map((x) => x.created)),
          series('CTRs Accepted', labels, m.map((x) => x.accepted)),
        ],
        options: { barDir: 'col', barGrouping: 'clustered', chartColors: [S.created, S.accepted].map(hex) },
      },
      {
        type: pptx.charts.LINE,
        data: [
          lineSeries('Creation → Queue', labels, m.map((x) => x.avgStartToQueue)),
          lineSeries('Queue → Submitted', labels, m.map((x) => x.avgQueueToSubmit)),
          lineSeries('Submitted → Accepted', labels, m.map((x) => x.avgSubmitToAccept)),
          lineSeries('Creation → Accepted', labels, m.map((x) => x.avgFilingDays)),
          constSeries(`Goal ${g.timelineGoalLineDays ?? 2} Days`, labels, g.timelineGoalLineDays ?? 2),
        ],
        options: {
          chartColors: [
            ...[S.durationStartToQueue, S.durationQueueToSubmit, S.durationSubmitToAccept, S.durationStartToAccept].map(hex),
            hex(theme.goalLines?.internalTarget || theme.brand.success),
          ],
          secondaryValAxis: true, secondaryCatAxis: true, lineSize: 2, lineSmooth: false,
        },
      },
    ], {
      ...baseChartOpts(theme),
      valAxes: [
        { showValAxisTitle: true, valAxisTitle: 'Reports' },
        { showValAxisTitle: true, valAxisTitle: 'Days', valGridLine: { style: 'none' } },
      ],
      catAxes: [{ catAxisLabelColor: hex(theme.ink.muted) }, { catAxisHidden: true }],
    });
    kpiBoxes(pptx, s, theme, cards);
  }

  // ---- Slide 4: Status breakdown (stacked)
  {
    const s = pptx.addSlide();
    slideChrome(pptx, s, theme, { title: 'CTR Status Breakdown', subtitle: 'Operational distribution and filing outcomes by creation month', period, footer });
    s.addChart(pptx.charts.BAR, [
      series('Accepted', labels, m.map((x) => x.acceptedByStart)),
      series('Excluded', labels, m.map((x) => x.excluded)),
      series('Pending', labels, m.map((x) => x.pending)),
      series('Queue Failed', labels, m.map((x) => x.queueFailed)),
      series('Other', labels, m.map((x) => x.other)),
    ], {
      ...baseChartOpts(theme),
      barDir: 'col',
      barGrouping: 'stacked',
      chartColors: [S.accepted, S.excluded, S.pending, S.queueFailed, S.other].map(hex),
      valAxisTitle: 'Reports',
      showValAxisTitle: true,
      showValue: false,
    });
    kpiBoxes(pptx, s, theme, cards);
  }

  // ---- Slide 5: Accepted vs Excluded trend (clustered + total created line)
  {
    const s = pptx.addSlide();
    slideChrome(pptx, s, theme, { title: 'CTR Accepted vs Excluded Trend', subtitle: 'Completed filings versus exclusions over time', period, footer });
    s.addChart([
      {
        type: pptx.charts.BAR,
        data: [
          series('Accepted', labels, m.map((x) => x.accepted)),
          series('Excluded', labels, m.map((x) => x.excluded)),
        ],
        options: { barDir: 'col', barGrouping: 'clustered', chartColors: [S.accepted, S.excluded].map(hex), showValue: true },
      },
      {
        type: pptx.charts.LINE,
        data: [series('Total Created', labels, m.map((x) => x.created))],
        options: { chartColors: [hex(S.created)], secondaryValAxis: false, secondaryCatAxis: false, lineSize: 2, lineSmooth: false },
      },
    ], {
      ...baseChartOpts(theme),
      valAxes: [{ showValAxisTitle: true, valAxisTitle: 'Reports' }],
      catAxes: [{ catAxisLabelColor: hex(theme.ink.muted) }],
    });
    kpiBoxes(pptx, s, theme, cards);
  }

  return pptx;
}

/** Browser entry point — under 5s for typical 13-month datasets (SRS 9.10). */
export async function exportCtrPptx(model, config) {
  const PptxGenJS = window.PptxGenJS;
  if (!PptxGenJS) throw new Error('PptxGenJS library is not loaded.');
  const pptx = buildCtrDeck(PptxGenJS, model, config);
  await pptx.writeFile({ fileName: `Altura-CTR-Dashboard-${model.currentMonth || 'export'}.pptx` });
}
