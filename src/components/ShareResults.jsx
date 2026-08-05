import { useState } from 'react';
import {
  buildResultsUrl,
  canNativeShare,
  copyToClipboard,
} from '../services/resultsLink.js';
import { buildEstimateMailto, buildEstimateText } from '../services/estimateSummary.js';
import { currency0, number } from '../utils/formatters.js';
import { downloadSummaryPdf } from '../services/summaryPdf.js';

/**
 * Download, share, or send the estimate to yourself.
 *
 * Sharing is the most common thing people want here — an estimate almost
 * always needs discussing with a partner or a business partner before anyone
 * acts on it — so that sits first and gets the native share sheet on mobile.
 */
export default function ShareResults({ summary, chartRef }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');

  const url = () => buildResultsUrl(summary);

  const say = (message) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 5000);
  };

  const share = async () => {
    const { systemKw, savings, solarData } = summary;
    const text =
      `A ${number(systemKw, 1)} kW solar system in ${solarData.name} could save about ` +
      `${currency0(savings.annualSavingsLow)}–${currency0(savings.annualSavingsHigh)} a year.`;

    if (canNativeShare()) {
      try {
        await navigator.share({ title: 'Our solar estimate — WattShift', text, url: url() });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user dismissed the sheet
      }
    }
    // Desktop, or the share sheet failed: fall back to the link.
    const ok = await copyToClipboard(`${text}\n${url()}`);
    say(ok ? 'Copied — paste it into a message.' : "Couldn't copy — your browser blocked it.");
  };

  const copyLink = async () => {
    const ok = await copyToClipboard(url());
    say(ok ? 'Link copied.' : "Couldn't copy — your browser blocked it.");
  };

  const download = async () => {
    setBusy(true);
    try {
      await downloadSummaryPdf(summary, chartRef?.current);
      say('Saved to your downloads.');
    } catch (err) {
      say(`Couldn't build the PDF: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const sendEmail = (e) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      say('Enter a valid email address.');
      return;
    }
    // No email service is configured, so this hands off to the customer's own
    // mail app with everything filled in — nothing leaves the browser.
    window.location.href = buildEstimateMailto(summary, url(), email);
    setEmailOpen(false);
    say('Your email app should open with the estimate ready to send.');
  };

  const copySummary = async () => {
    const ok = await copyToClipboard(buildEstimateText(summary, url()));
    say(ok ? 'Full summary copied — paste it anywhere.' : "Couldn't copy — your browser blocked it.");
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink-700 dark:text-ink-200">
        Share this estimate
      </h3>

      <div className="mt-3 space-y-2">
        <button type="button" onClick={share} className="btn-primary w-full justify-start">
          <span aria-hidden="true">📱</span>
          Send to your partner or household
        </button>

        <button type="button" onClick={copyLink} className="btn-secondary w-full justify-start">
          <span aria-hidden="true">📋</span>
          Copy link to share
        </button>

        <button
          type="button"
          onClick={download}
          disabled={busy}
          className="btn-secondary w-full justify-start"
        >
          <span aria-hidden="true">📄</span>
          {busy ? 'Building your summary…' : 'Download PDF summary'}
        </button>

        <button
          type="button"
          onClick={() => setEmailOpen((v) => !v)}
          aria-expanded={emailOpen}
          className="btn-secondary w-full justify-start"
        >
          <span aria-hidden="true">📧</span>
          Email this estimate to yourself
        </button>

        {emailOpen && (
          <form onSubmit={sendEmail} className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <label htmlFor="share-email" className="label">
              Your email address
            </label>
            <div className="flex gap-2">
              <input
                id="share-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="field"
              />
              <button
                type="submit"
                className="btn-primary min-h-[44px] shrink-0 px-4 py-2 text-sm sm:min-h-0"
              >
                Send
              </button>
            </div>
            <button
              type="button"
              onClick={copySummary}
              className="mt-2 inline-flex min-h-[44px] items-center text-sm text-solar-700 underline underline-offset-4 sm:min-h-0 sm:text-xs dark:text-solar-400"
            >
              Or copy the full summary to your clipboard instead
            </button>
          </form>
        )}
      </div>

      <p className="mt-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400" role="status" aria-live="polite">
        {status || 'A link carries only these numbers — never your bill, name or address.'}
      </p>
    </div>
  );
}
