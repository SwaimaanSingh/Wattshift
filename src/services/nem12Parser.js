/**
 * NEM12 interval meter data parser.
 *
 * NEM12 is the AEMO standard format every Australian distributor exports from
 * its customer portal. It is a flat CSV of typed records:
 *
 *   100  header      — format version and creation timestamp
 *   200  NMI details — which meter channel the following 300s belong to
 *   300  interval    — one day of readings for that channel
 *   400  quality     — substitution details for a run of intervals in the
 *                      preceding 300 record
 *   500  B2B details — ignored; irrelevant to consumption analysis
 *   900  end of data
 *
 * Everything happens in the browser. Meter data is far more revealing than a
 * bill — it shows when a house is empty — so it never leaves the device.
 *
 * Times are treated as AEST (UTC+10) year round, with no daylight-saving
 * shift, which is how AEMO defines the interval clock.
 */

/** Channel suffixes we understand. Anything else is kept but not modelled. */
export const CHANNEL_ROLES = {
  E1: 'Grid import',
  E2: 'Controlled load',
  B1: 'Solar export',
  Q1: 'Reactive power',
};

/** Quality flags AEMO can put on an interval. */
const QUALITY_MEANING = {
  A: 'actual',
  E: 'forward estimate',
  F: 'final substitute',
  N: 'null',
  S: 'substitute',
  V: 'variable',
};

/** A parse failure the customer can act on. */
export class Nem12Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Nem12Error';
    this.code = code;
  }
}

const NOT_NEM12 =
  "This doesn't look like a NEM12 meter data file. Make sure you download " +
  "the 'Detailed' or 'NEM12' format from your distributor's portal.";

/** Below this we can still model, but the result is not worth much. */
export const MIN_USEFUL_DAYS = 30;
/** Below this a year's seasonality is guesswork. */
export const RECOMMENDED_DAYS = 90;

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

/**
 * Parse a file the customer dropped on the page.
 *
 * Accepts a raw NEM12 CSV or a ZIP containing one — distributor portals hand
 * out both, and asking people to unzip first loses a good share of them.
 *
 * @param {File|Blob} file
 * @param {(stage: string, pct: number|null) => void} [onProgress]
 * @returns {Promise<object>} parser output — see parseNem12Text
 */
export async function parseNem12File(file, onProgress = () => {}) {
  const name = file?.name || '';
  onProgress('Reading your meter data…', 0.05);

  let text;
  if (/\.zip$/i.test(name) || file?.type === 'application/zip') {
    onProgress('Unzipping…', 0.15);
    text = await readZip(file);
  } else {
    text = await file.text();
  }

  onProgress('Reading intervals…', 0.4);
  const result = parseNem12Text(text, (pct) =>
    onProgress('Reading intervals…', 0.4 + pct * 0.5)
  );

  onProgress('Done', 1);
  return result;
}

/**
 * Pull the NEM12 CSV out of a ZIP archive.
 *
 * Portals sometimes bundle a PDF summary or a readme alongside the data, so
 * the largest CSV-looking member that actually starts with a 100 record wins.
 */
async function readZip(file) {
  const { default: JSZip } = await import('jszip');

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Nem12Error('bad_zip', "This ZIP file couldn't be opened. Try downloading it again.");
  }

  const members = Object.values(zip.files).filter((f) => !f.dir);
  const candidates = members
    .filter((f) => /\.(csv|txt|dat)$/i.test(f.name) || !/\.\w+$/.test(f.name))
    .sort((a, b) => (b._data?.uncompressedSize ?? 0) - (a._data?.uncompressedSize ?? 0));

  if (candidates.length === 0) {
    throw new Nem12Error(
      'no_csv_in_zip',
      "This ZIP doesn't contain a meter data file. Look for a CSV download in your distributor's portal."
    );
  }

  for (const member of candidates) {
    const text = await member.async('string');
    if (/^\s*100\s*,/.test(text) || /^\s*200\s*,/.test(text)) return text;
  }

  // Nothing had a header — hand back the biggest and let the validator explain.
  return candidates[0].async('string');
}

/**
 * Parse NEM12 text.
 *
 * @param {string} text
 * @param {(pct: number) => void} [onProgress]
 * @returns {{
 *   header: {version: string, creationDate: Date|null, fromParticipant: string|null, toParticipant: string|null},
 *   nmi: string,
 *   availableNmis: string[],
 *   channels: Object,
 *   summary: Object,
 *   warnings: string[],
 * }}
 */
export function parseNem12Text(text, onProgress = () => {}) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Nem12Error('empty', 'That file was empty.');
  }

  const lines = text.split(/\r\n|\r|\n/);
  const header = readHeader(lines);

  /** @type {Map<string, Map<string, object>>} nmi -> suffix -> channel */
  const byNmi = new Map();
  const warnings = [];
  if (header.headerMissing) {
    warnings.push(
      "This file had no format header — common with SA Power Networks' Detailed export. We've read it as NEM12 interval data."
    );
  }
  const anomalies = { negatives: 0, badRows: 0, oversized: 0 };

  let context = null; // the 200 record currently in force
  let lastDay = null; // the 300 record a 400 record would modify
  let sawEnd = false;

  for (let i = 0; i < lines.length; i++) {
    if (i % 2000 === 0) onProgress(i / lines.length);

    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    const fields = splitCsv(raw);
    switch (fields[0]?.trim()) {
      case '200': {
        context = readNmiRecord(fields);
        lastDay = null;
        if (!context) {
          anomalies.badRows++;
          break;
        }
        const channels = mapFor(byNmi, context.nmi);
        if (!channels.has(context.suffix)) {
          channels.set(context.suffix, {
            suffix: context.suffix,
            role: CHANNEL_ROLES[context.suffix] ?? null,
            unit: 'kWh',
            sourceUnit: context.uom,
            intervalMinutes: context.intervalMinutes,
            meterSerial: context.meterSerial || null,
            data: [],
            byDate: new Map(),
          });
        }
        break;
      }

      case '300': {
        if (!context) {
          anomalies.badRows++;
          break;
        }
        const channel = mapFor(byNmi, context.nmi).get(context.suffix);
        const day = readIntervalRecord(fields, context, anomalies);
        if (!day) {
          anomalies.badRows++;
          break;
        }
        // A repeated date is a revision; the later record wins.
        const existing = channel.byDate.get(day.date);
        if (existing) Object.assign(existing, day);
        else {
          channel.byDate.set(day.date, day);
          channel.data.push(day);
        }
        lastDay = channel.byDate.get(day.date);
        break;
      }

      case '400':
        if (lastDay) applyQualityEvent(fields, lastDay, context);
        break;

      case '900':
        sawEnd = true;
        break;

      default:
        break; // 100, 500 and anything unknown
    }
  }

  if (byNmi.size === 0) {
    throw new Nem12Error('no_data', NOT_NEM12);
  }
  if (!sawEnd) {
    warnings.push("The file has no end-of-data marker, so it may have been cut short. We've used everything we could read.");
  }

  onProgress(0.95);

  const availableNmis = [...byNmi.keys()];
  const nmi = availableNmis[0];
  if (availableNmis.length > 1) {
    warnings.push(
      `This file covers ${availableNmis.length} meters. We've analysed the first (${maskNmi(nmi)}).`
    );
  }

  const channels = finaliseChannels(byNmi.get(nmi), warnings, anomalies);
  const summary = summarise(channels);

  if (summary.totalDays < MIN_USEFUL_DAYS) {
    throw new Nem12Error(
      'too_few_days',
      `This file only has ${summary.totalDays} ${summary.totalDays === 1 ? 'day' : 'days'} of data. ` +
        'We recommend at least 3 months for a reliable analysis.'
    );
  }
  if (summary.totalDays < RECOMMENDED_DAYS) {
    warnings.push(
      `This file covers ${summary.totalDays} days. Three months or more would make the seasonal picture more reliable.`
    );
  }
  if (anomalies.badRows > 0) {
    warnings.push(
      `${anomalies.badRows} row${anomalies.badRows === 1 ? '' : 's'} couldn't be read and ${anomalies.badRows === 1 ? 'was' : 'were'} skipped.`
    );
  }
  if (anomalies.negatives > 0) {
    warnings.push(
      `${anomalies.negatives} negative reading${anomalies.negatives === 1 ? '' : 's'} were treated as zero.`
    );
  }

  onProgress(1);

  return { header, nmi, availableNmis, channels, summary, warnings };
}

/* ------------------------------------------------------------------ *
 * Record readers
 * ------------------------------------------------------------------ */

function readHeader(lines) {
  const line = lines.find((l) => /^\s*100\s*,/.test(l));
  if (line) {
    const fields = splitCsv(line);
    const version = (fields[1] || '').trim().toUpperCase();
    if (version !== 'NEM12') {
      throw new Nem12Error(
        'wrong_format',
        version === 'NEM13'
          ? 'This is a NEM13 file, which only holds meter totals — not the half-hourly detail we need. Ask your distributor for the NEM12 or "Detailed" format.'
          : NOT_NEM12
      );
    }

    return {
      version,
      creationDate: parseTimestamp(fields[2]),
      fromParticipant: fields[3]?.trim() || null,
      toParticipant: fields[4]?.trim() || null,
      headerMissing: false,
    };
  }

  // SA Power Networks' "Detailed" export is valid NEM12 interval data but
  // omits the 100 header row — the file opens straight onto 200 records.
  const firstInterval = lines.find((l) => /^\s*200\s*,/.test(l));
  if (!firstInterval || !readNmiRecord(splitCsv(firstInterval))) {
    throw new Nem12Error('not_nem12', NOT_NEM12);
  }

  return {
    version: 'NEM12',
    creationDate: null,
    fromParticipant: null,
    toParticipant: null,
    headerMissing: true,
  };
}

/** A 200 record: which meter channel the following 300 records describe. */
function readNmiRecord(fields) {
  const nmi = (fields[1] || '').trim().toUpperCase();
  if (!nmi) return null;

  // Suffix is field 4, but some exports leave it blank and put the whole
  // configuration in field 2 ("E1B1"). Fall back to the first channel there.
  const suffix =
    (fields[4] || '').trim().toUpperCase() ||
    (fields[2] || '').trim().toUpperCase().match(/[EBKQ]\d/)?.[0] ||
    'E1';

  const intervalMinutes = Number(fields[8]);
  return {
    nmi,
    suffix,
    uom: (fields[7] || 'KWH').trim().toUpperCase(),
    meterSerial: (fields[6] || '').trim(),
    intervalMinutes:
      Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30,
  };
}

/**
 * A 300 record: one day of readings.
 *
 * The value count is fixed by the interval length, so the quality fields sit
 * at a known offset — trailing fields can't be found by scanning from the end
 * because ReasonDescription is optional and frequently blank.
 */
function readIntervalRecord(fields, context, anomalies) {
  const date = parseDate(fields[1]);
  if (!date) return null;

  const expected = Math.round(1440 / context.intervalMinutes);
  if (!Number.isFinite(expected) || expected < 1 || expected > 288) return null;

  const scale = unitScale(context.uom);
  const values = new Array(expected);
  let usable = 0;

  for (let i = 0; i < expected; i++) {
    const raw = fields[2 + i];
    const value = Number(raw);

    if (raw === undefined || raw === '' || !Number.isFinite(value)) {
      values[i] = 0;
      continue;
    }
    usable++;

    if (value < 0) {
      // Import and export are separate channels in NEM12, so a negative here
      // is a data fault rather than a flow reversal.
      anomalies.negatives++;
      values[i] = 0;
      continue;
    }
    values[i] = value * scale;
  }

  if (usable === 0) return null;

  const quality = (fields[2 + expected] || 'A').trim().toUpperCase();
  const intervals = toHalfHourly(values, context.intervalMinutes);

  // A house does not use 25 kWh in half an hour. Values this large are almost
  // always a unit mix-up, and one bad day would distort the whole year.
  const total = intervals.reduce((a, b) => a + b, 0);
  const suspect = total > 2000;
  if (suspect) anomalies.oversized++;

  // The single largest raw reading, before it gets folded into a half-hourly
  // average. Sizing an existing system from its peak export needs this —
  // folding a 5-minute inverter spike into a 30-minute bucket dilutes it by
  // up to 6x, which is the difference between correctly reading a 12 kW
  // system and reporting one a tenth that size.
  let peakRaw = 0;
  for (const v of values) if (v > peakRaw) peakRaw = v;

  return {
    date,
    intervals,
    quality: quality[0] || 'A',
    qualityMethod: quality,
    substituted: quality[0] === 'S' || quality[0] === 'F' || quality[0] === 'E',
    estimated: false,
    total: round3(total),
    suspect,
    peakRawKwh: round3(peakRaw),
  };
}

/**
 * A 400 record refines the quality of a run of intervals inside the preceding
 * 300 record. We keep the worst flag seen for the day plus the affected count,
 * which is all the UI needs to say "some of this day was estimated".
 */
function applyQualityEvent(fields, day, context) {
  const start = Number(fields[1]);
  const end = Number(fields[2]);
  const method = (fields[3] || '').trim().toUpperCase();
  if (!method) return;

  const flag = method[0];
  if (flag === 'A') return;

  const perDay = Math.round(1440 / (context?.intervalMinutes || 30));
  const count =
    Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start + 1) : perDay;

  day.substituted = true;
  day.substitutedIntervals = (day.substitutedIntervals || 0) + count;
  // Report the day by its most doubtful flag.
  if (day.quality === 'A' || flag === 'N') day.quality = flag;
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/**
 * Fold any supported interval length onto the 48 half-hour slots the rest of
 * the app models in. Shorter intervals sum; a longer one is spread evenly,
 * which loses no energy and is the only defensible split without more detail.
 */
export function toHalfHourly(values, intervalMinutes) {
  if (intervalMinutes === 30) return values.map(round3);

  if (intervalMinutes < 30) {
    const perSlot = Math.round(30 / intervalMinutes);
    const out = new Array(48).fill(0);
    for (let i = 0; i < values.length; i++) {
      const slot = Math.floor(i / perSlot);
      if (slot < 48) out[slot] += values[i];
    }
    return out.map(round3);
  }

  const slotsPerReading = Math.round(intervalMinutes / 30);
  const out = new Array(48).fill(0);
  for (let i = 0; i < values.length; i++) {
    const share = values[i] / slotsPerReading;
    for (let s = 0; s < slotsPerReading; s++) {
      const slot = i * slotsPerReading + s;
      if (slot < 48) out[slot] += share;
    }
  }
  return out.map(round3);
}

/** kWh multiplier for a NEM12 unit of measure. */
function unitScale(uom) {
  switch (uom) {
    case 'MWH':
      return 1000;
    case 'WH':
      return 0.001;
    case 'KVARH':
    case 'KVAH':
    case 'KWH':
    default:
      return 1;
  }
}

/**
 * Sort each channel by date, drop days that failed the sanity check, and fill
 * gaps so the interval engine can walk a continuous calendar.
 *
 * A missing day is filled from the nearest days sharing its weekday — a
 * Tuesday looks far more like other Tuesdays than like the Sunday next to it.
 * Filled days are flagged so nothing downstream reports them as measured.
 */
function finaliseChannels(channelMap, warnings, anomalies) {
  const channels = {};

  for (const [suffix, channel] of channelMap) {
    channel.data.sort((a, b) => (a.date < b.date ? -1 : 1));

    const clean = channel.data.filter((d) => !d.suspect);
    const dropped = channel.data.length - clean.length;

    if (clean.length === 0) {
      warnings.push(`Channel ${suffix} held no readable days and was ignored.`);
      continue;
    }

    const filled = fillGaps(clean);
    const gapCount = filled.length - clean.length;

    if (dropped > 0 && suffix === 'E1') {
      warnings.push(
        `Some of your meter data couldn't be read. We've used ${clean.length} of ${clean.length + dropped} days available.`
      );
    }
    if (gapCount > 0 && suffix === 'E1') {
      warnings.push(
        `${gapCount} missing ${gapCount === 1 ? 'day was' : 'days were'} estimated from the same weekday nearby.`
      );
    }

    // The peak raw reading and the day it fell on — see readIntervalRecord.
    // Only measured days count; a gap-filled day just echoes a neighbour and
    // would never legitimately set the peak.
    let peakRawKwh = 0;
    let peakRawAt = null;
    for (const d of clean) {
      if ((d.peakRawKwh ?? 0) > peakRawKwh) {
        peakRawKwh = d.peakRawKwh;
        peakRawAt = d.date;
      }
    }

    channels[suffix] = {
      suffix,
      role: channel.role,
      unit: 'kWh',
      sourceUnit: channel.sourceUnit,
      intervalMinutes: channel.intervalMinutes,
      meterSerial: channel.meterSerial,
      data: filled,
      // Provenance the UI can quote without recounting.
      measuredDays: clean.length,
      estimatedDays: gapCount,
      droppedDays: dropped,
      substitutedDays: clean.filter((d) => d.substituted).length,
      peakRawKwh: round3(peakRawKwh),
      peakRawKw: round1(peakRawKwh * (60 / channel.intervalMinutes)),
      peakRawAt,
    };
  }

  if (!channels.E1) {
    throw new Nem12Error(
      'no_consumption',
      "We couldn't find a consumption channel (E1) in this file. Download the 'Detailed' report, which includes your usage as well as any solar export."
    );
  }

  anomalies.channels = Object.keys(channels).length;
  return channels;
}

/** Insert estimated days for any date missing from a sorted day list. */
function fillGaps(days) {
  const out = [];
  const byDate = new Map(days.map((d) => [d.date, d]));

  const cursor = new Date(`${days[0].date}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1].date}T00:00:00Z`);

  // A guard rather than a limit: 3 years of half-hourly data is already more
  // than any portal exports, and a corrupt end date must not hang the tab.
  for (let guard = 0; cursor <= last && guard < 1200; guard++) {
    const key = cursor.toISOString().slice(0, 10);
    const existing = byDate.get(key);

    if (existing) {
      out.push(existing);
    } else {
      const donors = nearestSameWeekday(days, cursor);
      out.push({
        date: key,
        intervals: donors ? averageIntervals(donors) : new Array(48).fill(0),
        quality: 'N',
        qualityMethod: 'N',
        substituted: false,
        estimated: true,
        total: donors ? round3(averageIntervals(donors).reduce((a, b) => a + b, 0)) : 0,
        suspect: false,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}

/** The two closest measured days that fall on the same weekday. */
function nearestSameWeekday(days, target) {
  const weekday = target.getUTCDay();
  const scored = days
    .filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === weekday && !d.estimated)
    .map((d) => ({
      day: d,
      distance: Math.abs(new Date(`${d.date}T00:00:00Z`) - target),
    }))
    .sort((a, b) => a.distance - b.distance);

  if (scored.length === 0) return days.length > 0 ? days.slice(0, 2) : null;
  return scored.slice(0, 2).map((s) => s.day);
}

function averageIntervals(days) {
  const out = new Array(48).fill(0);
  for (const day of days) {
    for (let i = 0; i < 48; i++) out[i] += day.intervals[i] ?? 0;
  }
  return out.map((v) => round3(v / days.length));
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

function summarise(channels) {
  const importCh = channels.E1;
  const exportCh = channels.B1;
  const controlled = channels.E2;

  const days = importCh.data;
  const totalDays = days.length;

  const sumOf = (ch) =>
    ch ? ch.data.reduce((sum, d) => sum + d.intervals.reduce((a, b) => a + b, 0), 0) : 0;

  const totalImportKwh = sumOf(importCh);
  const totalExportKwh = sumOf(exportCh);
  const totalControlledKwh = sumOf(controlled);

  // Peak demand: the largest half-hour, doubled to express it as kW.
  let peakDemandKw = 0;
  let peakAt = null;
  for (const day of days) {
    for (let i = 0; i < 48; i++) {
      const kw = (day.intervals[i] ?? 0) * 2;
      if (kw > peakDemandKw) {
        peakDemandKw = kw;
        peakAt = { date: day.date, interval: i };
      }
    }
  }

  return {
    dateRange: { start: days[0].date, end: days[totalDays - 1].date },
    totalDays,
    measuredDays: importCh.measuredDays,
    estimatedDays: importCh.estimatedDays,
    substitutedDays: importCh.substitutedDays,
    totalImportKwh: round1(totalImportKwh),
    totalExportKwh: round1(totalExportKwh),
    totalControlledKwh: round1(totalControlledKwh),
    avgDailyImportKwh: round2(totalImportKwh / totalDays),
    avgDailyExportKwh: round2(totalExportKwh / totalDays),
    avgDailyControlledKwh: round2(totalControlledKwh / totalDays),
    peakDemandKw: round1(peakDemandKw),
    peakDemandAt: peakAt ? { date: peakAt.date, time: intervalLabel(peakAt.interval) } : null,
    hasSolar: Boolean(exportCh) && totalExportKwh > 0,
    hasControlledLoad: Boolean(controlled) && totalControlledKwh > 0,
    // A full year is what makes the seasonal picture trustworthy.
    coversFullYear: totalDays >= 350,
    intervalMinutes: importCh.intervalMinutes,
  };
}

/**
 * Restrict already-parsed meter data to a date window, recomputing the
 * summary so the interval engine and UI can treat the slice exactly like a
 * standalone file.
 *
 * Built for analysing only the period since a detected install date — see
 * detectSetupChange() in existingSystemEstimate.js — but general enough for
 * any before/after comparison.
 *
 * @param {object} meterData parseNem12Text's return value, or another slice
 * @param {{start?: string, end?: string}} window inclusive ISO dates
 * @returns {object|null} same shape as parseNem12Text's return, or null if
 *   the window leaves no E1 data at all
 */
export function sliceMeterData(meterData, { start, end } = {}) {
  const channels = {};

  for (const [suffix, channel] of Object.entries(meterData?.channels ?? {})) {
    const data = channel.data.filter(
      (d) => (!start || d.date >= start) && (!end || d.date <= end)
    );
    if (data.length === 0) continue;

    channels[suffix] = {
      ...channel,
      data,
      measuredDays: data.filter((d) => !d.estimated).length,
      estimatedDays: data.filter((d) => d.estimated).length,
      substitutedDays: data.filter((d) => d.substituted).length,
    };
  }

  if (!channels.E1) return null;

  return {
    ...meterData,
    channels,
    summary: summarise(channels),
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** "07:30" for slot 15. Slot n covers n*30 minutes from midnight AEST. */
export function intervalLabel(index) {
  const minutes = index * 30;
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** "4:30 pm" — for prose, where 24-hour time reads as machinery. */
export function friendlyTime(index) {
  const minutes = index * 30;
  const hour24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Show only the tail of an NMI — the full number identifies a property. */
export function maskNmi(nmi) {
  if (!nmi || nmi.length < 5) return nmi || '';
  return `••••${nmi.slice(-4)}`;
}

export function qualityMeaning(flag) {
  return QUALITY_MEANING[flag] ?? 'unknown';
}

/** YYYYMMDD → "YYYY-MM-DD". */
function parseDate(value) {
  const digits = String(value || '').trim();
  if (!/^\d{8}$/.test(digits)) return null;

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** YYYYMMDDHHMM(SS) → Date. */
function parseTimestamp(value) {
  const digits = String(value || '').trim();
  if (!/^\d{12,14}$/.test(digits)) return null;
  const iso =
    `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` +
    `T${digits.slice(8, 10)}:${digits.slice(10, 12)}:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Split one CSV line.
 *
 * Written out rather than a naive split because ReasonDescription is free text
 * and quite often contains a comma — "Meter change, estimate applied" would
 * otherwise shift every following field along one.
 */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');

  const out = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }

  out.push(field);
  return out;
}

function mapFor(map, key) {
  if (!map.has(key)) map.set(key, new Map());
  return map.get(key);
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
