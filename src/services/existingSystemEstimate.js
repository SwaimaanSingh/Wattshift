/**
 * Detecting and sizing a system already on site.
 *
 * A NEM12 file can span an install: a household might go from grid-only to
 * solar-and-battery partway through the year the data covers. Two problems
 * follow from that if it isn't handled explicitly.
 *
 * First, averaging the whole file's export against a modelled generation
 * curve makes a mid-file install look like a system a tenth its real size —
 * the zero-export months before installation drag the average down. Second,
 * the pre-install months are the best signal available for the household's
 * true underlying consumption, because there was (almost) no solar yet to
 * hide any of it behind self-consumption.
 *
 * Install detection: monthly B1 step-up — current month ≥ 3× the running
 * prior maximum and ≥ 200 kWh above it. That catches mid-file installs even
 * when pre-install months have small residual export (<115 kWh). A clean
 * zero-export lead-in still resolves to the first month above 50 kWh.
 */
import { sliceMeterData } from './nem12Parser.js';

/** Monthly export below this across a zero-export lead-in = no solar yet. */
export const MONTHLY_EXPORT_INSTALL_THRESHOLD_KWH = 50;

/** Step-up: current month must clear this multiple of every prior month's max. */
export const MONTHLY_EXPORT_STEP_RATIO = 3;

/** Step-up: current month must also clear this absolute gap over the prior max. */
export const MONTHLY_EXPORT_STEP_MIN_KWH = 200;

/** Below this, a file simply doesn't have enough measured days either side
 * of a candidate change to tell a real install from noise. */
const MIN_SERIES_DAYS = 14 * 2 + 14;
/** Days averaged on each side of a candidate change date. */
const WINDOW_DAYS = 21;
/**
 * Daily export below this on the "before" side of a rolling window still
 * counts as a quiet / pre-install baseline. Real residual export before a
 * large array often sits around 1–4 kWh/day, so this is looser than zero.
 */
const LOW_BASELINE_KWH = 6;
/** The jump has to look like a system switching on, not a sunnier fortnight. */
const MIN_AFTER_KWH = 8;
const MIN_JUMP_KWH = 8;
const MIN_JUMP_RATIO = 3;

/**
 * Sum measured B1 export by calendar month (YYYY-MM).
 *
 * @param {object} exportChannel meterData.channels.B1
 * @returns {Map<string, number>} month key → kWh exported
 */
export function monthlyExportTotals(exportChannel) {
  const byMonth = new Map();
  if (!exportChannel?.data) return byMonth;

  for (const day of exportChannel.data) {
    if (day.estimated) continue;
    const monthKey = day.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + day.total);
  }

  return byMonth;
}

/**
 * Scan the export channel for a sustained step change from near-zero to
 * substantial daily export — the signature of a solar or battery install
 * partway through the file.
 *
 * Primary method: monthly B1 step-up (see {@link findInstallMonth}).
 * Fallback: rolling before/after daily comparison when the monthly pattern
 * does not show a clear pre/post split (e.g. solar present from day one).
 *
 * @param {object} meterData parsed NEM12 (channels.E1 and channels.B1)
 * @returns {{
 *   detected: boolean,
 *   changeDate: string,
 *   installMonth: string,
 *   preAvgExportKwh: number,
 *   postAvgExportKwh: number,
 *   preAvgImportKwh: number,
 *   postAvgImportKwh: number,
 *   preDays: number,
 *   postDays: number,
 *   monthsSinceInstall: number,
 *   method: 'monthly'|'rolling',
 * }|null} null if there's no export channel, not enough data, or no
 *   change that looks like a real install
 */
export function detectSetupChange(meterData) {
  const exportChannel = meterData?.channels?.B1;
  const importChannel = meterData?.channels?.E1;
  if (!exportChannel || !importChannel) return null;

  const monthly = detectSetupChangeFromMonthlyExport(exportChannel, importChannel, meterData);
  if (monthly) return monthly;

  return detectSetupChangeRolling(exportChannel, importChannel);
}

/**
 * Resolve the install month from B1 totals, then summarise pre/post averages.
 */
function detectSetupChangeFromMonthlyExport(exportChannel, importChannel, meterData) {
  const totals = monthlyExportTotals(exportChannel);
  const installMonth = findInstallMonth(totals);
  if (!installMonth) return null;

  const changeDate = `${installMonth}-01`;

  const preExport = averageDailyTotal(exportChannel.data, (d) => d.date < changeDate);
  const postExport = averageDailyTotal(exportChannel.data, (d) => d.date >= changeDate);
  const preImport = averageDailyTotal(importChannel.data, (d) => d.date < changeDate);
  const postImport = averageDailyTotal(importChannel.data, (d) => d.date >= changeDate);

  if (postExport.days < 14) return null;

  const { end } = meterData.summary.dateRange;
  const monthsSinceInstall = monthsBetween(changeDate, end);

  return {
    detected: true,
    changeDate,
    installMonth,
    preAvgExportKwh: round2(preExport.avg),
    postAvgExportKwh: round2(postExport.avg),
    preAvgImportKwh: round2(preImport.avg),
    postAvgImportKwh: round2(postImport.avg),
    preDays: preImport.days,
    postDays: postImport.days,
    monthsSinceInstall,
    method: 'monthly',
  };
}

/**
 * Find the install month from monthly B1 totals.
 *
 * Step-up rule (primary): current month ≥ 3× the running prior maximum AND
 * ≥ 200 kWh above it. Handles residual pre-install export.
 *
 * Zero-export lead-in: when every prior month summed to ~0, the first month
 * above {@link MONTHLY_EXPORT_INSTALL_THRESHOLD_KWH} is the install month.
 *
 * @param {Map<string, number>} monthlyB1Totals month key → kWh
 * @returns {string|null} YYYY-MM install month
 */
export function findInstallMonth(monthlyB1Totals) {
  const months = Array.from(monthlyB1Totals.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  if (months.length < 2) return null;

  let priorMax = 0;

  for (let i = 0; i < months.length; i++) {
    const [month, total] = months[i];

    // Step-up over residual pre-install export (e.g. <115 kWh → 471 kWh).
    if (priorMax > 0 && total >= priorMax * MONTHLY_EXPORT_STEP_RATIO && total - priorMax >= MONTHLY_EXPORT_STEP_MIN_KWH) {
      return month;
    }

    // Clean zero-export lead-in: first month that clearly turns on.
    if (priorMax === 0 && i > 0 && total > MONTHLY_EXPORT_INSTALL_THRESHOLD_KWH) {
      return month;
    }

    priorMax = Math.max(priorMax, total);
  }

  return null;
}

/** Rolling-window step detection — used when monthly totals are inconclusive. */
function detectSetupChangeRolling(exportChannel, importChannel) {
  const series = exportChannel.data.filter((d) => !d.estimated);
  if (series.length < MIN_SERIES_DAYS) return null;

  let best = null;
  for (let i = WINDOW_DAYS; i < series.length - WINDOW_DAYS; i++) {
    const before = meanTotal(series, i - WINDOW_DAYS, i);
    const after = meanTotal(series, i, i + WINDOW_DAYS);
    const jump = after - before;
    if (!best || jump > best.jump) {
      best = { date: series[i].date, before, after, jump };
    }
  }

  if (!best) return null;

  const looksLikeAnInstall =
    best.before < LOW_BASELINE_KWH &&
    best.after > MIN_AFTER_KWH &&
    best.jump > MIN_JUMP_KWH &&
    best.after >= best.before * MIN_JUMP_RATIO;
  if (!looksLikeAnInstall) return null;

  // Snap to the 1st of the install month so analysis matches the monthly path.
  const installMonth = best.date.slice(0, 7);
  const changeDate = `${installMonth}-01`;

  const pre = averageDailyTotal(importChannel.data, (d) => d.date < changeDate);
  const post = averageDailyTotal(importChannel.data, (d) => d.date >= changeDate);

  return {
    detected: true,
    changeDate,
    installMonth,
    preAvgExportKwh: round2(best.before),
    postAvgExportKwh: round2(best.after),
    preAvgImportKwh: round2(pre.avg),
    postAvgImportKwh: round2(post.avg),
    preDays: pre.days,
    postDays: post.days,
    monthsSinceInstall: monthsBetween(changeDate, importChannel.data.at(-1)?.date ?? changeDate),
    method: 'rolling',
  };
}

/**
 * Split parsed meter data into the periods either side of a detected setup
 * change, ready for separate analysis.
 *
 * @param {object} meterData
 * @param {{changeDate: string}} setupChange from detectSetupChange()
 * @returns {{pre: object|null, post: object|null}}
 */
export function splitAtChange(meterData, setupChange) {
  if (!setupChange?.changeDate) return { pre: null, post: null };
  const { start, end } = meterData.summary.dateRange;
  const dayBefore = addDays(setupChange.changeDate, -1);

  return {
    pre: sliceMeterData(meterData, { start, end: dayBefore }),
    post: sliceMeterData(meterData, { start: setupChange.changeDate, end }),
  };
}

/**
 * Minimum plausible system size from the largest single export reading.
 *
 * A system cannot export more than it can generate in that instant, so the
 * peak raw reading — before it is folded into a half-hourly average —
 * converts directly to a lower bound on inverter/array capacity:
 *
 *   kW = kWh in that interval x (60 / interval length in minutes)
 *
 * It's a lower bound on the *array*, not a measurement of it, because a
 * battery or the house's own daytime load can absorb genuine surplus before
 * it ever reaches the meter, and an undersized inverter or export limiting
 * can cap the reading from the other side. Both push the estimate down, so
 * the true system is usually this size or larger, rarely smaller.
 *
 * @param {object} exportChannel meterData.channels.B1 (or a slice of it)
 * @returns {{kw: number, atDate: string|null}|null}
 */
export function estimateSolarFromPeakExport(exportChannel) {
  if (!exportChannel?.peakRawKw) return null;
  return {
    kw: exportChannel.peakRawKw,
    atDate: exportChannel.peakRawAt ?? null,
  };
}

/** "November 2025" from an ISO date. */
export function monthYearLabel(iso) {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/* ------------------------------------------------------------------ *
 * Battery likelihood (E1/B1 signatures — no battery channel in NEM12)
 * ------------------------------------------------------------------ */

/** Half-hour slots for 18:00–23:00 (exclusive end): evening grid draw. */
const EVENING_SLOT_START = 36; // 18:00
const EVENING_SLOT_END = 46; // 23:00 exclusive

/**
 * Post-install evening import as a fraction of pre-install evening import.
 * Below this → battery is likely covering evening load from daytime solar.
 *
 * 0.45 (not 0.30): a large battery on a high-consumption home typically cuts
 * evening imports substantially without wiping them out — e.g. the reference
 * file's 0.37 ratio (63% reduction) is clear battery behaviour.
 */
export const BATTERY_EVENING_IMPORT_RATIO = 0.45;

/** Measured days required either side of an install for the evening signal. */
const BATTERY_DETECT_MIN_DAYS = 14;

const NOTE_EVENING_DROP =
  'We detected a possible battery — your evening grid imports dropped significantly after install. Enter your battery size below. You can find it on your inverter app, installer paperwork, or battery label.';

/**
 * Infer whether a battery is already on site from E1 shapes.
 *
 * Sole signal: evening import drop — post-install 6pm–11pm average E1
 * below {@link BATTERY_EVENING_IMPORT_RATIO} of pre-install (needs a
 * detected setup change with enough days either side).
 *
 * Midday export flatness is NOT used — that tracks export limiting, not
 * battery presence. A battery without an export limit still shows a normal
 * solar bell curve on B1.
 *
 * @param {object} meterData full parsed NEM12
 * @param {object|null} [setupChange] from {@link detectSetupChange}
 * @returns {{
 *   likely: boolean,
 *   reasons: ('evening_import_drop')[],
 *   eveningRatio: number|null,
 *   note: string|null,
 * }}
 */
export function detectLikelyBattery(meterData, setupChange = null) {
  const importChannel = meterData?.channels?.E1;
  const reasons = [];
  let eveningRatio = null;
  let preEveningAvg = null;
  let postEveningAvg = null;
  let preEveningDays = null;
  let postEveningDays = null;

  console.log('[detectLikelyBattery] setupChange', {
    detected: Boolean(setupChange?.detected),
    changeDate: setupChange?.changeDate ?? null,
    method: setupChange?.method ?? null,
    preDays: setupChange?.preDays ?? null,
    postDays: setupChange?.postDays ?? null,
  });

  if (setupChange?.detected && importChannel) {
    const changeDate = setupChange.changeDate;
    const preEvening = averageWindowDailyKwh(
      importChannel.data,
      (d) => d.date < changeDate,
      EVENING_SLOT_START,
      EVENING_SLOT_END
    );
    const postEvening = averageWindowDailyKwh(
      importChannel.data,
      (d) => d.date >= changeDate,
      EVENING_SLOT_START,
      EVENING_SLOT_END
    );
    preEveningAvg = round2(preEvening.avg);
    postEveningAvg = round2(postEvening.avg);
    preEveningDays = preEvening.days;
    postEveningDays = postEvening.days;

    if (
      preEvening.days >= BATTERY_DETECT_MIN_DAYS &&
      postEvening.days >= BATTERY_DETECT_MIN_DAYS &&
      preEvening.avg > 0
    ) {
      eveningRatio = round2(postEvening.avg / preEvening.avg);
      if (eveningRatio < BATTERY_EVENING_IMPORT_RATIO) {
        reasons.push('evening_import_drop');
      }
    }
  }

  const likely = reasons.length > 0;
  const note = likely ? NOTE_EVENING_DROP : null;

  console.log('[detectLikelyBattery] metrics', {
    preEveningAvgKwh: preEveningAvg,
    postEveningAvgKwh: postEveningAvg,
    preEveningDays,
    postEveningDays,
    eveningRatio,
    eveningThreshold: BATTERY_EVENING_IMPORT_RATIO,
    likely,
    reasons,
  });

  return { likely, reasons, eveningRatio, note };
}

/**
 * Mean daily kWh summed over half-hour slots [slotStart, slotEnd) for days
 * matching predicate.
 */
function averageWindowDailyKwh(days, predicate, slotStart, slotEnd) {
  let sum = 0;
  let count = 0;
  for (const day of days) {
    if (day.estimated || !predicate(day) || !day.intervals) continue;
    let dayTotal = 0;
    for (let i = slotStart; i < slotEnd; i++) dayTotal += day.intervals[i] ?? 0;
    sum += dayTotal;
    count++;
  }
  return { avg: count ? sum / count : 0, days: count };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function meanTotal(series, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += series[i].total;
  return sum / (to - from);
}

function averageDailyTotal(days, predicate) {
  const matched = days.filter((d) => !d.estimated && predicate(d));
  const total = matched.reduce((sum, d) => sum + d.total, 0);
  return { avg: matched.length ? total / matched.length : 0, days: matched.length };
}

function monthsBetween(isoStart, isoEnd) {
  const start = new Date(`${isoStart}T00:00:00Z`);
  const end = new Date(`${isoEnd}T00:00:00Z`);
  return Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1
  );
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round2 = (v) => Math.round(v * 100) / 100;
