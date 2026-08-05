/**
 * Half-hourly matching of load against solar, with battery dispatch.
 *
 * This is the module that makes Stage 2 worth the upload. Stage 1 has to
 * assume a self-consumption ratio because a bill only gives totals; here every
 * half hour of the year is walked, comparing what the meter recorded against
 * what the modelled array would have produced at that moment. The result is
 * measured rather than assumed — a household that runs the dishwasher at
 * midday and one that runs it at midnight get genuinely different answers.
 *
 * Energy is tracked as five flows so nothing is double-counted:
 *
 *   solar → load        used the instant it is generated
 *   solar → battery     stored for later (round-trip losses apply)
 *   solar → grid        exported
 *   battery → load      returned later, displacing a grid purchase
 *   grid → load         bought
 */
import { DEFAULTS } from '../config/defaults.js';
import { calculateProduction } from './calculationEngine.js';
import { detectSetupChange, splitAtChange } from './existingSystemEstimate.js';
import { generateSolarProfile } from './solarGenerationModel.js';

export const BATTERY_MODEL = {
  /**
   * Charge and discharge power as a fraction of capacity. C/2 is typical for
   * a home battery: a 13.5 kWh Powerwall moves about 5 kW, near enough to
   * C/2.5, and Sungrow and BYD stacks sit close to C/2.
   */
  chargeRateC: 0.5,
  dischargeRateC: 0.5,

  /**
   * Round-trip efficiency, split evenly between charging and discharging so
   * that losses land on the right side of the meter in each direction.
   */
  roundTripEfficiency: DEFAULTS.selfConsumptionModel.roundTripEfficiency,

  /**
   * Reserve held back for backup and cell health. Manufacturers quote usable
   * capacity, so this is deliberately small — it is the extra margin most
   * installers configure, not the full depth-of-discharge allowance.
   */
  reserveFraction: 0.05,
};

/* ------------------------------------------------------------------ *
 * Load reconstruction
 * ------------------------------------------------------------------ */

/**
 * Recover the site's actual consumption from what the meter recorded.
 *
 * E1 is grid *import*, not load. On a site with no solar the two are the same
 * thing, but on a site that already has panels the meter never sees the solar
 * the house consumed as it was generated — that energy simply never crosses
 * the boundary. Modelling a new system against raw E1 would treat that hidden
 * load as if it did not exist and understate the benefit.
 *
 * So where a B1 channel exists, the existing array's output is modelled and
 * whatever it produced but did not export is added back:
 *
 *   load = import + max(0, existingGeneration - export)
 *
 * This is an estimate stacked on an estimate, and it is flagged as such. With
 * no existing solar, load is exactly what the meter recorded.
 *
 * @returns {{byDate: Map<string, number[]>, reconstructed: boolean, addedKwh: number, note: string|null}}
 */
export function buildLoadProfile({ meterData, solarData, roofData, existingSolarKw }) {
  const importChannel = meterData.channels.E1;
  const exportChannel = meterData.channels.B1;
  const byDate = new Map();

  const hasExistingSolar = Boolean(exportChannel) && existingSolarKw > 0;

  if (!hasExistingSolar) {
    for (const day of importChannel.data) byDate.set(day.date, [...day.intervals]);
    return {
      byDate,
      reconstructed: false,
      addedKwh: 0,
      note: null,
    };
  }

  const existing = generateSolarProfile({
    systemKw: existingSolarKw,
    solarData,
    derate: DEFAULTS.derateFactor,
    roofData,
    startDate: meterData.summary.dateRange.start,
    endDate: meterData.summary.dateRange.end,
  });

  const exportByDate = new Map(exportChannel.data.map((d) => [d.date, d]));
  let addedKwh = 0;

  for (const day of importChannel.data) {
    const exportDay = exportByDate.get(day.date);
    // Near-zero export usually means no array output that day — common in the
    // install-month lead-in before panels switch on. Reconstructing against
    // modelled generation on those days invents phantom load and battery
    // throughput, so leave the meter import as the load.
    if ((exportDay?.total ?? 0) < 0.5) {
      byDate.set(day.date, [...day.intervals]);
      continue;
    }

    const generated = existing.byDate.get(day.date) ?? [];
    const exported = exportDay.intervals;
    const load = new Array(48);

    for (let i = 0; i < 48; i++) {
      // Generation the existing array made but did not send to the grid must
      // have been consumed on site.
      const selfUsed = Math.max(0, (generated[i] ?? 0) - (exported[i] ?? 0));
      load[i] = round3((day.intervals[i] ?? 0) + selfUsed);
      addedKwh += selfUsed;
    }

    byDate.set(day.date, load);
  }

  return {
    byDate,
    reconstructed: true,
    addedKwh: Math.round(addedKwh),
    note:
      `Your meter only records power bought from the grid, so the solar your existing ` +
      `${round1(existingSolarKw)} kW system supplied directly never appears on it. We've modelled that ` +
      `hidden usage and added it back — about ${Math.round(addedKwh).toLocaleString('en-AU')} kWh over the period.`,
  };
}

/* ------------------------------------------------------------------ *
 * The simulation
 * ------------------------------------------------------------------ */

/**
 * Walk every half hour, matching load against generation.
 *
 * @param {object} options
 * @param {Map<string, number[]>} options.loadByDate
 * @param {Map<string, number[]>} options.generationByDate
 * @param {number} [options.batteryKwh]
 * @param {object} [options.tariff] from buildTariffModel; prices each interval
 * @param {number} [options.feedInCents]
 * @returns {object} annual, monthly, daily and averaged profiles
 */
export function simulate({
  loadByDate,
  generationByDate,
  batteryKwh = 0,
  tariff = null,
  feedInCents = 0,
}) {
  const capacity = Math.max(0, batteryKwh);
  const usableFloor = capacity * BATTERY_MODEL.reserveFraction;
  // Power limits expressed as energy within one half-hour interval.
  const chargeLimit = (capacity * BATTERY_MODEL.chargeRateC) / 2;
  const dischargeLimit = (capacity * BATTERY_MODEL.dischargeRateC) / 2;
  // Losses are split so each direction carries its share.
  const oneWayEfficiency = Math.sqrt(BATTERY_MODEL.roundTripEfficiency);

  let charge = usableFloor;

  const annual = emptyTotals();
  const monthly = new Map();
  const daily = [];

  // 48-slot accumulators, summed then divided at the end.
  const buckets = {
    all: emptyProfile(),
    weekday: emptyProfile(),
    weekend: emptyProfile(),
    summer: emptyProfile(),
    winter: emptyProfile(),
  };
  const bucketDays = { all: 0, weekday: 0, weekend: 0, summer: 0, winter: 0 };

  // month (0-11) x hour (0-23) mean consumption, for the heatmap.
  const heatSum = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const heatDays = Array.from({ length: 12 }, () => new Array(24).fill(0));

  const socByDate = new Map();

  for (const [date, load] of loadByDate) {
    const generation = generationByDate.get(date);
    if (!generation) continue;

    const when = new Date(`${date}T00:00:00Z`);
    const month = when.getUTCMonth();
    const weekday = when.getUTCDay() !== 0 && when.getUTCDay() !== 6;
    const season = seasonOf(month);

    const dayTotals = emptyTotals();
    const soc = new Array(48).fill(0);

    for (let slot = 0; slot < 48; slot++) {
      const consumed = load[slot] ?? 0;
      const produced = generation[slot] ?? 0;

      let solarToLoad = 0;
      let solarToBattery = 0;
      let solarToGrid = 0;
      let batteryToLoad = 0;
      let gridToLoad = 0;

      if (produced >= consumed) {
        solarToLoad = consumed;
        const surplus = produced - consumed;

        if (capacity > 0) {
          const headroom = capacity - charge;
          // What the battery can absorb this interval, before losses.
          const canStore = Math.min(headroom, chargeLimit);
          // Solar drawn to store it — more than lands in the cells.
          const drawn = Math.min(surplus, canStore / oneWayEfficiency);
          solarToBattery = drawn;
          charge += drawn * oneWayEfficiency;
        }

        solarToGrid = surplus - solarToBattery;
      } else {
        solarToLoad = produced;
        const deficit = consumed - produced;

        if (capacity > 0) {
          const available = Math.max(0, charge - usableFloor);
          // What can be delivered to the load, after losses.
          const deliverable = Math.min(available, dischargeLimit) * oneWayEfficiency;
          batteryToLoad = Math.min(deficit, deliverable);
          charge -= batteryToLoad / oneWayEfficiency;
        }

        gridToLoad = deficit - batteryToLoad;
      }

      soc[slot] = round3(charge);

      const rate = tariff ? tariff.rateFor(slot, when) : (tariff?.flatRateCents ?? 0);
      const period = tariff ? tariff.periodFor(slot, when) : 'flat';

      accumulate(dayTotals, {
        load: consumed,
        generation: produced,
        solarToLoad,
        solarToBattery,
        solarToGrid,
        batteryToLoad,
        gridToLoad,
        // What the grid energy cost, and what the export earned.
        gridCost: (gridToLoad * rate) / 100,
        exportRevenue: (solarToGrid * feedInCents) / 100,
        // Value of what solar and battery displaced, at the rate in force.
        displacedValue: ((solarToLoad + batteryToLoad) * rate) / 100,
        period,
      });

      // Averaged profiles.
      for (const key of ['all', weekday ? 'weekday' : 'weekend', season].filter(Boolean)) {
        const bucket = buckets[key];
        bucket.load[slot] += consumed;
        bucket.generation[slot] += produced;
        bucket.selfConsumed[slot] += solarToLoad;
        bucket.gridImport[slot] += gridToLoad;
        bucket.exported[slot] += solarToGrid;
        bucket.batteryToLoad[slot] += batteryToLoad;
        bucket.batteryCharge[slot] += solarToBattery;
        bucket.soc[slot] += charge;
      }

      const hour = Math.floor(slot / 2);
      heatSum[month][hour] += consumed;
    }

    for (let hour = 0; hour < 24; hour++) heatDays[month][hour] += 1;

    bucketDays.all++;
    bucketDays[weekday ? 'weekday' : 'weekend']++;
    if (season) bucketDays[season]++;

    socByDate.set(date, soc);
    mergeTotals(annual, dayTotals);

    const monthKey = date.slice(0, 7);
    if (!monthly.has(monthKey)) monthly.set(monthKey, { ...emptyTotals(), days: 0 });
    const monthTotals = monthly.get(monthKey);
    mergeTotals(monthTotals, dayTotals);
    monthTotals.days++;

    daily.push({ date, ...roundTotals(dayTotals) });
  }

  const days = daily.length;

  return {
    annual: finaliseTotals(annual, days, capacity),
    monthly: [...monthly.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, totals]) => ({
        month,
        days: totals.days,
        ...finaliseTotals(totals, totals.days, capacity),
      })),
    daily,
    hourlyAverage: {
      all: averageBucket(buckets.all, bucketDays.all),
      weekday: averageBucket(buckets.weekday, bucketDays.weekday),
      weekend: averageBucket(buckets.weekend, bucketDays.weekend),
      summer: averageBucket(buckets.summer, bucketDays.summer),
      winter: averageBucket(buckets.winter, bucketDays.winter),
    },
    heatmap: heatSum.map((row, month) =>
      row.map((value, hour) => (heatDays[month][hour] ? value / heatDays[month][hour] : 0))
    ),
    socByDate,
    days,
    batteryKwh: capacity,
  };
}

/* ------------------------------------------------------------------ *
 * Top-level analysis
 * ------------------------------------------------------------------ */

/**
 * Everything the Stage 2 results page needs for one system and battery size.
 *
 * Runs the simulation twice — with and without the battery — so the page can
 * state what the battery actually adds rather than quoting a rule of thumb.
 *
 * @param {object} options
 * @param {object} options.meterData     parsed NEM12
 * @param {object} options.solarData     irradiance entry
 * @param {object} options.roofData
 * @param {number} options.systemKw
 * @param {number} [options.batteryKwh]
 * @param {number} options.derate        effective derate from Stage 1
 * @param {object} [options.tariff]      from buildTariffModel
 * @param {number} [options.feedInCents]
 * @param {number} [options.existingSolarKw]
 */
export function analyseIntervals({
  meterData,
  solarData,
  roofData,
  systemKw,
  batteryKwh = 0,
  derate,
  tariff = null,
  feedInCents = 0,
  existingSolarKw = 0,
}) {
  // Mid-file installs poison every average if pre-solar months stay in the
  // mix. Detect the install month from B1 export, then analyse only the
  // post-install slice — charts, self-consumption, and the annualisation
  // factor all share that filtered window.
  const setupChange = detectSetupChange(meterData);
  const activeMeterData =
    setupChange?.detected ? splitAtChange(meterData, setupChange).post ?? meterData : meterData;

  const { start, end } = activeMeterData.summary.dateRange;
  const analysisDays = activeMeterData.summary.totalDays;
  const annualisationFactor = analysisDays > 0 ? 365 / analysisDays : 1;

  const loadProfile = buildLoadProfile({
    meterData: activeMeterData,
    solarData,
    roofData,
    existingSolarKw,
  });

  const generation = generateSolarProfile({
    systemKw,
    solarData,
    derate,
    roofData,
    startDate: start,
    endDate: end,
  });

  const shared = {
    loadByDate: loadProfile.byDate,
    generationByDate: generation.byDate,
    tariff,
    feedInCents,
  };

  const withBatteryRaw = simulate({ ...shared, batteryKwh });
  const withoutBatteryRaw =
    batteryKwh > 0 ? simulate({ ...shared, batteryKwh: 0 }) : withBatteryRaw;

  const assessingExisting =
    existingSolarKw > 0 &&
    Math.abs(systemKw - existingSolarKw) < 0.05 &&
    activeMeterData.channels.B1;

  // Full-year generation from the Stage 1 production model (kW × PSH × derate
  // × 365) — not the partial-year interval profile scaled up, which skews
  // when the post-install window is seasonally lopsided.
  const annualGenerationKwh = assessingExisting
    ? calculateProduction(systemKw, solarData, derate).annual
    : null;

  const withBattery = assessingExisting
    ? applyExistingSystemMeterTotals(withBatteryRaw, activeMeterData, {
        annualGenerationKwh,
        annualisationFactor,
      })
    : withBatteryRaw;
  const withoutBattery = assessingExisting
    ? applyExistingSystemMeterTotals(withoutBatteryRaw, activeMeterData, {
        annualGenerationKwh,
        annualisationFactor,
      })
    : withoutBatteryRaw;

  return {
    systemKw,
    batteryKwh,
    loadProfile,
    generation,
    withBattery,
    withoutBattery,
    // The one the page reads for headline figures.
    result: withBattery,
    setupChange,
    meterData: activeMeterData,
    installDate: setupChange?.changeDate ?? null,
    postInstallDays: setupChange?.detected ? analysisDays : null,
    // Meter data rarely covers exactly a year; savings are always annualised
    // from the post-install window — never the full pre-filter span.
    annualisationFactor,
  };
}

/**
 * Existing-system headline totals from post-install meter readings + the
 * full-year generation model.
 *
 *   annual export/import  = post-install B1/E1 × (365 / days)
 *   annual generation     = systemKw × PSH × derate × 365
 *   self-consumed         = generation − export
 *   true consumption      = import + self-consumed
 *
 * Period values are stored so the UI's existing `× annualisationFactor`
 * recovers those annual figures. Battery cycles are not reverse-engineered
 * from E1/B1 — with a battery on site, export is only what escaped after
 * the battery was full.
 */
function applyExistingSystemMeterTotals(result, meterData, { annualGenerationKwh, annualisationFactor }) {
  const days = meterData.summary.totalDays || 0;
  const factor = annualisationFactor || (days > 0 ? 365 / days : 1);

  const exportPeriod = meterData.summary.totalExportKwh ?? 0;
  const importPeriod = meterData.summary.totalImportKwh ?? 0;

  const annualExport = exportPeriod * factor;
  const annualImport = importPeriod * factor;
  const annualGen = Math.max(0, annualGenerationKwh ?? 0);
  const annualSelf = Math.max(0, annualGen - annualExport);
  const annualLoad = annualImport + annualSelf;

  return {
    ...result,
    days,
    annual: {
      ...result.annual,
      days,
      // Divide by factor so Stage 2's `value * annualisationFactor` recovers annual.
      totalSolarGeneration: round1(factor > 0 ? annualGen / factor : 0),
      exported: round1(exportPeriod),
      gridImport: round1(importPeriod),
      selfConsumed: round1(factor > 0 ? annualSelf / factor : 0),
      displacedGridKwh: round1(factor > 0 ? annualSelf / factor : 0),
      totalLoad: round1(factor > 0 ? annualLoad / factor : 0),
      selfConsumptionRatio: annualGen > 0 ? annualSelf / annualGen : 0,
      gridDependenceRatio: annualLoad > 0 ? annualImport / annualLoad : 0,
      solarCoverageRatio: annualLoad > 0 ? annualSelf / annualLoad : 0,
      // Not calculable from boundary meter data alone once a battery is on site.
      batteryCycles: 0,
      batteryCyclesPerYear: 0,
    },
  };
}

/**
 * Scale a period's totals to a full year.
 *
 * Nine months of data must not be reported as an annual saving. Seasonality
 * makes this imperfect when the coverage is short and lopsided — a summer-only
 * file scaled up overstates the year — so the caller is told how much of a
 * year the data actually covered and the UI says so.
 */
export function annualise(value, days) {
  if (!days) return 0;
  return (value * 365) / days;
}

/* ------------------------------------------------------------------ *
 * Totals plumbing
 * ------------------------------------------------------------------ */

function emptyTotals() {
  return {
    load: 0,
    generation: 0,
    solarToLoad: 0,
    solarToBattery: 0,
    solarToGrid: 0,
    batteryToLoad: 0,
    gridToLoad: 0,
    gridCost: 0,
    exportRevenue: 0,
    displacedValue: 0,
    byPeriod: { peak: 0, shoulder: 0, offPeak: 0, flat: 0 },
    gridByPeriod: { peak: 0, shoulder: 0, offPeak: 0, flat: 0 },
  };
}

function emptyProfile() {
  return {
    load: new Array(48).fill(0),
    generation: new Array(48).fill(0),
    selfConsumed: new Array(48).fill(0),
    gridImport: new Array(48).fill(0),
    exported: new Array(48).fill(0),
    batteryToLoad: new Array(48).fill(0),
    batteryCharge: new Array(48).fill(0),
    soc: new Array(48).fill(0),
  };
}

function accumulate(totals, entry) {
  totals.load += entry.load;
  totals.generation += entry.generation;
  totals.solarToLoad += entry.solarToLoad;
  totals.solarToBattery += entry.solarToBattery;
  totals.solarToGrid += entry.solarToGrid;
  totals.batteryToLoad += entry.batteryToLoad;
  totals.gridToLoad += entry.gridToLoad;
  totals.gridCost += entry.gridCost;
  totals.exportRevenue += entry.exportRevenue;
  totals.displacedValue += entry.displacedValue;
  totals.byPeriod[entry.period] = (totals.byPeriod[entry.period] ?? 0) + entry.load;
  totals.gridByPeriod[entry.period] = (totals.gridByPeriod[entry.period] ?? 0) + entry.gridToLoad;
}

function mergeTotals(target, source) {
  for (const key of Object.keys(source)) {
    if (key === 'byPeriod' || key === 'gridByPeriod') {
      for (const period of Object.keys(source[key])) {
        target[key][period] = (target[key][period] ?? 0) + source[key][period];
      }
    } else if (typeof source[key] === 'number') {
      target[key] = (target[key] ?? 0) + source[key];
    }
  }
}

function roundTotals(totals) {
  return {
    load: round2(totals.load),
    generation: round2(totals.generation),
    selfConsumed: round2(totals.solarToLoad + totals.batteryToLoad),
    solarToLoad: round2(totals.solarToLoad),
    batteryToLoad: round2(totals.batteryToLoad),
    exported: round2(totals.solarToGrid),
    gridImport: round2(totals.gridToLoad),
  };
}

/**
 * Turn raw sums into the figures the page quotes.
 *
 * Two different senses of "self-consumption" matter and are named apart:
 *
 *   selfConsumptionRatio — the share of generation not exported. This is the
 *   industry definition and the one to compare against a datasheet.
 *
 *   displacedGridKwh — energy that actually replaced a grid purchase. It is
 *   smaller, because what goes through the battery comes back about 10% down
 *   on what went in. Savings are calculated from this one; using the ratio
 *   instead would quietly bill the customer's round-trip losses as savings.
 */
function finaliseTotals(totals, days, capacity) {
  const generation = totals.generation;
  const exported = totals.solarToGrid;
  const displaced = totals.solarToLoad + totals.batteryToLoad;

  const batteryLosses = totals.solarToBattery - totals.batteryToLoad;
  // Full-equivalent cycles: total throughput divided by usable capacity.
  const cycles = capacity > 0 ? totals.batteryToLoad / capacity : 0;

  return {
    days,
    totalLoad: round1(totals.load),
    totalSolarGeneration: round1(generation),
    selfConsumed: round1(displaced),
    displacedGridKwh: round1(displaced),
    exported: round1(exported),
    gridImport: round1(totals.gridToLoad),
    solarToLoad: round1(totals.solarToLoad),
    solarToBattery: round1(totals.solarToBattery),
    batteryToLoad: round1(totals.batteryToLoad),
    batteryLosses: round1(batteryLosses),
    selfConsumptionRatio: generation > 0 ? (generation - exported) / generation : 0,
    solarCoverageRatio: totals.load > 0 ? displaced / totals.load : 0,
    gridDependenceRatio: totals.load > 0 ? totals.gridToLoad / totals.load : 0,
    batteryCycles: Math.round(cycles),
    batteryCyclesPerYear: days > 0 ? Math.round((cycles * 365) / days) : 0,
    gridCost: round2(totals.gridCost),
    exportRevenue: round2(totals.exportRevenue),
    displacedValue: round2(totals.displacedValue),
    loadByPeriod: mapValues(totals.byPeriod, round1),
    gridByPeriod: mapValues(totals.gridByPeriod, round1),
  };
}

function averageBucket(bucket, days) {
  if (!days) return bucket;
  const out = {};
  for (const [key, values] of Object.entries(bucket)) {
    out[key] = values.map((v) => round3(v / days));
  }
  return out;
}

/** Southern-hemisphere meteorological seasons, collapsed to the two extremes. */
function seasonOf(month) {
  if (month === 11 || month === 0 || month === 1) return 'summer';
  if (month >= 5 && month <= 7) return 'winter';
  return null;
}

function mapValues(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fn(v)]));
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

/* ------------------------------------------------------------------ *
 * Readable observations
 * ------------------------------------------------------------------ */

/**
 * The plain-English observations the results page leads with.
 *
 * Everything here is derived from the customer's own data — the point of
 * Stage 2 is to tell them something about their house they didn't know.
 */
export function describeUsage(analysis, meterData) {
  const profile = analysis.result.hourlyAverage.all;
  const load = profile.load;

  const peakSlot = load.indexOf(Math.max(...load));
  const daytime = sumSlots(load, 16, 36); // 8am–6pm
  const evening = sumSlots(load, 34, 46); // 5pm–11pm
  const overnight = sumSlots(load, 0, 12) + sumSlots(load, 44, 48);
  const total = load.reduce((a, b) => a + b, 0) || 1;

  // The heaviest contiguous six-hour block.
  let bestStart = 0;
  let bestSum = -1;
  for (let start = 0; start < 48; start++) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += load[(start + i) % 48];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }

  const weekdayTotal = analysis.result.hourlyAverage.weekday.load.reduce((a, b) => a + b, 0);
  const weekendTotal = analysis.result.hourlyAverage.weekend.load.reduce((a, b) => a + b, 0);

  return {
    peakSlot,
    heaviestWindow: { startSlot: bestStart, endSlot: (bestStart + 12) % 48 },
    daytimeShare: daytime / total,
    eveningShare: evening / total,
    overnightShare: overnight / total,
    weekdayDailyKwh: round1(weekdayTotal),
    weekendDailyKwh: round1(weekendTotal),
    // Under 5% apart is not a pattern worth remarking on.
    weekendDiffers: Math.abs(weekendTotal - weekdayTotal) / (weekdayTotal || 1) > 0.05,
    weekendHigher: weekendTotal > weekdayTotal,
    peakDemandKw: meterData.summary.peakDemandKw,
    peakDemandAt: meterData.summary.peakDemandAt,
    /**
     * Daytime-heavy homes suit solar without a battery; evening-heavy ones are
     * where a battery earns its price. Saying which one they are is the single
     * most useful sentence on the page.
     */
    shape:
      daytime / total > 0.42 ? 'daytime' : evening / total > 0.32 ? 'evening' : 'balanced',
  };
}

function sumSlots(values, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i] ?? 0;
  return sum;
}
