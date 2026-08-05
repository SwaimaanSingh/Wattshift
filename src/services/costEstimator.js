/**
 * What a system costs, what the rebates take off, and how long it takes to
 * pay for itself.
 *
 * Everything is a range. A single number would be false precision: the same
 * 10 kW system on the same roof genuinely varies by thousands between
 * installers, depending on equipment, roof access, switchboard condition and
 * how busy the installer is that month. Quoting "$12,400" invites the customer
 * to treat one installer's quote as wrong when it is merely different.
 */
import {
  EQUIPMENT_TIERS,
  SYSTEM_COSTS_2026,
  getStateFromPostcode,
} from '../config/defaults.js';

/* ------------------------------------------------------------------ *
 * Rate selection
 * ------------------------------------------------------------------ */

/** Commercial solar rate band for a system size. */
export function getCommercialSolarRate(systemKw) {
  const rates = SYSTEM_COSTS_2026.commercial.solarPerKw;
  if (systemKw < 30) return rates.under30kw;
  if (systemKw <= 100) return rates.from30to100kw;
  return rates.over100kw;
}

/** Commercial battery rate band for a capacity. */
export function getCommercialBatteryRate(batteryKwh) {
  const rates = SYSTEM_COSTS_2026.commercial.batteryPerKwh;
  if (batteryKwh < 30) return rates.under30kwh;
  if (batteryKwh <= 100) return rates.from30to100kwh;
  return rates.over100kwh;
}

/**
 * STCs a system earns, and what they are worth.
 *
 * Certificates are whole units — the CER truncates rather than rounds, so a
 * system earning 91.8 certificates is paid for 91.
 */
export function calculateStc(systemKw, state) {
  const { pricePerStc, deemingYearsRemaining, zones, maxSystemKw } = SYSTEM_COSTS_2026.stc;

  const cappedKw = Math.min(systemKw, maxSystemKw);
  const zoneRating = zones[state] ?? zones.SA;
  const count = Math.floor(cappedKw * zoneRating * deemingYearsRemaining);

  return {
    count,
    pricePerStc,
    zoneRating,
    deemingYears: deemingYearsRemaining,
    rebate: count * pricePerStc,
    // Past 100 kW the scheme switches to annually-created LGCs, which are
    // income rather than a discount on the install.
    cappedBySchemeLimit: systemKw > maxSystemKw,
  };
}

/**
 * The federal battery rebate, which is residential-only and capped.
 */
export function calculateBatteryRebate(batteryKwh, isCommercial) {
  const { perKwh, maxKwh, validUntil } = SYSTEM_COSTS_2026.batteryRebate;

  if (isCommercial || !(batteryKwh > 0)) {
    return { eligible: false, kwhClaimed: 0, amount: 0, perKwh, validUntil };
  }

  const kwhClaimed = Math.min(batteryKwh, maxKwh);
  return {
    eligible: true,
    kwhClaimed,
    amount: kwhClaimed * perKwh,
    perKwh,
    validUntil,
    cappedByLimit: batteryKwh > maxKwh,
  };
}

/* ------------------------------------------------------------------ *
 * Costs
 * ------------------------------------------------------------------ */

/**
 * Full cost breakdown for a system.
 *
 * @param {object} options
 * @param {number} options.systemKw
 * @param {number} [options.batteryKwh]
 * @param {string} [options.postcode]
 * @param {string} [options.state]      preferred over postcode when known
 * @param {boolean} [options.isCommercial]
 * @param {'budget'|'standard'|'premium'} [options.tier]
 * @returns {object}
 */
export function calculateCosts({
  systemKw,
  batteryKwh = 0,
  postcode,
  state,
  isCommercial = false,
  tier = 'standard',
}) {
  const resolvedState = state || getStateFromPostcode(postcode);

  const solarRate = isCommercial
    ? getCommercialSolarRate(systemKw)
    : SYSTEM_COSTS_2026.residential.solarPerKw[tier] ??
      SYSTEM_COSTS_2026.residential.solarPerKw.standard;

  const solar = {
    low: Math.round(systemKw * solarRate.min),
    mid: Math.round(systemKw * solarRate.mid),
    high: Math.round(systemKw * solarRate.max),
    perKw: solarRate,
  };

  const stc = calculateStc(systemKw, resolvedState);
  const batteryRebate = calculateBatteryRebate(batteryKwh, isCommercial);

  let battery = { low: 0, mid: 0, high: 0, perKwh: null };
  if (batteryKwh > 0) {
    const batteryRate = isCommercial
      ? getCommercialBatteryRate(batteryKwh)
      : SYSTEM_COSTS_2026.residential.batteryPerKwh[tier] ??
        SYSTEM_COSTS_2026.residential.batteryPerKwh.standard;

    battery = {
      low: Math.round(batteryKwh * batteryRate.min),
      mid: Math.round(batteryKwh * batteryRate.mid),
      high: Math.round(batteryKwh * batteryRate.max),
      perKwh: batteryRate,
    };
  }

  // Commercial connections carry network charges a home never sees.
  const extras = [];
  const commercial = SYSTEM_COSTS_2026.commercial;
  if (isCommercial && systemKw > commercial.megThresholdKw) {
    extras.push({
      label: 'Network connection application',
      detail: `Required for embedded generators above ${commercial.megThresholdKw} kW`,
      amount: commercial.megApplicationCost,
    });
  }
  if (isCommercial && systemKw > commercial.networkStudyThresholdKw) {
    extras.push({
      label: 'Power system study',
      detail: `Required above ${commercial.networkStudyThresholdKw} kW`,
      amount: commercial.networkStudyCost,
    });
  }
  const extraCosts = extras.reduce((sum, e) => sum + e.amount, 0);

  const rebates = stc.rebate + batteryRebate.amount;

  /**
   * A rebate cannot pay you to install solar. On a small system in a high
   * zone the STC value can exceed the cheapest quoted price, and reporting a
   * negative cost would be nonsense — so the net floors at zero.
   */
  const net = (gross) => Math.max(0, Math.round(gross + extraCosts - rebates));

  return {
    state: resolvedState,
    tier,
    isCommercial,
    systemKw,
    batteryKwh,
    solar,
    battery,
    stc,
    stcRebate: stc.rebate,
    stcCount: stc.count,
    batteryRebate,
    extras,
    extraCosts,
    totalRebates: rebates,
    grossTotal: {
      low: solar.low + battery.low + extraCosts,
      mid: solar.mid + battery.mid + extraCosts,
      high: solar.high + battery.high + extraCosts,
    },
    netTotal: {
      low: net(solar.low + battery.low),
      mid: net(solar.mid + battery.mid),
      high: net(solar.high + battery.high),
    },
    // Filled in by withPayback() once the savings are known.
    paybackYears: { low: null, mid: null, high: null },
    pricingUpdated: SYSTEM_COSTS_2026.lastUpdated,
    pricingSource: SYSTEM_COSTS_2026.source,
  };
}

/* ------------------------------------------------------------------ *
 * Payback and long-run value
 * ------------------------------------------------------------------ */

/**
 * Attach payback and a 25-year projection to a cost breakdown.
 *
 * Payback pairs the *pessimistic* cost with the *pessimistic* saving and the
 * optimistic with the optimistic. Crossing them would produce a range so wide
 * it says nothing, and quoting the cheap system against the best-case saving
 * would be the oldest trick in solar sales.
 *
 * @param {object} costs - from calculateCosts
 * @param {{low: number, mid: number, high: number}} annualSavings
 */
export function withPayback(costs, annualSavings) {
  const payback = (cost, saving) => {
    if (!(saving > 0)) return null;
    const years = cost / saving;
    // Beyond the equipment's own life, "payback" stops being a useful word.
    return years > 40 ? null : Math.round(years * 10) / 10;
  };

  const projections = {
    low: projectLifetime(costs.netTotal.low, annualSavings.low, costs),
    mid: projectLifetime(costs.netTotal.mid, annualSavings.mid, costs),
    high: projectLifetime(costs.netTotal.high, annualSavings.high, costs),
  };

  return {
    ...costs,
    annualSavings,
    paybackYears: {
      // Best case: cheapest install, biggest saving.
      low: payback(costs.netTotal.low, annualSavings.high),
      mid: payback(costs.netTotal.mid, annualSavings.mid),
      // Worst case: dearest install, smallest saving.
      high: payback(costs.netTotal.high, annualSavings.low),
    },
    /** Payback accounting for degradation and rising prices — the honest one. */
    discountedPayback: {
      low: projections.high.breakEvenYear,
      mid: projections.mid.breakEvenYear,
      high: projections.low.breakEvenYear,
    },
    lifetime: {
      low: projections.low,
      mid: projections.mid,
      high: projections.high,
    },
    netBenefit25Year: {
      low: projections.low.netBenefit,
      mid: projections.mid.netBenefit,
      high: projections.high.netBenefit,
    },
  };
}

/**
 * Year-by-year cash position over the projection horizon.
 *
 * Two forces pull against each other and both are real:
 *
 *   Panels degrade — about 0.5% a year, so year 25 produces roughly 88% of
 *   year one.
 *
 *   Electricity gets dearer — at 3% a year the same kilowatt-hour saved is
 *   worth twice as much by year 25.
 *
 * The second outweighs the first, which is why a solar payback calculated on
 * today's rates alone is pessimistic. A battery replacement is subtracted at
 * the end of its warranted life, because pretending it lasts 25 years would
 * flatter the result.
 */
export function projectLifetime(netCost, firstYearSaving, costs) {
  const {
    years,
    panelDegradationPerYear,
    electricityPriceGrowth,
    batteryLifeYears,
    batteryReplacementCostFactor,
  } = SYSTEM_COSTS_2026.projection;

  const rows = [];
  let cumulative = -netCost;
  let breakEvenYear = null;

  for (let year = 1; year <= years; year++) {
    const output = (1 - panelDegradationPerYear) ** (year - 1);
    const priceIndex = (1 + electricityPriceGrowth) ** (year - 1);
    let saving = firstYearSaving * output * priceIndex;

    let replacement = 0;
    if (costs.batteryKwh > 0 && year === batteryLifeYears + 1) {
      // Priced at today's mid battery cost, discounted for the fall in cell
      // prices that a decade of manufacturing scale has reliably delivered.
      replacement = Math.round(costs.battery.mid * batteryReplacementCostFactor);
    }

    const previous = cumulative;
    cumulative += saving - replacement;

    if (breakEvenYear === null && previous < 0 && cumulative >= 0) {
      // Interpolate within the year rather than rounding up to the next one.
      const fraction = saving > 0 ? -previous / saving : 0;
      breakEvenYear = Math.round((year - 1 + fraction) * 10) / 10;
    }

    rows.push({
      year,
      saving: Math.round(saving),
      replacement,
      cumulative: Math.round(cumulative),
      outputFactor: Math.round(output * 1000) / 1000,
    });
  }

  return {
    rows,
    netBenefit: Math.round(cumulative),
    totalSavings: Math.round(rows.reduce((sum, r) => sum + r.saving, 0)),
    totalReplacements: rows.reduce((sum, r) => sum + r.replacement, 0),
    breakEvenYear,
    netCost,
  };
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

/** The cost breakdown as the rows the table and the PDF both render. */
export function costRows(costs) {
  const rows = [
    {
      key: 'solar',
      label: `Solar system (${round1(costs.systemKw)} kW)`,
      low: costs.solar.low,
      high: costs.solar.high,
    },
    {
      key: 'stc',
      label: `STC rebate (${costs.stcCount} certificates × $${costs.stc.pricePerStc})`,
      low: -costs.stcRebate,
      high: -costs.stcRebate,
      credit: true,
    },
  ];

  if (costs.batteryKwh > 0) {
    rows.push({
      key: 'battery',
      label: `Battery (${round1(costs.batteryKwh)} kWh)`,
      low: costs.battery.low,
      high: costs.battery.high,
    });

    if (costs.batteryRebate.eligible) {
      rows.push({
        key: 'battery-rebate',
        label: `Battery rebate (${round1(costs.batteryRebate.kwhClaimed)} kWh × $${costs.batteryRebate.perKwh})`,
        low: -costs.batteryRebate.amount,
        high: -costs.batteryRebate.amount,
        credit: true,
      });
    }
  }

  for (const extra of costs.extras) {
    rows.push({ key: extra.label, label: extra.label, low: extra.amount, high: extra.amount });
  }

  return rows;
}

export { EQUIPMENT_TIERS };

const round1 = (v) => Math.round(v * 10) / 10;
