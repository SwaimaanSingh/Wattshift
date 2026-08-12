import { useEffect, useState } from 'react';
import { monthYearLabel } from '../../services/existingSystemEstimate.js';
import { number, shortDate } from '../../utils/formatters.js';

/**
 * Plausible range for a residential/small-commercial array.
 *
 * Outside it the downstream analysis stops meaning anything: a sub-1.5 kW
 * figure makes the modelled generation so small that the daytime share
 * collapses toward zero, and a 100 kW+ figure swamps the measured load so the
 * usage pattern reads as if the site exports almost everything it makes.
 */
const MIN_SOLAR_KW = 1.5;
const MAX_SOLAR_KW = 100;
const SOLAR_RANGE_MESSAGE = `Please enter a system size between ${MIN_SOLAR_KW} kW and ${MAX_SOLAR_KW} kW`;

/**
 * The headline call-out for a detected install partway through the file.
 *
 * This is deliberately the first thing on the page when it applies — getting
 * this wrong is what made a 12.75 kW system read as 1.2 kW, so it is framed
 * as a finding worth knowing about, not a quiet correction buried in a
 * methodology footnote.
 */
export function SetupChangeBanner({
  setupChange,
  resolvedExistingSolarKw,
  resolvedExistingBatteryKwh,
}) {
  if (!setupChange?.detected) return null;

  const label = monthYearLabel(setupChange.changeDate);
  const days = setupChange.postDays;
  const strong = resolvedExistingSolarKw >= 3;

  return (
    <section className="mb-5 rounded-2xl border border-solar-300 bg-solar-50/70 p-5 dark:border-solar-800 dark:bg-solar-900/20">
      <p className="flex items-start gap-2 text-sm font-semibold text-solar-900 dark:text-solar-100">
        <span aria-hidden="true">📅</span>
        <span>
          Analysing {number(days)} days of post-install data (from {label})
        </span>
      </p>

      {strong && (
        <p className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-sm font-medium text-ink-800 dark:bg-ink-900/30 dark:text-ink-100">
          You already have a strong solar{resolvedExistingBatteryKwh > 0 ? ' + battery' : ''}{' '}
          setup (~{number(resolvedExistingSolarKw, 1)} kW solar
          {resolvedExistingBatteryKwh > 0
            ? `, ${number(resolvedExistingBatteryKwh, 1)} kWh battery`
            : ''}
          ). Here's how it's performing against your actual usage.
        </p>
      )}
    </section>
  );
}

/**
 * Pre vs post install grid-draw comparison — the clearest proof the system
 * is working. Numbers come from E1 either side of the detected install date.
 */
export function PrePostInstallInsight({
  setupChange,
  tariffCents,
  feedInCents,
  annualExportKwh,
}) {
  if (!setupChange?.detected) return null;

  const pre = setupChange.preAvgImportKwh;
  const post = setupChange.postAvgImportKwh;
  if (!(pre > 0) || !(post >= 0) || post >= pre) return null;

  const reductionPerDay = pre - post;
  const annualGridSavingKwh = reductionPerDay * 365;
  const rateDollars = (tariffCents ?? 0) / 100;
  const feedInDollars = (feedInCents ?? 0) / 100;
  const gridSavingValue = annualGridSavingKwh * rateDollars;
  const exportRevenue = (annualExportKwh ?? 0) * feedInDollars;

  return (
    <section className="mb-5 rounded-2xl border border-solar-300 bg-solar-50/70 p-5 dark:border-solar-800 dark:bg-solar-900/20">
      <h2 className="text-base font-semibold text-solar-900 dark:text-solar-100">
        Before and after your install
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-700 dark:text-ink-200">
        Before your solar and battery were installed, your home drew about{' '}
        <strong className="font-semibold text-ink-900 dark:text-ink-50">
          {number(pre, 1)} kWh
        </strong>{' '}
        from the grid every day. Now it draws just{' '}
        <strong className="font-semibold text-ink-900 dark:text-ink-50">
          {number(post, 1)} kWh
        </strong>{' '}
        — a reduction of {number(reductionPerDay, 1)} kWh/day. Over a year,
        that's about {number(Math.round(annualGridSavingKwh))} kWh less grid
        electricity
        {gridSavingValue > 0
          ? `, worth roughly $${number(Math.round(gridSavingValue))} at your current rates`
          : ''}
        .
        {exportRevenue > 0
          ? ` Your system is also earning ~$${number(Math.round(exportRevenue))}/year from solar exported to the grid.`
          : ''}
      </p>
    </section>
  );
}

/**
 * Manual solar/battery/inverter entry, always available once we've found
 * export in the meter data — whether or not a setup change was detected —
 * because the peak-export estimate is a floor, not a fact.
 */
export function ExistingSystemInputs({
  estimatedSolar,
  solarKwOverride,
  onSolarKwOverrideChange,
  hasBattery,
  onHasBatteryChange,
  batteryKwh,
  onBatteryKwhChange,
  inverterKw,
  onInverterKwChange,
  resolvedExistingSolarKw,
  batteryDetectionNote = null,
}) {
  const usingEstimate = solarKwOverride == null;

  return (
    <section className="card animate-fade-up">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <span aria-hidden="true">☀️</span>
        Your existing solar and battery
      </h2>

      <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
        {estimatedSolar
          ? `Your export data suggests a system of at least ${number(estimatedSolar.kw, 1)} kW — the largest single reading we found, on ${shortDate(estimatedSolar.atDate)}. Enter your actual specs below for a precise result.`
          : "We couldn't estimate a size from your export data. Enter your actual specs below if you know them."}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SolarSizeField
          id="existing-solar-kw"
          label="Solar system size"
          suffix="kW"
          placeholder={estimatedSolar ? number(estimatedSolar.kw, 2) : 'e.g. 6.6'}
          value={solarKwOverride}
          onChange={onSolarKwOverrideChange}
        />
        <NumberField
          id="existing-inverter-kw"
          label="Inverter size (optional)"
          suffix="kW"
          placeholder="e.g. 5"
          value={inverterKw}
          onChange={onInverterKwChange}
        />
      </div>

      <fieldset className="mt-4">
        <legend className="label">Do you have a battery?</legend>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onHasBatteryChange(false)}
            aria-pressed={!hasBattery}
            className={`chip ${!hasBattery ? 'chip-active' : ''}`}
          >
            No battery
          </button>
          <button
            type="button"
            onClick={() => onHasBatteryChange(true)}
            aria-pressed={hasBattery}
            className={`chip ${hasBattery ? 'chip-active' : ''}`}
          >
            Yes, I have one
          </button>
        </div>
        {hasBattery && (
          <div className="mt-3 max-w-[220px]">
            <NumberField
              id="existing-battery-kwh"
              label="Battery capacity"
              suffix="kWh"
              placeholder="e.g. 10, 15, 20, 25"
              value={batteryKwh}
              onChange={onBatteryKwhChange}
            />
          </div>
        )}
        {batteryDetectionNote && (
          <p className="mt-3 rounded-xl bg-solar-50 px-3 py-2.5 text-sm sm:text-xs text-solar-900 dark:bg-solar-900/25 dark:text-solar-100">
            {batteryDetectionNote}
          </p>
        )}
      </fieldset>

      <p className="mt-4 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        {usingEstimate
          ? `We're working with the ~${number(resolvedExistingSolarKw, 1)} kW estimate above.`
          : `Using the ${number(resolvedExistingSolarKw, 1)} kW you entered.`}{' '}
        {hasBattery &&
          "A battery absorbs daytime surplus before it reaches the meter, so your real system may be larger than an export-based estimate suggests — entering your actual size fixes that."}
      </p>
    </section>
  );
}

/**
 * Solar size entry, range-checked.
 *
 * Kept separate from NumberField rather than adding options to it: the
 * inverter and battery fields share that component, and buffering their input
 * the way this one does would change their behaviour too.
 *
 * What the user types is held locally and only handed upstream once it is
 * valid, so an out-of-range figure never reaches the analysis. The last good
 * value stays in effect and the results on screen keep referring to it, rather
 * than the page recalculating against 121 kW or blanking out mid-edit.
 *
 * An empty field is valid and does propagate: null means "no override", which
 * is how the caller falls back to the export-based estimate.
 */
function SolarSizeField({ id, label, suffix, placeholder, value, onChange }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));

  // Re-sync when the value changes from outside this field. Compared as a
  // number so a half-typed "6." is not rewritten to "6" under the cursor.
  useEffect(() => {
    const draftValue = draft.trim() === '' ? null : Number(draft);
    const matches = value == null ? draftValue == null : draftValue === value;
    if (!matches) setDraft(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const trimmed = draft.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const outOfRange =
    parsed != null &&
    (!Number.isFinite(parsed) || parsed < MIN_SOLAR_KW || parsed > MAX_SOLAR_KW);

  const errorId = `${id}-error`;

  const handleChange = (raw) => {
    setDraft(raw);

    const next = raw.trim();
    if (next === '') {
      onChange(null); // clearing the override is a valid state
      return;
    }

    const numeric = Number(next);
    if (!Number.isFinite(numeric) || numeric < MIN_SOLAR_KW || numeric > MAX_SOLAR_KW) {
      return; // hold the last valid value upstream — no recalculation
    }
    onChange(numeric);
  };

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={MIN_SOLAR_KW}
          max={MAX_SOLAR_KW}
          step={0.01}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          aria-invalid={outOfRange}
          aria-describedby={outOfRange ? errorId : undefined}
          className={`field pr-12 ${outOfRange ? 'border-red-500 focus:border-red-500 focus:ring-red-500/25' : ''}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm sm:text-xs text-ink-400 dark:text-ink-500">
          {suffix}
        </span>
      </div>
      {outOfRange && (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-sm sm:text-xs text-red-600 dark:text-red-400"
        >
          {SOLAR_RANGE_MESSAGE}
        </p>
      )}
    </div>
  );
}

function NumberField({ id, label, suffix, placeholder, value, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          className="field pr-12"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm sm:text-xs text-ink-400 dark:text-ink-500">
          {suffix}
        </span>
      </div>
    </div>
  );
}
