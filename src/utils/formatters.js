/** Australian number, currency and date formatting. */

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const AUD_WHOLE = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat('en-AU');

/** $1,234.56 */
export function currency(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return AUD.format(value);
}

/** $1,235 — for headline figures where cents are noise. */
export function currency0(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return AUD_WHOLE.format(value);
}

/** 1,234 */
export function number(value, decimals = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** 1,234 kWh */
export function kwh(value, decimals = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${number(value, decimals)} kWh`;
}

/** 8.2 kW */
export function kw(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${number(value, 1)} kW`;
}

/** 36.4c */
export function cents(value, decimals = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${number(value, decimals)}c`;
}

/** 35% */
export function percent(value, decimals = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${number(value, decimals)}%`;
}

/**
 * A daily charge in cents, expressed monthly — "$34/month".
 * People budget in months, and a monthly figure reads far less alarming than
 * the same charge quoted per year.
 */
export function centsPerDayAsMonthly(centsPerDay) {
  if (centsPerDay == null || Number.isNaN(centsPerDay)) return '—';
  return `${currency0((centsPerDay / 100) * (365 / 12))}/month`;
}

/** $1,200 – $1,600 */
export function currencyRange(low, high) {
  if (low == null || high == null) return '—';
  return `${currency0(low)} – ${currency0(high)}`;
}

/** 3.7 – 4.0 years — always shows the lower bound first. */
export function formatPaybackYears({ low, high } = {}) {
  if (low == null && high == null) return 'Not within 40 years';
  const values = [low, high].filter((v) => v != null);
  if (values.length === 1) return `${number(values[0], 1)} years`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(min - max) < 0.15) return `${number(min, 1)} years`;
  return `${number(min, 1)} – ${number(max, 1)} years`;
}

/** 15 Jan 2026 — accepts a Date or an ISO/parsable string. */
export function shortDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** Jan, Feb, … from a 'jan'-style key. */
export const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

export const MONTH_LABELS = {
  jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr',
  may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug',
  sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
};

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "north-facing" etc. — plain English for a compass code. */
const COMPASS_WORDS = {
  N: 'north', NNE: 'north-north-east', NE: 'north-east', ENE: 'east-north-east',
  E: 'east', ESE: 'east-south-east', SE: 'south-east', SSE: 'south-south-east',
  S: 'south', SSW: 'south-south-west', SW: 'south-west', WSW: 'west-south-west',
  W: 'west', WNW: 'west-north-west', NW: 'north-west', NNW: 'north-north-west',
  Flat: 'flat',
};

export function compassWord(code) {
  return COMPASS_WORDS[code] || String(code || '').toLowerCase();
}

/** Convert an azimuth in degrees (0 = north, clockwise) to a compass code. */
export function azimuthToCompass(degrees) {
  if (degrees == null || Number.isNaN(degrees)) return null;
  const points = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const normalised = ((degrees % 360) + 360) % 360;
  return points[Math.round(normalised / 22.5) % 16];
}
