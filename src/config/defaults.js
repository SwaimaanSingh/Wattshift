/**
 * Every assumption the estimate rests on, in one place.
 *
 * These are deliberately conservative. The tool is meant to be defensible to
 * an engineer, so where a range exists we take the pessimistic end and show
 * results as a band rather than a single number.
 */

export const DEFAULTS = {
  // Whole-of-system derate: inverter efficiency, temperature losses, wiring,
  // soiling and minor clipping. CEC guidance sits around 0.75–0.80.
  derateFactor: 0.78,

  /**
   * Self-consumption model parameters.
   *
   * The ratio is driven by battery capacity *relative to daily solar
   * production*, not by capacity alone — a 10 kWh battery is transformative
   * on a 6.6 kW system and a rounding error on a 500 kW one. See
   * calculateSelfConsumption() in calculationEngine.js.
   */
  selfConsumptionModel: {
    // Share used on site with no battery at all. Businesses run during
    // daylight, so they consume far more of their own generation.
    baseRatioHome: 0.3,
    baseRatioCommercial: 0.55,
    // Battery round-trip losses.
    roundTripEfficiency: 0.9,
    /**
     * Shape of the diminishing-returns curve on captured export. Commercial
     * sites capture more efficiently because their load is concentrated in
     * solar hours, so a battery meets demand as it discharges rather than
     * waiting for an evening peak.
     */
    captureCurveK: 1.8,
    captureCurveKCommercial: 2.4,
    // Exponent on the production-to-load ratio when derating the base.
    oversizingExponent: 0.5,
    // A battery bigger than this multiple of daily export buys nothing more.
    maxBatteryExportRatio: 1.5,
    // There are always losses; never claim a perfect result.
    maxSelfConsumption: 0.98,
  },

  // Fallbacks when extraction fails (SA averages, c/kWh and c/day).
  defaultTariffCents: 36.0,
  defaultSupplyChargeCents: 90.0,

  // Feed-in tariffs by retailer, c/kWh. Used only when the bill doesn't
  // state one. SA rates as at July 2026.
  feedInTariffs: {
    'Alinta Energy': 6.0,
    EnergyAustralia: 5.5,
    'Origin Energy': 5.0,
    AGL: 4.0,
    ENGIE: 4.0,
    'Simply Energy': 5.0,
    'Red Energy': 5.0,
    'Lumo Energy': 5.0,
    'iO Energy': 3.0,
    default: 5.0,
  },

  // Southern hemisphere: north is optimal. Multiplier on annual yield.
  orientationFactors: {
    N: 1.0,
    NNE: 0.97,
    NE: 0.95,
    ENE: 0.9,
    E: 0.85,
    ESE: 0.8,
    SE: 0.75,
    SSE: 0.7,
    S: 0.65,
    SSW: 0.7,
    SW: 0.75,
    WSW: 0.8,
    W: 0.85,
    WNW: 0.9,
    NW: 0.95,
    NNW: 0.97,
    Flat: 0.9,
  },

  // Shading allowance applied on top of orientation and pitch.
  shadingFactors: {
    none: 1.0,
    morning: 0.93,
    afternoon: 0.93,
    significant: 0.82,
  },

  // Savings are shown as a band, not a point estimate.
  uncertaintyRange: { low: 0.85, high: 1.15 },

  // Assumptions when we have no roof data at all (typical SA detached house).
  roofDefaults: {
    orientation: 'N',
    pitchDegrees: 22.5,
    shading: 'none',
  },

  // Sizing guard rails. Residential inverters/connections realistically cap
  // out well below what a very large bill would imply.
  sizing: {
    minKw: 1.5,
    maxRecommendedKw: 30,
    /**
     * Nobody installs a 1.5 kW system. Below roughly 6.6 kW the fixed costs of
     * a job — scaffolding, isolators, inverter, labour, paperwork — barely
     * change, so the price per kW climbs steeply and the STC rebate shrinks
     * with capacity. 6.6 kW paired with a 5 kW inverter is the standard
     * Australian residential install for exactly this reason.
     */
    practicalMinimumKw: 6.6,
    // Typical residential module rating used for panel-count estimates.
    // 415 W is the common mid-range module; count with Math.ceil so we never
    // understate how many panels the recommended kW needs.
    wattsPerPanel: 415,
    m2PerPanel: 2.1,
  },

  /** Battery presets, labelled. Used by both modes via `modes[x].battery`. */
  batteryLabel: (kwh) => (kwh === 0 ? 'No battery' : `${kwh} kWh`),

  /**
   * Home and business sites differ in scale, in the sizes worth offering, and
   * in the network rules that bite — so the whole set of UI constraints and
   * wording is swapped together rather than tweaked field by field. The bill
   * data never changes when the mode does.
   */
  modes: {
    home: {
      key: 'home',
      label: 'Home',
      icon: '🏠',
      site: 'your home',
      siteShort: 'home',
      occupants: 'household',
      practicalMinimumKw: 6.6,
      slider: {
        minKw: 3,
        maxKw: 30,
        stepKw: 0.1,
        quickSizes: [6.6, 10, 13.2, 15, 20],
        hints: [
          { kw: 6.6, label: 'Most popular' },
          { kw: 10, label: 'Best value' },
          { kw: 13.2, label: 'Large home' },
        ],
      },
      battery: {
        minKwh: 1,
        maxKwh: 30,
        stepKwh: 0.5,
        presets: [0, 5, 10, 13.5],
      },
      // Shown once the chosen size passes each threshold.
      solarNotes: [
        {
          above: 15,
          text: 'Systems over 15 kW may need export limiting. Your installer will handle this.',
        },
        {
          above: 30,
          text: 'Residential systems over 30 kW need special metering and AEMO registration.',
        },
      ],
      batteryNotes: [
        {
          above: 30,
          text: "That's a large battery for a home — make sure your installer confirms it suits your setup.",
        },
      ],
    },

    business: {
      key: 'business',
      label: 'Business',
      icon: '🏢',
      site: 'your business',
      siteShort: 'premises',
      occupants: 'business',
      practicalMinimumKw: 10,
      slider: {
        minKw: 3,
        maxKw: 200,
        stepKw: 0.1,
        quickSizes: [10, 30, 50, 100, 150],
        hints: [
          { kw: 30, label: 'Common for small business' },
          { kw: 100, label: 'Large commercial' },
        ],
      },
      battery: {
        minKwh: 1,
        maxKwh: 200,
        stepKwh: 0.5,
        presets: [0, 10, 30, 50, 100],
      },
      solarNotes: [
        {
          above: 30,
          text: 'Systems over 30 kW connect as large installations under different metering rules.',
        },
        {
          above: 100,
          text: 'Systems over 100 kW typically require SA Power Networks approval and may need an export agreement.',
        },
      ],
      batteryNotes: [
        {
          above: 100,
          text: 'Very large battery systems require specialist design. Contact an engineer for detailed modelling.',
        },
      ],
    },
  },

  /** Above this daily average, a site is probably not a house. */
  businessDetectionKwhPerDay: 50,

  /** Hard ceiling on anything typed into a capacity field. */
  maxTypedCapacity: 500,

  /**
   * "Nearly zero" means the energy component of the bill is fully offset, so
   * only the daily supply charge remains. It can never reach actual zero —
   * the connection fee is charged regardless of how much solar is installed.
   */
  nearZero: { targetRemainingEnergyShare: 0.05 },
};

/**
 * Installed-price benchmarks used by the quote checker.
 *
 * Solar figures are after STC rebates and fully installed. Battery figures are
 * before the federal rebate, which is subtracted separately because it scales
 * with usable capacity.
 *
 * Update `lastUpdated` whenever these move — the UI shows it, so a stale table
 * is visible rather than silently misleading.
 */
export const QUOTE_PRICING_2026 = {
  solar: {
    // Per kW installed, after STC rebates.
    budget: { min: 650, mid: 800, max: 950 },
    standard: { min: 800, mid: 1000, max: 1200 },
    premium: { min: 1100, mid: 1300, max: 1500 },
    typical: { min: 800, max: 1300 },
  },
  battery: {
    // Per kWh installed, before the federal rebate.
    perKwh: { min: 650, mid: 900, max: 1200 },
    // Federal Cheaper Home Batteries rebate (2026).
    federalRebatePerKwh: 340,
  },
  lastUpdated: '2026-07',
  source: 'Solar Choice Price Index, SolarQuotes, industry data',
};

/**
 * Installed system pricing for the Stage 2 cost estimate.
 *
 * Distinct from QUOTE_PRICING_2026 above, and deliberately so. That table is
 * post-rebate, because a customer holding a quote is looking at a post-rebate
 * number. This one is pre-rebate, because the cost breakdown shows the rebates
 * as their own lines — a customer needs to see the $3,000 of STCs before they
 * can understand why the total dropped.
 *
 * Update `lastUpdated` whenever these move. The UI shows it, so a stale table
 * is visible rather than silently misleading.
 */
export const SYSTEM_COSTS_2026 = {
  residential: {
    /** $/kW installed, before any rebate. */
    solarPerKw: {
      budget: { min: 800, mid: 950, max: 1100 },
      standard: { min: 1000, mid: 1200, max: 1400 },
      premium: { min: 1300, mid: 1500, max: 1800 },
    },
    /** $/kWh installed, before the federal battery rebate. */
    batteryPerKwh: {
      budget: { min: 600, mid: 750, max: 900 },
      standard: { min: 800, mid: 1000, max: 1200 },
      premium: { min: 1100, mid: 1300, max: 1500 },
    },
  },

  /**
   * Commercial work costs less per kW than residential at the same quality,
   * because the fixed costs of a job — travel, scaffolding, paperwork, the
   * design fee — spread across far more capacity.
   */
  commercial: {
    solarPerKw: {
      under30kw: { min: 900, mid: 1100, max: 1300 },
      from30to100kw: { min: 750, mid: 950, max: 1150 },
      over100kw: { min: 650, mid: 850, max: 1050 },
    },
    batteryPerKwh: {
      under30kwh: { min: 700, mid: 900, max: 1100 },
      from30to100kwh: { min: 550, mid: 750, max: 950 },
      over100kwh: { min: 450, mid: 650, max: 850 },
    },
    /** Network connection application for an embedded generator. */
    megApplicationCost: 4500,
    megThresholdKw: 30,
    /** Power system study, required past 100 kW on most networks. */
    networkStudyCost: 3000,
    networkStudyThresholdKw: 100,
  },

  /**
   * Small-scale Technology Certificates.
   *
   * One STC is one MWh of deemed generation over the years remaining in the
   * scheme, so the rebate is capacity x zone rating x years x price. The
   * certificate price floats — $35 is close to the market clearing rate once
   * an installer's margin is taken out of the $40 clearing-house ceiling.
   */
  stc: {
    pricePerStc: 35,
    /**
     * Years of generation still deemable. The SRES winds down to nothing at
     * the end of 2030, and the deeming period shortens by one every January —
     * so this figure must be checked each year, and it is the single number
     * most likely to be stale in this file.
     */
    deemingYearsRemaining: 4,
    /**
     * Zone ratings, in MWh per kW per year of deemed output. Australia is
     * divided into four zones; these are the rating that applies to most of
     * each state's population. A proper postcode-level lookup would refine
     * the inland parts of every state upward.
     */
    zones: {
      SA: 1.382, NSW: 1.382, VIC: 1.185, QLD: 1.536,
      WA: 1.382, TAS: 1.185, NT: 1.622, ACT: 1.382,
    },
    /** Systems above 100 kW earn LGCs annually instead of upfront STCs. */
    maxSystemKw: 100,
  },

  /** Federal Cheaper Home Batteries rebate. */
  batteryRebate: {
    perKwh: 340,
    maxKwh: 30,
    eligibility: 'residential',
    validUntil: '2026-12-31',
  },

  /**
   * Long-run projection assumptions.
   *
   * Panels lose output slowly and electricity gets dearer slowly; over 25
   * years both compound into real money, and leaving either out would be the
   * difference between an honest projection and a sales figure.
   */
  projection: {
    years: 25,
    panelDegradationPerYear: 0.005,
    electricityPriceGrowth: 0.03,
    /** Batteries are warranted to roughly 10 years; assume one replacement. */
    batteryLifeYears: 12,
    batteryReplacementCostFactor: 0.6,
  },

  lastUpdated: '2026-07',
  source: 'Solar Choice Price Index, SolarQuotes, CER STC data, installer quotes',
};

/** Equipment tiers, with the plain-English version of what you get. */
export const EQUIPMENT_TIERS = [
  {
    key: 'budget',
    label: 'Budget',
    summary: 'Entry-level panels and inverter',
    detail:
      'Tier 2 panels and a value inverter. Cheapest up front, with shorter warranties and brands that may not be supported here in ten years.',
  },
  {
    key: 'standard',
    label: 'Standard',
    summary: 'Tier 1 panels, reputable inverter',
    detail:
      'What most Australian homes get: Jinko, Trina or Longi panels with a Sungrow, Fronius or GoodWe inverter. 25-year product warranties and local support.',
  },
  {
    key: 'premium',
    label: 'Premium',
    summary: 'Top-tier panels and microinverters',
    detail:
      'REC, SunPower or Q Cells with Enphase microinverters or a premium string inverter. Higher output per square metre, better shade tolerance, longest warranties.',
  },
];

export const AU_STATES = ['SA', 'NSW', 'VIC', 'QLD', 'WA', 'TAS', 'NT', 'ACT'];

/**
 * State for an Australian postcode.
 *
 * Only a fallback: the irradiance table carries the state for every postcode
 * it knows, and that is the better source. This covers a postcode we've never
 * seen, and the ranges are the ones Australia Post publishes.
 */
export function getStateFromPostcode(postcode) {
  const code = Number(String(postcode || '').trim());
  if (!Number.isFinite(code)) return 'SA';

  if (code >= 800 && code <= 999) return 'NT';
  if (code >= 2600 && code <= 2618) return 'ACT';
  if (code >= 2900 && code <= 2920) return 'ACT';
  if (code >= 1000 && code <= 2999) return 'NSW';
  if (code >= 3000 && code <= 3999) return 'VIC';
  if (code >= 4000 && code <= 4999) return 'QLD';
  if (code >= 5000 && code <= 5999) return 'SA';
  if (code >= 6000 && code <= 6999) return 'WA';
  if (code >= 7000 && code <= 7999) return 'TAS';
  if (code >= 8000 && code <= 8999) return 'VIC';
  if (code >= 9000 && code <= 9999) return 'QLD';
  return 'SA';
}

/**
 * Enquiry delivery.
 *
 * With no Formspree endpoint configured the form falls back to a mailto: link,
 * which works everywhere and needs no backend.
 */
export const ENQUIRY_CONFIG = {
  endpoint: import.meta.env?.VITE_ENQUIRY_FORM_ENDPOINT || null,
  // TODO: Replace hello@wattshift.com.au before launch
  fallbackEmail: 'hello@wattshift.com.au',
};

/** Mode config by key, defaulting to home. */
export function getMode(key) {
  return DEFAULTS.modes[key] ?? DEFAULTS.modes.home;
}

/**
 * Guess whether a bill belongs to a business.
 *
 * Only a suggestion — the customer confirms. An average Australian house sits
 * near 15–20 kWh/day; sustained use past 50 is unusual for a dwelling.
 *
 * @returns {'home'|'business'}
 */
export function detectMode(dailyAverageKwh) {
  return dailyAverageKwh > DEFAULTS.businessDetectionKwhPerDay ? 'business' : 'home';
}

/**
 * Feed-in tariff for a retailer, falling back to the SA default.
 * @param {string|null} retailer
 * @returns {number} c/kWh
 */
export function getDefaultFiT(retailer) {
  if (!retailer) return DEFAULTS.feedInTariffs.default;
  const table = DEFAULTS.feedInTariffs;
  if (table[retailer] != null) return table[retailer];

  // Tolerate near-misses like "AGL South Australia Pty Limited".
  const needle = retailer.toLowerCase();
  const hit = Object.keys(table).find(
    (name) => name !== 'default' && needle.includes(name.toLowerCase())
  );
  return hit ? table[hit] : table.default;
}
