import { useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { intervalLabel } from '../../services/nem12Parser.js';
import { number } from '../../utils/formatters.js';

const VIEWS = [
  { key: 'all', label: 'Average day' },
  { key: 'weekday', label: 'Weekday' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'summer', label: 'Summer' },
  { key: 'winter', label: 'Winter' },
];

/**
 * The average day: what the house draws, against what the roof would make.
 *
 * The chart is stacked rather than drawn as two bare lines, because the useful
 * information is in the areas between them — the overlap is free electricity,
 * the load above the line is what still has to be bought, and the generation
 * above the line is what gets exported for a few cents.
 *
 * Values are shown in kW rather than kWh per interval. People know what a
 * 3 kW draw feels like; "1.5 kWh per half hour" is the same statement in a
 * unit nobody thinks in.
 */
export default function LoadProfileChart({ hourlyAverage, containerRef, batteryKwh = 0 }) {
  const [view, setView] = useState('all');
  const profile = hourlyAverage?.[view];

  if (!profile) return null;

  const data = profile.load.map((load, i) => {
    const generation = profile.generation[i] ?? 0;
    const selfConsumed = profile.selfConsumed[i] ?? 0;
    const batteryToLoad = profile.batteryToLoad[i] ?? 0;

    return {
      slot: i,
      time: intervalLabel(i),
      // Half-hourly energy expressed as average power over the interval.
      load: load * 2,
      generation: generation * 2,
      selfConsumed: selfConsumed * 2,
      fromBattery: batteryToLoad * 2,
      gridImport: (profile.gridImport[i] ?? 0) * 2,
      exported: (profile.exported[i] ?? 0) * 2,
    };
  });

  const dayLoad = profile.load.reduce((a, b) => a + b, 0);
  const dayGeneration = profile.generation.reduce((a, b) => a + b, 0);

  return (
    <section className="card animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Your day, half hour by half hour</h2>
          <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
            Averaged from your own meter readings. Where the yellow sits above
            the blue, you're exporting; where the blue sits above, you're buying.
          </p>
        </div>
        <div className="text-right text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          <p className="tnum">{number(dayLoad, 1)} kWh used</p>
          <p className="tnum">{number(dayGeneration, 1)} kWh generated</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Profile view">
        {VIEWS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={view === option.key}
            onClick={() => setView(option.key)}
            className={`chip ${view === option.key ? 'chip-active' : ''}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div ref={containerRef} className="mt-4 h-72 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-ink-200 dark:stroke-ink-800" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              // Every 3 hours: any denser and the labels collide on a phone.
              interval={5}
            />
            <YAxis
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
            <Tooltip content={<ProfileTooltip batteryKwh={batteryKwh} />} cursor={{ strokeOpacity: 0.2 }} />

            {/* Solar you use as it is made — the money-saving area. */}
            <Area
              dataKey="selfConsumed"
              name="Solar used directly"
              stroke="none"
              fill="currentColor"
              className="text-solar-500"
              fillOpacity={0.45}
              isAnimationActive={false}
            />
            <Area
              dataKey="generation"
              name="Solar generated"
              stroke="currentColor"
              className="text-amber-500"
              strokeWidth={2}
              fill="currentColor"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Line
              dataKey="load"
              name="Your usage"
              stroke="currentColor"
              className="text-blue-600 dark:text-blue-400"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {batteryKwh > 0 && (
              <Line
                dataKey="fromBattery"
                name="From battery"
                stroke="currentColor"
                className="text-purple-500"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Legend batteryKwh={batteryKwh} />
    </section>
  );
}

function Legend({ batteryKwh }) {
  const items = [
    { label: 'Your usage', className: 'bg-blue-600 dark:bg-blue-400' },
    { label: 'Solar generated', className: 'bg-amber-500' },
    { label: 'Solar used directly', className: 'bg-solar-500' },
    ...(batteryKwh > 0 ? [{ label: 'Supplied by battery', className: 'bg-purple-500' }] : []),
  ];

  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${item.className}`} aria-hidden="true" />
          <span className="text-sm sm:text-xs text-ink-600 dark:text-ink-300">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ProfileTooltip({ active, payload, label, batteryKwh }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  const rows = [
    ['Using', row.load],
    ['Solar making', row.generation],
    ['Solar used', row.selfConsumed],
    batteryKwh > 0 && row.fromBattery > 0.01 ? ['From battery', row.fromBattery] : null,
    row.gridImport > 0.01 ? ['Buying from grid', row.gridImport] : null,
    row.exported > 0.01 ? ['Exporting', row.exported] : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm sm:text-xs shadow-lg dark:border-ink-700 dark:bg-ink-900">
      <p className="font-semibold">{label}</p>
      {rows.map(([name, value]) => (
        <p key={name} className="mt-1 text-ink-600 dark:text-ink-300">
          {name}: <span className="tnum">{number(value, 2)} kW</span>
        </p>
      ))}
    </div>
  );
}
