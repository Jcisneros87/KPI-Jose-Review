/**
 * ONE-TIME master template builder.
 *
 * Takes the supplied corporate template (template/Example KPI Template.pptx —
 * "Regional Operations Support / Deployment Rate" slide) and produces BOTH
 * runtime masters — template/ctr-executive-master.pptx and
 * template/sar-executive-master.pptx — that the reporting engine injects
 * data into:
 *
 *  - The corporate slide (theme, layout, logo, title/subtitle shapes, KPI
 *    cards) is preserved byte-for-byte except for text tokenization.
 *  - The active chart (chart4.xml: a 2-series percent line chart) is replaced
 *    with the CTR combo structure the spec requires — clustered CTRs
 *    Completed columns, Avg Filing Days line (smooth + markers + labels),
 *    and red/green dashed reference lines — generated once here via
 *    PptxGenJS with no explicit fonts so the corporate theme fonts flow in.
 *  - Text placeholders become {{TOKENS}} the engine fills at export time,
 *    and each KPI card gains a small note line (template-styled) for the
 *    day-based context the spec added.
 *
 * Run: node tools/build-master-template.mjs
 * (Re-run only when the template or series structure changes.)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themes = JSON.parse(readFileSync(join(root, 'config/themes.json'), 'utf8'));
const goals = JSON.parse(readFileSync(join(root, 'config/goals.json'), 'utf8'));
const activeGoals = goals.versions[goals.versions.length - 1];

const hex = (c) => String(c).replace('#', '');
const S = themes.series;

// Deliberately fake placeholders — the runtime must replace every one, and
// tests assert none survive injection.
const MONTHS = Array.from({ length: 13 }, (_, i) => `PLACEHOLDER-M${i + 1}`);
const PLACE_VOL = MONTHS.map(() => 999);
const PLACE_DAYS = MONTHS.map(() => 99.9);

// ---------------------------------------------------------------- 1. donor chart

async function buildDonorChart(volumeLabel, g) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  const s = pptx.addSlide();
  s.addChart([
    {
      type: pptx.charts.BAR,
      data: [{ name: volumeLabel, labels: MONTHS, values: PLACE_VOL }],
      options: {
        barDir: 'col', barGrouping: 'clustered',
        chartColors: [hex(S.completedVolume)],
        showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 8,
      },
    },
    {
      type: pptx.charts.LINE,
      data: [{ name: 'Avg Filing Days', labels: MONTHS, values: PLACE_DAYS }],
      options: {
        chartColors: [hex(S.avgFilingDays)],
        secondaryValAxis: true, secondaryCatAxis: true,
        lineSize: 2.5, lineSmooth: true, lineDataSymbol: 'circle', lineDataSymbolSize: 9,
        showValue: true, dataLabelPosition: 't', dataLabelFontSize: 9, dataLabelFormatCode: '0.0',
      },
    },
    {
      type: pptx.charts.LINE,
      data: [
        { name: `Regulatory Deadline (${g.regulatoryThresholdDays} Days)`, labels: MONTHS, values: MONTHS.map(() => g.regulatoryThresholdDays) },
        { name: `Internal Goal (${g.internalTargetDays} Days)`, labels: MONTHS, values: MONTHS.map(() => g.internalTargetDays) },
      ],
      options: {
        chartColors: [hex(themes.goalLines.regulatoryThreshold), hex(themes.goalLines.internalTarget)],
        secondaryValAxis: true, secondaryCatAxis: true,
        lineSize: 1.5, lineDash: 'dash', lineSmooth: false, lineDataSymbol: 'none', showValue: false,
      },
    },
  ], {
    x: 0.5, y: 0.5, w: 8.25, h: 4.95,
    legendPos: 'b', showLegend: true, legendFontSize: 9,
    catGridLine: { style: 'none' },
    valAxes: [
      { showValAxisTitle: true, valAxisTitle: volumeLabel, valGridLine: { color: 'E1E0D9', style: 'solid', size: 0.5 } },
      { showValAxisTitle: true, valAxisTitle: 'Avg Filing Days', valGridLine: { style: 'none' }, valAxisMinVal: 0 },
    ],
    catAxes: [{}, { catAxisHidden: true }],
  });
  const buf = await pptx.write({ outputType: 'nodebuffer' });
  return JSZip.loadAsync(buf);
}

// ---------------------------------------------------------------- 2. build one master per report type

async function buildMaster({ type, volumeLabel, g }) {
  const template = await JSZip.loadAsync(readFileSync(join(root, 'template/Example KPI Template.pptx')));
  const donor = await buildDonorChart(volumeLabel, g);

  // PptxGenJS keeps a global chart counter across instances, so the donor's
  // chart part name varies — locate it dynamically.
  const donorChartPart = Object.keys(donor.files).find((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  let donorChart = await donor.file(donorChartPart).async('string');

  // Point the donor chart's Edit Data reference at the template's workbook rel
  const chart4Rels = await template.file('ppt/charts/_rels/chart4.xml.rels').async('string');
  const pkgRel = chart4Rels.match(/Id="([^"]+)"[^>]*Type="[^"]*\/package"/) || chart4Rels.match(/Type="[^"]*\/package"[^>]*Id="([^"]+)"/);
  if (!pkgRel) throw new Error('No package relationship found in chart4.xml.rels');
  donorChart = donorChart.replace(/(<c:externalData r:id=")[^"]+(")/, `$1${pkgRel[1]}$2`);

  // Normalize formula references to the runtime workbook's sheet name
  donorChart = donorChart.replace(/<c:f>[^!<]+!/g, '<c:f>Sheet1!');

  template.file('ppt/charts/chart4.xml', donorChart);
  // style4.xml / colors4.xml (Microsoft chart-style extension parts) are left
  // in place — they are advisory hints and PptxGenJS charts don't use them.

  // Coherent placeholder workbook (runtime rewrites it on every export)
  const donorWb = Object.keys(donor.files).find((f) => f.startsWith('ppt/embeddings/') && f.endsWith('.xlsx'));
  template.file('ppt/embeddings/Microsoft_Excel_Worksheet3.xlsx', await donor.file(donorWb).async('uint8array'));

  // ---- tokenize slide text
  let slide = await template.file('ppt/slides/slide1.xml').async('string');

  const replaceRun = (from, to) => {
    if (!slide.includes(`<a:t>${from}</a:t>`)) throw new Error(`Slide text not found: "${from}"`);
    slide = slide.replace(`<a:t>${from}</a:t>`, `<a:t>${to}</a:t>`);
  };
  replaceRun('Regional Operations Support', '{{REPORT_TITLE}}');
  replaceRun('Deployment Rate– ', '{{REPORT_SUBTITLE}}');
  replaceRun('May', '');
  replaceRun(' 2026', '');
  replaceRun('81% ', '{{KPI_MONTHLY}}');
  replaceRun('9%', '{{KPI_MOM}}');
  replaceRun('5%', '{{KPI_HIST}}');

  // Add a note line under each KPI value, inheriting the value paragraph's
  // alignment; 11pt so it reads as supporting text in the template's theme font.
  function addNoteParagraph(valueToken, noteToken) {
    const re = new RegExp(`<a:p>(?:(?!<a:p>)[\\s\\S])*?\\{\\{${valueToken}\\}\\}[\\s\\S]*?</a:p>`);
    const match = slide.match(re);
    if (!match) throw new Error(`Value paragraph not found for ${valueToken}`);
    const pPr = (match[0].match(/<a:pPr[^>]*\/>|<a:pPr>[\s\S]*?<\/a:pPr>/) || [''])[0];
    const note = `<a:p>${pPr}<a:r><a:rPr lang="en-US" sz="1100" dirty="0"/><a:t>{{${noteToken}}}</a:t></a:r></a:p>`;
    slide = slide.replace(match[0], match[0] + note);
  }
  addNoteParagraph('KPI_MONTHLY', 'KPI_MONTHLY_NOTE');
  addNoteParagraph('KPI_MOM', 'KPI_MOM_NOTE');
  addNoteParagraph('KPI_HIST', 'KPI_HIST_NOTE');

  template.file('ppt/slides/slide1.xml', slide);

  const out = await template.generateAsync({ type: 'nodebuffer' });
  // TEMPLATE_OUT_DIR lets tests regenerate masters without touching the
  // committed files.
  const outRoot = process.env.TEMPLATE_OUT_DIR || root;
  mkdirSync(join(outRoot, 'template'), { recursive: true });
  const fileName = `template/${type}-executive-master.pptx`;
  writeFileSync(join(outRoot, fileName), out);
  console.log(`Wrote ${fileName} (${out.length} bytes)`);
  console.log(`  ${volumeLabel} (columns) · Avg Filing Days (line) · ` +
    `Regulatory Deadline (${g.regulatoryThresholdDays} Days, red dash) · Internal Goal (${g.internalTargetDays} Days, green dash)`);
}

await buildMaster({ type: 'ctr', volumeLabel: 'CTRs Completed', g: activeGoals.ctr });
await buildMaster({ type: 'sar', volumeLabel: 'SARs Completed', g: activeGoals.sar });
