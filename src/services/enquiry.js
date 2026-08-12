/**
 * Enquiry submission.
 *
 * Posts to Web3Forms. Nothing is stored by the app itself.
 *
 * The mailto: helpers below are retained but no longer reached: they existed
 * for the case where no endpoint was configured, and the endpoint is now
 * fixed rather than read from the environment.
 */
import { ENQUIRY_CONFIG } from '../config/defaults.js';
import { currency0, kwh, number } from '../utils/formatters.js';

const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

/**
 * Identifies the form to Web3Forms. Public by design — it travels in the
 * request body from the browser and grants nothing beyond submitting to this
 * one form. Same key as the advice form in EnquirePage.jsx.
 */
const WEB3FORMS_ACCESS_KEY = '74b058b2-25b6-4400-b825-29d993a83474';

export const hasEnquiryEndpoint = () => Boolean(ENQUIRY_CONFIG.endpoint);

/** Short human-quotable reference, e.g. WS-4KQ7ZP. */
export function generateReference() {
  // No I/O/0/1 — they get misread over the phone.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `WS-${out}`;
}

/** The estimate context attached to an enquiry, as plain lines. */
export function buildEstimateSummary(context) {
  if (!context) return [];
  const { solarData, billData, systemKw, batteryKwh, savings, mode } = context;

  const lines = [
    ['Property type', mode === 'business' ? 'Business' : 'Home'],
    ['Location', `${solarData?.name ?? '—'} ${solarData?.postcode ?? ''}`.trim()],
  ];

  if (billData?.dailyAverageKwh) {
    lines.push([
      'Estimated usage',
      `${number(billData.dailyAverageKwh, 1)} kWh/day (${kwh(Math.round(billData.dailyAverageKwh * 365))}/yr)`,
    ]);
  }
  if (savings?.currentAnnualBill) {
    lines.push(['Current annual cost', `${currency0(savings.currentAnnualBill)}/yr`]);
  }
  if (systemKw) lines.push(['System of interest', `${number(systemKw, 1)} kW solar`]);
  lines.push([
    'Battery preference',
    batteryKwh > 0 ? `${number(batteryKwh, 1)} kWh` : 'No battery / undecided',
  ]);
  if (savings) {
    lines.push([
      'Estimated savings',
      `${currency0(savings.annualSavingsLow)} – ${currency0(savings.annualSavingsHigh)}/yr`,
    ]);
  }

  return lines;
}

function buildPlainBody(form, context, reference) {
  const summary = buildEstimateSummary(context)
    .map(([label, value]) => `  ${label}: ${value}`)
    .join('\n');

  return [
    'WattShift quote request',
    `Reference: ${reference}`,
    '',
    `Name:  ${form.name}`,
    `Email: ${form.email}`,
    `Phone: ${form.phone || '(not provided)'}`,
    `Property type: ${form.propertyType === 'business' ? 'Business' : 'Home'}`,
    `What they need: ${form.need}`,
    '',
    'Message:',
    form.message ? form.message : '  (none)',
    '',
    'Estimate summary',
    summary || '  (no estimate attached)',
    '',
    `Consent given: ${form.consent ? 'yes' : 'no'}`,
    `Submitted: ${new Date().toLocaleString('en-AU')}`,
  ].join('\n');
}

/** mailto: URL used when no endpoint is configured. */
export function buildMailto(form, context, reference) {
  const suburb = context?.solarData?.name ?? '';
  const kw = context?.systemKw ? `${number(context.systemKw, 1)} kW` : '';
  const subject = `WattShift Quote Request — ${
    form.propertyType === 'business' ? 'Business' : 'Home'
  } ${suburb} ${kw}`.replace(/\s+/g, ' ').trim();

  return `mailto:${ENQUIRY_CONFIG.fallbackEmail}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(buildPlainBody(form, context, reference))}`;
}

/**
 * @returns {Promise<{ok: boolean, reference: string, method: 'endpoint'|'mailto'}>}
 */
export async function submitEnquiry(form, context) {
  const reference = generateReference();

  const payload = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `WattShift quote request — ${reference}`,
    reference,
    name: form.name,
    email: form.email,
    phone: form.phone,
    propertyType: form.propertyType,
    need: form.need,
    message: form.message,
    consent: form.consent,
    estimate: Object.fromEntries(buildEstimateSummary(context)),
    submittedAt: new Date().toISOString(),
  };

  const res = await fetch(WEB3FORMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  // Web3Forms can answer 200 with {success: false} — a rejected key or a spam
  // block reads as a transport success, so the body decides whether the
  // enquiry actually got through, not the status code alone.
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.success) {
    throw new Error(result?.message || `Submission failed (${res.status})`);
  }

  return { ok: true, reference, method: 'endpoint' };
}
