/**
 * Sizing, production and savings.
 *
 * All figures are estimates presented as ranges. The modelling is deliberately
 * transparent: every factor is a named constant in config/defaults.js so an
 * engineer can audit or override it.
 */
import { DEFAULTS, getDefaultFiT, getMode } from '../config/defaults.js';
import { DAYS_IN_MONTH, MONTH_KEYS } from '../utils/formatters.js';

/* ------------------------------------------------------------------ *
 * Derating factors
 * ------------------------------------------------------------------ */

/** Yield multiplier for a roof orientation (southern hemisphere). */
export function getOrientationFactor(orientation) {
  if (!orientation) return DEFAULTS.orientationFactors.N;
  return DEFAULTS.orientationFactors[orientation] ?? DEFAULTS.orientationFactors.N;
}

/**
 * Yield multiplier for roof pitch.
 *
 * Optimal tilt in Australia is roughly 0.9 x latitude — about 31° for
 * Adelaide. Output falls away gently either side, so a quadratic penalty on
 * the deviation matches measured behaviour closely enough for an estimate and
 * never punishes a normal 15–35° roof much.
 */
export function getPitchFactor(pitchDegrees, latitude = -34.93) {
  if (pitchDegrees == null) return 1;
  const optimal = Math.abs(latitude) * 0.9;
  const deviation = Math.abs(pitchDegrees - optimal);
  return clamp(1 - 0.00015 * deviation ** 2, 0.75, 1);
}

export function getShadingFactor(shading) {
  return DEFAULTS.shadingFactors[shading] ?? 1;
}

/**
 * Combined derate: base system losses x orientation x pitch x shading.
 */
export function effectiveDerate(roof = {}, latitude = -34.93) {
  return (
    DEFAULTS.derateFactor *
    getOrientationFactor(roof.orientation ?? DEFAULTS.roofDefaults.orientation) *
    getPitchFactor(roof.pitchDegrees ?? DEFAULTS.roofDefaults.pitchDegrees, latitude) *
    getShadingFactor(roof.shading ?? DEFAULTS.roofDefaults.shading)
  );
}

/* ------------------------------------------------------------------ *
 * Sizing
 * ------------------------------------------------------------------ */

/**
 * System size that would generate roughly the customer's annual consumption.
 *
 * @param {object} billData
 * @param {object} solarData - irradiance entry for the location
 * @param {object} roofData
 */
export function calculateSystemSize(billData, solarData, roofData = {}, mode = 'home') {
  const dailyConsumption = resolveDailyConsumption(billData);
  if (!dailyConsumption || !solarData?.annual) return null;

  const modeConfig = getMode(mode);
  const annualConsumption = dailyConsumption * 365;
  const peakSunHours = solarData.annual;
  // Whole-of-system performance ratio: base derate × roof factors.
  const performanceRatio = effectiveDerate(roofData, solarData.lat);

  // systemSize = annualLoad / (peakSunHours × 365 × performanceRatio)
  // Equivalent daily form: dailyLoad / (peakSunHours × performanceRatio).
  const requiredKw = annualConsumption / (peakSunHours * 365 * performanceRatio);
  const coverageKw = clamp(
    round1(requiredKw),
    DEFAULTS.sizing.minKw,
    modeConfig.slider.maxKw
  );

  // A mathematically correct 1.5 kW recommendation is useless advice — see the
  // note on practicalMinimumKw in defaults.js.
  const recommendedKw = clamp(
    Math.max(coverageKw, modeConfig.practicalMinimumKw),
    DEFAULTS.sizing.minKw,
    modeConfig.slider.maxKw
  );

  const panelCount = panelsFor(recommendedKw);

  if (import.meta.env?.DEV) {
    console.log('[WattShift sizing]', {
      annualLoad_kWh: Math.round(annualConsumption),
      dailyLoad_kWh: Number(dailyConsumption.toFixed(3)),
      peakSunHours,
      performanceRatio: Number(performanceRatio.toFixed(4)),
      baseDerateFactor: DEFAULTS.derateFactor,
      systemSize_kW: recommendedKw,
      coverageKw,
      uncappedKw: round1(requiredKw),
      panelCount,
      wattsPerPanel: DEFAULTS.sizing.wattsPerPanel,
    });
  }

  return {
    coverageKw,
    practicalFloorApplied: recommendedKw > coverageKw,
    // Not rounded to "standard" sizes — the honest number is more useful.
    recommendedKw,
    uncappedKw: round1(requiredKw),
    cappedByLimit: round1(requiredKw) > modeConfig.slider.maxKw,
    dailyConsumption,
    annualConsumption,
    effectiveDerate: performanceRatio,
    panelCount,
    roofAreaNeededM2: roofAreaFor(recommendedKw),
    /**
     * For a site that already has solar, the bill's kWh figure is what it
     * still buys from the grid — the existing system's self-consumed output
     * never appears on it. So the size derived above *is* the extra capacity
     * needed; subtracting the existing system from it would double-count the
     * generation that has already been netted off.
     */
    additionalKwNeeded: billData.existingSolarSizeKw != null ? recommendedKw : null,
  };
}

/** Panels needed for a system size, at the default panel wattage. */
export function panelsFor(systemKw) {
  if (!(systemKw > 0)) return 0;
  return Math.ceil(systemKw / (DEFAULTS.sizing.wattsPerPanel / 1000));
}

/** Roof area those panels occupy, m². */
export function roofAreaFor(systemKw) {
  return Math.round(panelsFor(systemKw) * DEFAULTS.sizing.m2PerPanel);
}

/** Daily consumption from whichever fields the bill gave us. */
export function resolveDailyConsumption(billData) {
  if (billData?.dailyAverageKwh > 0) return billData.dailyAverageKwh;
  if (billData?.totalKwh > 0 && billData?.billingDays > 0) {
    return billData.totalKwh / billData.billingDays;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Production
 * ------------------------------------------------------------------ */

/**
 * Monthly and annual generation for a system size.
 * @param {number} systemKw
 * @param {object} solarData - must carry `psh` monthly values
 * @param {number} derate
 */
export function calculateProduction(systemKw, solarData, derate) {
  const monthly = {};
  let annual = 0;

  MONTH_KEYS.forEach((month, i) => {
    const psh = solarData?.psh?.[month] ?? solarData?.annual ?? 0;
    const production = systemKw * psh * derate * DAYS_IN_MONTH[i];
    monthly[month] = Math.round(production);
    annual += production;
  });

  return { monthly, annual: Math.round(annual) };
}

/* ------------------------------------------------------------------ *
 * Self-consumption
 * ------------------------------------------------------------------ */

/**
 * Share of generation used on site rather than exported.
 *
 * Driven by battery capacity *relative to daily solar production*. That
 * relationship is the whole model: a 10 kWh battery covers most of a 6.6 kW
 * system's daily export and barely registers against a 500 kW system's. An
 * earlier version keyed the ratio off capacity alone, which made every large
 * battery on a big system report an identical figure.
 *
 * @param {number} batteryKwh - battery capacity in kWh (0 = none)
 * @param {number} systemKw - solar system size in kW
 * @param {number} annualPsh - annual average peak sun hours
 * @param {number} derate - effective system derate
 * @param {boolean} isCommercial
 * @param {number} annualConsumptionKwh - the site's own annual usage
 * @param {object} [options]
 * @param {number|null} [options.baseRatioOverride=null] - see below
 * @returns {number} self-consumption ratio
 */
export function calculateSelfConsumption(
  batteryKwh,
  systemKw,
  annualPsh,
  derate,
  isCommercial,
  annualConsumptionKwh,
  { baseRatioOverride = null } = {}
) {
  const model = DEFAULTS.selfConsumptionModel;
  const dailyProduction = systemKw * annualPsh * derate;
  const dailyConsumption = (annualConsumptionKwh ?? 0) / 365;

  /**
   * The base ratio falls as the system outgrows the load. A 30 kW array on a
   * 5 kWh/day house cannot self-consume 30% of what it makes — there is
   * nothing there to absorb it. An undersized system is not scaled up: at
   * best it self-consumes the full base share.
   */
  const productionToLoad = dailyProduction / Math.max(dailyConsumption, 0.1);
  const oversizingFactor =
    dailyConsumption > 0
      ? Math.min(1, 1 / Math.pow(Math.max(productionToLoad, 1), model.oversizingExponent))
      : // Consumption unknown: derating here would assume a wildly oversized
        // system and understate savings on no evidence. Leave the base alone.
        1;

  // Businesses run through the solar day, so they absorb far more of their
  // own generation before any battery is involved.
  const fullBaseRatio = isCommercial
    ? model.baseRatioCommercial
    : model.baseRatioHome;

  /**
   * Sizing a system that does not exist yet keeps the derived base above: it
   * holds an undersized array at the flat base share, a deliberately
   * conservative floor for a recommendation.
   *
   * A caller reporting on a system already on the roof knows better, and can
   * say so. estimateTrueConsumption extends the same power law below the
   * production = load crossover — a small array on a large load really does
   * get nearly all of its output absorbed on site — and reconstructs true
   * consumption from the result. Anything describing that same system has to
   * start from the identical figure or the two disagree on screen, so it is
   * passed in rather than re-derived: the reconstruction iterates to a fixed
   * point, and recomputing from its final load lands fractionally apart.
   *
   * Only the starting share is supplied. Battery capture below still runs on
   * the engine's own curve.
   */
  const baseRatio =
    baseRatioOverride != null
      ? clamp(baseRatioOverride, 0, model.maxSelfConsumption)
      : fullBaseRatio * oversizingFactor;

  if (!(batteryKwh > 0) || !(dailyProduction > 0)) return baseRatio;

  // Everything not used as it is generated would otherwise be exported.
  const dailyExport = dailyProduction * (1 - baseRatio);
  if (dailyExport <= 0) return baseRatio;

  const effectiveCapacity = batteryKwh * model.roundTripEfficiency;

  // The key metric: how much of a day's export the battery could hold.
  const batteryExportRatio = Math.min(
    effectiveCapacity / dailyExport,
    model.maxBatteryExportRatio
  );

  // Diminishing returns. A battery never captures export perfectly — it
  // arrives spread across the day rather than in one block, bursts can exceed
  // the charge rate, and the battery is rarely empty when charging starts.
  const k = isCommercial ? model.captureCurveKCommercial : model.captureCurveK;
  const captureEfficiency = 1 - Math.exp(-k * batteryExportRatio);

  const additionalSelfConsumption = (1 - baseRatio) * captureEfficiency;

  return Math.min(baseRatio + additionalSelfConsumption, model.maxSelfConsumption);
}

/* ------------------------------------------------------------------ *
 * Financials
 * ------------------------------------------------------------------ */

/**
 * Bill before and after, plus the savings band.
 *
 * @param {{annual: number}} production
 * @param {object} billData
 * @param {number} ratio - self-consumption ratio
 */
export function calculateSavings(production, billData, ratio) {
  const annualProduction = production.annual;

  const tariffRate = (billData.tariffRateCentsPerKwh ?? DEFAULTS.defaultTariffCents) / 100;
  const feedInRate =
    (billData.feedInTariffCents ?? getDefaultFiT(billData.retailer)) / 100;
  const supplyCharge =
    (billData.dailySupplyChargeCents ?? DEFAULTS.defaultSupplyChargeCents) / 100;

  const dailyConsumption = resolveDailyConsumption(billData) ?? 0;
  const annualConsumption = dailyConsumption * 365;

  // Self-use is generation × the (battery-aware) rate, never more than the
  // site's own load. Everything else is exported and credited at the FiT —
  // export is not capped separately from self-consumption.
  const selfConsumedKwh = Math.min(annualProduction * ratio, annualConsumption);
  const exportedKwh = Math.max(0, annualProduction - selfConsumedKwh);

  const savingsFromSelfConsumption = selfConsumedKwh * tariffRate;
  const savingsFromExport = exportedKwh * feedInRate;
  const annualSavings = savingsFromSelfConsumption + savingsFromExport;

  const supplyChargeAnnual = supplyCharge * 365;
  const currentAnnualBill = annualConsumption * tariffRate + supplyChargeAnnual;

  const remainingGridPurchase = Math.max(0, annualConsumption - selfConsumedKwh);
  const newAnnualBill =
    remainingGridPurchase * tariffRate + supplyChargeAnnual - exportedKwh * feedInRate;

  const { low, high } = DEFAULTS.uncertaintyRange;

  /**
   * Savings grow with self-use and with export credits until they offset the
   * whole bill (energy + supply charge). Retailers treat surplus credits
   * inconsistently — many roll them forward rather than paying out — so we
   * stop counting past a fully offset bill rather than showing a net credit.
   * The connection fee is still reported so the UI can explain why a bill
   * that looks "zeroed" was paid down by export, not waived.
   */
  const minAnnualBill = 0;
  const maxPossibleSavings = Math.max(0, currentAnnualBill);

  const savingsMid = Math.min(Math.round(annualSavings), Math.round(maxPossibleSavings));
  const savingsLow = Math.min(Math.round(annualSavings * low), Math.round(maxPossibleSavings));
  const savingsHigh = Math.min(Math.round(annualSavings * high), Math.round(maxPossibleSavings));

  // Bills are derived from the capped savings so the two always reconcile.
  const floorBill = (value) => Math.max(Math.round(value), Math.round(minAnnualBill));

  return {
    annualSavingsLow: savingsLow,
    annualSavingsHigh: savingsHigh,
    annualSavingsMid: savingsMid,
    currentAnnualBill: Math.round(currentAnnualBill),
    // A larger bill reduction is the optimistic case, so the low/high bounds
    // on the remaining bill invert relative to the savings bounds.
    newAnnualBillLow: floorBill(currentAnnualBill - savingsHigh),
    newAnnualBillHigh: floorBill(currentAnnualBill - savingsLow),
    newAnnualBillMid: floorBill(currentAnnualBill - savingsMid),
    minAnnualBill: Math.round(minAnnualBill),
    supplyChargeAnnual: Math.round(supplyChargeAnnual),
    savingsCapped: Math.round(annualSavings * high) > Math.round(maxPossibleSavings),
    rawNewAnnualBill: Math.round(newAnnualBill),
    // Where the saving comes from, scaled so the parts sum to the capped total.
    breakdown: (() => {
      const scale = annualSavings > 0 ? savingsMid / annualSavings : 0;
      return {
        fromSelfConsumption: Math.round(savingsFromSelfConsumption * scale),
        fromExport: Math.round(savingsFromExport * scale),
      };
    })(),
    // Actual share of generation used on site (after the load ceiling), not
    // the uncapped model ratio — so the table matches the kWh figures.
    selfConsumptionPercent: annualProduction
      ? Math.round((selfConsumedKwh / annualProduction) * 100)
      : 0,
    modelSelfConsumptionPercent: Math.round(ratio * 100),
    selfConsumedKwh: Math.round(selfConsumedKwh),
    exportedKwh: Math.round(exportedKwh),
    annualConsumption: Math.round(annualConsumption),
    offsetPercent: annualConsumption
      ? Math.round((annualProduction / annualConsumption) * 100)
      : null,
    rates: {
      tariffCents: tariffRate * 100,
      feedInCents: feedInRate * 100,
      supplyChargeCents: supplyCharge * 100,
      feedInAssumed: billData.feedInTariffCents == null,
      tariffAssumed: billData.tariffRateCentsPerKwh == null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Existing solar
 * ------------------------------------------------------------------ */

/**
 * Estimate an existing system's size from how much it exports.
 *
 * Rearranges production = kW x PSH x derate x 365 x (1 - self-consumption),
 * assuming a typical no-battery self-consumption share. Rough by nature — it
 * is offered as "around X kW", never as a fact.
 */
export function estimateExistingSolarSize(billData, solarData) {
  const exportKwh = billData?.solarExportKwh;
  const days = billData?.billingDays;
  if (!exportKwh || !days || !solarData?.annual) return null;

  const dailyExport = exportKwh / days;
  // No battery, so the exported share is whatever isn't used as generated.
  const exportShare = 1 - DEFAULTS.selfConsumptionModel.baseRatioHome;
  const derate = DEFAULTS.derateFactor;

  const kw = dailyExport / (solarData.annual * derate * exportShare);
  if (!Number.isFinite(kw) || kw <= 0.3) return null;

  return clamp(round1(kw), 0.5, 100);
}

/**
 * Reconstruct true site load when existing solar hides self-consumed kWh
 * from the bill. Grid import + estimated on-site solar use.
 *
 * modelled_gen = systemKw × PSH × 365 × performanceRatio
 * Uses monthly irradiance from the postcode table when available
 * (via calculateProduction); otherwise the annual average PSH.
 * Export and grid import are annualised from the billing period.
 *
 * Self-consumption comes from the same oversizing-derate model that powers
 * the sizing flow (calculateSelfConsumption), never from the bill's export
 * figure — a single seasonal bill annualises export badly, which used to
 * blow up the add-back for larger systems. The rate depends on the load and
 * the load depends on the rate, so the pair is iterated to a fixed point;
 * three rounds converge well within display rounding.
 *
 * @returns {object|null}
 */
export function estimateTrueConsumption(billData, solarData, roofData, existingKw) {
  if (!(existingKw > 0) || !solarData) return null;

  const dailyGrid = resolveDailyConsumption(billData);
  if (!(dailyGrid > 0)) return null;

  const days = billData.billingDays > 0 ? billData.billingDays : 365;
  const annualGridImport = dailyGrid * 365;
  const periodExport = billData.solarExportKwh ?? 0;
  const annualExport = (periodExport / days) * 365;

  const performanceRatio = effectiveDerate(roofData, solarData.lat);

  // Monthly PSH when the postcode lookup has it; calculateProduction falls
  // back to solarData.annual for every month when psh is missing.
  const production = calculateProduction(existingKw, solarData, performanceRatio);
  const modelledGen =
    production.annual > 0
      ? production.annual
      : existingKw * (solarData.annual ?? 0) * 365 * performanceRatio;

  const model = DEFAULTS.selfConsumptionModel;
  // Same daily-production basis the engine uses internally, so the
  // undersized crossover below matches its oversized one exactly.
  const dailyProduction = existingKw * (solarData.annual ?? 0) * performanceRatio;

  let trueConsumption = annualGridImport;
  let selfConsumptionRate = 0;
  let solarSelfConsumed = 0;

  for (let i = 0; i < 3; i++) {
    selfConsumptionRate = calculateSelfConsumption(
      0,
      existingKw,
      solarData.annual,
      performanceRatio,
      false,
      trueConsumption
    );

    /**
     * The engine holds undersized systems at the flat base ratio (its sizing
     * flow wants a conservative floor there). For reconstruction that would
     * tie every undersized size at the same percentage, so extend the
     * engine's own power law continuously below the production = load
     * crossover: a smaller system on the same load self-consumes a strictly
     * larger share of what it makes.
     */
    const productionToLoad = dailyProduction / Math.max(trueConsumption / 365, 0.1);
    if (productionToLoad > 0 && productionToLoad < 1) {
      selfConsumptionRate = Math.min(
        selfConsumptionRate / Math.pow(productionToLoad, model.oversizingExponent),
        model.maxSelfConsumption
      );
    }

    solarSelfConsumed = modelledGen * selfConsumptionRate;
    trueConsumption = annualGridImport + solarSelfConsumed;
  }

  return {
    existingKw,
    annualGridImport: Math.round(annualGridImport),
    annualExport: Math.round(annualExport),
    modelledGeneration: Math.round(modelledGen),
    selfConsumptionRate,
    solarSelfConsumed: Math.round(solarSelfConsumed),
    trueConsumption: Math.round(trueConsumption),
    dailyTrueConsumption: trueConsumption / 365,
    effectiveDerate: performanceRatio,
    production,
  };
}

/* ------------------------------------------------------------------ *
 * Multi-bill consumption profile
 * ------------------------------------------------------------------ */

/**
 * Build a 12-month daily-consumption profile from one or more bills.
 *
 * Months covered by a bill use that bill's daily average. Gaps are filled by
 * scaling the overall average with the location's seasonal irradiance shape
 * inverted — consumption in southern Australia peaks in summer and winter —
 * so instead of inventing a shape we simply hold the overall average and mark
 * the month as estimated. Honest beats clever here.
 *
 * @param {object[]} bills
 * @returns {{monthly: Object, coverage: Object, monthsCovered: number, accuracy: string}}
 */
export function buildConsumptionProfile(bills) {
  const valid = bills.filter((b) => resolveDailyConsumption(b) != null);

  const monthly = {};
  const coverage = {};
  const buckets = {};

  for (const bill of valid) {
    const daily = resolveDailyConsumption(bill);
    for (const month of monthsSpanned(bill)) {
      (buckets[month] ||= []).push(daily);
    }
  }

  const overallDaily =
    valid.length > 0
      ? valid.reduce((sum, b) => sum + resolveDailyConsumption(b), 0) / valid.length
      : null;

  MONTH_KEYS.forEach((month, i) => {
    const samples = buckets[month];
    const daily =
      samples && samples.length > 0
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : overallDaily;

    monthly[month] = daily != null ? Math.round(daily * DAYS_IN_MONTH[i]) : null;
    coverage[month] = Boolean(samples && samples.length > 0);
  });

  const monthsCovered = Object.values(coverage).filter(Boolean).length;

  return {
    monthly,
    coverage,
    monthsCovered,
    accuracy: accuracyFor(monthsCovered, valid.length),
    dailyAverage: overallDaily,
    annualEstimate: overallDaily != null ? Math.round(overallDaily * 365) : null,
  };
}

/** Month keys touched by a bill's period. */
function monthsSpanned(bill) {
  const start = bill.billingPeriodStart ? new Date(bill.billingPeriodStart) : null;
  const end = bill.billingPeriodEnd ? new Date(bill.billingPeriodEnd) : null;
  if (!start || !end || Number.isNaN(start) || Number.isNaN(end)) return [];

  const out = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end && out.length < 24) {
    out.push(MONTH_KEYS[cursor.getMonth()]);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function accuracyFor(monthsCovered, billCount) {
  if (monthsCovered >= 11) return 'high';
  if (monthsCovered >= 5 || billCount >= 3) return 'good';
  if (billCount >= 2) return 'fair';
  return 'basic';
}

export const ACCURACY_COPY = {
  basic: 'Basic estimate — upload more bills for seasonal accuracy',
  fair: 'Fair estimate — a few more bills would sharpen it',
  good: 'Good estimate — covers a solid part of the year',
  high: 'High accuracy — your bills cover a full year',
};

/**
 * Reduce several parsed bills to one representative bill.
 *
 * Consumption comes from the combined profile (so seasonal coverage counts),
 * while rates come from the most recent bill that actually stated them —
 * averaging tariffs across bills that straddle a price rise would report a
 * rate the customer no longer pays.
 *
 * @param {object[]} bills
 */
export function mergeBills(bills) {
  const usable = bills.filter((b) => b && resolveDailyConsumption(b) != null);
  if (usable.length === 0) return { ...(bills[0] || {}), billCount: bills.length };
  if (usable.length === 1) {
    return { ...usable[0], billCount: 1, profile: buildConsumptionProfile(usable) };
  }

  const profile = buildConsumptionProfile(usable);
  const byRecency = [...usable].sort(
    (a, b) => endTime(b) - endTime(a) || confidenceRank(b) - confidenceRank(a)
  );

  const latestWith = (field) => byRecency.find((b) => b[field] != null)?.[field] ?? null;

  const totalKwh = usable.reduce((sum, b) => sum + (b.totalKwh || 0), 0);
  const totalDays = usable.reduce((sum, b) => sum + (b.billingDays || 0), 0);

  return {
    ...byRecency[0],
    billCount: usable.length,
    totalKwh: totalKwh || null,
    billingDays: totalDays || null,
    dailyAverageKwh: profile.dailyAverage,
    tariffRateCentsPerKwh: latestWith('tariffRateCentsPerKwh'),
    touRates: byRecency.find((b) => b.touRates)?.touRates ?? null,
    dailySupplyChargeCents: latestWith('dailySupplyChargeCents'),
    feedInTariffCents: latestWith('feedInTariffCents'),
    postcode: latestWith('postcode'),
    address: latestWith('address'),
    hasSolar: usable.some((b) => b.hasSolar),
    solarExportKwh: usable.reduce((sum, b) => sum + (b.solarExportKwh || 0), 0) || null,
    billingPeriodStart: usable
      .map((b) => b.billingPeriodStart)
      .filter(Boolean)
      .sort()[0] ?? null,
    billingPeriodEnd: usable
      .map((b) => b.billingPeriodEnd)
      .filter(Boolean)
      .sort()
      .pop() ?? null,
    confidence: worstConfidence(usable),
    profile,
  };
}

const endTime = (bill) =>
  bill.billingPeriodEnd ? new Date(bill.billingPeriodEnd).getTime() : 0;

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };
const confidenceRank = (bill) => CONFIDENCE_ORDER[bill.confidence] ?? 0;

function worstConfidence(bills) {
  return bills.reduce(
    (worst, b) => (confidenceRank(b) < CONFIDENCE_ORDER[worst] ? b.confidence : worst),
    'high'
  );
}

/* ------------------------------------------------------------------ *
 * Top-level orchestration
 * ------------------------------------------------------------------ */

/**
 * Everything the results screen needs, for one system size and battery size.
 *
 * @param {object} billData    merged/representative bill
 * @param {object} solarData   irradiance entry
 * @param {object} roofData
 * @param {number} batteryKwh  0 for no battery
 * @param {number} [systemKw]  defaults to the recommended size
 */
export function calculateScenario(
  billData,
  solarData,
  roofData,
  batteryKwh = 0,
  systemKw,
  mode = 'home'
) {
  const sizing = calculateSystemSize(billData, solarData, roofData, mode);
  if (!sizing) return null;

  const activeKw = systemKw ?? sizing.recommendedKw;
  const production = calculateProduction(activeKw, solarData, sizing.effectiveDerate);
  const ratio = calculateSelfConsumption(
    batteryKwh,
    activeKw,
    solarData.annual,
    sizing.effectiveDerate,
    mode === 'business',
    sizing.annualConsumption
  );
  const savings = calculateSavings(production, billData, ratio);

  return {
    sizing,
    production,
    savings,
    systemKw: activeKw,
    batteryKwh,
    panelCount: panelsFor(activeKw),
    roofAreaM2: roofAreaFor(activeKw),
  };
}

/**
 * Smallest system size that reduces the bill to roughly just the daily supply
 * charge.
 *
 * "Nearly zero" cannot mean zero: the connection fee is charged no matter how
 * much solar is installed. Nor does it mean covering 100% of consumption —
 * without a battery only about a third of generation is used on site, so the
 * rest has to be earned back through export credits, which needs a larger
 * system than simple coverage.
 *
 * The bill falls monotonically as capacity rises, so a bisection search finds
 * the smallest size meeting the target. Returns the slider maximum, flagged,
 * when even that isn't enough — which happens on low feed-in tariffs.
 *
 * @returns {{kw: number, reachable: boolean, supplyChargeAnnual: number}|null}
 */
export function sizeForNearZeroBill(
  billData,
  solarData,
  roofData,
  batteryKwh = 0,
  mode = 'home'
) {
  const sizing = calculateSystemSize(billData, solarData, roofData, mode);
  if (!sizing) return null;

  const supplyChargeAnnual =
    ((billData.dailySupplyChargeCents ?? DEFAULTS.defaultSupplyChargeCents) / 100) * 365;

  const billAt = (kw) => {
    const production = calculateProduction(kw, solarData, sizing.effectiveDerate);
    const ratio = calculateSelfConsumption(
      batteryKwh,
      kw,
      solarData.annual,
      sizing.effectiveDerate,
      mode === 'business',
      sizing.annualConsumption
    );
    return calculateSavings(production, billData, ratio).newAnnualBillMid;
  };

  const energyNow = Math.max(0, sizing.annualConsumption *
    ((billData.tariffRateCentsPerKwh ?? DEFAULTS.defaultTariffCents) / 100));
  const target =
    supplyChargeAnnual + energyNow * DEFAULTS.nearZero.targetRemainingEnergyShare;

  const { minKw, maxKw } = getMode(mode).slider;

  if (billAt(minKw) <= target) {
    return { kw: minKw, reachable: true, supplyChargeAnnual };
  }
  if (billAt(maxKw) > target) {
    return { kw: maxKw, reachable: false, supplyChargeAnnual };
  }

  let low = minKw;
  let high = maxKw;
  for (let i = 0; i < 24 && high - low > 0.05; i++) {
    const mid = (low + high) / 2;
    if (billAt(mid) <= target) high = mid;
    else low = mid;
  }

  return { kw: round1(high), reachable: true, supplyChargeAnnual };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
