import { useEffect, useState } from 'react';
import BatteryBenefits from './BatteryBenefits.jsx';
import CapacityControl from './CapacityControl.jsx';
import { DEFAULTS } from '../config/defaults.js';
import { currency0, number, percent } from '../utils/formatters.js';

/**
 * Battery scenarios. Presets cover the common sizes for the selected site
 * type; "Custom" reveals a slider and number field for anything else, with
 * self-consumption interpolated along the curve in defaults.js.
 */
export default function BatteryToggle({
  batteryKwh,
  onChange,
  baseline,
  current,
  modeConfig,
}) {
  const { presets, minKwh, maxKwh, stepKwh } = modeConfig.battery;
  const matchesPreset = presets.some((kwh) => Math.abs(kwh - batteryKwh) < 0.01);
  const [showCustom, setShowCustom] = useState(!matchesPreset && batteryKwh > 0);

  // Switching site type swaps the presets; a size that was a preset may no
  // longer be one, so the custom panel has to follow.
  useEffect(() => {
    if (!matchesPreset && batteryKwh > 0) setShowCustom(true);
  }, [matchesPreset, batteryKwh]);

  const extraSaving = current.annualSavingsMid - baseline.annualSavingsMid;

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '180ms' }}>
      <h2 className="text-base font-semibold">What if you added a battery?</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        A battery stores daytime solar for the evening, so {modeConfig.site} buys
        less from the grid. Every figure above updates as you change this.
      </p>

      <div
        className="mt-4 flex flex-wrap gap-2"
        role="group"
        aria-label="Battery size"
      >
        {presets.map((kwh) => {
          const active = !showCustom && Math.abs(batteryKwh - kwh) < 0.01;
          return (
            <button
              key={kwh}
              type="button"
              onClick={() => {
                setShowCustom(false);
                onChange(kwh);
              }}
              aria-pressed={active}
              className={`chip py-2.5 ${active ? 'chip-active' : ''}`}
            >
              {DEFAULTS.batteryLabel(kwh)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setShowCustom(true);
            if (matchesPreset && batteryKwh === 0) {
              onChange(modeConfig.key === 'business' ? 20 : 8);
            }
          }}
          aria-pressed={showCustom}
          className={`chip py-2.5 ${showCustom ? 'chip-active' : ''}`}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="mt-4 rounded-xl border border-ink-200 p-4 dark:border-ink-800">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">Battery capacity</span>
            <span className="text-lg font-bold tabular-nums text-solar-700 dark:text-solar-400">
              {number(batteryKwh, 1)} kWh
            </span>
          </div>
          <CapacityControl
            id="battery-size"
            label="Battery capacity in kilowatt hours"
            unit="kWh"
            value={batteryKwh}
            min={minKwh}
            max={maxKwh}
            step={stepKwh}
            onChange={onChange}
            notes={modeConfig.batteryNotes}
          />
        </div>
      )}

      <div className="mt-5 rounded-xl border border-ink-200 p-4 dark:border-ink-800">
        <p className="text-sm text-ink-700 dark:text-ink-200">
          Power you use yourself instead of exporting:{' '}
          <strong className="font-semibold">
            {percent(baseline.selfConsumptionPercent)}
          </strong>
          {current.selfConsumptionPercent !== baseline.selfConsumptionPercent && (
            <>
              {' → '}
              <strong className="font-semibold text-solar-700 dark:text-solar-400">
                {percent(current.selfConsumptionPercent)}
              </strong>{' '}
              with this battery
            </>
          )}
        </p>
        {!(batteryKwh > 0) && (
          <p className="mt-1.5 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
            This uses typical household patterns. The exact figure depends on
            when you use power during the day — upload your interval meter data
            for a precise calculation.
          </p>
        )}

        {extraSaving > 0 && (
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
            That's roughly {currency0(extraSaving)} a year more than solar alone
            — before the cost of the battery itself.
          </p>
        )}
      </div>

      <div className="mt-4">
        <BatteryBenefits />
      </div>

      <p className="mt-4 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        These use typical {modeConfig.occupants} patterns. For precise
        modelling, your smart meter data would show exactly when you use power —
        that's part of the detailed analysis.
      </p>
    </section>
  );
}
