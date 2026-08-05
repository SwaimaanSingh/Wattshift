/**
 * Time-of-use tariff modelling for half-hourly data.
 *
 * A flat rate makes a battery worth roughly what it saves in feed-in tariff
 * forgone. A time-of-use tariff changes the argument entirely: the battery
 * fills on solar that would have earned 5c and empties into the 4pm–9pm peak
 * that would have cost 55c. Modelling the periods properly is most of why
 * interval data is worth uploading.
 *
 * The subtlety that makes this non-trivial: NEM12 intervals are stamped in
 * AEST year round, but a retailer's peak window is defined in *local clock
 * time*, daylight saving included. In Adelaide in January those differ by an
 * hour — apply the window to the raw AEST slot and the model prices the most
 * expensive hours of the year in the wrong place.
 */

/**
 * Retail time-of-use windows by state, in local clock time.
 *
 * Hours are inclusive of the hour they name: a peak hour of 16 covers 16:00
 * to 16:59. Retailers vary within a state and these are the common shape
 * rather than any one plan — the rates themselves always come from the bill.
 */
export const TOU_PERIODS = {
  SA: {
    label: 'South Australia',
    weekday: {
      peak: [16, 17, 18, 19, 20],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    // Weekends have no peak on almost every SA plan.
    weekend: {
      peak: [],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
  },
  NSW: {
    label: 'New South Wales',
    weekday: {
      peak: [14, 15, 16, 17, 18, 19],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 20, 21],
      offPeak: [22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    weekend: {
      peak: [],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      offPeak: [22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
  },
  VIC: {
    label: 'Victoria',
    // Victorian flexible-pricing plans typically run peak/off-peak only.
    weekday: {
      peak: [15, 16, 17, 18, 19, 20],
      shoulder: [],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    },
    weekend: {
      peak: [],
      shoulder: [],
      offPeak: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    },
  },
  QLD: {
    label: 'Queensland',
    weekday: {
      peak: [16, 17, 18, 19, 20],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    weekend: {
      peak: [],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
  },
  WA: {
    label: 'Western Australia',
    weekday: {
      peak: [15, 16, 17, 18, 19, 20],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    weekend: {
      peak: [],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
  },
  TAS: {
    label: 'Tasmania',
    // Tasmania's peak is split across both ends of the day.
    weekday: {
      peak: [7, 8, 9, 16, 17, 18, 19, 20],
      shoulder: [10, 11, 12, 13, 14, 15],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    weekend: {
      peak: [],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
  },
  NT: {
    label: 'Northern Territory',
    weekday: {
      peak: [15, 16, 17, 18, 19, 20],
      shoulder: [],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    },
    weekend: {
      peak: [],
      shoulder: [],
      offPeak: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    },
  },
  ACT: {
    label: 'Australian Capital Territory',
    weekday: {
      peak: [7, 8, 15, 16, 17, 18, 19, 20],
      shoulder: [9, 10, 11, 12, 13, 14],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    weekend: {
      peak: [],
      shoulder: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      offPeak: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
  },
};

/**
 * Hours each state's clock runs ahead of AEST.
 *
 * NEM12 stamps every interval in AEST regardless of where the meter is, so
 * this is what converts a slot index into the local hour a tariff is written
 * against. `dst` marks the states that observe daylight saving.
 */
const STATE_CLOCKS = {
  NSW: { standardOffset: 0, dst: true },
  VIC: { standardOffset: 0, dst: true },
  TAS: { standardOffset: 0, dst: true },
  ACT: { standardOffset: 0, dst: true },
  SA: { standardOffset: -0.5, dst: true },
  NT: { standardOffset: -1.5, dst: false },
  QLD: { standardOffset: 0, dst: false },
  WA: { standardOffset: -2, dst: false },
};

/**
 * Is a date inside Australian daylight saving?
 *
 * DST runs from the first Sunday in October to the first Sunday in April.
 * Treating the boundary days as whole days is off by a few hours twice a year,
 * against a year of half-hourly data — immaterial, and far cheaper than
 * pulling in a timezone database.
 *
 * @param {Date} date - UTC-based date
 */
export function isDaylightSaving(date) {
  const month = date.getUTCMonth(); // 0 = January
  if (month > 3 && month < 9) return false; // May–September
  if (month === 3) return date.getUTCDate() < firstSunday(date.getUTCFullYear(), 3);
  if (month === 9) return date.getUTCDate() >= firstSunday(date.getUTCFullYear(), 9);
  return true; // October–March
}

function firstSunday(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  return 1 + ((7 - first.getUTCDay()) % 7);
}

/**
 * The local clock hour a half-hour slot falls in.
 *
 * @param {number} slot  0–47, AEST
 * @param {Date} date
 * @param {string} state
 * @returns {number} 0–23 local hour
 */
export function localHourForSlot(slot, date, state) {
  const clock = STATE_CLOCKS[state] ?? STATE_CLOCKS.SA;
  const offset = clock.standardOffset + (clock.dst && isDaylightSaving(date) ? 1 : 0);
  const localHour = slot * 0.5 + offset;
  return Math.floor(((localHour % 24) + 24) % 24);
}

/**
 * Which tariff period a slot falls in.
 *
 * @returns {'peak'|'shoulder'|'offPeak'}
 */
export function periodForSlot(slot, date, state) {
  const periods = TOU_PERIODS[state] ?? TOU_PERIODS.SA;
  const day = date.getUTCDay();
  const table = day === 0 || day === 6 ? periods.weekend : periods.weekday;
  const hour = localHourForSlot(slot, date, state);

  if (table.peak.includes(hour)) return 'peak';
  if (table.shoulder.includes(hour)) return 'shoulder';
  return 'offPeak';
}

/**
 * Build the pricing function the interval engine charges against.
 *
 * Falls back to the flat rate whenever the bill didn't give us usable
 * time-of-use rates — an invented peak rate would change the battery's payback
 * by years, so a missing rate means we simply don't claim the benefit.
 *
 * @param {object} billData
 * @param {string} state
 * @param {number} flatRateCents - the Stage 1 rate, already resolved
 * @returns {{
 *   isTou: boolean,
 *   state: string,
 *   rates: {peak: number, shoulder: number, offPeak: number}|null,
 *   flatRateCents: number,
 *   rateFor: (slot: number, date: Date) => number,
 *   periodFor: (slot: number, date: Date) => string,
 *   reason: string|null,
 * }}
 */
export function buildTariffModel(billData, state, flatRateCents) {
  const tou = billData?.touRates;
  const usable =
    tou &&
    Number.isFinite(tou.peak) &&
    tou.peak > 0 &&
    // A "peak" no higher than off-peak is a misread, not a tariff.
    (!Number.isFinite(tou.offPeak) || tou.peak > tou.offPeak);

  if (!usable) {
    return {
      isTou: false,
      state,
      rates: null,
      flatRateCents,
      rateFor: () => flatRateCents,
      periodFor: (slot, date) => periodForSlot(slot, date, state),
      reason: tou
        ? "Your bill's time-of-use rates couldn't be read reliably, so a flat rate was used."
        : null,
    };
  }

  // Shoulder is frequently absent from a bill even on a plan that has one.
  // Splitting the difference is the least wrong assumption available.
  const rates = {
    peak: tou.peak,
    shoulder: Number.isFinite(tou.shoulder) ? tou.shoulder : (tou.peak + (tou.offPeak ?? flatRateCents)) / 2,
    offPeak: Number.isFinite(tou.offPeak) ? tou.offPeak : flatRateCents,
  };

  return {
    isTou: true,
    state,
    rates,
    flatRateCents,
    rateFor: (slot, date) => rates[periodForSlot(slot, date, state)],
    periodFor: (slot, date) => periodForSlot(slot, date, state),
    reason: null,
    shoulderAssumed: !Number.isFinite(tou.shoulder),
  };
}

/**
 * Share of the day each period covers, for explaining the tariff in the UI.
 * @returns {{peak: number, shoulder: number, offPeak: number}} hours per weekday
 */
export function periodHours(state) {
  const periods = TOU_PERIODS[state] ?? TOU_PERIODS.SA;
  return {
    peak: periods.weekday.peak.length,
    shoulder: periods.weekday.shoulder.length,
    offPeak: periods.weekday.offPeak.length,
  };
}

/** "4pm–9pm" for a period's hours, or null when it has none. */
export function periodWindowLabel(state, period) {
  const hours = (TOU_PERIODS[state] ?? TOU_PERIODS.SA).weekday[period];
  if (!hours || hours.length === 0) return null;

  // Group consecutive hours so a split peak reads as two windows.
  const sorted = [...hours].sort((a, b) => a - b);
  const runs = [];
  for (const hour of sorted) {
    const last = runs[runs.length - 1];
    if (last && hour === last.end + 1) last.end = hour;
    else runs.push({ start: hour, end: hour });
  }

  return runs.map((r) => `${hourLabel(r.start)}–${hourLabel(r.end + 1)}`).join(' and ');
}

function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
