/**
 * Primitives shared by every retailer pattern module.
 *
 * Written against the sample bills in scripts/sample-text/ — see
 * BILL_FORMATS.md for what each quirk here is compensating for.
 */

/* ------------------------------------------------------------------ *
 * Numbers and rates
 * ------------------------------------------------------------------ */

/** "1,669.952" | "$1,226.89" | "-$0.30" -> Number (NaN-safe -> null) */
export function toNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '').replace(/^\+/, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Normalise a rate to cents.
 *
 * Bills mix units freely — "$0.53", "39.259 c/kWh", "8.219200 $/Day",
 * "5.501300 ¢/kWh" all appear in the samples. `context` is the raw matched
 * text around the number, which carries the unit.
 *
 * @param {number|string} value
 * @param {string} context - surrounding text containing the unit marker
 * @returns {number|null} cents
 */
export function rateToCents(value, context = '') {
  const n = typeof value === 'number' ? value : toNumber(value);
  if (n == null) return null;

  const ctx = String(context);
  if (/[c¢]\s*\/\s*(kwh|day|month|meter)/i.test(ctx) || /\bcents?\b/i.test(ctx)) {
    return n; // already cents
  }
  if (/\$/.test(ctx)) return n * 100;

  // No unit marker. Rates below $5 are dollars-per-unit; anything larger is
  // already cents (a 39c/kWh rate never appears as "0.39" without a $ sign).
  return Math.abs(n) < 5 ? n * 100 : n;
}

/** True when a usage rate is plausible for an Australian bill (c/kWh). */
export const isPlausibleUsageRate = (c) => c != null && c >= 3 && c <= 200;
/** True when a daily supply charge is plausible (c/day). */
export const isPlausibleSupplyCharge = (c) => c != null && c >= 10 && c <= 1500;
/** Feed-in tariffs range from small negative (export charges) to ~25c. */
export const isPlausibleFiT = (c) => c != null && c >= -30 && c <= 30;

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_NAME = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
/** "6 Mar 2026" | "03 SEP 25" | "06 June 2025" */
const DMY_TEXT = `\\d{1,2}\\s+${MONTH_NAME}\\.?\\s+\\d{2,4}`;
/** "31/03/2026" | "03/04/25" */
const DMY_SLASH = '\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}';

export const DATE_PATTERN = `(?:${DMY_TEXT}|${DMY_SLASH})`;

/**
 * Parse the Australian date formats seen across the samples.
 * Two-digit years are read as 2000+ (bills are never from the 1900s).
 * @returns {Date|null}
 */
export function parseAuDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  let m = s.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH_NAME})\\.?\\s+(\\d{2,4})$`, 'i'));
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month == null) return null;
    return makeDate(Number(m[3]), month, Number(m[1]));
  }

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    // Australian bills are always day-first.
    return makeDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  return null;
}

function makeDate(year, monthIndex, day) {
  const fullYear = year < 100 ? 2000 + year : year;
  const d = new Date(fullYear, monthIndex, day);
  if (
    d.getFullYear() !== fullYear ||
    d.getMonth() !== monthIndex ||
    d.getDate() !== day
  ) {
    return null; // rejects things like 31 Feb
  }
  return d;
}

/**
 * Inclusive day count — a 6 Mar to 5 Apr period is 31 days on every sample
 * bill checked, i.e. both endpoints count.
 */
export function daysInclusive(start, end) {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * ISO date built from local components. `toISOString()` would convert local
 * midnight to UTC and shift Australian dates back a day.
 */
export const toIso = (d) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;

/**
 * All "<date> to|-|– <date>" ranges in the document, in order, tagged with
 * the line they came from so callers can prefer ones near a period label.
 * @returns {{start: Date, end: Date, line: string, index: number}[]}
 */
export function findDateRanges(text) {
  const re = new RegExp(
    `(${DATE_PATTERN})\\s*(?:to|until|-|–|—)\\s*(${DATE_PATTERN})`,
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = parseAuDate(m[1]);
    const end = parseAuDate(m[2]);
    if (!start || !end || end < start) continue;
    // Guard against a rate calendar being read as a billing period.
    const span = daysInclusive(start, end);
    if (span == null || span > 400) continue;
    out.push({ start, end, line: lineAt(text, m.index), index: m.index });
  }
  return out;
}

/**
 * Ranges that print the year only once: "14 Dec - 13 Jan 2026",
 * "1 - 31 July 2025", "01/07 - 31/07/2025".
 *
 * Used only when no fully-qualified range exists, so it cannot outrank the
 * stricter reading. The trailing year belongs to the end date; the start
 * inherits it and rolls back a year when that would put it after the end,
 * which is what makes a December-to-January period come out as 31 days rather
 * than a negative span.
 *
 * @returns {{start: Date, end: Date, line: string, index: number}[]}
 */
export function findSharedYearRanges(text) {
  const SEP = '\\s*(?:to|until|-|–|—)\\s*';
  const YEAR = '\\d{2,4}';

  // A leading day must not be a fragment of a longer number, and the trailing
  // year must not be. Without this, "6 Mar 2026 to 5 Apr 2026" matches as
  // "26 ... to 5 Apr 2026" — the tail of the first year read as a start day.
  const DAY = '(?<![\\d/-])(\\d{1,2})';
  const TAIL_YEAR = `(${YEAR})(?![\\d/-])`;

  const shapes = [
    // "14 Dec - 13 Jan 2026"
    {
      re: new RegExp(
        `${DAY}\\s+(${MONTH_NAME})\\.?${SEP}(\\d{1,2})\\s+(${MONTH_NAME})\\.?\\s+${TAIL_YEAR}`,
        'gi'
      ),
      read: (m) => ({
        startDay: Number(m[1]),
        startMonth: monthIndex(m[2]),
        endDay: Number(m[3]),
        endMonth: monthIndex(m[4]),
        year: Number(m[5]),
        // Different months either side: a start after the end means the period
        // wraps a year boundary (14 Dec -> 13 Jan).
        mayWrapYear: true,
      }),
    },
    // "1 - 31 July 2025" — both endpoints share the one month, so a start day
    // after the end day is not a wrap, it is a bad match.
    {
      re: new RegExp(
        `${DAY}${SEP}(\\d{1,2})\\s+(${MONTH_NAME})\\.?\\s+${TAIL_YEAR}`,
        'gi'
      ),
      read: (m) => ({
        startDay: Number(m[1]),
        startMonth: monthIndex(m[3]),
        endDay: Number(m[2]),
        endMonth: monthIndex(m[3]),
        year: Number(m[4]),
        mayWrapYear: false,
      }),
    },
    // "01/07 - 31/07/2025" — slash form only, so a fully-qualified range
    // ("31/07/2025 - 30/08/2025") cannot be partially matched.
    {
      re: new RegExp(`${DAY}/(\\d{1,2})${SEP}(\\d{1,2})/(\\d{1,2})/${TAIL_YEAR}`, 'g'),
      read: (m) => ({
        startDay: Number(m[1]),
        startMonth: Number(m[2]) - 1,
        endDay: Number(m[3]),
        endMonth: Number(m[4]) - 1,
        year: Number(m[5]),
        mayWrapYear: true,
      }),
    },
  ];

  const out = [];
  for (const { re, read } of shapes) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const f = read(m);
      if (f.startMonth == null || f.endMonth == null) continue;

      const end = makeDate(f.year, f.endMonth, f.endDay);
      if (!end) continue;

      let start = makeDate(f.year, f.startMonth, f.startDay);
      if (start && start > end) {
        if (!f.mayWrapYear) continue;
        start = makeDate(f.year - 1, f.startMonth, f.startDay);
      }
      if (!start || start > end) continue;

      const span = daysInclusive(start, end);
      if (span == null || span > 400) continue;

      out.push({ start, end, line: lineAt(text, m.index), index: m.index });
    }
  }
  return out;
}

const monthIndex = (name) => {
  const i = MONTHS[String(name).slice(0, 3).toLowerCase()];
  return i == null ? null : i;
};

/**
 * Periods stated as two separately-labelled fields rather than one range:
 *   "Bill period start  01/07/2025 ... Bill period end  31/07/2025"
 *   "From: 1 Jul 2025" / "To: 31 Jul 2025"
 *
 * Also a fallback only — a bill that prints a proper range is read that way.
 *
 * @returns {{start: Date, end: Date, line: string, index: number}|null}
 */
export function findLabelledPeriod(text) {
  const startLabels = [
    new RegExp(
      `(?:bill(?:ing)?|supply|service|charge|invoice|read(?:ing)?)\\s+period\\s+(?:start(?:s|ing)?|from|begin(?:s|ning)?)\\b[^\\n\\d]{0,15}(${DATE_PATTERN})`,
      'i'
    ),
    new RegExp(
      `\\bperiod\\s+(?:start(?:s|ing)?|from|begin(?:s|ning)?)\\b[^\\n\\d]{0,15}(${DATE_PATTERN})`,
      'i'
    ),
    new RegExp(
      `\\bstart\\s+(?:date|of\\s+(?:bill|period))\\b[^\\n\\d]{0,15}(${DATE_PATTERN})`,
      'i'
    ),
    // A colon is required: "From 6 Mar 2026 to 5 Apr 2026" is a range, not a
    // labelled field, and is already handled by findDateRanges.
    new RegExp(`\\bfrom\\s*:\\s*(${DATE_PATTERN})`, 'i'),
  ];

  const endLabels = [
    new RegExp(
      `(?:bill(?:ing)?|supply|service|charge|invoice|read(?:ing)?)\\s+period\\s+(?:end(?:s|ing)?|to|finish(?:es)?)\\b[^\\n\\d]{0,15}(${DATE_PATTERN})`,
      'i'
    ),
    new RegExp(
      `\\bperiod\\s+(?:end(?:s|ing)?|to|finish(?:es)?)\\b[^\\n\\d]{0,15}(${DATE_PATTERN})`,
      'i'
    ),
    new RegExp(`\\bend\\s+(?:date|of\\s+(?:bill|period))\\b[^\\n\\d]{0,15}(${DATE_PATTERN})`, 'i'),
    new RegExp(`\\bto\\s*:\\s*(${DATE_PATTERN})`, 'i'),
  ];

  const start = parseAuDate(firstMatch(text, startLabels));
  const end = parseAuDate(firstMatch(text, endLabels));
  if (!start || !end || end < start) return null;

  const span = daysInclusive(start, end);
  if (span == null || span > 400) return null;

  return { start, end, line: '', index: 0 };
}

/** The full visual line containing a character offset. */
export function lineAt(text, index) {
  const from = text.lastIndexOf('\n', index) + 1;
  let to = text.indexOf('\n', index);
  if (to === -1) to = text.length;
  return text.slice(from, to);
}

/* ------------------------------------------------------------------ *
 * Line scanning
 * ------------------------------------------------------------------ */

export const lines = (text) => text.split('\n');

/** First capture group of the first matching pattern, or null. */
export function firstMatch(text, patterns, group = 1) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m[group] != null) return m[group];
  }
  return null;
}

/** All matches of a global pattern as arrays. */
export function allMatches(text, pattern) {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
  );
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m.index === re.lastIndex) re.lastIndex++; // zero-length guard
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Charge-row scanning
 * ------------------------------------------------------------------ */

/**
 * Sections after which rows are no longer retail usage of energy.
 *
 * Note "total charges" is deliberately absent: AGL prints "Total charges"
 * as a subtotal *before* the solar export block, so treating it as a section
 * boundary would discard the export rows.
 */
const NON_ENERGY_SECTION =
  /^\s*(network charges|environmental charges|regulated charges|market charges|metering and services|metering charges|retail service charges|additional charges|payments and transactions|invoice summary|invoice charge summary|demand and capacity)\b/i;

/**
 * Row labels that are never a customer usage tariff.
 * "average"/"daily usage" matter because the usage-summary panels print lines
 * like "Daily usage 8.18 kWh", which would otherwise be summed as consumption.
 */
const NON_TARIFF_LABEL =
  /\b(aemo|reps?|r\.e\.p\.s|lrec|srec|lret|sres|l\.r\.e\.t|s\.r\.e\.s|certificate|access charge|standing charge|metering|meter charge|value added|retail service|demand|capacity|kva|greenhouse|emissions|balance|payment|gst|sub-?total|rounding|previous|discount|concession|rebate credit|averages?|avg|daily usage|per day|this time last year|last year|same time)\b/i;

/**
 * Classify a charge-row label into a tariff bucket.
 * Order matters: "off peak" must beat "peak", and export beats everything.
 */
export function classifyRow(label) {
  const l = label.toLowerCase();
  if (/\b(export|feed[- ]?in|solar)\b/.test(l)) return 'export';
  if (/off[\s-]?peak/.test(l)) return 'offpeak';
  if (/shoulder/.test(l)) return 'shoulder';
  if (/\bpeak\b/.test(l)) return 'peak';
  if (/controlled|\bcl\s?1\b|off\s?peak\s?water/.test(l)) return 'controlled';
  if (/anytime|general|single rate|all times|usage|consumption|energy/.test(l)) {
    return 'flat';
  }
  return null;
}

/**
 * @typedef {Object} ChargeRow
 * @property {string} label
 * @property {'peak'|'offpeak'|'shoulder'|'controlled'|'flat'|'export'} kind
 * @property {number} kwh
 * @property {number|null} rateCents
 * @property {number|null} amount
 * @property {string} raw
 */

/**
 * Pull usage/export rows out of the charges table.
 *
 * Two row shapes cover every sample:
 *   A) quantity carries an explicit unit — "Peak  1,669.952 kWh  $0.53  $885.07"
 *   B) unit lives in the column header — "Total Anytime  1318  $0.3903  $514.42"
 *
 * Rows appearing after a non-energy section header are ignored, which is what
 * stops commercial bills double-counting the same kWh through their network
 * and environmental blocks.
 *
 * @param {string} text
 * @param {{stopAtNonEnergy?: boolean}} [options]
 * @returns {ChargeRow[]}
 */
export function scanChargeRows(text, { stopAtNonEnergy = true } = {}) {
  const out = [];
  let stopped = false;
  let section = null;

  for (const raw of lines(text)) {
    const line = raw.trim();
    if (!line) continue;

    if (NON_ENERGY_SECTION.test(line)) {
      stopped = true;
      continue;
    }
    if (stopAtNonEnergy && stopped) continue;

    // Try the line as a data row first. Only if it isn't one do we consider it
    // a heading — otherwise a genuine row like Lumo's "Total Anytime 1318
    // $0.3903 $514.42" would be mistaken for a section title.
    const row = NON_TARIFF_LABEL.test(line)
      ? null
      : parseRowWithUnit(line) || parseRowRateUnit(line) || parseRowWithoutUnit(line);

    if (row) {
      // AGL groups exports under a "Solar export" heading and labels the
      // second row "Next", which carries no solar wording at all — so the
      // heading, not the label, decides.
      if (section === 'export') row.kind = 'export';
      out.push(row);
      continue;
    }

    const heading = readSectionHeading(line);
    if (heading !== undefined) section = heading;
  }

  return out;
}

/**
 * @returns {string|null|undefined} section name, null to clear, or undefined
 *   when the line is not a heading at all.
 */
function readSectionHeading(line) {
  if (/^\s*(solar\s+export|export\s+charges?|feed[- ]?in\s+credits?)\b/i.test(line)) {
    return 'export';
  }
  if (
    /^\s*(usage\s+and\s+supply|electricity\s+charges|your\s+electricity\s+charges|energy\s+charges|new\s+charges)\b/i.test(
      line
    )
  ) {
    return 'usage';
  }
  // "Total credits" / "Total charges" close the block they summarise.
  if (/^\s*total\b/i.test(line)) return null;
  return undefined;
}

/** Shape A — quantity followed by "kWh". */
function parseRowWithUnit(line) {
  const m = line.match(/^(.*?)([\d,]+(?:\.\d+)?)\s*kwh\b(.*)$/i);
  if (!m) return null;

  const label = m[1].trim();
  const kwhValue = toNumber(m[2]);
  if (kwhValue == null || !label) return null;

  const kind = classifyRow(label);
  if (!kind) return null;

  const { rateCents, amount } = readRateAndAmount(m[3]);

  // A charge row always states a rate or a cost. Lines with neither are meter
  // register readings — e.g. Origin's "219076907 E1 Export Usage 49,255.250
  // kWh", which is consumption despite the "Export" label and must not be
  // read as a solar export row.
  if (rateCents == null && amount == null) return null;

  return { label, kind, kwh: kwhValue, rateCents, amount, raw: line };
}

/**
 * Shape A2 — the unit sits on the *rate*, not the quantity:
 *   "Peak  14  LG032103550  603.105  39.259 c/kWh  $236.77"
 *
 * Origin's residential layout puts bill days and the meter number between the
 * label and the figures, and never writes "kWh" after the quantity. Without
 * this, no row parses and the tariff falls back to the first c/kWh figure on
 * the page — which on that bill is the controlled-load rate, understating the
 * usage rate by more than half.
 */
function parseRowRateUnit(line) {
  const m = line.match(
    /^(.*?)([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*[c¢]\s*\/\s*kwh\b(.*)$/i
  );
  if (!m) return null;

  const label = m[1].trim();
  if (!label) return null;

  const kind = classifyRow(label);
  if (!kind) return null;

  const kwhValue = toNumber(m[2]);
  const rateCents = toNumber(m[3]);
  if (kwhValue == null || rateCents == null) return null;

  const amounts = allMatches(m[4], /-?\$\s?-?[\d,]+(?:\.\d+)?/g);
  if (amounts.length === 0) return null;

  // A cost is required here. Rate calendars repeat the tariff table without
  // amounts — Alinta's "03 Feb - 30 Jun  Peak - Step 1  48.862 c/kWh  All day"
  // would otherwise be read as 1 kWh of peak usage.
  const amount = applyCreditSign(toNumber(amounts[amounts.length - 1][0]), m[4]);

  return { label, kind, kwh: kwhValue, rateCents, amount, raw: line };
}

/** Shape B — bare quantity, then a $ rate, then a $ amount. */
function parseRowWithoutUnit(line) {
  const m = line.match(
    /^(.*?)\s([\d,]+(?:\.\d+)?)\s+(-?\$-?[\d,]+(?:\.\d+)?)\s+(-?\$?-?[\d,]+(?:\.\d+)?)\s*(?:cr)?\s*$/i
  );
  if (!m) return null;

  const label = m[1].trim();
  if (!label || /\bday/i.test(label)) return null;

  const kind = classifyRow(label);
  if (!kind) return null;

  const kwhValue = toNumber(m[2]);
  if (kwhValue == null) return null;

  return {
    label,
    kind,
    kwh: kwhValue,
    rateCents: rateToCents(toNumber(m[3]), m[3]),
    amount: applyCreditSign(toNumber(m[4]), line.slice(line.indexOf(m[4]))),
    raw: line,
  };
}

/** Read "$0.53 $885.07" or "39.259 c/kWh $236.77" from a row's tail. */
function readRateAndAmount(tail) {
  const rateMatch = tail.match(
    /(-?\$\s?-?[\d,]+(?:\.\d+)?|-?[\d,]+(?:\.\d+)?\s*[c¢]\s*\/\s*kwh)/i
  );
  const rateCents = rateMatch
    ? rateToCents(toNumber(rateMatch[1]), rateMatch[1])
    : null;

  // The amount is the last currency figure on the line.
  const amounts = allMatches(tail, /-?\$\s?-?[\d,]+(?:\.\d+)?/g);
  const amount =
    amounts.length > 1 ? applyCreditSign(toNumber(amounts[amounts.length - 1][0]), tail) : null;

  return { rateCents, amount };
}

/**
 * Australian bills mark credits with a trailing "cr" rather than a minus sign
 * — AGL prints a solar credit as "$31.00cr". Missing this flips the sign of
 * the feed-in tariff, turning a payment to the customer into a charge.
 */
function applyCreditSign(amount, context) {
  if (amount == null) return null;
  return /\bcr\b|\dcr\b/i.test(context) ? -Math.abs(amount) : amount;
}

/**
 * Consumption-weighted average rate across rows — the rate the customer
 * actually paid when a bill spans a price change or several tariff blocks.
 */
export function weightedRate(rows) {
  const usable = rows.filter(
    (r) => r.rateCents != null && r.kwh > 0 && Number.isFinite(r.rateCents)
  );
  if (usable.length === 0) return null;

  const totalKwh = usable.reduce((sum, r) => sum + r.kwh, 0);
  if (totalKwh <= 0) return null;

  const weighted = usable.reduce((sum, r) => sum + r.rateCents * r.kwh, 0);
  return weighted / totalKwh;
}

/* ------------------------------------------------------------------ *
 * Supply charge
 * ------------------------------------------------------------------ */

/**
 * Daily supply charge rows: "Supply charge Daily 31 days $1.1089",
 * "Daily Supply 14 73.709 c/Day", "Access Charge 31 Days 8.219200 $/Day",
 * "Standing Charge 7.73310 31.00 Day".
 * @returns {{days: number|null, cents: number}[]}
 */
/** Wording that can only be the fixed daily charge. */
const SUPPLY_LABEL =
  /\b(supply|service to property|daily charge|standing charge|access charge|service charge|daily supply|fixed supply|connection charge)\b/i;

/**
 * Wording that is a daily charge on some bills and a volumetric block header
 * on others — "Network charges" heads a whole section of c/kWh rows on the
 * commercial samples. Accepted only when the same line states an explicit
 * per-day rate, so a section header or a period total can never be read as
 * one.
 */
const SUPPLY_LABEL_LOOSE =
  /\b(network\s+(?:charge|access|tariff)|fixed\s+(?:daily\s+)?charge|availability\s+charge|service\s+availability|site\s+charge|customer\s+charge|meter(?:ing)?\s+service\s+charge)\b/i;

/** "1.1089 $/day", "73.709 c/Day", "$1.0875 /day", "108.75 cents per day" */
const PER_DAY_RATE =
  /(-?[\d,]+(?:\.\d+)?)\s*(?:[c¢]\s*\/\s*day|\$\s*\/\s*day|cents?\s*(?:\/|per)\s*day|\/\s*day\b|per\s+day\b)|\$\s?(-?[\d,]+(?:\.\d+)?)\s*\/?\s*(?:per\s+)?day\b/i;

export function scanSupplyRows(text) {
  const out = [];

  for (const raw of lines(text)) {
    const line = raw.trim();

    const named = SUPPLY_LABEL.test(line);
    const looselyNamed = !named && SUPPLY_LABEL_LOOSE.test(line);
    if (!named && !looselyNamed) continue;

    if (/\bkwh\b/i.test(line)) continue; // a usage row that mentions "service"

    const days = toNumber(
      firstMatch(line, [/([\d,]+(?:\.\d+)?)\s*days?\b/i]) ?? null
    );

    // Prefer an explicitly per-day rate, else the first money-looking figure.
    const explicit = line.match(PER_DAY_RATE);
    const dollarRate = line.match(/\$\s?([\d,]+(?:\.\d+)?)/);

    let centsValue = null;
    if (explicit) {
      centsValue = rateToCents(toNumber(explicit[1] ?? explicit[2]), explicit[0]);
    } else if (named && dollarRate) {
      // Only the unambiguous labels may fall back to a bare dollar figure.
      centsValue = rateToCents(toNumber(dollarRate[1]), '$');
    }

    if (isPlausibleSupplyCharge(centsValue)) {
      out.push({ days, cents: centsValue });
    }
  }

  return out;
}

/** Day-weighted daily supply charge in c/day. */
export function weightedSupplyCharge(rows) {
  if (rows.length === 0) return null;
  const withDays = rows.filter((r) => r.days > 0);
  if (withDays.length === 0) return rows[0].cents;

  const totalDays = withDays.reduce((s, r) => s + r.days, 0);
  const weighted = withDays.reduce((s, r) => s + r.cents * r.days, 0);
  return weighted / totalDays;
}

/* ------------------------------------------------------------------ *
 * Address and postcode
 * ------------------------------------------------------------------ */

const STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT';
const POSTCODE_RE = new RegExp(`\\b(${STATES})[,\\s]+(\\d{4})\\b`, 'gi');

/**
 * Find the supply address postcode.
 *
 * Bills carry two addresses — where the post goes and where the power goes.
 * The AGL sample is posted to Pine Point (5571) for a site in Somerton Park
 * (5044), 150 km away, so we look near a supply-address marker first.
 *
 * @returns {{postcode: string|null, address: string|null}}
 */
export function extractSupplyLocation(text) {
  const supplyMarkers =
    /(supply address|tax invoice for|site address|premises|service address|supply period for|bill for supply address|electricity bill for supply address)/i;

  const allLines = lines(text);

  for (let i = 0; i < allLines.length; i++) {
    if (!supplyMarkers.test(allLines[i])) continue;
    // The address may sit several lines below the marker — AGL puts help-line
    // text in between, with the street and suburb four lines down.
    const window = allLines.slice(i, i + 6).join(' ');
    const found = matchPostcode(window);
    if (found) {
      return {
        postcode: found.postcode,
        address: cleanAddress(window, supplyMarkers),
      };
    }
  }

  const fallback = matchPostcode(text);
  return {
    postcode: fallback ? fallback.postcode : null,
    address: null,
  };
}

function matchPostcode(chunk) {
  POSTCODE_RE.lastIndex = 0;
  const m = POSTCODE_RE.exec(chunk);
  return m ? { state: m[1].toUpperCase(), postcode: m[2] } : null;
}

function cleanAddress(chunk, marker) {
  const cleaned = chunk
    .replace(marker, ' ')
    .replace(/\b(national\s+meter(ing)?\s+identifier|nmi)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:,-]+/, '')
    .trim();

  // Trim anything after the postcode — usually the next column's text.
  const m = cleaned.match(new RegExp(`^(.*?\\b(?:${STATES})[,\\s]+\\d{4})`, 'i'));
  const address = (m ? m[1] : cleaned).trim();
  return address.length > 4 && address.length < 160 ? address : null;
}

/* ------------------------------------------------------------------ *
 * Misc field helpers
 * ------------------------------------------------------------------ */

/** Total payable — the largest "amount due"-style figure on the bill. */
export function extractTotalAmount(text) {
  const patterns = [
    // `[^$]` rather than `[^\n$]` — payment slips print the label and the
    // figure on separate lines.
    /(?:total\s+amount\s+(?:due|payable)|amount\s+due|total\s+due|current\s+charges\s*\(incl\.?\s*gst\)|total\s+charges|total\s+owed|direct\s+debit\s+amount)\b[^$]{0,45}\$\s?([\d,]+\.\d{2})/gi,
    /\btotal\s*\([^)]*gst[^)]*\)\s*\$\s?([\d,]+\.\d{2})/gi,
    // Further label variants. Deliberately excludes "closing balance" and
    // "account balance", which fold in arrears from earlier bills and so are
    // not this statement's amount.
    /(?:amount\s+payable|total\s+payable|balance\s+due|amount\s+to\s+pay|please\s+pay|pay\s+this\s+amount|total\s+this\s+bill|total\s+for\s+this\s+bill|total\s+amount\s+of\s+this\s+bill|total\s+new\s+charges|new\s+charges\s+total|total\s+current\s+charges)\b[^$]{0,45}\$\s?([\d,]+\.\d{2})/gi,
  ];

  const candidates = [];
  for (const p of patterns) {
    for (const m of allMatches(text, p)) {
      const value = toNumber(m[1]);
      if (value != null && value > 0) candidates.push(value);
    }
  }
  if (candidates.length === 0) return null;

  // Bills repeat the payable figure; the mode is safer than the max, which
  // can pick up a "total charges before credits" line.
  const counts = new Map();
  for (const v of candidates) counts.set(v, (counts.get(v) || 0) + 1);
  let best = candidates[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** "Average daily usage 63.84 kWh" / "Usage 52.73 kWh" / "Daily usage 8.18 kWh" */
export function extractDailyAverage(text) {
  const value = toNumber(
    firstMatch(text, [
      /average\s+daily\s+usage[^\n\d]{0,30}([\d,]+(?:\.\d+)?)\s*kwh/i,
      /daily\s+average(?:s)?[^\n\d]{0,40}([\d,]+(?:\.\d+)?)\s*kwh/i,
      /daily\s+averages?\s+for\s+this\s+account[^\n\d]{0,20}usage\s*([\d,]+(?:\.\d+)?)/i,
      /\bdaily\s+usage\b[^\n\d]{0,20}([\d,]+(?:\.\d+)?)\s*kwh/i,
      /avg\.?\s+daily\s+use[^\n\d]{0,20}([\d,]+(?:\.\d+)?)/i,
      /([\d,]+(?:\.\d+)?)\s*kwh[^\n]{0,20}average\s+daily/i,
    ])
  );
  if (value != null && value > 0 && value < 20000) return value;

  // AGL prints the heading and the figure several lines apart:
  //   "Average daily usage" / "For this bill" / "77.09 kWh"
  return extractDailyAverageNearby(text);
}

/** Look a few lines past an "average daily usage" heading for the figure. */
function extractDailyAverageNearby(text) {
  const allLines = lines(text);
  for (let i = 0; i < allLines.length; i++) {
    if (!/average\s+daily\s+usage|daily\s+average/i.test(allLines[i])) continue;

    for (let j = i; j < Math.min(i + 5, allLines.length); j++) {
      const m = allLines[j].match(/(?:^|\s)([\d,]+(?:\.\d+)?)\s*kwh\b/i);
      if (!m) continue;
      const value = toNumber(m[1]);
      if (value != null && value > 0 && value < 20000) return value;
    }
  }
  return null;
}

/**
 * Lines stating a *rate* of consumption or a comparison, not this period's
 * total. "Average daily usage 63.84 kWh" and "Same time last year 1,204 kWh"
 * are the two that actually bite — both would otherwise be read as the total.
 */
const NOT_A_PERIOD_TOTAL =
  /\b(average|avg|daily|per\s+day|each\s+day|last\s+year|previous\s+(?:year|bill|read|period)|same\s+time|projected|forecast|estimated\s+(?:next|annual)|per\s+year|annual(?:ly)?)\b/i;

/**
 * Explicit total-usage lines, ordered from the wording that can only mean the
 * period total down to looser phrasings.
 *
 * Retailers label the same figure at least a dozen ways — "Total usage",
 * "Energy used", "Units used", "kWh used", "You used ... kWh". Each candidate
 * is rejected if its own line also carries daily/average/comparison wording,
 * which is what keeps "Daily usage 8.18 kWh" out of the result.
 */
const TOTAL_KWH_PATTERNS = [
  /consumption\s+this\s+period:?\s*([\d,]+(?:\.\d+)?)\s*kwh/gi,
  /total\s+(?:electricity\s+|energy\s+)?(?:usage|consumption)[^\n\d]{0,30}([\d,]+(?:\.\d+)?)\s*kwh/gi,
  /total\s+(?:usage|consumption)\s*\(kwh\)[^\n\d]{0,20}([\d,]+(?:\.\d+)?)/gi,
  /energy\s+used[^\n\d]{0,20}([\d,]+(?:\.\d+)?)\s*kwh/gi,
  // Label variants beyond the originals.
  /total\s+kwh(?:\s+used)?[^\n\d]{0,20}([\d,]+(?:\.\d+)?)/gi,
  /(?:total\s+)?(?:electricity|energy|power)\s+used[^\n\d]{0,25}([\d,]+(?:\.\d+)?)\s*kwh/gi,
  /(?:total\s+)?units?\s+used[^\n\d]{0,20}([\d,]+(?:\.\d+)?)/gi,
  /\bkwh\s+used[^\n\d]{0,20}([\d,]+(?:\.\d+)?)/gi,
  /(?:usage|consumption)\s+(?:this|for\s+this)\s+(?:bill|period|month|quarter)[^\n\d]{0,20}([\d,]+(?:\.\d+)?)\s*kwh/gi,
  /you(?:\s+have|'ve)?\s+used[^\n\d]{0,30}([\d,]+(?:\.\d+)?)\s*kwh/gi,
  /([\d,]+(?:\.\d+)?)\s*kwh\s+(?:used|consumed)\b/gi,
];

export function extractExplicitTotalKwh(text) {
  for (const pattern of TOTAL_KWH_PATTERNS) {
    for (const m of allMatches(text, pattern)) {
      if (NOT_A_PERIOD_TOTAL.test(lineAt(text, m.index))) continue;
      const value = toNumber(m[1]);
      if (value != null && value > 0 && value < 10_000_000) return value;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Retailer name
 * ------------------------------------------------------------------ */

/** Words that are part of the boilerplate around a name, never the name. */
const NOT_A_BRAND =
  /\b(tax|invoice|statement|account|abn|acn|recipient|created|adjustment|note|customer|national|metering|identifier|payment|copyright|registered|office|trading|name|the)\b/i;

/**
 * Retailer name read off the letterhead or footer, for brands that have no
 * module of their own.
 *
 * Deliberately narrow: only a legal-entity or trading-name line whose brand
 * ends in an energy word is accepted ("Nectr Energy Pty Ltd", "Sumo Power Pty
 * Ltd", "Energy Locals Pty Ltd"). A bare capitalised word somewhere on the
 * page is not evidence of a retailer, and a confidently wrong name is worse
 * than none — anything else returns null and the field stays empty.
 *
 * @returns {string|null}
 */
export function extractRetailerName(text) {
  const ENERGY_WORD = '(?:Energy|Power|Electric|Electricity|Gas|Utilities)';
  const BRAND = `[A-Z][A-Za-z0-9'&.-]*(?:\\s+[A-Z][A-Za-z0-9'&.-]*){0,2}\\s+${ENERGY_WORD}|${ENERGY_WORD}\\s+[A-Z][A-Za-z0-9'&.-]*`;

  const patterns = [
    new RegExp(`\\btrading\\s+as\\s+(${BRAND})\\b`),
    new RegExp(`\\b(${BRAND})\\s+Pty\\.?\\s*(?:Ltd|Limited)\\b`),
    new RegExp(`\\b(${BRAND})\\s+(?:Ltd|Limited)\\b`),
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;

    const name = m[1].replace(/\s{2,}/g, ' ').trim();
    if (NOT_A_BRAND.test(name)) continue;
    if (name.length < 4 || name.length > 40) continue;
    return name;
  }
  return null;
}

/** Merge a base result with overrides, ignoring null/undefined overrides. */
export function mergeDefined(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}
