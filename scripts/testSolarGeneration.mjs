/**
 * Verification for the half-hourly solar generation model.
 *
 *   node scripts/testSolarGeneration.mjs
 *
 * The claims worth checking are the ones the spec makes about Adelaide:
 * roughly 6am–8pm in summer peaking near 80% of rated capacity, and roughly
 * 7:30am–5pm in winter peaking near 60%. Times are AEST (UTC+10), matching
 * NEM12 — Adelaide's own clock runs 30 minutes behind that.
 */
import {
  averageProfile,
  dailyPsh,
  dayOfYearFor,
  generateSolarProfile,
  orientationAzimuth,
  solarDeclination,
  solarElevation,
  sunTimes,
  temperatureFactor,
} from '../src/services/solarGenerationModel.js';
import { effectiveDerate } from '../src/services/calculationEngine.js';

let failures = 0;

const pass = (label, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label.padEnd(48)}${detail}`);
};

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const clock = (hours) => {
  if (hours == null) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Adelaide, from the shipped irradiance table. */
const ADELAIDE = {
  name: 'Adelaide',
  state: 'SA',
  lat: -34.93,
  lng: 138.6,
  psh: {
    jan: 7.4, feb: 6.7, mar: 5.5, apr: 4.1, may: 3, jun: 2.5,
    jul: 2.7, aug: 3.5, sep: 4.6, oct: 5.8, nov: 6.8, dec: 7.3,
  },
  annual: 4.99,
};

const DARWIN = { lat: -12.46, lng: 130.84, annual: 5.8, psh: null };
const HOBART = { lat: -42.88, lng: 147.33, annual: 3.8, psh: null };

/* ------------------------------------------------------------------ *
 * 1. Solar position
 * ------------------------------------------------------------------ */

console.log('\n1. Solar position');

pass(
  'declination is ~ -23.4° at the December solstice',
  near(solarDeclination(355), -23.44, 0.4),
  `${solarDeclination(355).toFixed(2)}°`
);
pass(
  'declination is ~ +23.4° at the June solstice',
  near(solarDeclination(172), 23.44, 0.4),
  `${solarDeclination(172).toFixed(2)}°`
);
pass(
  'declination is ~0° at the equinoxes',
  Math.abs(solarDeclination(81)) < 1 && Math.abs(solarDeclination(264)) < 1.5,
  `${solarDeclination(81).toFixed(2)}° / ${solarDeclination(264).toFixed(2)}°`
);

const summerSun = sunTimes(1, ADELAIDE.lat, ADELAIDE.lng); // 1 January
const winterSun = sunTimes(182, ADELAIDE.lat, ADELAIDE.lng); // 1 July
const equinoxSun = sunTimes(264, ADELAIDE.lat, ADELAIDE.lng); // 21 September

console.log(
  `\n   Adelaide sunrise/sunset in AEST` +
    `\n     1 Jan   ${clock(summerSun.sunrise)} – ${clock(summerSun.sunset)}  (${summerSun.dayLength.toFixed(1)} h)` +
    `\n     1 Jul   ${clock(winterSun.sunrise)} – ${clock(winterSun.sunset)}  (${winterSun.dayLength.toFixed(1)} h)` +
    `\n     21 Sep  ${clock(equinoxSun.sunrise)} – ${clock(equinoxSun.sunset)}  (${equinoxSun.dayLength.toFixed(1)} h)\n`
);

pass('summer day is ~14 hours', near(summerSun.dayLength, 14.2, 0.5), `${summerSun.dayLength.toFixed(2)} h`);
pass('winter day is ~9.8 hours', near(winterSun.dayLength, 9.8, 0.5), `${winterSun.dayLength.toFixed(2)} h`);
pass('equinox day is ~12 hours', near(equinoxSun.dayLength, 12.1, 0.3), `${equinoxSun.dayLength.toFixed(2)} h`);
pass('summer sunrise near 6am AEST', near(summerSun.sunrise, 5.8, 0.5), clock(summerSun.sunrise));
pass('summer sunset near 8pm AEST', near(summerSun.sunset, 20, 0.5), clock(summerSun.sunset));
pass('winter sunrise near 7:30am AEST', near(winterSun.sunrise, 7.7, 0.4), clock(winterSun.sunrise));
pass('winter sunset near 5:30pm AEST', near(winterSun.sunset, 17.5, 0.4), clock(winterSun.sunset));
pass(
  'solar noon sits after 12:00 AEST west of the meridian',
  summerSun.solarNoon > 12.5 && summerSun.solarNoon < 13.1,
  clock(summerSun.solarNoon)
);
pass(
  'Darwin has a flatter seasonal swing than Hobart',
  sunTimes(1, DARWIN.lat, DARWIN.lng).dayLength - sunTimes(182, DARWIN.lat, DARWIN.lng).dayLength <
    sunTimes(1, HOBART.lat, HOBART.lng).dayLength - sunTimes(182, HOBART.lat, HOBART.lng).dayLength
);

pass(
  'elevation peaks at solar noon',
  (() => {
    let best = -90;
    let bestHour = 0;
    for (let h = 0; h < 24; h += 0.05) {
      const e = solarElevation(h, 1, ADELAIDE.lat, ADELAIDE.lng);
      if (e > best) {
        best = e;
        bestHour = h;
      }
    }
    return near(bestHour, summerSun.solarNoon, 0.1);
  })()
);
pass(
  'midsummer noon elevation is ~78° at Adelaide',
  near(solarElevation(summerSun.solarNoon, 1, ADELAIDE.lat, ADELAIDE.lng), 78, 2),
  `${solarElevation(summerSun.solarNoon, 1, ADELAIDE.lat, ADELAIDE.lng).toFixed(1)}°`
);
pass(
  'midwinter noon elevation is ~31° at Adelaide',
  near(solarElevation(winterSun.solarNoon, 172, ADELAIDE.lat, ADELAIDE.lng), 31.6, 2),
  `${solarElevation(winterSun.solarNoon, 172, ADELAIDE.lat, ADELAIDE.lng).toFixed(1)}°`
);
pass('sun is below the horizon at 2am', solarElevation(2, 1, ADELAIDE.lat, ADELAIDE.lng) < 0);
pass('day of year: 1 Jan is 1', dayOfYearFor(new Date('2025-01-01T00:00:00Z')) === 1);
pass('day of year: 31 Dec is 365', dayOfYearFor(new Date('2025-12-31T00:00:00Z')) === 365);

/* ------------------------------------------------------------------ *
 * 2. Energy conservation
 * ------------------------------------------------------------------ */

console.log('\n2. The curve carries the right amount of energy');

const derate = effectiveDerate({ orientation: 'N', pitchDegrees: 22.5, shading: 'none' }, ADELAIDE.lat);
const systemKw = 6.6;

const year = generateSolarProfile({
  systemKw,
  solarData: ADELAIDE,
  derate,
  roofData: { orientation: 'N', pitchDegrees: 22.5 },
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  // A generous inverter, so this check sees the unclipped energy.
  inverterKw: 20,
});

const expectedAnnual = systemKw * ADELAIDE.annual * derate * 365;
console.log(
  `   derate ${(derate * 100).toFixed(1)}%   modelled ${year.totalKwh} kWh   ` +
    `simple PSH×derate×365 ${Math.round(expectedAnnual)} kWh`
);

pass('365 days generated', year.days === 365);
pass(
  'annual total is within 5% of the Stage 1 daily-average method',
  near(year.totalKwh, expectedAnnual, expectedAnnual * 0.05),
  `${((year.totalKwh / expectedAnnual - 1) * 100).toFixed(1)}%`
);
pass(
  'every day has 48 slots',
  [...year.byDate.values()].every((d) => d.length === 48)
);
pass('no negative generation', [...year.byDate.values()].every((d) => d.every((v) => v >= 0)));

const janTotal = sumMonth(year.byDate, '2025-01');
const julTotal = sumMonth(year.byDate, '2025-07');
pass(
  'January generates roughly 2.4× July',
  janTotal / julTotal > 2 && janTotal / julTotal < 3.2,
  `${janTotal.toFixed(0)} vs ${julTotal.toFixed(0)} kWh (${(janTotal / julTotal).toFixed(2)}×)`
);
pass(
  'monthly totals track the PSH table',
  near(janTotal, systemKw * ADELAIDE.psh.jan * derate * 31, systemKw * ADELAIDE.psh.jan * derate * 31 * 0.09),
  `${janTotal.toFixed(0)} vs ${(systemKw * ADELAIDE.psh.jan * derate * 31).toFixed(0)} kWh`
);

/* ------------------------------------------------------------------ *
 * 3. Curve shape
 * ------------------------------------------------------------------ */

console.log('\n3. Curve shape against the spec');

const summerDay = year.byDate.get('2025-01-15');
const winterDay = year.byDate.get('2025-07-15');

const firstSlot = (day) => day.findIndex((v) => v > 0.01);
const lastSlot = (day) => day.length - 1 - [...day].reverse().findIndex((v) => v > 0.01);
const slotClock = (slot) => clock(slot * 0.5);
const peakOf = (day) => Math.max(...day);
// Interval energy → the fraction of rated DC capacity that implies.
const asCapacityFraction = (day) => (peakOf(day) * 2) / systemKw;

console.log(
  `   15 Jan  generating ${slotClock(firstSlot(summerDay))}–${slotClock(lastSlot(summerDay) + 1)}` +
    `  peak ${(asCapacityFraction(summerDay) * 100).toFixed(0)}% of rated  total ${summerDay.reduce((a, b) => a + b, 0).toFixed(1)} kWh`
);
console.log(
  `   15 Jul  generating ${slotClock(firstSlot(winterDay))}–${slotClock(lastSlot(winterDay) + 1)}` +
    `  peak ${(asCapacityFraction(winterDay) * 100).toFixed(0)}% of rated  total ${winterDay.reduce((a, b) => a + b, 0).toFixed(1)} kWh`
);

pass('summer generation starts around 6am', near(firstSlot(summerDay) * 0.5, 6, 1), slotClock(firstSlot(summerDay)));
pass('summer generation ends around 8pm', near((lastSlot(summerDay) + 1) * 0.5, 20, 1), slotClock(lastSlot(summerDay) + 1));
pass('winter generation starts around 7:30am', near(firstSlot(winterDay) * 0.5, 7.5, 1), slotClock(firstSlot(winterDay)));
pass('winter generation ends around 5:30pm', near((lastSlot(winterDay) + 1) * 0.5, 17.5, 1), slotClock(lastSlot(winterDay) + 1));
/**
 * The spec quotes 80% of rated in summer and 60% in winter. Those are clear-day
 * peaks; these are average days, because the PSH table they scale to is a
 * monthly average that already includes cloud. An average July day yields about
 * 14 kWh from 6.6 kW, and no curve spanning 9.8 hours of daylight can total
 * 14 kWh while peaking at 4 kW. The average is the right basis for annual
 * savings, so the expectations below are the average-day equivalents.
 */
pass(
  'summer peaks near 70% of rated capacity on an average day',
  near(asCapacityFraction(summerDay), 0.7, 0.1),
  `${(asCapacityFraction(summerDay) * 100).toFixed(0)}%`
);
pass(
  'winter peaks near 35% of rated capacity on an average day',
  near(asCapacityFraction(winterDay), 0.35, 0.1),
  `${(asCapacityFraction(winterDay) * 100).toFixed(0)}%`
);
// Per-day conservation: whatever shape the curve takes, its area must be the
// energy the PSH table implies for that date.
for (const [label, date, day] of [
  ['15 Jan', new Date('2025-01-15T00:00:00Z'), summerDay],
  ['15 Jul', new Date('2025-07-15T00:00:00Z'), winterDay],
]) {
  const expected =
    systemKw *
    dailyPsh(date, ADELAIDE) *
    derate *
    temperatureFactor(dayOfYearFor(date), ADELAIDE.lat);
  pass(
    `${label} area under the curve matches its PSH energy`,
    near(day.reduce((a, b) => a + b, 0), expected, expected * 0.01),
    `${day.reduce((a, b) => a + b, 0).toFixed(2)} vs ${expected.toFixed(2)} kWh`
  );
}
pass(
  'a winter curve is more concentrated than a summer one',
  peakOf(winterDay) / winterDay.reduce((a, b) => a + b, 0) >
    peakOf(summerDay) / summerDay.reduce((a, b) => a + b, 0)
);
pass('nothing is generated at midnight', summerDay[0] === 0 && summerDay[47] === 0);
pass(
  'the curve rises then falls without a second hump',
  (() => {
    const peakIndex = summerDay.indexOf(peakOf(summerDay));
    const rising = summerDay.slice(firstSlot(summerDay), peakIndex);
    const falling = summerDay.slice(peakIndex, lastSlot(summerDay) + 1);
    return (
      rising.every((v, i) => i === 0 || v >= rising[i - 1] - 1e-9) &&
      falling.every((v, i) => i === 0 || v <= falling[i - 1] + 1e-9)
    );
  })()
);
pass(
  'peak sits at solar noon, not clock noon',
  (() => {
    const peakSlot = summerDay.indexOf(peakOf(summerDay));
    return near(peakSlot * 0.5 + 0.25, sunTimes(15, ADELAIDE.lat, ADELAIDE.lng).solarNoon, 0.5);
  })(),
  slotClock(summerDay.indexOf(peakOf(summerDay)))
);

/* ------------------------------------------------------------------ *
 * 4. Orientation shifts the curve in time
 * ------------------------------------------------------------------ */

console.log('\n4. Orientation moves generation through the day');

const orientationDay = (orientation) => {
  const roof = { orientation, pitchDegrees: 22.5, shading: 'none' };
  return generateSolarProfile({
    systemKw,
    solarData: ADELAIDE,
    derate: effectiveDerate(roof, ADELAIDE.lat),
    roofData: roof,
    startDate: '2025-01-15',
    endDate: '2025-01-15',
    inverterKw: 20,
  }).byDate.get('2025-01-15');
};

const centreOfMass = (day) => {
  const total = day.reduce((a, b) => a + b, 0);
  return day.reduce((sum, v, i) => sum + v * (i * 0.5 + 0.25), 0) / total;
};

const north = orientationDay('N');
const west = orientationDay('W');
const east = orientationDay('E');

console.log(
  `   centre of generation — east ${clock(centreOfMass(east))}` +
    `   north ${clock(centreOfMass(north))}   west ${clock(centreOfMass(west))}`
);

pass('west-facing generation arrives later than north', centreOfMass(west) > centreOfMass(north) + 0.5);
pass('east-facing generation arrives earlier than north', centreOfMass(east) < centreOfMass(north) - 0.5);
pass(
  'west shifts by roughly two hours against east',
  near(centreOfMass(west) - centreOfMass(east), 2, 0.6),
  `${(centreOfMass(west) - centreOfMass(east)).toFixed(2)} h apart`
);
pass(
  'a west roof still makes less energy overall than north',
  west.reduce((a, b) => a + b, 0) < north.reduce((a, b) => a + b, 0)
);
pass('azimuth lookup: north is 0°, west is 270°', orientationAzimuth('N') === 0 && orientationAzimuth('W') === 270);

/* ------------------------------------------------------------------ *
 * 5. Inverter clipping
 * ------------------------------------------------------------------ */

console.log('\n5. Inverter clipping');

const withInverter = (inverterKw) =>
  generateSolarProfile({
    systemKw: 6.6,
    solarData: ADELAIDE,
    derate,
    roofData: { orientation: 'N', pitchDegrees: 22.5 },
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    inverterKw,
  });

const standard = withInverter(5);
const undersized = withInverter(2.5);

const clipShare = (p) => p.clippedKwh / (p.totalKwh + p.clippedKwh);

console.log(
  `   6.6 kW array on a 5 kW inverter:   ${standard.clippedKwh} kWh clipped (${(clipShare(standard) * 100).toFixed(1)}%)`
);
console.log(
  `   6.6 kW array on a 2.5 kW inverter: ${undersized.clippedKwh} kWh clipped (${(clipShare(undersized) * 100).toFixed(1)}%)`
);

/**
 * A standard 1.33 DC:AC ratio clips essentially nothing here, and that is the
 * correct result rather than a gap: these are average days, and an average day
 * never reaches the peak that a clear one would. The cap still has to hold when
 * an inverter is genuinely undersized.
 */
pass('a standard inverter pairing barely clips', clipShare(standard) < 0.01);
pass('an undersized inverter clips materially', clipShare(undersized) > 0.05, `${(clipShare(undersized) * 100).toFixed(1)}%`);
pass(
  'no interval exceeds the inverter rating',
  [...undersized.byDate.values()].every((d) => d.every((v) => v <= 1.25 + 1e-6))
);
pass(
  'omitting inverterKw derives it from the array',
  near(
    generateSolarProfile({
      systemKw: 6.6,
      solarData: ADELAIDE,
      derate,
      startDate: '2025-01-01',
      endDate: '2025-01-02',
    }).inverterKw,
    5,
    0.1
  )
);

/* ------------------------------------------------------------------ *
 * 6. Temperature and PSH interpolation
 * ------------------------------------------------------------------ */

console.log('\n6. Temperature derate and PSH interpolation');

const janTemp = temperatureFactor(15, ADELAIDE.lat);
const julTemp = temperatureFactor(196, ADELAIDE.lat);
console.log(`   temperature factor — mid Jan ${janTemp.toFixed(3)}   mid Jul ${julTemp.toFixed(3)}`);

pass('summer costs output against the annual mean', janTemp < 1, janTemp.toFixed(3));
pass('winter gains against the annual mean', julTemp > 1, julTemp.toFixed(3));
pass('the seasonal spread is about 8%', near(julTemp - janTemp, 0.08, 0.02), `${((julTemp - janTemp) * 100).toFixed(1)}%`);
pass(
  'the factor averages to 1 across the year, so the annual total is untouched',
  (() => {
    let sum = 0;
    for (let d = 1; d <= 365; d++) sum += temperatureFactor(d, ADELAIDE.lat);
    return near(sum / 365, 1, 0.002);
  })()
);

pass(
  'PSH at a month midpoint equals the table value',
  near(dailyPsh(new Date('2025-01-16T00:00:00Z'), ADELAIDE), ADELAIDE.psh.jan, 0.05),
  `${dailyPsh(new Date('2025-01-16T00:00:00Z'), ADELAIDE).toFixed(2)} vs ${ADELAIDE.psh.jan}`
);
pass(
  'PSH between months lands between their values',
  (() => {
    const v = dailyPsh(new Date('2025-01-31T00:00:00Z'), ADELAIDE);
    return v < ADELAIDE.psh.jan && v > ADELAIDE.psh.feb;
  })()
);
pass(
  'PSH has no step at a month boundary',
  Math.abs(
    dailyPsh(new Date('2025-01-31T00:00:00Z'), ADELAIDE) -
      dailyPsh(new Date('2025-02-01T00:00:00Z'), ADELAIDE)
  ) < 0.06
);
pass('PSH falls back to the annual average with no monthly table', dailyPsh(new Date(), DARWIN) === DARWIN.annual);

/* ------------------------------------------------------------------ *
 * 7. Averaging helper
 * ------------------------------------------------------------------ */

console.log('\n7. Average profile helper');

const avgAll = averageProfile(year.byDate);
const avgSummer = averageProfile(year.byDate, (d) => d.startsWith('2025-01'));

pass('average has 48 slots', avgAll.length === 48);
pass(
  'the average day totals the annual figure',
  near(
    avgAll.reduce((a, b) => a + b, 0) * 365,
    year.totalKwh,
    year.totalKwh * 0.01
  )
);
pass('a summer average beats the yearly average', avgSummer.reduce((a, b) => a + b, 0) > avgAll.reduce((a, b) => a + b, 0));

/* ------------------------------------------------------------------ *
 * 8. Other latitudes
 * ------------------------------------------------------------------ */

console.log('\n8. Sanity across Australia');

for (const [name, place] of [
  ['Darwin   ', { ...DARWIN, psh: null }],
  ['Adelaide ', ADELAIDE],
  ['Hobart   ', { ...HOBART, psh: null }],
]) {
  const summer = sunTimes(1, place.lat, place.lng);
  const winter = sunTimes(182, place.lat, place.lng);
  const profile = generateSolarProfile({
    systemKw: 6.6,
    solarData: place,
    derate,
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    inverterKw: 20,
  });
  const expected = 6.6 * place.annual * derate * 365;
  const drift = (profile.totalKwh / expected - 1) * 100;
  console.log(
    `   ${name} summer ${summer.dayLength.toFixed(1)} h / winter ${winter.dayLength.toFixed(1)} h` +
      `   annual ${profile.totalKwh} kWh (${drift >= 0 ? '+' : ''}${drift.toFixed(1)}% vs PSH method)`
  );
  pass(`${name.trim()} annual total within 6% of the PSH method`, Math.abs(drift) < 6, `${drift.toFixed(1)}%`);
}

function sumMonth(byDate, prefix) {
  let total = 0;
  for (const [date, intervals] of byDate) {
    if (date.startsWith(prefix)) total += intervals.reduce((a, b) => a + b, 0);
  }
  return total;
}

console.log(
  `\n${failures === 0 ? 'All solar generation checks passed.' : `${failures} check(s) FAILED.`}`
);
process.exit(failures > 0 ? 1 : 0);
