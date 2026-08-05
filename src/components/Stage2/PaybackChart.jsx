import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SYSTEM_COSTS_2026 } from '../../config/defaults.js';
import { currency0, number } from '../../utils/formatters.js';

/**
 * Cumulative cash position over 25 years.
 *
 * The band between the pessimistic and optimistic cases is the honest part of
 * this chart — a single line implies a precision that a 25-year projection of
 * electricity prices does not have. Where it crosses zero is the payback.
 */
export default function PaybackChart({ costs, containerRef }) {
  const mid = costs.lifetime?.mid;
  if (!mid?.rows?.length) return null;

  const { panelDegradationPerYear, electricityPriceGrowth } = SYSTEM_COSTS_2026.projection;

  const data = mid.rows.map((row, i) => ({
    year: row.year,
    mid: row.cumulative,
    low: costs.lifetime.low.rows[i]?.cumulative ?? row.cumulative,
    high: costs.lifetime.high.rows[i]?.cumulative ?? row.cumulative,
    // Recharts stacks an area from the band's floor upward.
    bandFloor: costs.lifetime.low.rows[i]?.cumulative ?? row.cumulative,
    bandHeight:
      (costs.lifetime.high.rows[i]?.cumulative ?? row.cumulative) -
      (costs.lifetime.low.rows[i]?.cumulative ?? row.cumulative),
    replacement: row.replacement,
  }));

  const breakEven = mid.breakEvenYear;

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '420ms' }}>
      <h2 className="text-base font-semibold">Paying for itself</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        Cumulative position after the up-front cost, allowing for panels losing{' '}
        {number(panelDegradationPerYear * 100, 1)}% of their output a year and
        electricity prices rising {number(electricityPriceGrowth * 100, 0)}% a
        year.
      </p>

      <div ref={containerRef} className="mt-4 h-64 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-ink-200 dark:stroke-ink-800" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              interval={4}
              label={{ value: 'Year', position: 'insideBottomRight', offset: -2, style: { fontSize: 10 } }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              width={58}
              tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
            />
            <Tooltip content={<PaybackTooltip />} cursor={{ strokeOpacity: 0.2 }} />

            <ReferenceLine y={0} className="stroke-ink-400" strokeWidth={1.5} />
            {breakEven != null && (
              <ReferenceLine
                x={Math.round(breakEven)}
                strokeDasharray="4 3"
                className="stroke-solar-600"
                label={{
                  value: `pays back ~yr ${number(breakEven, 1)}`,
                  position: 'insideTopLeft',
                  style: { fontSize: 10 },
                  className: 'fill-solar-700',
                }}
              />
            )}

            {/* Uncertainty band, drawn as an invisible floor plus a visible body. */}
            <Area dataKey="bandFloor" stackId="band" stroke="none" fill="none" isAnimationActive={false} />
            <Area
              dataKey="bandHeight"
              stackId="band"
              name="Range"
              stroke="none"
              fill="currentColor"
              className="text-solar-500"
              fillOpacity={0.18}
              isAnimationActive={false}
            />

            <Line
              dataKey="mid"
              name="Expected"
              stroke="currentColor"
              className="text-solar-600"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Figure label="Up-front cost" value={currency0(mid.netCost)} />
        <Figure
          label="Pays for itself"
          value={breakEven != null ? `year ${number(breakEven, 1)}` : 'beyond 25 years'}
        />
        <Figure label="25-year benefit" value={currency0(mid.netBenefit)} highlight />
      </dl>

      {mid.totalReplacements > 0 && (
        <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          Includes {currency0(mid.totalReplacements)} to replace the battery
          after {SYSTEM_COSTS_2026.projection.batteryLifeYears} years — the dip
          in the line. Assuming it lasts the full 25 would flatter the result.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, highlight }) {
  return (
    <div>
      <dt className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">{label}</dt>
      <dd
        className={`tnum text-sm font-semibold ${highlight ? 'text-solar-700 dark:text-solar-400' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function PaybackTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm sm:text-xs shadow-lg dark:border-ink-700 dark:bg-ink-900">
      <p className="font-semibold">Year {label}</p>
      <p className="mt-1 text-ink-600 dark:text-ink-300">
        Expected: <span className="tnum">{currency0(row.mid)}</span>
      </p>
      <p className="text-ink-500 dark:text-ink-400">
        Range: <span className="tnum">{currency0(row.low)} – {currency0(row.high)}</span>
      </p>
      {row.replacement > 0 && (
        <p className="mt-1 text-amber-600 dark:text-amber-400">
          Battery replacement: −{currency0(row.replacement)}
        </p>
      )}
    </div>
  );
}
