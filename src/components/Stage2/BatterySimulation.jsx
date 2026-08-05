import { DEFAULTS } from '../../config/defaults.js';
import { currency0, kwh, number, percent } from '../../utils/formatters.js';

/** Batteries are warranted in cycles; this is the figure the datasheets quote. */
const TYPICAL_CYCLE_LIFE = 6000;

/**
 * Battery sizing, with the numbers coming from the customer's own data.
 *
 * Stage 1 has the same control, but there it moves a modelled ratio. Here it
 * re-runs the dispatch simulation over a year of real readings, so the figures
 * change for a reason the customer can point at.
 */
export default function BatterySimulation({
  batteryKwh,
  onChange,
  withBattery,
  withoutBattery,
  modeConfig,
  annualisationFactor = 1,
  assessingExisting = false,
}) {
  const battery = modeConfig.battery;
  const base = withoutBattery.annual;
  const current = withBattery.annual;

  const presets = [...battery.presets];
  const isCustom = batteryKwh > 0 && !presets.some((k) => Math.abs(k - batteryKwh) < 0.01);
  if (isCustom) presets.push(batteryKwh);
  presets.sort((a, b) => a - b);

  const extraSelfConsumed = current.selfConsumed - base.selfConsumed;
  const importAvoided = base.gridImport - current.gridImport;
  const cyclesPerYear = current.batteryCyclesPerYear;
  const lifeYears = cyclesPerYear > 0 ? TYPICAL_CYCLE_LIFE / cyclesPerYear : null;

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '300ms' }}>
      <h2 className="text-base font-semibold">
        {assessingExisting ? 'Your battery' : 'What a battery does for you'}
      </h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        {assessingExisting
          ? 'Change the size below to see how storage shifts month-by-month grid imports on the chart above.'
          : 'Modelled by charging and discharging against your actual readings, half hour by half hour, for every day of your data.'}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {presets.map((kwhValue) => (
          <button
            key={kwhValue}
            type="button"
            onClick={() => onChange(kwhValue)}
            aria-pressed={Math.abs(kwhValue - batteryKwh) < 0.01}
            className={`chip ${Math.abs(kwhValue - batteryKwh) < 0.01 ? 'chip-active' : ''}`}
          >
            {DEFAULTS.batteryLabel(kwhValue)}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="stage2-battery" className="label">
          Battery capacity: <span className="tnum">{number(batteryKwh, 1)} kWh</span>
        </label>
        <input
          id="stage2-battery"
          type="range"
          min={0}
          max={battery.maxKwh}
          step={battery.stepKwh}
          value={batteryKwh}
          onChange={(e) => onChange(Number(e.target.value))}
          className="range"
        />
      </div>

      {assessingExisting ? (
        batteryKwh > 0 ? (
          <p className="mt-4 rounded-xl bg-solar-50 px-4 py-3 text-sm text-solar-900 dark:bg-solar-900/25 dark:text-solar-100">
            Battery: {number(batteryKwh, 1)} kWh — stores daytime solar for evening use.
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-600 dark:text-ink-300">
            No battery selected. Choose a size to see evening grid imports fall on the
            month-by-month chart.
          </p>
        )
      ) : batteryKwh > 0 ? (
        <>
          <p className="mt-4 rounded-xl bg-solar-50 px-4 py-3 text-sm text-solar-900 dark:bg-solar-900/25 dark:text-solar-100">
            With a {number(batteryKwh, 1)} kWh battery, you'd use{' '}
            <strong className="font-semibold">
              {percent(current.selfConsumptionRatio * 100)}
            </strong>{' '}
            of your solar instead of{' '}
            <strong className="font-semibold">{percent(base.selfConsumptionRatio * 100)}</strong> —
            keeping another {kwh(Math.round(extraSelfConsumed * annualisationFactor))} a year that
            would otherwise have been exported for a few cents.
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
            <Stat label="Grid power avoided" value={`${kwh(Math.round(importAvoided * annualisationFactor))}/yr`} />
            <Stat label="Cycles per year" value={number(cyclesPerYear)} />
            <Stat
              label="At that rate, lasts"
              value={lifeYears ? `~${number(Math.min(lifeYears, 25), 0)} years` : '—'}
              hint={`${number(TYPICAL_CYCLE_LIFE)} cycle warranty`}
            />
            <Stat label="Stored per year" value={`${kwh(Math.round(current.solarToBattery * annualisationFactor))}`} />
            <Stat
              label="Round-trip losses"
              value={`${kwh(Math.round(current.batteryLosses * annualisationFactor))}/yr`}
              hint="about 10% of what goes in"
            />
            <Stat
              label="Still bought from grid"
              value={`${kwh(Math.round(current.gridImport * annualisationFactor))}/yr`}
            />
          </dl>

          {cyclesPerYear > 0 && cyclesPerYear < 200 && (
            <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
              At {number(cyclesPerYear)} cycles a year this battery is rarely
              filling completely — a smaller one would do nearly the same job
              for less.
            </p>
          )}

          {current.gridCost > 0 && base.gridCost > current.gridCost && (
            <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
              On your tariff, that's about{' '}
              <strong className="font-semibold text-ink-800 dark:text-ink-100">
                {currency0(Math.round((base.gridCost - current.gridCost) * annualisationFactor))}
              </strong>{' '}
              a year off your grid purchases.
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-600 dark:text-ink-300">
          Without a battery you'd use {percent(base.selfConsumptionRatio * 100)} of
          your solar as it's generated and export the rest. Move the slider to
          see what storage would change.
        </p>
      )}

      {modeConfig.batteryNotes
        ?.filter((note) => batteryKwh > note.above)
        .map((note) => (
          <p key={note.text} className="mt-3 text-sm sm:text-xs text-amber-700 dark:text-amber-400">
            {note.text}
          </p>
        ))}
    </section>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <dt className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="tnum text-sm font-semibold">{value}</dd>
      {hint && <p className="text-sm text-ink-400 sm:text-[11px] dark:text-ink-500">{hint}</p>}
    </div>
  );
}
