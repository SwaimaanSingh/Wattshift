import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MONTH_KEYS, MONTH_LABELS, kwh } from '../utils/formatters.js';

/**
 * Month-by-month use versus generation.
 *
 * Months backed by an actual bill are drawn solid; months we've estimated are
 * drawn faded, so it's obvious which is which.
 */
export default function MonthlyBreakdown({ profile, production, containerRef }) {
  if (!profile?.monthly) return null;

  const data = MONTH_KEYS.map((month) => ({
    month: MONTH_LABELS[month],
    used: profile.monthly[month] ?? 0,
    generated: production?.monthly?.[month] ?? 0,
    measured: Boolean(profile.coverage?.[month]),
  }));

  const anyEstimated = data.some((d) => !d.measured);

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '240ms' }}>
      <h2 className="text-base font-semibold">Through the year</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        Solar peaks in summer, while your use may not — which is why the yearly
        totals matter more than any single month.
      </p>

      {/* min-w-0 + overflow-hidden: Recharts sizes its legend from the chart's
          own width, which can exceed the container on narrow phones and make
          the whole page scroll sideways. */}
      <div ref={containerRef} className="mt-5 h-64 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-ink-200 dark:stroke-ink-800" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              className="fill-ink-500"
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fillOpacity: 0.06 }} />
            {/* Custom legend: the two usage colours carry different meanings
                (measured vs estimated), which a per-series legend can't say. */}
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8, width: '100%', left: 0 }}
              content={() => <ChartLegend showEstimated={anyEstimated} />}
            />
            {/* Animation off deliberately: Recharts grows bars from zero via
                requestAnimationFrame, which never fires while the tab isn't
                compositing — the bars would stay flat and read as "no usage". */}
            <Bar dataKey="used" name="You use" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill="currentColor"
                  className={
                    entry.measured
                      ? 'text-ink-400 dark:text-ink-500'
                      : 'text-ink-200 dark:text-ink-700'
                  }
                />
              ))}
            </Bar>
            <Bar
              dataKey="generated"
              name="Solar makes"
              radius={[3, 3, 0, 0]}
              fill="currentColor"
              className="text-solar-500"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {anyEstimated && (
        <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          Upload more bills to replace the estimated months with real data.
        </p>
      )}
    </section>
  );
}

function ChartLegend({ showEstimated }) {
  const items = [
    {
      key: 'actual',
      label: 'Actual usage (from your bill)',
      className: 'bg-ink-400 dark:bg-ink-500',
    },
    ...(showEstimated
      ? [
          {
            key: 'estimated',
            label: 'Estimated usage (average)',
            className: 'bg-ink-200 dark:bg-ink-700',
          },
        ]
      : []),
    { key: 'solar', label: 'Solar production', className: 'bg-solar-500' },
  ];

  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-1">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-sm ${item.className}`}
            aria-hidden="true"
          />
          <span className="text-sm sm:text-xs text-ink-600 dark:text-ink-300">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const measured = payload[0]?.payload?.measured;

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm sm:text-xs shadow-lg dark:border-ink-700 dark:bg-ink-900">
      <p className="font-semibold">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="mt-1 text-ink-600 dark:text-ink-300">
          {entry.name}: <span className="tnum">{kwh(entry.value)}</span>
        </p>
      ))}
      {!measured && (
        <p className="mt-1 italic text-ink-400">estimated from your average</p>
      )}
    </div>
  );
}
