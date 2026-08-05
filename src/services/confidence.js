/**
 * Confidence scoring, kept separate from billParser.js so it can be exercised
 * from Node (scripts/testParsers.mjs) without importing browser-only modules
 * like PDF.js.
 */

/** Without these the estimate cannot be produced at all. */
export const CRITICAL_FIELDS = ['totalKwh', 'tariffRateCentsPerKwh', 'billingDays'];

/** Nice to have; each one missing costs confidence but not viability. */
export const SECONDARY_FIELDS = [
  'dailySupplyChargeCents',
  'billingPeriodStart',
  'billingPeriodEnd',
  'postcode',
  'totalBillAmount',
];

/** Friendly names for the manual-entry form. */
export const FIELD_LABELS = {
  totalKwh: 'Total electricity used (kWh)',
  tariffRateCentsPerKwh: 'Rate per kWh (c)',
  billingDays: 'Days in the billing period',
  dailySupplyChargeCents: 'Daily supply charge (c/day)',
  billingPeriodStart: 'Billing period start',
  billingPeriodEnd: 'Billing period end',
  postcode: 'Postcode',
  totalBillAmount: 'Total bill amount',
};

/**
 * Work out which fields are missing and how much to trust the result.
 *
 * OCR output is capped at "medium" — the scanned samples produced values like
 * "24756 c/kWh" where a decimal point was lost, and a plausible-looking wrong
 * number is more dangerous than an admitted gap.
 *
 * @param {object} data
 * @param {'pdf-text'|'ocr'|'ai'|'manual'} source
 */
export function applyConfidence(data, source = 'pdf-text') {
  const missing = [];

  for (const field of [...CRITICAL_FIELDS, ...SECONDARY_FIELDS]) {
    const value = data[field];
    if (value == null || value === '' || (typeof value === 'number' && Number.isNaN(value))) {
      missing.push(field);
    }
  }

  const missingCritical = CRITICAL_FIELDS.filter((f) => missing.includes(f));
  const missingSecondary = SECONDARY_FIELDS.filter((f) => missing.includes(f));

  let confidence;
  if (missingCritical.length > 0) confidence = 'low';
  else if (missingSecondary.length <= 2) confidence = 'high';
  else confidence = 'medium';

  if (source === 'ocr' && confidence === 'high') confidence = 'medium';

  return { ...data, confidence, missingFields: missing };
}
