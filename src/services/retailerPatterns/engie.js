/**
 * ENGIE (large business).
 *
 * Verified against: engie-adelaide-inn — a 43-page bundle of monthly C&I
 * statements, scanned rather than digital, so everything here runs on OCR
 * output.
 *
 * Layout notes:
 * - "Billing Period: 01 Jan 2025 to 31 Jan 2025", "Supply Address: ...",
 *   "Total Amount Payable $6,707.13" all survive OCR cleanly.
 * - There is no total-consumption line. The market-charge rows (REPS, LRET,
 *   SRES, AEMO) are each levied on total consumption and repeat the same
 *   volume, so the most common kWh quantity across those rows is the total.
 *   This is more robust than summing the energy rows, where OCR dropped a
 *   thousands separator ("9,407.35 kWh" became "9.40735 kWh").
 * - The unbundled rate structure means no single usage rate exists. OCR
 *   damage to the network rows makes the blended sum unreliable too, so the
 *   rate is deliberately left unset — that drives low confidence and hands
 *   the bill to the AI fallback rather than inventing a number.
 */
import { parse as parseGeneric } from './generic.js';
import { allMatches, mergeDefined, toNumber } from './_shared.js';

export const id = 'engie';
export const displayName = 'ENGIE';

export function detect(text) {
  if (/engie\.com(\.au)?/i.test(text)) return 3;
  if (/\bENGIE\b/.test(text)) return 2;
  // The logo OCRs as "CNGIC"; pair it with the partnership boilerplate.
  if (/CNGI[CE@]/.test(text) && /IPower\s+Pty\s+Ltd/i.test(text)) return 2;
  return 0;
}

/** Rows whose quantity is always the full period consumption. */
const MARKET_CHARGE_ROW =
  /(r\.?e\.?p\.?s|l\.?r\.?e\.?t|s\.?r\.?e\.?s|aemo)[^\n]*?([\d]{1,3}(?:,\d{3})+(?:\.\d+)?)\s*kwh/gi;

export function parse(text) {
  const base = parseGeneric(text);

  // Prefer the market-charge volume over summed energy rows: OCR dropped a
  // thousands separator in the peak row ("9,407.35 kWh" -> "9.40735 kWh"),
  // which would understate consumption by about 40%.
  const marketVolume = consumptionFromMarketCharges(text);

  return mergeDefined(base, {
    retailer: displayName,
    totalKwh: marketVolume ?? base.totalKwh,
  });
}

function consumptionFromMarketCharges(text) {
  const values = allMatches(text, MARKET_CHARGE_ROW)
    .map((m) => toNumber(m[2]))
    .filter((v) => v != null && v > 0);

  if (values.length < 2) return null;

  // The same volume repeats across these rows; take the mode so a single
  // OCR misread cannot win.
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);

  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : null;
}
