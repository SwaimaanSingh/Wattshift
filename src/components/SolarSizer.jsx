import { useMemo } from 'react';
import CapacityControl from './CapacityControl.jsx';
import { centsPerDayAsMonthly, number } from '../utils/formatters.js';

/**
 * Adjustable system capacity. Everything on the results page recalculates as
 * this moves, so people can answer "what if I went bigger?" themselves rather
 * than accepting a single recommended number.
 */
export default function SolarSizer({
  systemKw,
  recommendedKw,
  onChange,
  nearZero,
  supplyChargeCents,
  modeConfig,
  title = 'Try a different size',
  description,
}) {
  const { minKw, maxKw, stepKw, quickSizes, hints } = modeConfig.slider;

  const percentOf = (kw) =>
    ((Math.min(kw, maxKw) - minKw) / (maxKw - minKw)) * 100;

  const activeHint = useMemo(
    () => hints.find((h) => Math.abs(h.kw - systemKw) < Math.max(0.35, h.kw * 0.03)),
    [hints, systemKw]
  );

  const atNearZero = nearZero && Math.abs(systemKw - nearZero.kw) < 0.05;

  return (
    <section
      className="card flex h-full flex-col animate-fade-up"
      style={{ animationDelay: '90ms' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-2xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
          {number(systemKw, 1)} kW
        </p>
      </div>

      <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
        {description ??
          `Drag, or type an exact size, to see what a bigger or smaller system would do for ${modeConfig.site}.`}
      </p>

      <div className="mt-5">
        <CapacityControl
          id="solar-size"
          label="System size in kilowatts"
          unit="kW"
          value={systemKw}
          min={minKw}
          max={maxKw}
          step={stepKw}
          onChange={onChange}
          notes={modeConfig.solarNotes}
        />

        {/* Recommended marker sits under the track at its true position. */}
        <div className="relative mt-1 h-5">
          <div
            className="absolute -translate-x-1/2 whitespace-nowrap text-sm sm:text-xs font-medium text-solar-700 dark:text-solar-400"
            style={{ left: `${Math.min(88, Math.max(8, percentOf(recommendedKw)))}%` }}
          >
            ▲ Recommended: {number(recommendedKw, 1)} kW
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {quickSizes.map((kw) => (
          <button
            key={kw}
            type="button"
            onClick={() => onChange(kw)}
            aria-pressed={Math.abs(systemKw - kw) < 0.05}
            className={`chip ${Math.abs(systemKw - kw) < 0.05 ? 'chip-active' : ''}`}
          >
            {number(kw, kw % 1 === 0 ? 0 : 1)} kW
          </button>
        ))}
        <button type="button" onClick={() => onChange(recommendedKw)} className="chip">
          Reset
        </button>
      </div>

      {activeHint && (
        <p className="mt-3 inline-flex rounded-lg bg-solar-50 px-2.5 py-1 text-sm sm:text-xs font-medium text-solar-800 dark:bg-solar-900/30 dark:text-solar-300">
          {activeHint.label}
        </p>
      )}

      <div className="mt-auto border-t border-ink-200 pt-4 dark:border-ink-800">
        <button
          type="button"
          onClick={() => nearZero && onChange(nearZero.kw)}
          disabled={!nearZero}
          className="btn-secondary w-full"
        >
          What size makes my bill nearly zero?
        </button>

        {atNearZero && nearZero && (
          <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
            {nearZero.reachable ? (
              <>
                To get your costs about as low as they go you'd need around{' '}
                <strong className="font-semibold text-ink-900 dark:text-ink-100">
                  {number(nearZero.kw, 1)} kW
                </strong>
                . Your bill can get down to roughly{' '}
                {centsPerDayAsMonthly(supplyChargeCents)} — your supply charge —
                but not truly zero while you're connected to the grid.
              </>
            ) : (
              <>
                Even at {number(nearZero.kw, 1)} kW — the largest size shown here
                — your bill wouldn't reach its floor of about{' '}
                {centsPerDayAsMonthly(supplyChargeCents)} (your supply charge),
                because your feed-in tariff is low and you use a lot of power at
                night. A battery changes this considerably: try one below.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
