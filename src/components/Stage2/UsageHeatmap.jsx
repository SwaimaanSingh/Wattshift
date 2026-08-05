import { useState } from 'react';
import { MONTH_KEYS, MONTH_LABELS, number } from '../../utils/formatters.js';

const CELL = 26;
const ROW = 22;
const LEFT = 34;
const TOP = 18;

/**
 * Consumption by hour of day against month of year.
 *
 * Drawn as hand-rolled SVG rather than a chart library, for two reasons: no
 * library does a categorical heatmap well, and an SVG rasterises cleanly into
 * the PDF report through the same path as every other chart here. A grid of
 * divs would need html2canvas and a whole extra dependency to reach the page.
 */
export default function UsageHeatmap({ heatmap, containerRef }) {
  const [hover, setHover] = useState(null);

  if (!heatmap?.length) return null;

  const values = heatmap.flat();
  const max = Math.max(...values, 0.001);

  const width = LEFT + 24 * CELL + 8;
  const height = TOP + 12 * ROW + 22;

  // The hottest cell — worth naming, since it is the whole point of the chart.
  let hottest = { month: 0, hour: 0, value: -1 };
  heatmap.forEach((row, month) =>
    row.forEach((value, hour) => {
      if (value > hottest.value) hottest = { month, hour, value };
    })
  );

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '180ms' }}>
      <h2 className="text-base font-semibold">When you use power, across the year</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        Darker means more. Your heaviest hour is{' '}
        <strong className="font-semibold text-ink-800 dark:text-ink-100">
          {hourLabel(hottest.hour)} in {MONTH_LABELS[MONTH_KEYS[hottest.month]]}
        </strong>
        , averaging {number(hottest.value, 1)} kWh.
      </p>

      <div ref={containerRef} className="mt-4 w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="min-w-[520px] max-w-full"
          role="img"
          aria-label="Heatmap of average consumption by hour of day and month of year"
        >
          {/* Hour labels, every three hours to stay legible. */}
          {Array.from({ length: 24 }, (_, hour) =>
            hour % 3 === 0 ? (
              <text
                key={`h${hour}`}
                x={LEFT + hour * CELL + CELL / 2}
                y={TOP - 6}
                textAnchor="middle"
                className="fill-ink-500"
                style={{ fontSize: 9 }}
              >
                {hour}
              </text>
            ) : null
          )}

          {heatmap.map((row, month) => (
            <g key={month}>
              <text
                x={LEFT - 6}
                y={TOP + month * ROW + ROW / 2 + 3}
                textAnchor="end"
                className="fill-ink-500"
                style={{ fontSize: 9 }}
              >
                {MONTH_LABELS[MONTH_KEYS[month]]}
              </text>

              {row.map((value, hour) => (
                <rect
                  key={hour}
                  x={LEFT + hour * CELL}
                  y={TOP + month * ROW}
                  width={CELL - 1.5}
                  height={ROW - 1.5}
                  rx={2}
                  fill={colourFor(value / max)}
                  onMouseEnter={() => setHover({ month, hour, value })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {`${MONTH_LABELS[MONTH_KEYS[month]]}, ${hourLabel(hour)} — ${number(value, 2)} kWh`}
                  </title>
                </rect>
              ))}
            </g>
          ))}

          <text x={LEFT} y={height - 6} className="fill-ink-400" style={{ fontSize: 9 }}>
            Hour of day
          </text>
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">Less</span>
          <div className="flex">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
              <span
                key={t}
                className="h-3 w-6 first:rounded-l last:rounded-r"
                style={{ backgroundColor: colourFor(t) }}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">
            More ({number(max, 1)} kWh)
          </span>
        </div>

        {hover && (
          <p className="text-sm sm:text-xs text-ink-600 dark:text-ink-300">
            {MONTH_LABELS[MONTH_KEYS[hover.month]]}, {hourLabel(hover.hour)} —{' '}
            <span className="tnum font-medium">{number(hover.value, 2)} kWh</span>
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A single-hue ramp from near-white to deep green.
 *
 * Deliberately sequential rather than a rainbow: intensity should read as
 * ordered at a glance, and a rainbow scale makes people see boundaries in the
 * data that aren't there. Colours are literal rather than Tailwind classes so
 * they survive being serialised into the PDF.
 */
function colourFor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  // #f0fdf4 (solar-50) through to #14532d (solar-900).
  const from = [240, 253, 244];
  const to = [20, 83, 45];
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * clamped ** 0.85));
  return `rgb(${mix.join(',')})`;
}

function hourLabel(hour) {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}
