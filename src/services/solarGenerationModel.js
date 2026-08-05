/**
 * Half-hourly solar generation profiles.
 *
 * Stage 1 works in daily and monthly totals, which is all a bill supports.
 * Matching generation against interval meter data needs the same 30-minute
 * resolution on both sides, so this module turns a location's monthly peak sun
 * hours into a shaped curve for every half hour of every day.
 *
 * The approach is deliberately physical rather than fitted:
 *
 *   1. Solar position — declination and hour angle from the day of year and
 *      latitude give the sun's elevation at any moment, and with it sunrise,
 *      sunset and the shape of the day.
 *   2. Clear-sky shape — irradiance on the panel follows the sine of the
 *      elevation, attenuated by the air mass the light travels through.
 *   3. Scaling — that shape is then normalised so the area under the curve
 *      equals the day's energy from the PSH table. The physics sets the shape;
 *      the measured irradiance data sets the magnitude. Nothing is invented.
 *
 * Times are AEST (UTC+10) year round with no daylight-saving shift, matching
 * how AEMO stamps NEM12 intervals — so slot 20 here is slot 20 there.
 *
 * One thing to know when reading the output: every day produced here is an
 * *average* day for its date, because the PSH table it is scaled against is a
 * monthly average that already includes cloudy weather. A clear July day in
 * Adelaide really does peak near 60% of rated capacity, but a typical July day
 * yields about 14 kWh from a 6.6 kW system, and no curve spread across 9.8
 * hours of daylight can both total 14 kWh and peak at 4 kW. Averages are the
 * right basis for annual savings; individual clear days would overstate them.
 */
import { DEFAULTS } from '../config/defaults.js';
import { DAYS_IN_MONTH, MONTH_KEYS } from '../utils/formatters.js';

const DEG = Math.PI / 180;

/** All Australian meter data is stamped in AEST regardless of the state. */
const AEST_OFFSET_HOURS = 10;

/** Reference longitude for AEST — the meridian the clock is built on. */
const AEST_MERIDIAN = 150;

export const GENERATION_MODEL = {
  /**
   * Temperature derate. Panels are rated at 25 °C and lose roughly 0.35%/°C
   * above it. Cell temperature runs well above ambient in sun, so a summer
   * afternoon in Adelaide costs real output while a clear July day gives a
   * little back.
   */
  temperature: {
    coefficientPerDegree: -0.0035,
    // Monthly mean daytime cell temperature, southern Australia. Applied
    // relative to the 25 °C rating.
    summerCellTemp: 48,
    winterCellTemp: 26,
    referenceTemp: 25,
  },

  /**
   * Inverter clipping. A system's AC output is capped by its inverter, which
   * is routinely sized below the array — 6.6 kW of panels on a 5 kW inverter
   * is the standard Australian install. Without this the model would report
   * midday output no inverter could actually deliver.
   */
  dcToAcRatio: 1.33,

  /** Air-mass attenuation exponent (Kasten-Young style, simplified). */
  airMassExponent: 0.678,

  /** Panels stop producing below this elevation — horizon clutter, glancing light. */
  minElevationDegrees: 3,
};

/* ------------------------------------------------------------------ *
 * Solar position
 * ------------------------------------------------------------------ */

/**
 * Solar declination for a day of the year, in degrees.
 *
 * Cooper's equation — accurate to about 0.5°, far below the uncertainty in
 * everything else here.
 */
export function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin(DEG * ((360 / 365) * (dayOfYear + 284)));
}

/**
 * The equation of time, in minutes.
 *
 * The sun does not cross the meridian at the same clock time each day: the
 * earth's tilt and elliptical orbit shift solar noon by up to ±16 minutes.
 * It matters here because a quarter-hour error moves generation between two
 * half-hour slots at exactly the times a battery is deciding what to do.
 */
export function equationOfTime(dayOfYear) {
  const b = DEG * ((360 / 364) * (dayOfYear - 81));
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Clock time of solar noon, in decimal hours AEST.
 *
 * @param {number} dayOfYear
 * @param {number} longitude - degrees east
 */
export function solarNoon(dayOfYear, longitude) {
  // Four minutes of clock time per degree from the timezone meridian.
  const longitudeCorrection = (AEST_MERIDIAN - longitude) * 4;
  return 12 + (longitudeCorrection - equationOfTime(dayOfYear)) / 60;
}

/**
 * Sunrise and sunset in decimal hours AEST, plus day length.
 *
 * Returns null hours inside the polar circles, which cannot occur in Australia
 * but keeps the function honest if it is ever reused.
 *
 * @param {number} dayOfYear
 * @param {number} latitude - negative in the southern hemisphere
 * @param {number} longitude
 */
export function sunTimes(dayOfYear, latitude, longitude) {
  const declination = solarDeclination(dayOfYear);
  const noon = solarNoon(dayOfYear, longitude);

  // Standard sunrise: geometric centre 0.833° below the horizon, allowing for
  // refraction and the sun's radius.
  const cosHourAngle =
    (Math.cos(90.833 * DEG) - Math.sin(latitude * DEG) * Math.sin(declination * DEG)) /
    (Math.cos(latitude * DEG) * Math.cos(declination * DEG));

  if (cosHourAngle > 1) return { sunrise: null, sunset: null, dayLength: 0, solarNoon: noon };
  if (cosHourAngle < -1) return { sunrise: 0, sunset: 24, dayLength: 24, solarNoon: noon };

  const hourAngle = Math.acos(cosHourAngle) / DEG;
  const halfDay = hourAngle / 15;

  return {
    sunrise: noon - halfDay,
    sunset: noon + halfDay,
    dayLength: halfDay * 2,
    solarNoon: noon,
  };
}

/**
 * Sun elevation above the horizon, in degrees.
 *
 * @param {number} hour - decimal hours AEST
 */
export function solarElevation(hour, dayOfYear, latitude, longitude) {
  const declination = solarDeclination(dayOfYear) * DEG;
  const lat = latitude * DEG;
  // 15° of rotation per hour either side of solar noon.
  const hourAngle = (hour - solarNoon(dayOfYear, longitude)) * 15 * DEG;

  const sinElevation =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);

  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / DEG;
}

/**
 * Sun azimuth in degrees clockwise from north.
 *
 * Needed because a west-facing roof does not simply make less energy — it
 * makes it later in the day, which is the entire argument for west-facing
 * panels on a time-of-use tariff.
 */
export function solarAzimuth(hour, dayOfYear, latitude, longitude) {
  const declination = solarDeclination(dayOfYear) * DEG;
  const lat = latitude * DEG;
  const hourAngle = (hour - solarNoon(dayOfYear, longitude)) * 15 * DEG;
  const elevation = solarElevation(hour, dayOfYear, latitude, longitude) * DEG;

  const cosAzimuth =
    (Math.sin(declination) - Math.sin(elevation) * Math.sin(lat)) /
    (Math.cos(elevation) * Math.cos(lat) || 1e-9);

  const azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) / DEG;
  // Before solar noon the sun is east of the meridian.
  return hourAngle < 0 ? azimuth : 360 - azimuth;
}

/* ------------------------------------------------------------------ *
 * Panel-plane response
 * ------------------------------------------------------------------ */

/**
 * Relative irradiance reaching a tilted panel, as an unscaled shape value.
 *
 * Two effects are combined:
 *
 *   Air mass — near the horizon sunlight crosses far more atmosphere, so
 *   early and late sun is weaker than elevation alone suggests.
 *
 *   Incidence angle — output follows the cosine of the angle between the sun
 *   and the panel normal. This is what tips a west-facing array's production
 *   into the afternoon.
 */
function planeOfArrayResponse(elevation, azimuth, tiltDegrees, panelAzimuth) {
  if (elevation <= GENERATION_MODEL.minElevationDegrees) return 0;

  // Kasten-Young air mass, simplified; ~1 overhead, ~5 near the horizon.
  const airMass = 1 / Math.max(Math.sin(elevation * DEG), 0.05);
  const atmosphere = 0.7 ** (airMass ** GENERATION_MODEL.airMassExponent);

  const tilt = tiltDegrees * DEG;
  const el = elevation * DEG;
  const azimuthDelta = (azimuth - panelAzimuth) * DEG;

  // Cosine of the angle of incidence on a tilted, oriented plane.
  const cosIncidence =
    Math.sin(el) * Math.cos(tilt) + Math.cos(el) * Math.sin(tilt) * Math.cos(azimuthDelta);

  // Diffuse light arrives from the whole sky, so a panel keeps producing even
  // when the direct beam is behind it — an isotropic diffuse share prevents
  // the model claiming zero output on a south roof at midday.
  const diffuse = 0.12 * Math.sin(el);
  const direct = Math.max(0, cosIncidence) * atmosphere;

  return Math.max(0, direct + diffuse);
}

/** Panel azimuth in degrees clockwise from north for a compass code. */
const COMPASS_AZIMUTH = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  Flat: 0,
};

export function orientationAzimuth(orientation) {
  return COMPASS_AZIMUTH[orientation] ?? 0;
}

/* ------------------------------------------------------------------ *
 * Temperature
 * ------------------------------------------------------------------ */

/**
 * Temperature derate for a day of the year, normalised to average 1.0.
 *
 * Rather than pull in a climate dataset, cell temperature is swung sinusoidally
 * between a summer and a winter figure. The effect is real but second-order —
 * about 8% between January and July — so a smooth seasonal shape is enough,
 * and every parameter above is nameable and auditable.
 *
 * The normalisation matters. Stage 1's derateFactor already counts temperature
 * losses in its whole-of-system figure, so applying an absolute temperature
 * derate here as well would charge for them twice and quietly drop annual
 * output by about 4%. What Stage 1 cannot express is *when* those losses fall,
 * and that is exactly what interval matching needs: dividing through by the
 * annual mean keeps the yearly total in agreement with Stage 1 while still
 * moving output from January into July.
 */
export function temperatureFactor(dayOfYear, latitude) {
  const { summerCellTemp, winterCellTemp, referenceTemp, coefficientPerDegree } =
    GENERATION_MODEL.temperature;

  // Peak heat mid-January in the southern hemisphere, mid-July in the north.
  const phase = latitude < 0 ? 15 : 197;
  const seasonal = Math.cos(DEG * ((360 / 365) * (dayOfYear - phase)));

  const mid = (summerCellTemp + winterCellTemp) / 2;
  const swing = (summerCellTemp - winterCellTemp) / 2;
  const cellTemp = mid + swing * seasonal;

  const raw = 1 + coefficientPerDegree * (cellTemp - referenceTemp);
  // The cosine averages to zero over a year, so the mean factor is the one at
  // the midpoint temperature.
  const annualMean = 1 + coefficientPerDegree * (mid - referenceTemp);

  return raw / annualMean;
}

/* ------------------------------------------------------------------ *
 * Daily peak sun hours
 * ------------------------------------------------------------------ */

/**
 * Peak sun hours for a specific date, interpolated from the monthly table.
 *
 * Stepping between months would put a visible discontinuity on the 1st of
 * every month in the daily charts, so months are interpolated smoothly around
 * their midpoints.
 */
export function dailyPsh(date, solarData) {
  const monthly = solarData?.psh;
  const annual = solarData?.annual ?? 4.5;
  if (!monthly) return annual;

  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const daysThisMonth = DAYS_IN_MONTH[month];
  const midpoint = daysThisMonth / 2;

  // Blend towards the neighbouring month once past its midpoint.
  const towardsNext = day >= midpoint;
  const neighbour = towardsNext ? (month + 1) % 12 : (month + 11) % 12;
  const span = towardsNext
    ? DAYS_IN_MONTH[month] / 2 + DAYS_IN_MONTH[neighbour] / 2
    : DAYS_IN_MONTH[neighbour] / 2 + DAYS_IN_MONTH[month] / 2;

  const distance = Math.abs(day - midpoint);
  const weight = Math.min(0.5, distance / span);

  const here = monthly[MONTH_KEYS[month]] ?? annual;
  const there = monthly[MONTH_KEYS[neighbour]] ?? annual;

  return here * (1 - weight) + there * weight;
}

/* ------------------------------------------------------------------ *
 * Profile generation
 * ------------------------------------------------------------------ */

/**
 * Half-hourly generation for every date in a range.
 *
 * @param {object} options
 * @param {number} options.systemKw
 * @param {object} options.solarData   irradiance entry (psh, annual, lat, lng)
 * @param {number} options.derate      effective derate — already includes
 *                                     orientation, pitch and shading factors
 * @param {object} [options.roofData]  orientation and pitch, for curve shape
 * @param {string} options.startDate   'YYYY-MM-DD' inclusive
 * @param {string} options.endDate     'YYYY-MM-DD' inclusive
 * @param {number} [options.inverterKw] AC cap; defaults to systemKw / 1.33
 * @returns {{
 *   byDate: Map<string, number[]>,
 *   totalKwh: number,
 *   days: number,
 *   inverterKw: number,
 *   clippedKwh: number,
 * }}
 */
export function generateSolarProfile({
  systemKw,
  solarData,
  derate,
  roofData = {},
  startDate,
  endDate,
  inverterKw,
}) {
  const latitude = solarData?.lat ?? -34.93;
  const longitude = solarData?.lng ?? 138.6;
  const tilt = roofData.pitchDegrees ?? DEFAULTS.roofDefaults.pitchDegrees;
  const panelAzimuth = orientationAzimuth(
    roofData.orientation ?? DEFAULTS.roofDefaults.orientation
  );

  const acCap = inverterKw ?? systemKw / GENERATION_MODEL.dcToAcRatio;
  // Energy ceiling for one half-hour interval.
  const intervalCap = acCap / 2;

  const byDate = new Map();
  let totalKwh = 0;
  let clippedKwh = 0;
  let days = 0;

  const cursor = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(`${endDate}T00:00:00Z`);

  for (let guard = 0; cursor <= last && guard < 1200; guard++) {
    const key = cursor.toISOString().slice(0, 10);
    const { intervals, clipped } = generateDay({
      date: cursor,
      systemKw,
      solarData,
      derate,
      latitude,
      longitude,
      tilt,
      panelAzimuth,
      intervalCap,
    });

    byDate.set(key, intervals);
    totalKwh += intervals.reduce((a, b) => a + b, 0);
    clippedKwh += clipped;
    days++;

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    byDate,
    totalKwh: Math.round(totalKwh),
    days,
    inverterKw: Math.round(acCap * 10) / 10,
    clippedKwh: Math.round(clippedKwh),
  };
}

/**
 * One day's 48 values, in kWh per interval.
 *
 * The shape comes from the sun's position; the total comes from the PSH table.
 * Clipping is applied after scaling, so energy lost to an undersized inverter
 * is genuinely lost rather than redistributed.
 */
function generateDay({
  date,
  systemKw,
  solarData,
  derate,
  latitude,
  longitude,
  tilt,
  panelAzimuth,
  intervalCap,
}) {
  const dayOfYear = dayOfYearFor(date);
  const intervals = new Array(48).fill(0);

  // Shape first, unscaled.
  const shape = new Array(48).fill(0);
  let shapeSum = 0;

  for (let slot = 0; slot < 48; slot++) {
    // Sample the middle of the interval — the average over the half hour is
    // closer to its midpoint value than to either edge.
    const hour = slot * 0.5 + 0.25;
    const elevation = solarElevation(hour, dayOfYear, latitude, longitude);
    if (elevation <= GENERATION_MODEL.minElevationDegrees) continue;

    const azimuth = solarAzimuth(hour, dayOfYear, latitude, longitude);
    const response = planeOfArrayResponse(elevation, azimuth, tilt, panelAzimuth);
    shape[slot] = response;
    shapeSum += response;
  }

  if (shapeSum <= 0) return { intervals, clipped: 0 };

  /**
   * The day's DC energy. PSH is measured on the horizontal plane and the
   * orientation and pitch factors inside `derate` already convert that to what
   * this roof actually receives, so the shape must not apply them a second
   * time — it only decides *when* the energy arrives, never how much.
   */
  const psh = dailyPsh(date, solarData);
  const dayEnergy = systemKw * psh * derate * temperatureFactor(dayOfYear, latitude);

  let clipped = 0;
  for (let slot = 0; slot < 48; slot++) {
    if (shape[slot] <= 0) continue;
    const raw = (shape[slot] / shapeSum) * dayEnergy;
    const capped = Math.min(raw, intervalCap);
    clipped += raw - capped;
    intervals[slot] = Math.round(capped * 1000) / 1000;
  }

  return { intervals, clipped };
}

/** 1–366. */
export function dayOfYearFor(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86400000) + 1;
}

/**
 * A representative 365-day profile keyed by month and day, for use when there
 * is no meter data to align to.
 *
 * @returns {{byDate: Map<string, number[]>, totalKwh: number}}
 */
export function generateTypicalYear({ systemKw, solarData, derate, roofData, year = 2025 }) {
  return generateSolarProfile({
    systemKw,
    solarData,
    derate,
    roofData,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  });
}

/**
 * Average generation per half-hour slot across a set of dates.
 * @param {Map<string, number[]>} byDate
 * @param {(date: string) => boolean} [filter]
 */
export function averageProfile(byDate, filter = () => true) {
  const out = new Array(48).fill(0);
  let count = 0;

  for (const [date, intervals] of byDate) {
    if (!filter(date)) continue;
    for (let i = 0; i < 48; i++) out[i] += intervals[i] ?? 0;
    count++;
  }

  return count === 0 ? out : out.map((v) => v / count);
}

/** Local AEST offset, exported so callers don't rediscover it. */
export { AEST_OFFSET_HOURS };
