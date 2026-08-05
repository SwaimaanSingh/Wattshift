/**
 * Plain-text rendering of an estimate, for emailing or pasting anywhere.
 *
 * Deliberately plain text rather than HTML: it survives every mail client,
 * pastes into a message or a note unchanged, and is readable as-is.
 */
import { currency0, kwh, number, shortDate } from '../utils/formatters.js';

/**
 * @param {object} summary - the results-page summary object
 * @param {string} [url] - link that recreates the estimate
 */
export function buildEstimateText(summary, url) {
  const {
    billData,
    solarData,
    roofData,
    sizing,
    production,
    savings,
    systemKw,
    batteryLabel,
    scenarios,
    panelCount,
    roofAreaM2,
  } = summary;

  const line = (label, value) => `${label.padEnd(24)} ${value}`;
  const rule = '-'.repeat(52);

  const out = [
    'WATTSHIFT — YOUR SOLAR ESTIMATE',
    rule,
    line('Location', `${solarData.name} (${solarData.postcode})`),
    billData.retailer ? line('Retailer', billData.retailer) : null,
    line('Generated', shortDate(new Date())),
    '',
    'YOUR ELECTRICITY USE',
    line('Daily average', `${number(sizing.dailyConsumption, 1)} kWh/day`),
    line('Annual estimate', kwh(Math.round(sizing.annualConsumption))),
    line('Usage rate', `${number(savings.rates.tariffCents, 1)} c/kWh${savings.rates.tariffAssumed ? ' (assumed)' : ''}`),
    line('Supply charge', `${number(savings.rates.supplyChargeCents, 1)} c/day`),
    line('Current annual cost', `${currency0(savings.currentAnnualBill)}/yr`),
    '',
    'RECOMMENDED SYSTEM',
    line('System size', `${number(systemKw, 1)} kW`),
    line('Approx. panels', `${panelCount} panels, ~${number(roofAreaM2)} m2 of roof`),
    line('Generation', `${kwh(production.annual)}/yr`),
    line('Covers', `${savings.offsetPercent}% of your usage`),
    line('Battery', batteryLabel),
    line('Self-consumption', `${savings.selfConsumptionPercent}%`),
    '',
    'ESTIMATED SAVINGS',
    line('Bill now', `${currency0(savings.currentAnnualBill)}/yr`),
    line('Bill with solar', `${currency0(savings.newAnnualBillLow)} - ${currency0(savings.newAnnualBillHigh)}/yr`),
    line('Annual saving', `${currency0(savings.annualSavingsLow)} - ${currency0(savings.annualSavingsHigh)}`),
  ].filter(Boolean);

  if (Array.isArray(scenarios) && scenarios.length > 0) {
    out.push('', 'BATTERY OPTIONS', rule);
    for (const s of scenarios) {
      out.push(
        `${s.label.padEnd(22)} ${`${currency0(s.savings.annualSavingsLow)}-${currency0(s.savings.annualSavingsHigh)}`.padEnd(19)} ${s.savings.selfConsumptionPercent}% self-use`
      );
    }
  }

  out.push(
    '',
    'ASSUMPTIONS',
    line('Sun hours', `${number(solarData.annual, 2)} PSH/day`),
    line('Roof', `${roofData.orientation}-facing, ${number(roofData.pitchDegrees, 1)} deg, ${roofData.shading} shading${roofData.detected ? ' (detected)' : ' (assumed)'}`),
    line('System derate', `${number(sizing.effectiveDerate * 100, 1)}%`),
    line('Savings range', '+/-15% on the mid estimate')
  );

  if (url) out.push('', 'See this estimate again:', url);

  out.push(
    '',
    rule,
    'These estimates are for guidance only and do not constitute',
    'engineering advice. Actual performance depends on site conditions,',
    'equipment selection and installation quality. Consult a',
    'CEC-accredited installer for system design.',
    '',
    'Your bill data was processed in your browser and is not stored',
    'on any server.'
  );

  return out.join('\n');
}

/** mailto: link carrying the whole summary. */
export function buildEstimateMailto(summary, url, to = '') {
  const subject = `My WattShift solar estimate — ${number(summary.systemKw, 1)} kW in ${summary.solarData.name}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    buildEstimateText(summary, url)
  )}`;
}
