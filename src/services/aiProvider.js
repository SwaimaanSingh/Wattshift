/**
 * AI fallback for bills the regex patterns can't read.
 *
 * Swappable by design: everything else in the app calls `extractWithAI(text)`
 * and gets back the same BillData shape. To move to Ollama, Claude or OpenAI,
 * change AI_PROVIDER and add a function — nothing outside this file changes.
 */

const AI_PROVIDER = 'gemini';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.1';

/** Bills can be long; the fields we want are always in the first pages. */
const MAX_CHARS = 14000;
const TIMEOUT_MS = 30000;

export function isAiConfigured() {
  if (AI_PROVIDER === 'gemini') return Boolean(import.meta.env?.VITE_GEMINI_API_KEY);
  if (AI_PROVIDER === 'ollama') return true;
  return false;
}

/**
 * @param {string} billText
 * @returns {Promise<object|null>} partial BillData, or null if unusable
 */
export async function extractWithAI(billText) {
  const text = billText.slice(0, MAX_CHARS);
  switch (AI_PROVIDER) {
    case 'gemini':
      return extractWithGemini(text);
    case 'ollama':
      return extractWithOllama(text);
    default:
      throw new Error(`Unknown AI provider: ${AI_PROVIDER}`);
  }
}

const PROMPT = `You are reading an Australian electricity bill. Extract the fields below and return ONLY a JSON object — no markdown fence, no commentary.

{
  "retailer": string|null,
  "billingPeriodStart": "YYYY-MM-DD"|null,
  "billingPeriodEnd": "YYYY-MM-DD"|null,
  "billingDays": number|null,
  "totalKwh": number|null,
  "dailyAverageKwh": number|null,
  "tariffType": "flat"|"tou"|null,
  "tariffRateCentsPerKwh": number|null,
  "touRates": { "peak": number|null, "shoulder": number|null, "offPeak": number|null }|null,
  "dailySupplyChargeCents": number|null,
  "hasSolar": boolean,
  "solarExportKwh": number|null,
  "feedInTariffCents": number|null,
  "totalBillAmount": number|null,
  "postcode": string|null,
  "address": string|null
}

Rules:
- All rates in CENTS per kWh. A bill showing "$0.3903" is 39.03 cents. A bill showing "39.259 c/kWh" is 39.259 cents.
- dailySupplyChargeCents is cents per day. "$1.1089" per day is 110.89.
- totalKwh is consumption only. Never include exported solar in it. If the bill lists Peak/Off-peak/Shoulder separately, add them together.
- If the bill spans a price change and shows two rate blocks, weight each rate by its kWh to get one average.
- feedInTariffCents is what the customer is PAID per exported kWh. If the bill CHARGES for export, make it negative.
- hasSolar is true only if there is an actual exported quantity or a solar credit. A plan advertising "a high feed-in tariff" is not evidence of solar.
- postcode must come from the SUPPLY address (where the electricity is used), not the postal address.
- Use null for anything not stated. Do not guess or calculate values that are not on the bill, except for the sums and weighted averages described above.

BILL TEXT:
`;

async function extractWithGemini(billText) {
  const apiKey = import.meta.env?.VITE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const body = {
    contents: [{ parts: [{ text: PROMPT + billText }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };

  const response = await postJson(`${GEMINI_ENDPOINT}?key=${apiKey}`, body);
  const raw = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  return normaliseAiResult(parseJsonLoosely(raw));
}

async function extractWithOllama(billText) {
  const body = {
    model: OLLAMA_MODEL,
    prompt: PROMPT + billText,
    format: 'json',
    stream: false,
    options: { temperature: 0 },
  };

  const response = await postJson(OLLAMA_ENDPOINT, body);
  return normaliseAiResult(parseJsonLoosely(response?.response));
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`AI request failed (${res.status})`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Models sometimes wrap JSON in a fence despite instructions. */
function parseJsonLoosely(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Coerce and sanity-check whatever the model returned. A model that
 * hallucinates a 3900 c/kWh rate must not reach the calculator.
 */
function normaliseAiResult(result) {
  if (!result || typeof result !== 'object') return null;

  const num = (value, min, max) => {
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(n)) return null;
    return n >= min && n <= max ? n : null;
  };

  const tou = result.touRates || null;

  return {
    retailer: typeof result.retailer === 'string' ? result.retailer : null,
    billingPeriodStart: isoOrNull(result.billingPeriodStart),
    billingPeriodEnd: isoOrNull(result.billingPeriodEnd),
    billingDays: num(result.billingDays, 1, 400),
    totalKwh: num(result.totalKwh, 1, 5_000_000),
    dailyAverageKwh: num(result.dailyAverageKwh, 0.1, 100_000),
    tariffType: result.tariffType === 'tou' || result.tariffType === 'flat'
      ? result.tariffType
      : null,
    tariffRateCentsPerKwh: num(result.tariffRateCentsPerKwh, 3, 200),
    touRates: tou
      ? {
          peak: num(tou.peak, 3, 200),
          shoulder: num(tou.shoulder, 3, 200),
          offPeak: num(tou.offPeak, 3, 200),
        }
      : null,
    dailySupplyChargeCents: num(result.dailySupplyChargeCents, 10, 1500),
    hasSolar: Boolean(result.hasSolar),
    solarExportKwh: num(result.solarExportKwh, 0, 5_000_000),
    feedInTariffCents: num(result.feedInTariffCents, -30, 30),
    totalBillAmount: num(result.totalBillAmount, 0, 10_000_000),
    postcode: /^\d{4}$/.test(String(result.postcode ?? '')) ? String(result.postcode) : null,
    address: typeof result.address === 'string' ? result.address.slice(0, 160) : null,
  };
}

function isoOrNull(value) {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
