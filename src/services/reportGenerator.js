/**
 * The multi-page feasibility report.
 *
 * This is the artefact a customer takes to three installers, so it has to
 * stand on its own: every figure carries its units, every assumption is stated
 * on the last page, and nothing appears that we can't show the working for.
 *
 * jsPDF is imported lazily. Most people never download the report, and it is a
 * large dependency to ship on first paint of a phone-first app.
 */
import { SYSTEM_COSTS_2026 } from '../config/defaults.js';
import { captureCharts } from './chartImage.js';
import { costRows } from './costEstimator.js';
import { monthYearLabel } from './existingSystemEstimate.js';
import { maskNmi } from './nem12Parser.js';
import { periodWindowLabel } from './touTariffModel.js';
import { currency0, formatPaybackYears, kwh, number, percent, shortDate } from '../utils/formatters.js';

const MARGIN = 18;
const BRAND = [22, 163, 74];
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const RULE = [226, 232, 240];

/**
 * @param {object} report - assembled by Stage2Results
 * @param {Record<string, HTMLElement|null>} chartRefs
 */
export async function downloadReport(report, chartRefs = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Rasterise everything before writing: a chart that fails should cost us
  // that chart, not the document.
  const charts = await captureCharts(chartRefs);

  const ctx = {
    doc,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    report,
    charts,
  };

  pageSummary(ctx);
  pageConsumption(ctx);
  pageProduction(ctx);
  if (report.isAssessingExisting) {
    pagePerformance(ctx);
  } else {
    pageFinancial(ctx);
  }
  pageMethodology(ctx);

  addFooters(ctx);

  const suffix = report.solarData?.postcode || 'report';
  doc.save(`wattshift-solar-report-${suffix}.pdf`);
}

/* ------------------------------------------------------------------ *
 * Page 1 — Summary
 * ------------------------------------------------------------------ */

function pageSummary(ctx) {
  const { doc, pageWidth, report } = ctx;
  const assessing = report.isAssessingExisting;
  header(
    ctx,
    assessing ? 'Solar System Performance Report' : 'Solar & Battery Feasibility Report',
    true
  );

  let y = 48;

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text(report.preparedFor || 'Property Owner', MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED);
  doc.text(
    `${report.solarData?.name ?? 'Location'} ${report.solarData?.postcode ?? ''}`.trim(),
    MARGIN,
    y
  );
  y += 5;
  doc.text(`Generated ${shortDate(new Date())}`, MARGIN, y);
  y += 12;

  // Key findings, boxed.
  const boxHeight = assessing ? 55 : report.batteryKwh > 0 ? 62 : 55;
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(...BRAND);
  doc.roundedRect(MARGIN, y, pageWidth - MARGIN * 2, boxHeight, 3, 3, 'FD');

  doc.setTextColor(...BRAND).setFont('helvetica', 'bold').setFontSize(11);
  doc.text('Key findings', MARGIN + 6, y + 9);

  const findings = assessing
    ? [
        [
          'Your system',
          `${number(report.systemKw, 1)} kW solar${report.batteryKwh > 0 ? ` + ${number(report.batteryKwh, 1)} kWh battery` : ''}`,
        ],
        ['Annual generation', kwh(Math.round(report.annualGeneration))],
        [
          'Self-consumption',
          `${percent(report.selfConsumptionPercent)} ${report.hasIntervalData ? '(from your meter data)' : '(estimated)'}`,
        ],
        ['Exported to grid', kwh(Math.round(report.exportedKwh))],
        ['Grid dependence', `${percent(report.gridDependencePercent)} of total usage`],
      ]
    : [
        [
          'Recommended system',
          `${number(report.systemKw, 1)} kW solar${report.batteryKwh > 0 ? ` + ${number(report.batteryKwh, 1)} kWh battery` : ''}`,
        ],
        [
          'Estimated annual savings',
          `${currency0(report.annualSavings.low)} – ${currency0(report.annualSavings.high)}`,
        ],
        [
          'Estimated cost after rebates',
          `${currency0(report.costs.netTotal.low)} – ${currency0(report.costs.netTotal.high)}`,
        ],
        ['Estimated payback', formatPaybackYears(report.costs.paybackYears)],
        [
          'Self-consumption',
          `${percent(report.selfConsumptionPercent)} ${report.hasIntervalData ? '(from your meter data)' : '(estimated)'}`,
        ],
      ];
  if (!assessing && report.batteryKwh > 0) {
    findings.push(['Battery cycles per year', number(report.batteryCyclesPerYear)]);
  }

  let boxY = y + 17;
  doc.setFontSize(9.5);
  for (const [label, value] of findings) {
    doc.setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(label, MARGIN + 6, boxY);
    doc.setFont('helvetica', 'bold').setTextColor(...INK);
    doc.text(String(value), pageWidth - MARGIN - 6, boxY, { align: 'right' });
    boxY += 7.5;
  }

  y += boxHeight + 10;

  y = section(ctx, 'What this report covers', y);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK);
  const intro = assessing
    ? report.hasIntervalData
      ? `This report assesses how your existing ${number(report.systemKw, 1)} kW solar system is performing against your actual usage, ` +
        `modelled from ${number(report.meterSummary.totalDays)} days of half-hourly readings from your smart meter ` +
        `(${shortDate(report.meterSummary.dateRange.start)} to ${shortDate(report.meterSummary.dateRange.end)}). ` +
        'It shows how much you generate, use on site, export, and still draw from the grid — not what a new system would cost.'
      : `This report assesses how your existing ${number(report.systemKw, 1)} kW solar system is likely performing, ` +
        'estimated from your bill totals and the system size you entered. Uploading smart meter data would replace ' +
        'the self-consumption and export figures with calculations from your own half-hourly readings.'
    : report.hasIntervalData
      ? `This analysis is built from ${number(report.meterSummary.totalDays)} days of half-hourly readings from your own smart meter, ` +
        `covering ${shortDate(report.meterSummary.dateRange.start)} to ${shortDate(report.meterSummary.dateRange.end)}. ` +
        'Rather than assuming how much of your solar you would use on site, every half hour of the year has been modelled ' +
        'against your recorded consumption and the sun position at your location.'
      : 'This analysis is built from the totals on your electricity bill combined with long-term irradiance data for your ' +
        'postcode. Self-consumption is estimated from typical usage patterns rather than measured. Uploading your smart ' +
        'meter data would replace that estimate with a calculation from your own half-hourly readings.';

  y = paragraph(ctx, intro, y);

  if (report.setupChange?.detected) {
    y += 2;
    const label = monthYearLabel(report.setupChange.changeDate);
    const days = report.setupChange.postDays ?? report.meterSummary?.totalDays;
    y = paragraph(
      ctx,
      `Analysing ${number(days)} days of post-install data (from ${label})` +
        `${
          report.existingSolarKw > 0
            ? ` (~${number(report.existingSolarKw, 1)} kW solar${report.existingBatteryKwh > 0 ? ` and a ${number(report.existingBatteryKwh, 1)} kWh battery` : ''})`
            : ''
        }.`,
      y
    );

    if (report.setupChange.preAvgImportKwh > 0 && report.setupChange.postAvgImportKwh >= 0) {
      const pre = report.setupChange.preAvgImportKwh;
      const post = report.setupChange.postAvgImportKwh;
      if (post < pre) {
        const reduction = pre - post;
        const annualSavingKwh = reduction * 365;
        const rate = (report.rates?.tariffCents ?? 0) / 100;
        const feedIn = (report.rates?.feedInCents ?? 0) / 100;
        const gridValue = annualSavingKwh * rate;
        const exportRevenue = (report.exportedKwh ?? 0) * feedIn;
        y += 2;
        y = paragraph(
          ctx,
          `Before your solar and battery were installed, your home drew about ${number(pre, 1)} kWh from the grid every day. ` +
            `Now it draws just ${number(post, 1)} kWh — a reduction of ${number(reduction, 1)} kWh/day. ` +
            `Over a year, that's about ${number(Math.round(annualSavingKwh))} kWh less grid electricity` +
            (gridValue > 0 ? `, worth roughly $${number(Math.round(gridValue))} at your current rates` : '') +
            `.` +
            (exportRevenue > 0
              ? ` Your system is also earning ~$${number(Math.round(exportRevenue))}/year from solar exported to the grid.`
              : ''),
          y
        );
      }
    }
  }

  y += 4;
  y = section(ctx, 'Your site', y);
  y = rows(ctx, y, [
    ['Location', `${report.solarData?.name ?? '—'} (${report.solarData?.postcode ?? '—'})`],
    ['Site type', report.mode === 'business' ? 'Business' : 'Home'],
    ['Retailer', report.billData?.retailer || 'Not identified'],
    ['Annual consumption', kwh(Math.round(report.annualConsumption))],
    ['Daily average', `${number(report.annualConsumption / 365, 1)} kWh/day`],
    ['Current annual cost', `${currency0(report.currentAnnualBill)}/year`],
    ...(report.hasIntervalData
      ? [['Meter', maskNmi(report.meterSummary.nmi ?? '')]]
      : []),
  ]);
}

/* ------------------------------------------------------------------ *
 * Page 2 — Consumption
 * ------------------------------------------------------------------ */

function pageConsumption(ctx) {
  const { doc, report } = ctx;
  doc.addPage();
  header(ctx, 'Consumption analysis');

  let y = 42;

  y = section(ctx, 'How much you use', y);
  y = rows(ctx, y, [
    ['Annual consumption', kwh(Math.round(report.annualConsumption))],
    ['Daily average', `${number(report.annualConsumption / 365, 1)} kWh/day`],
    ['Usage rate', `${number(report.rates.tariffCents, 2)} c/kWh${report.rates.tariffAssumed ? ' (assumed)' : ''}`],
    ['Daily supply charge', `${number(report.rates.supplyChargeCents, 2)} c/day`],
    ['Feed-in tariff', `${number(report.rates.feedInCents, 2)} c/kWh${report.rates.feedInAssumed ? ' (assumed)' : ''}`],
    ['Tariff type', report.tariff?.isTou ? `Time of use (${periodWindowLabel(report.costs.state, 'peak') ?? 'peak window'} peak)` : 'Flat rate'],
    ...(report.hasIntervalData
      ? [
          ['Peak demand', `${number(report.meterSummary.peakDemandKw, 1)} kW at ${report.meterSummary.peakDemandAt?.time ?? '—'}`],
          ['Readings', `${number(report.meterSummary.totalDays)} days at ${report.meterSummary.intervalMinutes}-minute intervals`],
        ]
      : []),
  ]);

  if (report.hasIntervalData && report.usage) {
    y += 4;
    y = section(ctx, 'When you use it', y);
    const shapeText = {
      daytime:
        'Your consumption is concentrated in daylight hours, which suits solar well — a large share of what the panels ' +
        'make will be used on site without needing storage.',
      evening:
        'Your consumption is concentrated in the evening, after the panels have stopped producing. This is the pattern ' +
        'where a battery earns its cost, by moving midday generation into the hours you actually use it.',
      balanced:
        'Your consumption is spread fairly evenly through the day, so solar covers a reasonable share directly and a ' +
        'battery adds a moderate amount on top.',
    }[report.usage.shape];

    y = paragraph(ctx, shapeText, y);
    y += 2;
    y = rows(ctx, y, [
      ['Daytime share (8am–6pm)', percent(report.usage.daytimeShare * 100, 1)],
      ['Evening share (5pm–11pm)', percent(report.usage.eveningShare * 100, 1)],
      ['Overnight share', percent(report.usage.overnightShare * 100, 1)],
      ['Average weekday', `${number(report.usage.weekdayDailyKwh, 1)} kWh`],
      ['Average weekend day', `${number(report.usage.weekendDailyKwh, 1)} kWh`],
    ]);
  }

  y = placeChart(ctx, 'loadProfile', 'Your average day', y);
  y = placeChart(ctx, 'heatmap', 'Usage by hour and month', y);
}

/* ------------------------------------------------------------------ *
 * Page 3 — Production
 * ------------------------------------------------------------------ */

function pageProduction(ctx) {
  const { doc, report } = ctx;
  const assessing = report.isAssessingExisting;
  doc.addPage();
  header(ctx, assessing ? 'Your system performance' : 'Solar production modelling');

  let y = 42;

  y = section(ctx, assessing ? 'Your system' : 'The system modelled', y);
  y = rows(ctx, y, [
    ['System size', `${number(report.systemKw, 1)} kW`],
    ['Approximate panels', `${report.panelCount} panels, about ${number(report.roofAreaM2)} m² of roof`],
    ['Battery', report.batteryKwh > 0 ? `${number(report.batteryKwh, 1)} kWh` : 'None'],
    ['Roof orientation', `${report.roofData?.orientation ?? 'N'}-facing at ${number(report.roofData?.pitchDegrees ?? 22.5, 1)}° pitch${report.roofData?.detected ? ' (detected)' : ' (assumed)'}`],
    ['Shading allowance', report.roofData?.shading ?? 'none'],
    ['Peak sun hours', `${number(report.solarData?.annual, 2)} per day (annual average)`],
    ['System derate', percent(report.derate * 100, 1)],
  ]);

  y += 4;
  y = section(ctx, assessing ? 'Annual performance' : 'What it would produce', y);
  y = rows(ctx, y, [
    ['Annual generation', `${kwh(Math.round(report.annualGeneration))}/year`],
    ['Covers', `${percent(report.offsetPercent)} of your annual consumption`],
    ['Used on site', `${kwh(Math.round(report.selfConsumedKwh))} (${percent(report.selfConsumptionPercent)})`],
    ['Exported to grid', kwh(Math.round(report.exportedKwh))],
    ['Still bought from grid', kwh(Math.round(report.gridImportKwh))],
    ['Grid dependence', `${percent(report.gridDependencePercent)} of total usage`],
    ...(assessing && report.batteryKwh > 0
      ? [['Battery', `${number(report.batteryKwh, 1)} kWh — stores daytime solar for evening use`]]
      : report.batteryKwh > 0
        ? [
            ['Stored in battery', kwh(Math.round(report.storedKwh))],
            ['Returned from battery', kwh(Math.round(report.batteryToLoadKwh))],
            ['Round-trip losses', kwh(Math.round(report.batteryLossesKwh))],
          ]
        : []),
  ]);

  if (report.hasIntervalData) {
    y += 3;
    y = paragraph(
      ctx,
      assessing
        ? `The ${percent(report.selfConsumptionPercent)} self-consumption figure above is generation minus measured export — ` +
          'generation from your system size and local sun data, export from your post-install meter readings.'
        : `The ${percent(report.selfConsumptionPercent)} self-consumption figure above is calculated, not assumed. ` +
          'It comes from comparing your recorded consumption against modelled generation in each half-hour interval ' +
          'across the whole period of your meter data.',
      y
    );
  }

  y = placeChart(ctx, 'energyBalance', 'Month by month', y);
  y = placeChart(ctx, 'generationOverlay', 'A representative day', y);
}

/* ------------------------------------------------------------------ *
 * Page 4 — Performance (existing system assessment)
 * ------------------------------------------------------------------ */

function pagePerformance(ctx) {
  const { doc, report } = ctx;
  doc.addPage();
  header(ctx, 'How your system is performing');

  let y = 42;

  y = section(ctx, 'Energy balance', y);
  y = paragraph(
    ctx,
    `Your ${number(report.systemKw, 1)} kW system generates about ${kwh(Math.round(report.annualGeneration))} a year. ` +
      `You use ${percent(report.selfConsumptionPercent)} of that on site (${kwh(Math.round(report.selfConsumedKwh))}), ` +
      `export ${kwh(Math.round(report.exportedKwh))}, and still draw ${percent(report.gridDependencePercent)} of your ` +
      `total usage from the grid (${kwh(Math.round(report.gridImportKwh))}).`,
    y
  );

  y += 4;
  y = rows(ctx, y, [
    ['Generation', `${kwh(Math.round(report.annualGeneration))}/year`],
    ['Self-consumption', percent(report.selfConsumptionPercent)],
    ['Used on site', kwh(Math.round(report.selfConsumedKwh))],
    ['Exported', kwh(Math.round(report.exportedKwh))],
    ['True consumption', `${kwh(Math.round(report.annualConsumption))}/year`],
    [
      'Daily average',
      `${number((report.annualConsumption ?? 0) / 365, 1)} kWh/day`,
    ],
    ['Grid dependence', `${percent(report.gridDependencePercent)} of total usage`],
    ['Grid imports', kwh(Math.round(report.gridImportKwh))],
    ...(report.batteryKwh > 0
      ? [['Battery', `${number(report.batteryKwh, 1)} kWh — stores daytime solar for evening use`]]
      : []),
  ]);

  if (!report.hasIntervalData) {
    y += 4;
    y = paragraph(
      ctx,
      'These figures are estimated from typical usage patterns and your system size. Uploading smart meter data ' +
        'would replace them with a half-hourly calculation from your own readings.',
      y
    );
  }
}

/* ------------------------------------------------------------------ *
 * Page 4 — Financial
 * ------------------------------------------------------------------ */

function pageFinancial(ctx) {
  const { doc, report } = ctx;
  doc.addPage();
  header(ctx, 'Financial analysis');

  let y = 42;
  const costs = report.costs;

  y = section(ctx, 'System cost', y);
  y = costTable(ctx, y, costs);

  y += 6;
  y = section(ctx, 'Savings and payback', y);
  y = rows(ctx, y, [
    ['Bill now', `${currency0(report.currentAnnualBill)}/year`],
    [
      'Bill with this system',
      `${currency0(Math.max(0, report.newAnnualBill.low))} – ${currency0(Math.max(0, report.newAnnualBill.high))}/year`,
    ],
    [
      'Annual saving',
      `${currency0(report.annualSavings.low)} – ${currency0(report.annualSavings.high)}`,
    ],
    ['  from using your own solar', currency0(report.savingsBreakdown.fromSelfConsumption)],
    ['  from export credits', currency0(report.savingsBreakdown.fromExport)],
    ['Simple payback', formatPaybackYears(costs.paybackYears)],
    ['Payback allowing for price rises', formatPaybackYears(costs.discountedPayback)],
    [
      '25-year net benefit',
      `${currency0(costs.netBenefit25Year.low)} – ${currency0(costs.netBenefit25Year.high)}`,
    ],
  ]);

  y = placeChart(ctx, 'payback', 'Cumulative position over 25 years', y);

  const { doc: d, pageHeight } = ctx;
  if (y < pageHeight - 40) {
    y += 2;
    y = paragraph(
      ctx,
      `The 25-year projection assumes panels lose ${number(SYSTEM_COSTS_2026.projection.panelDegradationPerYear * 100, 1)}% of ` +
        `their output each year and electricity prices rise ${number(SYSTEM_COSTS_2026.projection.electricityPriceGrowth * 100, 0)}% ` +
        `each year.${report.batteryKwh > 0 ? ` A battery replacement is deducted after ${SYSTEM_COSTS_2026.projection.batteryLifeYears} years.` : ''} ` +
        'Costs are indicative and vary by installer, equipment and site complexity.',
      y
    );
  }
  void d;
}

/* ------------------------------------------------------------------ *
 * Page 5 — Methodology
 * ------------------------------------------------------------------ */

function pageMethodology(ctx) {
  const { doc, report } = ctx;
  doc.addPage();
  header(ctx, 'Methodology and disclaimer');

  let y = 42;

  y = section(ctx, 'Where the numbers come from', y);
  y = rows(ctx, y, [
    ['Consumption', report.hasIntervalData ? 'Your NEM12 smart meter data, read in your browser' : 'Totals from your electricity bill'],
    ['Solar irradiance', 'Long-term peak sun hours by postcode, from Bureau of Meteorology derived data'],
    ['Generation model', 'Solar position calculated from latitude, longitude and day of year'],
    ['Tariff rates', report.rates.tariffAssumed ? 'Typical rates for your state (not read from your bill)' : 'Read from your electricity bill'],
    ['Equipment pricing', `${SYSTEM_COSTS_2026.source}, updated ${SYSTEM_COSTS_2026.lastUpdated}`],
    ['STC values', `Zone rating for ${report.costs.state}, ${report.costs.stc.deemingYears} years deemed at $${report.costs.stc.pricePerStc} per certificate`],
  ]);

  y += 4;
  y = section(ctx, 'Assumptions', y);
  y = rows(ctx, y, [
    ['System derate', `${percent(report.derate * 100, 1)} — inverter efficiency, temperature, wiring, soiling`],
    ['Roof', `${report.roofData?.orientation ?? 'N'}-facing, ${number(report.roofData?.pitchDegrees ?? 22.5, 1)}° pitch, ${report.roofData?.shading ?? 'none'} shading`],
    ...(report.batteryKwh > 0
      ? [
          ['Battery round-trip efficiency', '90%'],
          ['Battery charge/discharge rate', 'C/2'],
        ]
      : []),
    ['Panel degradation', `${number(SYSTEM_COSTS_2026.projection.panelDegradationPerYear * 100, 1)}% per year`],
    ['Electricity price growth', `${number(SYSTEM_COSTS_2026.projection.electricityPriceGrowth * 100, 0)}% per year`],
    ['Savings range', '±15% on the mid estimate'],
    ...(report.hasIntervalData && report.annualisationFactor !== 1
      ? [
          [
            'Annualisation',
            report.setupChange?.detected
              ? `${number(report.meterSummary.totalDays)} days of post-install data (from ${monthYearLabel(report.setupChange.changeDate)}) scaled to a full year (factor: ${number(report.annualisationFactor, 2)})`
              : `${number(report.meterSummary.totalDays)} days of data scaled to a full year`,
          ],
        ]
      : []),
  ]);

  y += 4;
  y = section(ctx, 'What this report is not', y);
  y = paragraph(
    ctx,
    'These estimates are for guidance only and do not constitute engineering advice. Actual performance depends on ' +
      'site conditions, equipment selection, installation quality and future electricity prices, none of which can be ' +
      'known in advance. Nothing here replaces a site inspection by a CEC-accredited installer, and no part of it is ' +
      'financial advice.',
    y
  );

  y += 2;
  y = paragraph(
    ctx,
    report.hasIntervalData
      ? 'Your meter data and bill data were processed entirely within your web browser. Neither was uploaded to any ' +
        'server, and neither is stored anywhere by WattShift.'
      : 'Your bill data was processed entirely within your web browser. It was not uploaded to any server and is not ' +
        'stored anywhere by WattShift.',
    y
  );

  if (report.warnings?.length) {
    y += 3;
    y = section(ctx, 'Notes on your data', y);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
    for (const warning of report.warnings) {
      y = paragraph(ctx, `• ${warning}`, y, { size: 9, colour: MUTED });
    }
  }

  y += 4;
  doc.setDrawColor(...RULE);
  doc.line(MARGIN, y, ctx.pageWidth - MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...BRAND);
  doc.text('This report was generated by WattShift — wattshift.com.au', MARGIN, y);
}

/* ------------------------------------------------------------------ *
 * Layout helpers
 * ------------------------------------------------------------------ */

function header(ctx, title, tall = false) {
  const { doc, pageWidth } = ctx;
  const height = tall ? 34 : 26;

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, height, 'F');
  doc.setTextColor(255, 255, 255);

  doc.setFont('helvetica', 'bold').setFontSize(tall ? 20 : 15);
  doc.text('WattShift', MARGIN, tall ? 16 : 13);

  doc.setFont('helvetica', 'normal').setFontSize(tall ? 11 : 9);
  doc.text(title, MARGIN, tall ? 25 : 19);

  if (!tall) {
    doc.text(shortDate(new Date()), pageWidth - MARGIN, 19, { align: 'right' });
  }

  doc.setTextColor(...INK);
}

function section(ctx, title, y) {
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...BRAND);
  doc.text(title, MARGIN, y);
  doc.setTextColor(...INK);
  return y + 6;
}

/**
 * Label-and-value rows with alternating backgrounds.
 *
 * A leading double space in the label marks a sub-item, which is indented and
 * muted — used for the components of a total.
 */
function rows(ctx, y, entries) {
  const { doc, pageWidth } = ctx;
  doc.setFontSize(9.5);

  entries.forEach(([label, value], i) => {
    const isSub = label.startsWith('  ');

    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN - 2, y - 3.8, pageWidth - MARGIN * 2 + 4, 5.6, 'F');
    }

    doc.setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(label.trim(), MARGIN + (isSub ? 4 : 0), y);

    doc.setFont('helvetica', isSub ? 'normal' : 'bold').setTextColor(...(isSub ? MUTED : INK));
    doc.text(String(value), pageWidth - MARGIN, y, { align: 'right' });

    y += 5.8;
  });

  return y;
}

function paragraph(ctx, text, y, { size = 9.5, colour = INK } = {}) {
  const { doc, pageWidth } = ctx;
  doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...colour);
  const lines = doc.splitTextToSize(text, pageWidth - MARGIN * 2);
  doc.text(lines, MARGIN, y);
  return y + lines.length * (size * 0.42) + 3;
}

/** The cost breakdown, with the rebate lines in green and a ruled total. */
function costTable(ctx, y, costs) {
  const { doc, pageWidth } = ctx;
  const right = pageWidth - MARGIN;

  doc.setFontSize(9.5);

  costRows(costs).forEach((row, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN - 2, y - 3.8, pageWidth - MARGIN * 2 + 4, 5.6, 'F');
    }

    doc.setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(row.label, MARGIN, y);

    const value = row.credit
      ? `-${currency0(Math.abs(row.low))}`
      : row.low === row.high
        ? currency0(row.low)
        : `${currency0(row.low)} - ${currency0(row.high)}`;

    doc.setFont('helvetica', 'bold').setTextColor(...(row.credit ? BRAND : INK));
    doc.text(value, right, y, { align: 'right' });
    y += 5.8;
  });

  y += 1;
  doc.setDrawColor(...INK).setLineWidth(0.4);
  doc.line(MARGIN, y, right, y);
  doc.setLineWidth(0.2);
  y += 6;

  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...INK);
  doc.text('Estimated net cost (inc GST)', MARGIN, y);
  doc.text(`${currency0(costs.netTotal.low)} - ${currency0(costs.netTotal.high)}`, right, y, {
    align: 'right',
  });

  return y + 4;
}

/**
 * Place a captured chart, if it fits on what remains of the page.
 *
 * Silently skipped when the chart failed to rasterise or there is no room —
 * a squeezed, illegible chart is worse than none.
 */
function placeChart(ctx, key, title, y) {
  const { doc, pageWidth, pageHeight, charts } = ctx;
  const image = charts[key];
  if (!image) return y;

  const width = pageWidth - MARGIN * 2;
  const height = Math.min(width * (image.height / image.width), 78);

  if (y + height + 14 > pageHeight - 20) return y;

  y += 5;
  y = section(ctx, title, y);
  doc.addImage(image.dataUrl, 'PNG', MARGIN, y, width, height);
  return y + height + 4;
}

/** Page numbers, once the total is known. */
function addFooters(ctx) {
  const { doc, pageWidth, pageHeight } = ctx;
  const total = doc.internal.getNumberOfPages();

  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(...RULE);
    doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    doc.text('WattShift — wattshift.com.au', MARGIN, pageHeight - 7.5);
    doc.text(`Page ${page} of ${total}`, pageWidth - MARGIN, pageHeight - 7.5, {
      align: 'right',
    });
  }
}
