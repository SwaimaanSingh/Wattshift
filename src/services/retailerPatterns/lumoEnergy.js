/**
 * Lumo Energy.
 *
 * Verified against: abe-chandra-sept25 (residential flat + solar, split by a
 * 1 July price change).
 *
 * Layout notes:
 * - Charge rows omit the kWh unit — it lives in the column header:
 *   "Total Anytime  1318  $0.3903  $514.42"
 * - "Total Solar*" rows are exports and print credits as negative rates.
 * - "Daily averages for this account: Usage 52.73 kWh Solar Exports: 0.34 kWh"
 * - Meter-reading rows ("112292 - 110974 = 1318") carry no $ and are skipped.
 */
import { parse as parseGeneric } from './generic.js';
import { firstMatch, mergeDefined, toNumber } from './_shared.js';

export const id = 'lumoEnergy';
export const displayName = 'Lumo Energy';

export function detect(text) {
  if (/lumoenergy\.com\.au/i.test(text)) return 3;
  if (/\bLUMO\s+ENERGY\b/i.test(text)) return 3;
  if (/\bLumo\b/i.test(text)) return 1;
  return 0;
}

export function parse(text) {
  const base = parseGeneric(text);

  // Lumo states both daily averages explicitly on the usage page.
  const dailyExport = toNumber(
    firstMatch(text, [/solar\s+exports?\s*:?\s*([\d.]+)\s*kwh/i])
  );

  const exportKwh =
    base.solarExportKwh ??
    (dailyExport != null && base.billingDays ? dailyExport * base.billingDays : null);

  return mergeDefined(base, {
    retailer: displayName,
    hasSolar: base.hasSolar || (dailyExport != null && dailyExport > 0),
    solarExportKwh: exportKwh,
  });
}
