/**
 * One-page PDF summary of the estimate.
 *
 * jsPDF is loaded lazily — most people never tap download, and it's a large
 * dependency to ship on first paint.
 */
import { svgToPng } from './chartImage.js';
import { currency0, kwh, number, shortDate } from '../utils/formatters.js';

const MARGIN = 18;

/**
 * @param {object} summary
 * @param {HTMLElement} [chartEl] container holding the monthly chart's <svg>
 */
export async function downloadSummaryPdf(summary, chartEl) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const {
    billData,
    solarData,
    roofData,
    sizing,
    production,
    savings,
    batteryLabel,
    systemKw,
    scenarios,
  } = summary;

  // Rasterise the chart before writing anything — if it fails we simply omit
  // the image rather than losing the whole document.
  const chartImage = await svgToPng(chartEl).catch(() => null);

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  // Header
  doc.setFillColor(22, 163, 74);
  doc.rect(0, 0, pageWidth, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold').setFontSize(16);
  doc.text('WattShift', MARGIN, 13);
  doc.setFont('helvetica', 'normal').setFontSize(9);
  doc.text('Solar estimate summary', MARGIN, 19);
  doc.text(shortDate(new Date()), pageWidth - MARGIN, 19, { align: 'right' });

  y = 38;
  doc.setTextColor(15, 23, 42);

  y = section(doc, 'Your electricity use', y);
  y = rows(doc, y, [
    ['Location', `${solarData.name} (${solarData.postcode})`],
    ['Retailer', billData.retailer || 'Not identified'],
    [
      'Billing period',
      billData.billingPeriodStart
        ? `${shortDate(billData.billingPeriodStart)} to ${shortDate(billData.billingPeriodEnd)} (${billData.billingDays} days)`
        : `${billData.billingDays ?? '—'} days`,
    ],
    ['Daily average', `${number(sizing.dailyConsumption, 1)} kWh/day`],
    ['Annual estimate', kwh(Math.round(sizing.annualConsumption))],
    ['Usage rate', `${number(savings.rates.tariffCents, 2)} c/kWh${savings.rates.tariffAssumed ? ' (assumed)' : ''}`],
    ['Daily supply charge', `${number(savings.rates.supplyChargeCents, 2)} c/day`],
    ['Current annual cost', `${currency0(savings.currentAnnualBill)}/year`],
  ]);

  y += 4;
  y = section(doc, 'System modelled', y);
  y = rows(doc, y, [
    ['System size', `${number(systemKw, 1)} kW${Math.abs(systemKw - sizing.recommendedKw) > 0.05 ? ` (recommended ${number(sizing.recommendedKw, 1)} kW)` : ''}`],
    ['Approx. panels', `${summary.panelCount} panels, ~${number(summary.roofAreaM2)} m² of roof`],
    ['Estimated generation', `${kwh(production.annual)}/year`],
    ['Covers', `${savings.offsetPercent}% of your usage`],
    ['Battery scenario', batteryLabel],
    ['Self-consumption', `${savings.selfConsumptionPercent}%`],
  ]);

  y += 4;
  y = section(doc, 'Estimated savings', y);
  y = rows(doc, y, [
    ['Bill now', `${currency0(savings.currentAnnualBill)}/year`],
    [
      'Bill with solar',
      `${currency0(Math.max(0, savings.newAnnualBillLow))} – ${currency0(Math.max(0, savings.newAnnualBillHigh))}/year`,
    ],
    [
      'Annual saving',
      `${currency0(savings.annualSavingsLow)} – ${currency0(savings.annualSavingsHigh)}`,
    ],
  ]);

  if (Array.isArray(scenarios) && scenarios.length > 0) {
    y += 4;
    y = section(doc, `Battery options at ${number(systemKw, 1)} kW`, y);
    y = scenarioTable(doc, y, scenarios, summary.batteryKwh);
  }

  if (chartImage) {
    y += 4;
    y = section(doc, 'Through the year', y);
    const pageWidth = doc.internal.pageSize.getWidth();
    const width = pageWidth - MARGIN * 2;
    const height = width * (chartImage.height / chartImage.width);
    doc.addImage(chartImage.dataUrl, 'PNG', MARGIN, y, width, height);
    y += height + 2;
  }

  y += 4;
  y = section(doc, 'Assumptions', y);
  y = rows(doc, y, [
    ['Sun hours', `${number(solarData.annual, 2)} peak sun hours/day (annual average)`],
    [
      'Roof',
      `${roofData.orientation}-facing, ${number(roofData.pitchDegrees, 1)}° pitch, ${roofData.shading} shading${roofData.detected ? ' (detected)' : ' (assumed)'}`,
    ],
    ['System derate', `${number(sizing.effectiveDerate * 100, 1)}%`],
    [
      'Feed-in tariff',
      `${number(savings.rates.feedInCents, 2)} c/kWh${savings.rates.feedInAssumed ? ' (assumed)' : ''}`,
    ],
    ['Savings range', '±15% on the mid estimate'],
  ]);

  // Disclaimer pinned to the foot of the page.
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, pageHeight - 30, pageWidth - MARGIN, pageHeight - 30);
  doc.setFontSize(7.5).setTextColor(100, 116, 139);
  doc.text(
    doc.splitTextToSize(
      'These estimates are for guidance only and do not constitute engineering advice. Actual performance depends on site ' +
        'conditions, equipment selection and installation quality. Consult a CEC-accredited installer for system design. ' +
        'Your bill data was processed in your browser and is not stored on any server.',
      pageWidth - MARGIN * 2
    ),
    MARGIN,
    pageHeight - 24
  );

  doc.save(`wattshift-estimate-${solarData.postcode || 'summary'}.pdf`);
}

/** Battery scenarios as a compact four-column table. */
function scenarioTable(doc, y, scenarios, activeKwh) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const right = pageWidth - MARGIN;
  const cols = [MARGIN, MARGIN + 62, MARGIN + 108, right];

  doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(100, 116, 139);
  doc.text('Scenario', cols[0], y);
  doc.text('Annual saving', cols[1], y);
  doc.text('New bill', cols[2], y);
  doc.text('Self-use', cols[3], y, { align: 'right' });
  y += 1.5;
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, y, right, y);
  y += 4;

  doc.setFontSize(8.5);
  for (const s of scenarios) {
    const active = Math.abs(s.batteryKwh - activeKwh) < 0.01;
    doc.setFont('helvetica', active ? 'bold' : 'normal');
    doc.setTextColor(...(active ? [22, 163, 74] : [15, 23, 42]));

    doc.text(s.label, cols[0], y);
    doc.text(
      `${currency0(s.savings.annualSavingsLow)}-${currency0(s.savings.annualSavingsHigh)}`,
      cols[1],
      y
    );
    doc.text(
      `${currency0(Math.max(0, s.savings.newAnnualBillLow))}-${currency0(Math.max(0, s.savings.newAnnualBillHigh))}`,
      cols[2],
      y
    );
    doc.text(`${s.savings.selfConsumptionPercent}%`, cols[3], y, { align: 'right' });
    y += 5;
  }

  doc.setTextColor(15, 23, 42);
  return y;
}

function section(doc, title, y) {
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(22, 163, 74);
  doc.text(title, MARGIN, y);
  doc.setTextColor(15, 23, 42);
  return y + 6;
}

function rows(doc, y, entries) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(9.5);

  for (const [label, value] of entries) {
    doc.setFont('helvetica', 'normal').setTextColor(100, 116, 139);
    doc.text(label, MARGIN, y);
    doc.setFont('helvetica', 'bold').setTextColor(15, 23, 42);
    doc.text(String(value), pageWidth - MARGIN, y, { align: 'right' });
    y += 5.6;
  }

  return y;
}
