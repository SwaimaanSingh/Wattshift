import { useEffect, useState } from 'react';
import CapacityControl from './CapacityControl.jsx';
import { kwh, number } from '../utils/formatters.js';

const QUICK_SIZES = [3, 5, 6.6, 10, 13.2];

/**
 * Shown when the bill shows solar export — the customer already has a system,
 * so the whole recommendation changes shape.
 *
 * Export alone cannot size the system (it is surplus after self-consumption),
 * so we never invent a kW figure here. Manual size is optional.
 */
export default function ExistingSolar({ billData, value, onChange }) {
  const matchesPreset = value != null && QUICK_SIZES.some((s) => Math.abs(s - value) < 0.01);
  const [showCustom, setShowCustom] = useState(value != null && !matchesPreset);

  useEffect(() => {
    if (value != null && !QUICK_SIZES.some((s) => Math.abs(s - value) < 0.01)) {
      setShowCustom(true);
    }
  }, [value]);

  const dailyExport =
    billData.solarExportKwh && billData.billingDays
      ? billData.solarExportKwh / billData.billingDays
      : null;

  return (
    <section className="card animate-fade-up border-solar-200 bg-solar-50/40 dark:border-solar-900 dark:bg-solar-900/10">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <span aria-hidden="true">☀️</span>
        You already have solar
      </h2>

      <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">
        Your bill shows {kwh(billData.solarExportKwh, dailyExport < 1 ? 1 : 0)}{' '}
        sent back to the grid
        {dailyExport != null && ` — about ${number(dailyExport, 1)} kWh a day`}.
      </p>

      <fieldset className="mt-4">
        <legend className="label">Do you know your system size?</legend>
        <div className="flex flex-wrap gap-2">
          {QUICK_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => {
                setShowCustom(false);
                onChange(size);
              }}
              aria-pressed={!showCustom && value === size}
              className={`chip ${!showCustom && value === size ? 'chip-active' : ''}`}
            >
              {size} kW
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setShowCustom(true);
              if (value == null || matchesPreset) onChange(value ?? 6.6);
            }}
            aria-pressed={showCustom}
            className={`chip ${showCustom ? 'chip-active' : ''}`}
          >
            Custom
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCustom(false);
              onChange(null);
            }}
            aria-pressed={!showCustom && value == null}
            className={`chip ${!showCustom && value == null ? 'chip-active' : ''}`}
          >
            I don&apos;t know
          </button>
        </div>
      </fieldset>

      {showCustom && value != null && (
        <div className="mt-4 rounded-xl border border-ink-200 p-4 dark:border-ink-800">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">System size</span>
            <span className="text-lg font-bold tabular-nums text-solar-700 dark:text-solar-400">
              {number(value, 1)} kW
            </span>
          </div>
          <CapacityControl
            id="existing-solar-size"
            label="Existing system size in kilowatts"
            unit="kW"
            value={value}
            min={1}
            max={50}
            step={0.1}
            onChange={onChange}
          />
        </div>
      )}

      {value == null && (
        <p className="mt-3 text-sm sm:text-xs text-ink-600 dark:text-ink-300">
          A bill alone can&apos;t measure an existing system. For an accurate
          performance check, upload your interval/meter data.
        </p>
      )}
    </section>
  );
}
