import { useState } from 'react';
import {
  getCurrentPosition,
  isValidPostcode,
  lookupPostcode,
  nearestToCoords,
} from '../services/solarDataService.js';

/**
 * Screen 3 — only shown when the bill didn't give us a postcode, or the
 * customer wants to change it.
 */
export default function LocationInput({ initialPostcode, onResolved, onBack }) {
  const [postcode, setPostcode] = useState(initialPostcode || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const useMyLocation = async () => {
    setBusy(true);
    setError(null);
    try {
      const { lat, lng } = await getCurrentPosition();
      const match = await nearestToCoords(lat, lng);
      if (!match) throw new Error("Couldn't match your location to a postcode.");
      onResolved({ ...match, lat, lng, detectedBy: 'geolocation' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitPostcode = async (e) => {
    e.preventDefault();
    const value = String(postcode).trim();
    if (!isValidPostcode(value)) {
      setError('Enter a 4-digit Australian postcode.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const match = await lookupPostcode(value);
      onResolved({ ...match, detectedBy: 'postcode' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Where is this property?</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-300">
        We need this for one reason: how much sun your area gets.
      </p>

      <button
        type="button"
        onClick={useMyLocation}
        disabled={busy}
        className="btn-primary mt-7 w-full"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 2a5.5 5.5 0 0 0-5.5 5.5c0 3.9 4.6 9.4 5.1 10a.5.5 0 0 0 .8 0c.5-.6 5.1-6.1 5.1-10A5.5 5.5 0 0 0 10 2Zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
            clipRule="evenodd"
          />
        </svg>
        {busy ? 'Finding you…' : 'Use my location'}
      </button>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
        <span className="text-sm text-ink-400">or</span>
        <div className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
      </div>

      <form onSubmit={submitPostcode}>
        <label htmlFor="postcode" className="label">
          Enter your postcode
        </label>
        <div className="flex gap-3">
          <input
            id="postcode"
            className="field"
            inputMode="numeric"
            maxLength={4}
            placeholder="5000"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.replace(/\D/g, ''))}
            aria-invalid={Boolean(error)}
          />
          <button type="submit" disabled={busy} className="btn-secondary shrink-0">
            Continue
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-8 inline-flex min-h-[44px] items-center self-start text-sm text-ink-500 underline underline-offset-4 hover:text-ink-800 sm:min-h-0 dark:hover:text-ink-200"
        >
          Back
        </button>
      )}

      <p className="mt-6 text-sm sm:text-xs text-ink-400 dark:text-ink-500">
        Your location stays in your browser. We don't send it anywhere.
      </p>
    </div>
  );
}
