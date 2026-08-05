import { useState } from 'react';
import { DEFAULTS } from '../config/defaults.js';
import { compassWord, number } from '../utils/formatters.js';

const ORIENTATIONS = [
  ['N', 'North'],
  ['NE', 'North-east'],
  ['NW', 'North-west'],
  ['E', 'East'],
  ['W', 'West'],
  ['Flat', 'Flat roof'],
];

const PITCHES = [
  ['5', 'Flat or nearly flat'],
  ['12.5', 'Low (10–15°)'],
  ['22.5', 'Medium (20–25°)'],
  ['32.5', 'Steep (30°+)'],
];

const SHADING = [
  ['none', 'No shading'],
  ['morning', 'Some morning shade'],
  ['afternoon', 'Some afternoon shade'],
  ['significant', 'Significant shade'],
];

/**
 * Roof summary from the Google Solar API, or the adjustable defaults when
 * there's no coverage. When nothing was detected the controls start open,
 * because that's when the customer's input actually matters.
 */
export default function RoofInfo({ roof, detected, locationName, onChange }) {
  const [open, setOpen] = useState(!detected);

  return (
    <section className="card h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden="true">🏠</span>
            {detected ? 'We found your roof' : 'Your roof'}
          </h2>

          {detected ? (
            <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
              Main roof faces{' '}
              <strong className="font-semibold text-ink-900 dark:text-ink-100">
                {compassWord(roof.orientation)}
              </strong>
              , with a {describePitch(roof.pitchDegrees)} slope
              {roof.usableAreaM2
                ? `, about ${number(roof.usableAreaM2)} m² usable`
                : ''}
              .
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
              We couldn't check your roof from above, so we've assumed a typical
              {locationName ? ` ${locationName}` : ''} home: facing{' '}
              {compassWord(roof.orientation)}, medium slope, no shading. Adjust
              below for a closer estimate.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-medium text-solar-700 underline underline-offset-4 sm:min-h-0 dark:text-solar-400"
          aria-expanded={open}
        >
          {open ? 'Hide' : detected ? 'Not right?' : 'Adjust'}
        </button>
      </div>

      {detected && (
        <p className="tech mt-2">
          azimuth {roof.azimuthDegrees}° · pitch {roof.pitchDegrees}°
          {roof.segmentCount ? ` · ${roof.segmentCount} roof planes` : ''}
          {roof.maxSystemKw ? ` · roof fits up to ~${roof.maxSystemKw} kW` : ''}
        </p>
      )}

      {open && (
        <div className="mt-5 space-y-4 border-t border-ink-200 pt-5 dark:border-ink-800">
          <Choice
            label="Which way does your roof face?"
            hint="North is best in Australia"
            options={ORIENTATIONS}
            value={roof.orientation}
            onChange={(v) => onChange({ ...roof, orientation: v })}
          />
          <Choice
            label="How steep is it?"
            options={PITCHES}
            value={String(roof.pitchDegrees)}
            onChange={(v) => onChange({ ...roof, pitchDegrees: Number(v) })}
          />
          <Choice
            label="Any shade from trees or buildings?"
            options={SHADING}
            value={roof.shading}
            onChange={(v) => onChange({ ...roof, shading: v })}
          />

          <button
            type="button"
            onClick={() => onChange({ ...DEFAULTS.roofDefaults })}
            className="inline-flex min-h-[44px] items-center text-sm text-ink-500 underline underline-offset-4 hover:text-ink-800 sm:min-h-0 dark:hover:text-ink-200"
          >
            Reset to typical
          </button>
        </div>
      )}
    </section>
  );
}

function Choice({ label, hint, options, value, onChange }) {
  return (
    <fieldset>
      <legend className="label">
        {label}
        {hint && <span className="ml-2 text-sm sm:text-xs font-normal text-ink-400">{hint}</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={`chip ${value === key ? 'chip-active' : ''}`}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function describePitch(degrees) {
  if (degrees == null) return 'medium';
  if (degrees < 8) return 'flat';
  if (degrees < 17) return 'low';
  if (degrees < 27) return 'medium';
  return 'steep';
}
