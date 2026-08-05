import { useEffect, useRef, useState } from 'react';
import { DEFAULTS } from '../config/defaults.js';

/**
 * Slider paired with a typed number field.
 *
 * The field is deliberately allowed to exceed the slider's range: the slider
 * covers the sizes that are actually worth offering, but a customer with an
 * unusual site should still be able to model it. When they go past the end the
 * slider pins to its maximum while the calculations use what was typed, and a
 * note explains what that size implies.
 *
 * Typing is debounced so a partially typed "1" in "150" doesn't briefly
 * recalculate the whole page at 1 kW.
 */
export default function CapacityControl({
  id,
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  notes = [],
  debounceMs = 300,
}) {
  const [text, setText] = useState(() => format(value));
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const editingRef = useRef(false);

  // Follow external changes (slider, quick-select, near-zero) unless the
  // customer is mid-keystroke in the field.
  useEffect(() => {
    if (!editingRef.current) setText(format(value));
  }, [value]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const commit = (raw) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setError('Enter a number.');
      return;
    }
    if (parsed < 0) {
      setError('Must be zero or more.');
      return;
    }
    if (parsed > DEFAULTS.maxTypedCapacity) {
      setError(`Maximum is ${DEFAULTS.maxTypedCapacity} ${unit}.`);
      return;
    }
    setError(null);
    onChange(parsed);
  };

  const onType = (e) => {
    const raw = e.target.value;
    editingRef.current = true;
    setText(raw);

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(raw), debounceMs);
  };

  const onBlur = () => {
    editingRef.current = false;
    clearTimeout(timerRef.current);
    commit(text);
    setText(format(value));
  };

  const beyondSlider = value > max;
  const activeNote = notes
    .filter((n) => value > n.above)
    .sort((a, b) => b.above - a.above)[0];

  return (
    <div>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={Math.min(Math.max(value, min), max)}
            onChange={(e) => {
              editingRef.current = false;
              onChange(Number(e.target.value));
            }}
            aria-valuetext={`${format(value)} ${unit}`}
            className="range"
          />
          <div className="mt-1 flex justify-between text-sm sm:text-xs text-ink-400">
            <span>
              {min} {unit}
            </span>
            <span>
              {max} {unit}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={text}
              onChange={onType}
              onFocus={() => {
                editingRef.current = true;
              }}
              onBlur={onBlur}
              aria-label={`${label} value`}
              aria-invalid={Boolean(error)}
              className={`w-20 min-h-[44px] rounded-lg border px-2.5 py-1.5 text-right text-base font-semibold tabular-nums
                          focus:outline-none focus:ring-2 focus:ring-solar-600/25
                          sm:min-h-0
                          dark:bg-ink-900 dark:text-ink-100
                          ${
                            error
                              ? 'border-red-500 focus:border-red-500'
                              : 'border-ink-300 focus:border-solar-600 dark:border-ink-700'
                          }`}
            />
            <span className="text-sm text-ink-500 dark:text-ink-400">{unit}</span>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm sm:text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!error && beyondSlider && (
        <p className="mt-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          Above the slider range — the slider stays at {max} {unit}, but the
          figures use {format(value)} {unit}.
        </p>
      )}

      {!error && activeNote && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm sm:text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          {activeNote.text}
        </p>
      )}
    </div>
  );
}

function format(value) {
  if (value == null || Number.isNaN(value)) return '';
  return String(Math.round(value * 10) / 10);
}
