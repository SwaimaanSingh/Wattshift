import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { intervalLabel } from '../../services/nem12Parser.js';
import { kwh, number } from '../../utils/formatters.js';

/**
 * A single real day, at full resolution.
 *
 * The averaged profile is the useful one for sizing, but averages hide the
 * thing people most want to check: what actually happened on a particular day.
 * Being able to walk to a cold July Tuesday and see the battery run flat by
 * 9pm is what makes the modelling believable.
 */
export default function GenerationOverlay({
  loadByDate,
  generationByDate,
  socByDate,
  batteryKwh = 0,
  containerRef,
}) {
  const dates = useMemo(() => [...loadByDate.keys()].sort(), [loadByDate]);

  // Open on a day worth looking at rather than 1 January: the day with the
  // most generation shows the system doing something.
  const initialIndex = useMemo(() => {
    let best = 0;
    let bestTotal = -1;
    dates.forEach((date, i) => {
      const total = (generationByDate.get(date) ?? []).reduce((a, b) => a + b, 0);
      if (total > bestTotal) {
        bestTotal = total;
        best = i;
      }
    });
    return best;
  }, [dates, generationByDate]);

  const [index, setIndex] = useState(initialIndex);
  const date = dates[Math.min(index, dates.length - 1)];

  const data = useMemo(() => {
    const load = loadByDate.get(date) ?? [];
    const generation = generationByDate.get(date) ?? [];
    const soc = socByDate?.get(date) ?? [];

    return Array.from({ length: 48 }, (_, i) => ({
      time: intervalLabel(i),
      load: (load[i] ?? 0) * 2,
      generation: (generation[i] ?? 0) * 2,
      soc: soc[i] ?? 0,
    }));
  }, [date, loadByDate, generationByDate, socByDate]);

  if (!date) return null;

  const dayLoad = (loadByDate.get(date) ?? []).reduce((a, b) => a + b, 0);
  const dayGeneration = (generationByDate.get(date) ?? []).reduce((a, b) => a + b, 0);

  const step = (delta) =>
    setIndex((current) => Math.max(0, Math.min(dates.length - 1, current + delta)));

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '240ms' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Browse a single day</h2>
          <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
            Your actual half-hourly readings against modelled generation
            {batteryKwh > 0 ? ', with the battery’s charge level' : ''}.
          </p>
        </div>
        <div className="text-right text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          <p className="tnum">{number(dayLoad, 1)} kWh used</p>
          <p className="tnum">{number(dayGeneration, 1)} kWh generated</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index === 0}
          className="chip px-3 disabled:opacity-40"
          aria-label="Previous day"
        >
          ←
        </button>

        <input
          type="range"
          min={0}
          max={dates.length - 1}
          value={Math.min(index, dates.length - 1)}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label="Select a day"
          className="range w-auto flex-1"
        />

        <button
          type="button"
          onClick={() => step(1)}
          disabled={index >= dates.length - 1}
          className="chip px-3 disabled:opacity-40"
          aria-label="Next day"
        >
          →
        </button>
      </div>

      <p className="mt-2 text-center text-sm font-medium">{formatDate(date)}</p>

      <div ref={containerRef} className="mt-3 h-64 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: batteryKwh > 0 ? 4 : 6, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-ink-200 dark:stroke-ink-800" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              interval={5}
            />
            <YAxis
              yAxisId="power"
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              width={36}
              domain={[0, 'auto']}
              tickCount={5}
              allowDecimals
              tickFormatter={(v) => number(v, v >= 10 || Number.isInteger(v) ? 0 : 1)}
              label={{
                value: 'kW',
                position: 'top',
                offset: 8,
                style: { fontSize: 10, fill: 'currentColor', textAnchor: 'middle' },
              }}
            />
            {batteryKwh > 0 && (
              <YAxis
                yAxisId="soc"
                orientation="right"
                domain={[0, batteryKwh]}
                tick={{ fontSize: 10 }}
                className="fill-purple-500"
                axisLine={false}
                tickLine={false}
                width={40}
                tickCount={5}
                tickFormatter={(v) => number(v, v >= 10 || Number.isInteger(v) ? 0 : 1)}
                label={{
                  value: 'kWh',
                  position: 'top',
                  offset: 8,
                  style: { fontSize: 10, fill: 'currentColor', textAnchor: 'middle' },
                }}
              />
            )}
            <Tooltip content={<DayTooltip batteryKwh={batteryKwh} />} cursor={{ fillOpacity: 0.06 }} />

            <Bar
              yAxisId="power"
              dataKey="load"
              name="Your usage"
              fill="currentColor"
              className="text-blue-500/70 dark:text-blue-400/60"
              isAnimationActive={false}
            />
            <Area
              yAxisId="power"
              dataKey="generation"
              name="Solar generated"
              stroke="currentColor"
              className="text-amber-500"
              strokeWidth={2}
              fill="currentColor"
              fillOpacity={0.18}
              isAnimationActive={false}
            />
            {batteryKwh > 0 && (
              <Line
                yAxisId="soc"
                dataKey="soc"
                name="Battery charge"
                stroke="currentColor"
                className="text-purple-500"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {[
          { label: 'Your usage', className: 'bg-blue-500/70 dark:bg-blue-400/60' },
          { label: 'Solar generated', className: 'bg-amber-500' },
          ...(batteryKwh > 0 ? [{ label: 'Battery charge', className: 'bg-purple-500' }] : []),
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

function DayTooltip({ active, payload, label, batteryKwh }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm sm:text-xs shadow-lg dark:border-ink-700 dark:bg-ink-900">
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-ink-600 dark:text-ink-300">
        Using: <span className="tnum">{number(row.load, 2)} kW</span>
      </p>
      <p className="text-ink-600 dark:text-ink-300">
        Solar: <span className="tnum">{number(row.generation, 2)} kW</span>
      </p>
      {batteryKwh > 0 && (
        <p className="text-ink-600 dark:text-ink-300">
          Battery: <span className="tnum">{kwh(row.soc, 1)}</span> of {number(batteryKwh, 1)} kWh
        </p>
      )}
    </div>
  );
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}
