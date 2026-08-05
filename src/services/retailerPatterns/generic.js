/**
 * Catch-all extraction. Every retailer module builds on this and overrides
 * only the fields where its own layout beats the general patterns.
 */
import {
  allMatches,
  daysInclusive,
  extractDailyAverage,
  extractExplicitTotalKwh,
  extractRetailerName,
  extractSupplyLocation,
  extractTotalAmount,
  findDateRanges,
  findLabelledPeriod,
  findSharedYearRanges,
  firstMatch,
  isPlausibleFiT,
  isPlausibleSupplyCharge,
  isPlausibleUsageRate,
  lines,
  rateToCents,
  scanChargeRows,
  scanSupplyRows,
  toIso,
  toNumber,
  weightedRate,
  weightedSupplyCharge,
} from './_shared.js';

export const id = 'generic';
export const displayName = null; // unknown retailer

/**
 * @typedef {Object} BillData
 * @property {string|null} retailer
 * @property {string|null} billingPeriodStart  ISO date
 * @property {string|null} billingPeriodEnd    ISO date
 * @property {number|null} billingDays
 * @property {number|null} totalKwh
 * @property {number|null} dailyAverageKwh
 * @property {'flat'|'tou'|null} tariffType
 * @property {number|null} tariffRateCentsPerKwh
 * @property {{peak:number|null, shoulder:number|null, offPeak:number|null}|null} touRates
 * @property {number|null} dailySupplyChargeCents
 * @property {boolean} hasSolar
 * @property {number|null} solarExportKwh
 * @property {number|null} feedInTariffCents
 * @property {number|null} existingSolarSizeKw
 * @property {number|null} totalBillAmount
 * @property {string|null} postcode
 * @property {string|null} address
 * @property {'high'|'medium'|'low'} confidence
 * @property {string[]} missingFields
 * @property {Object} diagnostics
 */

/**
 * @param {string} text
 * @returns {BillData}
 */
export function parse(text) {
  const period = extractBillingPeriod(text);
  const rows = scanChargeRows(text);

  const usageRows = rows.filter((r) => r.kind !== 'export');
  const exportRows = rows.filter((r) => r.kind === 'export');

  const dailyAverageKwh = extractDailyAverage(text);
  const usage = resolveTotalKwh({
    text,
    usageRows,
    dailyAverageKwh,
    days: period.days,
  });

  const tariff = resolveTariff(text, usageRows, usage.totalKwh);
  const supplyChargeCents = weightedSupplyCharge(scanSupplyRows(text));
  const solar = resolveSolar(text, exportRows, usage.totalKwh);
  const location = extractSupplyLocation(text);

  const data = {
    // Only reached for brands with no module of their own — every retailer
    // module overrides this with its own display name.
    retailer: extractRetailerName(text),
    billingPeriodStart: toIso(period.start),
    billingPeriodEnd: toIso(period.end),
    billingDays: period.days,
    totalKwh: usage.totalKwh,
    dailyAverageKwh:
      dailyAverageKwh ??
      (usage.totalKwh && period.days ? usage.totalKwh / period.days : null),
    tariffType: tariff.type,
    tariffRateCentsPerKwh: tariff.mainRateCents,
    touRates: tariff.touRates,
    dailySupplyChargeCents: isPlausibleSupplyCharge(supplyChargeCents)
      ? supplyChargeCents
      : null,
    hasSolar: solar.hasSolar,
    solarExportKwh: solar.exportKwh,
    feedInTariffCents: solar.fitCents,
    existingSolarSizeKw: null, // inferred later, needs irradiance data
    totalBillAmount: extractTotalAmount(text),
    postcode: location.postcode,
    address: location.address,
    confidence: 'low',
    missingFields: [],
    diagnostics: {
      usageSource: usage.source,
      tariffSource: tariff.source,
      rowsFound: rows.length,
      isUnbundled: tariff.isUnbundled,
    },
  };

  return data;
}

/* ------------------------------------------------------------------ *
 * Billing period
 * ------------------------------------------------------------------ */

const PERIOD_LABEL =
  /(bill(ing)?\s+period|supply\s+period|charge\s+period|service\s+period|usage\s+period|read(?:ing)?\s+period|period\s*:|invoice\s+period|for\s+the\s+period|this\s+bill\s+covers|electricity\s+(?:tax\s+)?invoice)/i;

export function extractBillingPeriod(text) {
  // A fully-qualified range is the strongest reading and is tried first; the
  // fallbacks only run when the bill never prints one.
  let ranges = findDateRanges(text);

  if (ranges.length === 0) {
    const labelled = findLabelledPeriod(text);
    if (labelled) ranges = [labelled];
  }
  if (ranges.length === 0) {
    ranges = findSharedYearRanges(text);
  }
  if (ranges.length === 0) {
    return { start: null, end: null, days: extractStatedDays(text) };
  }

  // Ranges printed next to a period label are authoritative.
  const labelled = ranges.filter((r) => PERIOD_LABEL.test(r.line));
  const pool = labelled.length > 0 ? labelled : ranges;

  // A bill split by a mid-period price change prints several sub-ranges;
  // their union is the real billing period.
  let start = pool[0].start;
  let end = pool[0].end;
  for (const r of pool) {
    if (r.start < start) start = r.start;
    if (r.end > end) end = r.end;
  }

  const days = daysInclusive(start, end);
  const stated = extractStatedDays(text);

  // Trust the printed day count when it disagrees materially — a stray date
  // range can stretch the union.
  if (stated && days && Math.abs(stated - days) > 3 && stated < days) {
    return { start, end, days: stated };
  }

  return { start, end, days: days ?? stated };
}

/** "(31 days)" — summed when a bill is split into several rate blocks. */
function extractStatedDays(text) {
  const bracketed = allMatches(text, /\((\d{1,3})\s*days?\)/gi).map((m) =>
    Number(m[1])
  );
  if (bracketed.length === 0) {
    const single = toNumber(
      firstMatch(text, [/\bperiod:?\s*(\d{1,3})\s*days\b/i, /\b(\d{1,3})\s*days\b/i])
    );
    return single && single > 0 && single <= 400 ? single : null;
  }
  if (bracketed.length === 1) return bracketed[0];

  // Several blocks: distinct values are consecutive sub-periods, repeats are
  // the same figure restated.
  const distinct = [...new Set(bracketed)];
  const total = distinct.reduce((s, v) => s + v, 0);
  return total > 0 && total <= 400 ? total : null;
}

/* ------------------------------------------------------------------ *
 * Total usage
 * ------------------------------------------------------------------ */

function resolveTotalKwh({ text, usageRows, dailyAverageKwh, days }) {
  const explicit = extractExplicitTotalKwh(text);
  const fromRows = usageRows.reduce((sum, r) => sum + r.kwh, 0) || null;
  const fromAverage = dailyAverageKwh && days ? dailyAverageKwh * days : null;

  // Cross-check: the average-daily figure is printed by the retailer and is a
  // good referee when row summing has gone wrong (OCR noise, missed rows).
  const agrees = (a, b) => a && b && Math.abs(a - b) / Math.max(a, b) <= 0.05;

  if (explicit && (!fromAverage || agrees(explicit, fromAverage))) {
    return { totalKwh: explicit, source: 'explicit-total' };
  }
  if (fromRows && (!fromAverage || agrees(fromRows, fromAverage))) {
    return { totalKwh: fromRows, source: 'summed-rows' };
  }
  if (fromAverage) return { totalKwh: fromAverage, source: 'daily-average' };
  if (explicit) return { totalKwh: explicit, source: 'explicit-total' };
  if (fromRows) return { totalKwh: fromRows, source: 'summed-rows' };
  return { totalKwh: null, source: 'none' };
}

/* ------------------------------------------------------------------ *
 * Tariff
 * ------------------------------------------------------------------ */

/**
 * Commercial bills unbundle the cost of a kWh across energy, network,
 * environmental and regulated blocks. Reading only the retail energy rate
 * understates the true marginal cost by roughly 3x, so when that structure is
 * present we sum every per-kWh charge instead.
 */
function isUnbundledBill(text) {
  const blocks = [
    /network charges/i,
    /environmental charges/i,
    /market charges/i,
    /regulated charges/i,
  ].filter((re) => re.test(text)).length;
  return blocks >= 2;
}

function resolveTariff(text, usageRows, totalKwh) {
  if (isUnbundledBill(text)) {
    const blended = blendedVolumetricRate(text, totalKwh);
    if (isPlausibleUsageRate(blended)) {
      return {
        type: 'flat',
        mainRateCents: blended,
        touRates: null,
        source: 'blended-volumetric',
        isUnbundled: true,
      };
    }
  }

  const byKind = (kind) => usageRows.filter((r) => r.kind === kind);
  const peak = weightedRate(byKind('peak'));
  const shoulder = weightedRate(byKind('shoulder'));
  const offPeak = weightedRate(byKind('offpeak'));

  const isTou =
    [peak, shoulder, offPeak].filter(isPlausibleUsageRate).length >= 2;

  if (isTou) {
    const main = weightedRate(usageRows.filter((r) => r.kind !== 'controlled'));
    return {
      type: 'tou',
      mainRateCents: isPlausibleUsageRate(main) ? main : peak,
      touRates: {
        peak: isPlausibleUsageRate(peak) ? peak : null,
        shoulder: isPlausibleUsageRate(shoulder) ? shoulder : null,
        offPeak: isPlausibleUsageRate(offPeak) ? offPeak : null,
      },
      source: 'tou-rows',
      isUnbundled: false,
    };
  }

  const flat = weightedRate(usageRows);
  if (isPlausibleUsageRate(flat)) {
    return {
      type: 'flat',
      mainRateCents: flat,
      touRates: null,
      source: 'flat-rows',
      isUnbundled: false,
    };
  }

  // Last resort: a bare "NN.NNN c/kWh" anywhere on the bill.
  const loose = rateToCents(
    toNumber(firstMatch(text, [/([\d.]+)\s*[c¢]\s*\/\s*kwh/i])),
    'c/kWh'
  );
  return {
    type: isPlausibleUsageRate(loose) ? 'flat' : null,
    mainRateCents: isPlausibleUsageRate(loose) ? loose : null,
    touRates: null,
    source: isPlausibleUsageRate(loose) ? 'loose-rate' : 'none',
    isUnbundled: false,
  };
}

/**
 * Sum every charge expressed per kWh and divide by consumption. Demand and
 * fixed charges are deliberately excluded — solar reliably offsets energy,
 * not peak demand.
 */
function blendedVolumetricRate(text, totalKwh) {
  if (!totalKwh || totalKwh <= 0) return null;

  let sum = 0;
  let found = 0;

  for (const raw of lines(text)) {
    // Rows look like: "<label> <qty> kWh <rate> ¢/kWh [factors] $<amount>"
    if (!/[c¢]\s*\/\s*kwh/i.test(raw)) continue;
    const amounts = allMatches(raw, /\$\s?-?([\d,]+(?:\.\d+)?)/g);
    if (amounts.length === 0) continue;

    const amount = toNumber(amounts[amounts.length - 1][1]);
    if (amount == null || amount <= 0) continue;

    sum += amount;
    found++;
  }

  if (found < 2) return null;
  return (sum / totalKwh) * 100; // dollars -> cents
}

/* ------------------------------------------------------------------ *
 * Solar
 * ------------------------------------------------------------------ */

/** Export quantities stated outside the charges table. */
const EXPORT_KWH_PATTERNS = [
  /(?:solar\s+export(?:s|ed)?|exported\s+to\s+(?:the\s+)?grid|export(?:ed)?\s+usage|feed[- ]?in|energy\s+exported|electricity\s+exported|total\s+export(?:s|ed)?|export\s+to\s+(?:the\s+)?grid|solar\s+credit)[^\n\d]{0,40}([\d,]+(?:\.\d+)?)\s*kwh/gi,
  /([\d,]+(?:\.\d+)?)\s*kwh[^\n]{0,30}(?:exported|solar\s+export|export(?:ed)?\s+to\s+(?:the\s+)?grid|fed\s+back\s+(?:in)?to)/gi,
];

const FIT_LABEL =
  '(?:feed[- ]?in\\s+tariff|feed[- ]?in\\s+credit|feed[- ]?in\\s+rate|solar\\s+feed[- ]?in|solar\\s+credit\\s+rate|solar\\s+export\\s+rate|export\\s+credit\\s+rate)';

/**
 * Feed-in rate stated as a plan term rather than a charge row, paired with the
 * unit the pattern itself pins down.
 *
 * The unit cannot be inferred from magnitude here: Australian feed-in tariffs
 * now sit at 2-5c, which the fallback heuristic in `rateToCents` reads as
 * dollars — turning 4.5 c/kWh into 450c, well outside the plausible range, so
 * the rate would be thrown away rather than reported.
 */
const FIT_RATE_PATTERNS = [
  [new RegExp(`${FIT_LABEL}[^\\n\\d]{0,40}([\\d.]+)\\s*(?:[c¢]|cents?)`, 'i'), 'cents'],
  [new RegExp(`${FIT_LABEL}[^\\n$]{0,40}\\$\\s?([\\d.]+)`, 'i'), 'dollars'],
];

/**
 * NEM register codes (E1 import, B1 export). Retailers disagree about which
 * is which — the Origin C&I sample labels its consumption register
 * "E1 Export Usage" — so these lines are never used as solar evidence.
 */
const REGISTER_LINE = /(?:^|\s)[EBKQ]\d(?:\s|:)/i;

function resolveSolar(text, exportRows, totalKwh) {
  const rowKwh = exportRows.reduce((sum, r) => sum + r.kwh, 0);

  let exportKwh = rowKwh > 0 ? rowKwh : null;
  if (exportKwh == null) {
    const searchable = lines(text)
      .filter((l) => !REGISTER_LINE.test(l))
      .join('\n');

    for (const pattern of EXPORT_KWH_PATTERNS) {
      const values = allMatches(searchable, pattern)
        .map((m) => toNumber(m[1]))
        .filter((v) => v != null && v > 0);
      if (values.length > 0) {
        exportKwh = Math.max(...values);
        break;
      }
    }
  }

  // An "export" figure identical to total consumption is the same number read
  // twice, not a site that exported everything it used.
  if (exportKwh != null && totalKwh != null && Math.abs(exportKwh - totalKwh) < 0.01) {
    exportKwh = null;
  }

  // A plan blurb like "this plan has a high feed in tariff" is not evidence of
  // solar — we require an actual exported quantity or a solar credit line.
  const creditLine =
    /solar\s+(?:credit|rebate|export\s+credit)|feed[- ]?in\s+(?:tariff|credit|rebate)[^\n]{0,40}\d|export\s+credit[^\n]{0,40}\d/i.test(
      text
    );
  const hasSolar = (exportKwh != null && exportKwh > 0) || (rowKwh > 0 && creditLine);

  let fitCents = weightedRate(exportRows);
  if (!isPlausibleFiT(fitCents)) fitCents = looseFeedInRate(text);

  return {
    hasSolar,
    exportKwh: hasSolar ? exportKwh : null,
    // Feed-in rates print as credits; report the magnitude the customer earns.
    fitCents: hasSolar && fitCents != null ? Math.abs(fitCents) * signOf(fitCents, exportRows) : null,
  };
}

/** First feed-in rate whose stated unit makes it a plausible tariff. */
function looseFeedInRate(text) {
  for (const [pattern, unit] of FIT_RATE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;

    const value = toNumber(m[1]);
    if (value == null) continue;

    const cents = unit === 'dollars' ? value * 100 : value;
    if (isPlausibleFiT(cents)) return cents;
  }
  return null;
}

/**
 * Export is usually a credit but not always — the iO Energy sample charges
 * for daytime export. Keep the sign when the bill genuinely charges.
 */
function signOf(fitCents, exportRows) {
  const netAmount = exportRows.reduce((sum, r) => sum + (r.amount || 0), 0);
  // Amounts on export rows are printed as credits (often negative). A net
  // positive charge means the customer is paying to export.
  if (exportRows.length > 0 && netAmount > 0) return -1;
  return 1;
}
