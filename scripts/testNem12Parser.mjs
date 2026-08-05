/**
 * Verification for the NEM12 parser.
 *
 *   node scripts/testNem12Parser.mjs
 *   node scripts/testNem12Parser.mjs path/to/real-file.csv
 *
 * Synthetic files are generated to exercise each format variation, because
 * real meter data can't be committed to the repo — it identifies a property.
 * Pass a real export as an argument to check it end to end without printing
 * anything identifying.
 */
import { readFileSync } from 'node:fs';
import {
  Nem12Error,
  maskNmi,
  parseNem12Text,
  toHalfHourly,
} from '../src/services/nem12Parser.js';

let failures = 0;

const pass = (label, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

/* ------------------------------------------------------------------ *
 * Fixture builder
 * ------------------------------------------------------------------ */

const NMI = '6123456789';

/** A plausible household half-hour shape: overnight base, morning and evening peaks. */
function loadShape(slot, dayIndex) {
  const hour = slot / 2;
  const base = 0.18;
  const morning = 0.55 * Math.exp(-((hour - 7.5) ** 2) / 2.2);
  const evening = 0.95 * Math.exp(-((hour - 19) ** 2) / 3.5);
  const wobble = 0.03 * Math.sin(dayIndex * 1.7 + slot * 0.4);
  return Math.max(0, base + morning + evening + wobble);
}

function solarShape(slot) {
  const hour = slot / 2;
  if (hour < 6.5 || hour > 19) return 0;
  return Math.max(0, 1.6 * Math.exp(-((hour - 12.6) ** 2) / 7));
}

function isoToNem12(iso) {
  return iso.replace(/-/g, '');
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} options
 * @param {number} options.days
 * @param {number} [options.intervalMinutes]
 * @param {boolean} [options.solar]
 * @param {boolean} [options.controlledLoad]
 * @param {number[]} [options.skipDays] day indexes to omit entirely
 * @param {string} [options.uom]
 */
function buildNem12({
  days = 365,
  intervalMinutes = 30,
  solar = false,
  controlledLoad = false,
  skipDays = [],
  uom = 'KWH',
  nmi = NMI,
  start = '2025-01-01',
  includeEnd = true,
  quality = 'A',
} = {}) {
  const perDay = Math.round(1440 / intervalMinutes);
  const scale = uom === 'WH' ? 1000 : uom === 'MWH' ? 0.001 : 1;
  const skip = new Set(skipDays);

  const lines = ['100,NEM12,202607250915,SAPN,RETAILER'];

  const channel = (suffix, shapeFn) => {
    lines.push(
      `200,${nmi},${suffix}${suffix === 'E1' ? 'B1' : ''},1,${suffix},N1,METER001,${uom},${intervalMinutes},20260801`
    );
    for (let d = 0; d < days; d++) {
      if (skip.has(d)) continue;
      const values = [];
      for (let i = 0; i < perDay; i++) {
        // Sub-30-minute readings carry a share of the half-hour they sit in.
        const slot = Math.floor((i * intervalMinutes) / 30);
        const perHalfHour = 30 / intervalMinutes;
        // Six decimals: at 4 dp a megawatt-hour file quantises at 0.1 kWh per
        // interval, which is the fixture rounding rather than a parser fault.
        values.push(((shapeFn(slot, d) / perHalfHour) * scale).toFixed(6));
      }
      lines.push(`300,${isoToNem12(addDays(start, d))},${values.join(',')},${quality},,,20260725091500`);
    }
  };

  channel('E1', loadShape);
  if (solar) channel('B1', (slot) => solarShape(slot));
  if (controlledLoad) channel('E2', (slot) => (slot >= 2 && slot < 10 ? 0.9 : 0));

  if (includeEnd) lines.push('900');
  return lines.join('\r\n');
}

/* ------------------------------------------------------------------ *
 * 1. Baseline 30-minute file
 * ------------------------------------------------------------------ */

console.log('\n1. Standard 30-minute file, one year, no solar');

const basic = parseNem12Text(buildNem12({ days: 365 }));

pass('header version is NEM12', basic.header.version === 'NEM12');
pass('creation date parsed', basic.header.creationDate instanceof Date);
pass('participant read', basic.header.fromParticipant === 'SAPN');
pass('NMI read', basic.nmi === NMI);
pass('one NMI found', basic.availableNmis.length === 1);
pass('E1 channel present', Boolean(basic.channels.E1));
pass('no B1 channel', !basic.channels.B1);
pass('365 days', basic.summary.totalDays === 365, `${basic.summary.totalDays}`);
pass('date range start', basic.summary.dateRange.start === '2025-01-01');
pass('date range end', basic.summary.dateRange.end === '2025-12-31');
pass('48 intervals per day', basic.channels.E1.data[0].intervals.length === 48);
pass('hasSolar false', basic.summary.hasSolar === false);
pass('covers a full year', basic.summary.coversFullYear === true);
pass('no warnings', basic.warnings.length === 0, basic.warnings.join(' | '));

const dayOneSum = basic.channels.E1.data[0].intervals.reduce((a, b) => a + b, 0);
pass('day total matches its intervals', near(dayOneSum, basic.channels.E1.data[0].total));
pass(
  'annual import is the sum of days',
  near(
    basic.summary.totalImportKwh,
    basic.channels.E1.data.reduce((s, d) => s + d.total, 0),
    0.5
  )
);
pass(
  'average daily import is plausible',
  basic.summary.avgDailyImportKwh > 8 && basic.summary.avgDailyImportKwh < 30,
  `${basic.summary.avgDailyImportKwh} kWh/day`
);
pass(
  'peak demand looks like kW not kWh',
  near(basic.summary.peakDemandKw, Math.max(...basic.channels.E1.data[0].intervals) * 2, 0.4),
  `${basic.summary.peakDemandKw} kW at ${basic.summary.peakDemandAt.time}`
);
pass(
  'peak lands in the evening',
  Number(basic.summary.peakDemandAt.time.slice(0, 2)) >= 17,
  basic.summary.peakDemandAt.time
);

/* ------------------------------------------------------------------ *
 * 2. Interval lengths normalise to 48 slots
 * ------------------------------------------------------------------ */

console.log('\n2. 15-minute and 5-minute files normalise to half-hourly');

for (const minutes of [15, 5]) {
  const parsed = parseNem12Text(buildNem12({ days: 90, intervalMinutes: minutes }));
  pass(
    `${minutes}-minute: 48 slots per day`,
    parsed.channels.E1.data.every((d) => d.intervals.length === 48)
  );
  pass(
    `${minutes}-minute: energy preserved vs 30-minute`,
    near(parsed.summary.avgDailyImportKwh, basic.summary.avgDailyImportKwh, 0.35),
    `${parsed.summary.avgDailyImportKwh} vs ${basic.summary.avgDailyImportKwh}`
  );
  pass(`${minutes}-minute: source interval recorded`, parsed.summary.intervalMinutes === minutes);
}

console.log('\n   toHalfHourly() directly');
pass('30-min passes through', toHalfHourly(new Array(48).fill(1), 30).length === 48);
pass('15-min sums pairs', near(toHalfHourly(new Array(96).fill(0.5), 15)[0], 1));
pass('5-min sums sixes', near(toHalfHourly(new Array(288).fill(0.25), 5)[0], 1.5));
pass(
  '60-min spreads evenly without losing energy',
  near(
    toHalfHourly(new Array(24).fill(2), 60).reduce((a, b) => a + b, 0),
    48
  )
);

/* ------------------------------------------------------------------ *
 * 3. Solar and controlled load channels
 * ------------------------------------------------------------------ */

console.log('\n3. Sites with solar export and controlled load');

const withSolar = parseNem12Text(
  buildNem12({ days: 365, solar: true, controlledLoad: true })
);

pass('B1 detected', Boolean(withSolar.channels.B1));
pass('E2 detected', Boolean(withSolar.channels.E2));
pass('hasSolar true', withSolar.summary.hasSolar === true);
pass('hasControlledLoad true', withSolar.summary.hasControlledLoad === true);
pass('export total > 0', withSolar.summary.totalExportKwh > 1000, `${withSolar.summary.totalExportKwh} kWh`);
pass(
  'controlled load total > 0',
  withSolar.summary.totalControlledKwh > 1000,
  `${withSolar.summary.totalControlledKwh} kWh`
);
pass('roles labelled', withSolar.channels.B1.role === 'Solar export');
pass(
  'export is zero overnight',
  withSolar.channels.B1.data[0].intervals[2] === 0 &&
    withSolar.channels.B1.data[0].intervals[46] === 0
);
pass('import unaffected by extra channels', near(withSolar.summary.avgDailyImportKwh, basic.summary.avgDailyImportKwh, 0.2));

/* ------------------------------------------------------------------ *
 * 4. Units
 * ------------------------------------------------------------------ */

console.log('\n4. Unit conversion');

for (const [uom, label] of [['WH', 'watt-hours'], ['MWH', 'megawatt-hours']]) {
  const parsed = parseNem12Text(buildNem12({ days: 60, uom }));
  pass(
    `${label} convert to kWh`,
    near(parsed.summary.avgDailyImportKwh, basic.summary.avgDailyImportKwh, 0.4),
    `${parsed.summary.avgDailyImportKwh} kWh/day`
  );
  pass(`${label}: unit reported as kWh`, parsed.channels.E1.unit === 'kWh');
}

/* ------------------------------------------------------------------ *
 * 5. Gaps, substitution and quality
 * ------------------------------------------------------------------ */

console.log('\n5. Missing days, substituted readings and quality flags');

const gappy = parseNem12Text(buildNem12({ days: 200, skipDays: [10, 11, 57, 120] }));
pass('gaps filled to a continuous calendar', gappy.summary.totalDays === 200, `${gappy.summary.totalDays}`);
pass('estimated days counted', gappy.channels.E1.estimatedDays === 4, `${gappy.channels.E1.estimatedDays}`);
pass('measured days counted', gappy.channels.E1.measuredDays === 196);
pass('estimated days flagged', gappy.channels.E1.data.filter((d) => d.estimated).length === 4);
pass(
  'a filled day carries a plausible profile',
  gappy.channels.E1.data.find((d) => d.estimated).total > 5,
  `${gappy.channels.E1.data.find((d) => d.estimated).total} kWh`
);
pass(
  'filled day matches its weekday neighbours',
  (() => {
    const filled = gappy.channels.E1.data.find((d) => d.estimated);
    const weekday = new Date(`${filled.date}T00:00:00Z`).getUTCDay();
    const peers = gappy.channels.E1.data.filter(
      (d) => !d.estimated && new Date(`${d.date}T00:00:00Z`).getUTCDay() === weekday
    );
    const avg = peers.reduce((s, d) => s + d.total, 0) / peers.length;
    return near(filled.total, avg, avg * 0.15);
  })()
);
pass('a gap warning is raised', gappy.warnings.some((w) => /estimated/.test(w)), gappy.warnings.join(' | '));

const substituted = parseNem12Text(buildNem12({ days: 120, quality: 'S53' }));
pass('substituted days flagged', substituted.channels.E1.substitutedDays === 120);
pass('substituted values still used', substituted.summary.totalImportKwh > 0);
pass('quality method retained', substituted.channels.E1.data[0].qualityMethod === 'S53');

const withEvent = parseNem12Text(
  buildNem12({ days: 60 }).replace(
    /^900$/m,
    '900'
  ).split('\r\n').flatMap((line, i, all) => {
    // Attach a 400 record to the first 300 record.
    if (line.startsWith('300,') && all.slice(0, i).every((l) => !l.startsWith('300,'))) {
      return [line, '400,1,10,S53,77,"Meter fault, estimate applied"'];
    }
    return [line];
  }).join('\r\n')
);
pass('400 record marks the day substituted', withEvent.channels.E1.data[0].substituted === true);
pass('400 record counts affected intervals', withEvent.channels.E1.data[0].substitutedIntervals === 10);
pass(
  'quoted comma in a reason field does not shift columns',
  near(withEvent.summary.avgDailyImportKwh, basic.summary.avgDailyImportKwh, 0.3)
);

/* ------------------------------------------------------------------ *
 * 6. Multiple NMIs
 * ------------------------------------------------------------------ */

console.log('\n6. Multiple NMIs in one file');

const twoNmis = parseNem12Text(
  [
    buildNem12({ days: 60, includeEnd: false }),
    buildNem12({ days: 60, nmi: '6999999999', includeEnd: false })
      .split('\r\n')
      .filter((l) => !l.startsWith('100,'))
      .join('\r\n'),
    '900',
  ].join('\r\n')
);
pass('both NMIs listed', twoNmis.availableNmis.length === 2, twoNmis.availableNmis.map(maskNmi).join(', '));
pass('first NMI analysed', twoNmis.nmi === NMI);
pass('a warning explains the choice', twoNmis.warnings.some((w) => /meters/.test(w)));
pass('NMI masking hides all but the last four', maskNmi(NMI) === '••••6789');

/* ------------------------------------------------------------------ *
 * 7. Rejections and error messages
 * ------------------------------------------------------------------ */

console.log('\n7. Files we should refuse, with a message worth reading');

const expectError = (label, text, code) => {
  try {
    parseNem12Text(text);
    failures++;
    console.log(`  FAIL  ${label} — parsed without error`);
  } catch (err) {
    const ok = err instanceof Nem12Error && err.code === code;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} — ${err.code}: ${err.message}`);
  }
};

expectError('a bank statement CSV', 'Date,Description,Amount\n2025-01-01,Coffee,-5.50', 'not_nem12');
expectError('empty file', '   ', 'empty');
expectError('NEM13 summary file', '100,NEM13,202607250915,SAPN,RETAILER\n900', 'wrong_format');
expectError('only three weeks of data', buildNem12({ days: 21 }), 'too_few_days');
expectError(
  'a file with no consumption channel',
  buildNem12({ days: 90 })
    .split('\r\n')
    .map((l) => l.replace(/^200,(\d+),E1B1,1,E1,/, '200,$1,B1,1,B1,'))
    .join('\r\n'),
  'no_consumption'
);

const short = parseNem12Text(buildNem12({ days: 45 }));
pass(
  '45 days parses but warns about the span',
  short.warnings.some((w) => /45 days/.test(w)),
  short.warnings.join(' | ')
);

const truncated = parseNem12Text(buildNem12({ days: 90, includeEnd: false }));
pass(
  'a truncated file warns but still parses',
  truncated.summary.totalDays === 90 && truncated.warnings.some((w) => /cut short/.test(w))
);

/* ------------------------------------------------------------------ *
 * 8. Dirty data
 * ------------------------------------------------------------------ */

console.log('\n8. Dirty data');

const negatives = parseNem12Text(
  buildNem12({ days: 90 }).replace(/^(300,20250105),[\d.]+,[\d.]+/m, '$1,-0.5,-0.25')
);
pass('negative readings zeroed', negatives.summary.totalImportKwh > 0);
pass('negatives reported', negatives.warnings.some((w) => /negative/.test(w)), negatives.warnings.join(' | '));

const blanks = parseNem12Text(
  buildNem12({ days: 90 }).replace(/^(300,20250107),[\d.]+,[\d.]+,[\d.]+/m, '$1,,,')
);
pass('blank readings treated as zero, day kept', blanks.summary.totalDays === 90);

const absurd = parseNem12Text(
  buildNem12({ days: 90 }).replace(
    /^300,20250109,.*$/m,
    `300,20250109,${new Array(48).fill('9999').join(',')},A,,,20260725091500`
  )
);
pass(
  'an absurd day is dropped rather than skewing the year',
  absurd.channels.E1.droppedDays === 1 && absurd.summary.avgDailyImportKwh < 30,
  `${absurd.summary.avgDailyImportKwh} kWh/day`
);
pass(
  'the dropped day is reported',
  absurd.warnings.some((w) => /couldn't be read/.test(w)),
  absurd.warnings.join(' | ')
);

const revised = parseNem12Text(
  buildNem12({ days: 90 }) +
    `\r\n200,${NMI},E1B1,1,E1,N1,METER001,KWH,30,20260801\r\n` +
    `300,20250110,${new Array(48).fill('0.5').join(',')},A,,,20260726091500`
);
pass('a revised day replaces the original once', revised.summary.totalDays === 90);
pass(
  'the revision wins',
  near(revised.channels.E1.data.find((d) => d.date === '2025-01-10').total, 24),
  `${revised.channels.E1.data.find((d) => d.date === '2025-01-10').total} kWh`
);

const unixEndings = parseNem12Text(buildNem12({ days: 90 }).replace(/\r\n/g, '\n'));
pass('unix line endings', unixEndings.summary.totalDays === 90);

const blankSuffix = parseNem12Text(
  buildNem12({ days: 90 }).replace(/^200,(\d+),E1B1,1,E1,/m, '200,$1,E1B1,1,,')
);
pass('a blank suffix falls back to the configuration field', Boolean(blankSuffix.channels.E1));

console.log('\n   Headerless SAPN Detailed export');
const headerless = parseNem12Text(
  buildNem12({ days: 90, includeEnd: false })
    .split('\r\n')
    .filter((l) => !l.startsWith('100,'))
    .concat('900')
    .join('\r\n')
);
pass('parses without a 100 record', headerless.summary.totalDays === 90);
pass('E1 still present', Boolean(headerless.channels.E1));
pass('warns about the missing header', headerless.warnings.some((w) => /no format header/i.test(w)));

/* ------------------------------------------------------------------ *
 * 9. Optional: a real file
 * ------------------------------------------------------------------ */

const realPath = process.argv[2];
if (realPath) {
  console.log(`\n9. Real file: ${realPath}`);
  try {
    const parsed = parseNem12Text(readFileSync(realPath, 'utf8'));
    console.log(`  NMI               ${maskNmi(parsed.nmi)}`);
    console.log(`  Channels          ${Object.keys(parsed.channels).join(', ')}`);
    console.log(`  Range             ${parsed.summary.dateRange.start} to ${parsed.summary.dateRange.end}`);
    console.log(`  Days              ${parsed.summary.totalDays} (${parsed.summary.measuredDays} measured, ${parsed.summary.estimatedDays} filled)`);
    console.log(`  Interval          ${parsed.summary.intervalMinutes} min`);
    console.log(`  Import            ${parsed.summary.totalImportKwh} kWh (${parsed.summary.avgDailyImportKwh}/day)`);
    console.log(`  Export            ${parsed.summary.totalExportKwh} kWh (${parsed.summary.avgDailyExportKwh}/day)`);
    console.log(`  Peak demand       ${parsed.summary.peakDemandKw} kW at ${parsed.summary.peakDemandAt?.time}`);
    for (const w of parsed.warnings) console.log(`  warning: ${w}`);
    pass('real file parsed', parsed.summary.totalDays > 0);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${err.code || 'error'}: ${err.message}`);
  }
} else {
  console.log('\n9. Real file: none supplied (pass a path as an argument to test one)');
}

console.log(
  `\n${failures === 0 ? 'All NEM12 parser checks passed.' : `${failures} check(s) FAILED.`}`
);
process.exit(failures > 0 ? 1 : 0);
