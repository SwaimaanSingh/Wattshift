/**
 * Origin Energy.
 *
 * Verified against:
 * - origin-college-park (residential TOU + controlled load, scanned/OCR)
 * - origin-farm-2024-11 / origin-farm-2025-10 (C&I demand tariff)
 *
 * Layout notes:
 * - Residential: "Your billing period: 17 Jun 2022 - 15 Sep 2022 (91 days)",
 *   rates as "39.259 c/kWh", supply as "Daily Supply 14 73.709 c/Day".
 * - C&I: "Consumption this period: 49,255.250 kWh" is authoritative, and the
 *   register labels are inverted relative to NEM convention (see
 *   BILL_FORMATS.md #8) so they are deliberately ignored.
 */
import { parse as parseGeneric } from './generic.js';
import {
  firstMatch,
  isPlausibleSupplyCharge,
  mergeDefined,
  rateToCents,
  toNumber,
} from './_shared.js';

export const id = 'origin';
export const displayName = 'Origin Energy';

export function detect(text) {
  if (/origin\s*energy\s*(electricity)?\s*(limited|ltd)/i.test(text)) return 3;
  if (/originenergy\.com\.au/i.test(text)) return 3;
  if (/\bOrigin\s+Energy\b/i.test(text)) return 2;
  return 0;
}

export function parse(text) {
  const base = parseGeneric(text);

  // "Daily Supply 14 73.709 c/Day" (residential) and
  // "Access Charge 31 Days 8.219200 $/Day" (C&I) — the day count sits between
  // the label and the rate, so each pattern carries its own unit.
  const supply = matchSupplyCharge(text);

  return mergeDefined(base, {
    retailer: displayName,
    dailySupplyChargeCents: isPlausibleSupplyCharge(supply) ? supply : null,
  });
}

function matchSupplyCharge(text) {
  const attempts = [
    [/daily\s+supply\s+\d+\s+([\d.]+)\s*[c¢]\s*\/\s*day/i, 'c/day'],
    [/access\s+charge\s+\d+\s*days?\s+([\d.]+)\s*\$\s*\/\s*day/i, '$'],
  ];
  for (const [pattern, unit] of attempts) {
    const value = toNumber(firstMatch(text, [pattern]));
    if (value == null) continue;
    const c = rateToCents(value, unit);
    if (isPlausibleSupplyCharge(c)) return c;
  }
  return null;
}
