import { forwardRef, useEffect, useRef, useState } from 'react';
import { buildEstimateSummary, submitEnquiry } from '../services/enquiry.js';

const NEEDS = [
  'Quotes for a new solar system',
  'Quotes for solar + battery',
  'Battery added to existing solar',
  "A second opinion on a quote I've received",
  "General advice — not sure yet",
];

/**
 * Quote-request form, shown as an overlay so it never loses the estimate
 * behind it. Closes on Escape and traps initial focus.
 */
export default function EnquiryModal({ open, onClose, context, onPrivacy }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    propertyType: context?.mode === 'business' ? 'business' : 'home',
    need: '',
    message: '',
    consent: false,
  });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    firstFieldRef.current?.focus();
    // Stop the page behind scrolling while the overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Please tell us your name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = 'Enter a valid email address.';
    if (!form.need) next.need = 'Let us know what you need.';
    if (!form.consent) next.consent = 'We need your consent to pass this on.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setState('sending');
    setFailure(null);
    try {
      const outcome = await submitEnquiry(form, context);
      setResult(outcome);
      setState('done');
    } catch (err) {
      setFailure(err.message);
      setState('error');
    }
  };

  const summary = buildEstimateSummary(context);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enquiry-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-ink-900">
        {state === 'done' ? (
          <Confirmation result={result} form={form} context={context} onClose={onClose} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="enquiry-title" className="text-xl font-bold tracking-tight">
                  Get free quotes from qualified installers
                </h2>
                <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
                  WattShift connects you with up to 3 CEC-accredited solar
                  installers in your area. No spam, no pressure.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-ink-400 hover:text-ink-700 sm:min-h-0 sm:min-w-0 dark:hover:text-ink-200"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {summary.length > 0 && (
              <dl className="mt-5 space-y-1.5 rounded-xl bg-ink-50 p-4 text-sm dark:bg-ink-800/60">
                <p className="mb-2 text-sm sm:text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  Sent with your enquiry
                </p>
                {summary.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <Field id="e-name" label="Name" value={form.name} onChange={set('name')} error={errors.name} ref={firstFieldRef} />
              <Field id="e-email" label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} />
              <Field
                id="e-phone"
                label="Phone"
                hint="Optional — installers prefer to call"
                type="tel"
                value={form.phone}
                onChange={set('phone')}
              />

              <div>
                <span className="label">Property type</span>
                <div className="flex gap-2">
                  {[
                    ['home', '🏠 Home'],
                    ['business', '🏢 Business'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, propertyType: value }))}
                      aria-pressed={form.propertyType === value}
                      className={`chip ${form.propertyType === value ? 'chip-active' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="e-need" className="label">
                  What do you need?
                </label>
                <select
                  id="e-need"
                  value={form.need}
                  onChange={set('need')}
                  className={`field ${errors.need ? 'border-red-500' : ''}`}
                >
                  <option value="">Choose…</option>
                  {NEEDS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {errors.need && <p className="mt-1.5 text-sm sm:text-xs text-red-600 dark:text-red-400">{errors.need}</p>}
              </div>

              <div>
                <label htmlFor="e-message" className="label">
                  Anything else we should know?{' '}
                  <span className="text-sm sm:text-xs font-normal text-ink-400">Optional</span>
                </label>
                <textarea id="e-message" rows={3} value={form.message} onChange={set('message')} className="field" />
              </div>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.consent}
                  onChange={set('consent')}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-solar-600 sm:mt-1 sm:h-4 sm:w-4"
                  aria-invalid={Boolean(errors.consent)}
                />
                <span className="text-sm text-ink-600 dark:text-ink-300">
                  I agree to WattShift sharing my details with up to 3 qualified
                  installers.{' '}
                  <button
                    type="button"
                    onClick={onPrivacy}
                    className="text-solar-700 underline underline-offset-4 dark:text-solar-400"
                  >
                    Privacy Policy
                  </button>
                </span>
              </label>
              {errors.consent && <p className="text-sm sm:text-xs text-red-600 dark:text-red-400">{errors.consent}</p>}

              {state === 'error' && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {failure} — please try again, or email us directly.
                </p>
              )}

              <button type="submit" disabled={state === 'sending'} className="btn-primary w-full">
                {state === 'sending' ? 'Sending…' : 'Request quotes'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Confirmation({ result, form, context, onClose }) {
  const suburb = context?.solarData?.name ?? 'your area';

  return (
    <div>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-solar-100 dark:bg-solar-900/40">
        <svg className="h-6 w-6 text-solar-700 dark:text-solar-400" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-bold tracking-tight">
        Thanks {form.name.split(' ')[0]}! We're finding installers in your area.
      </h2>

      {result?.method === 'mailto' && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          Your email app should have opened with the details ready to send. If it
          didn't, please send them to us directly and quote the reference below.
        </p>
      )}

      <h3 className="mt-5 text-sm font-semibold">What happens next</h3>
      <ul className="mt-2 space-y-2 text-sm text-ink-600 dark:text-ink-300">
        {[
          `We'll review your estimate and match you with up to 3 CEC-accredited installers near ${suburb}`,
          'Expect to hear from them within 48 hours',
          "They'll have your estimate data, so you won't need to repeat yourself",
          'No obligation — compare quotes at your own pace',
        ].map((line) => (
          <li key={line} className="flex gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-solar-500" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
        <p className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">Your estimate reference</p>
        <p className="text-lg font-bold tracking-wide tabular-nums">{result?.reference}</p>
      </div>

      <button type="button" onClick={onClose} className="btn-primary mt-5 w-full">
        Back to my estimate
      </button>
    </div>
  );
}

const Field = forwardRef(function EnquiryField({ id, label, hint, error, ...props }, ref) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {hint && <span className="ml-2 text-sm sm:text-xs font-normal text-ink-400">{hint}</span>}
      </label>
      <input
        id={id}
        ref={ref}
        type="text"
        className={`field ${error ? 'border-red-500' : ''}`}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <p className="mt-1.5 text-sm sm:text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
});
