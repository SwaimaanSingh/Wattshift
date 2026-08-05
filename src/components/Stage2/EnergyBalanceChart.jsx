import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MONTH_LABELS, MONTH_KEYS, kwh } from '../../utils/formatters.js';

/**
 * Where each month's energy comes from and goes.
 *
 * Consumption is stacked (solar direct + battery + grid = everything used) and
 * export is drawn as its own bar alongside rather than stacked on top, because
 * exported energy is not consumed — stacking it would make the column read as
 * a larger bill than the customer actually has.
 */
export default function EnergyBalanceChart({
  monthly,
  batteryKwh = 0,
  containerRef,
  estimated = false,
}) {
  if (!monthly?.length) return null;

  console.log('[EnergyBalanceChart] rendering with batteryKwh=', batteryKwh);

  const data = monthly.map((month) => ({
    label: monthLabel(month.month),
    solarDirect: Math.round(month.solarToLoad ?? 0),
    fromBattery: Math.round(month.batteryToLoad ?? 0),
    gridImport: Math.round(month.gridImport ?? 0),
    exported: Math.round(month.exported ?? 0),
  }));

  const anyBattery = batteryKwh > 0 || data.some((d) => d.fromBattery > 0);

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '120ms' }}>
      <h2 className="text-base font-semibold">Month by month</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        {estimated
          ? 'Estimated from your bill totals and the local sun hours for each month.'
          : 'Each column is what you used that month, split by where it came from. The orange bar is what you sent to the grid.'}
      </p>

      <div ref={containerRef} className="mt-4 h-64 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-ink-200 dark:stroke-ink-800" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip content={<BalanceTooltip />} cursor={{ fillOpacity: 0.06 }} />

            <Bar dataKey="solarDirect" name="Solar used directly" stackId="used" fill="currentColor" className="text-solar-500" isAnimationActive={false} />
            {anyBattery && (
              <Bar dataKey="fromBattery" name="From battery" stackId="used" fill="currentColor" className="text-purple-500" isAnimationActive={false} />
            )}
            <Bar dataKey="gridImport" name="Bought from grid" stackId="used" radius={[3, 3, 0, 0]} fill="currentColor" className="text-ink-400 dark:text-ink-500" isAnimationActive={false} />
            <Bar dataKey="exported" name="Exported" radius={[3, 3, 0, 0]} fill="currentColor" className="text-amber-500" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {[
          { label: 'Solar used directly', className: 'bg-solar-500' },
          ...(anyBattery ? [{ label: 'From battery', className: 'bg-purple-500' }] : []),
          { label: 'Bought from grid', className: 'bg-ink-400 dark:bg-ink-500' },
          { label: 'Exported', className: 'bg-amber-500' },
        ].map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${item.className}`} aria-hidden="true" />
            <span className="text-sm sm:text-xs text-ink-600 dark:text-ink-300">{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Jan" from either a 'YYYY-MM' key or a 'jan' month key. */
function monthLabel(value) {
  if (MONTH_KEYS.includes(value)) return MONTH_LABELS[value];
  const month = Number(String(value).slice(5, 7));
  return MONTH_LABELS[MONTH_KEYS[month - 1]] ?? value;
}

function BalanceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const used = payload
    .filter((entry) => entry.dataKey !== 'exported')
    .reduce((sum, entry) => sum + (entry.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm sm:text-xs shadow-lg dark:border-ink-700 dark:bg-ink-900">
      <p className="font-semibold">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="mt-1 text-ink-600 dark:text-ink-300">
          {entry.name}: <span className="tnum">{kwh(entry.value)}</span>
        </p>
      ))}
      <p className="mt-1.5 border-t border-ink-200 pt-1 font-medium dark:border-ink-700">
        Total used: <span className="tnum">{kwh(used)}</span>
      </p>
    </div>
  );
}
