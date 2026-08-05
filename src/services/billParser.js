/**
 * Bill parsing orchestrator.
 *
 *   PDF.js / OCR  ->  retailer regex  ->  AI fallback  ->  manual form
 *
 * The text-processing half is deliberately free of browser APIs so the same
 * code path can be exercised from Node in scripts/testParsers.mjs.
 */
import { extractText } from './pdfExtractor.js';
import { parseWithPatterns } from './retailerPatterns/index.js';
import { extractWithAI, isAiConfigured } from './aiProvider.js';
import { CRITICAL_FIELDS, SECONDARY_FIELDS, applyConfidence } from './confidence.js';
import { splitStatements } from './statementSplitter.js';

export { CRITICAL_FIELDS, SECONDARY_FIELDS, applyConfidence };

/**
 * Parse already-extracted text. Pure — no File, no network.
 * @param {string} text
 * @param {'pdf-text'|'ocr'} source
 */
export function parseBillText(text, source = 'pdf-text') {
  const { data, retailerId, retailerName } = parseWithPatterns(text);

  const scored = applyConfidence(data, source);
  return {
    ...scored,
    diagnostics: {
      ...scored.diagnostics,
      retailerId,
      retailerName,
      textSource: source,
      textLength: text.length,
    },
  };
}

/**
 * Full pipeline for one uploaded file.
 *
 * @param {File} file
 * @param {(stage: string, pct: number|null) => void} [onProgress]
 * @returns {Promise<object[]>} one BillData per statement found in the file.
 *   Always resolves — parse failures come back as low-confidence data rather
 *   than a thrown error, so the UI can offer the manual form.
 */
export async function extractBillData(file, onProgress = () => {}) {
  let extracted;

  try {
    extracted = await extractText(file, onProgress);
  } catch (err) {
    return [failed(file, `Could not read the file: ${err.message}`)];
  }

  if (!extracted.text || extracted.text.replace(/\s/g, '').length < 40) {
    return [failed(file, 'No readable text found in this file.')];
  }

  onProgress('Looking for your usage…', null);

  // One upload can hold a year of statements — split before parsing so each
  // month is read on its own terms.
  const statements = splitStatements(extracted.pages);
  const bills = [];

  for (let i = 0; i < statements.length; i++) {
    if (statements.length > 1) {
      onProgress(`Reading statement ${i + 1} of ${statements.length}…`, null);
    }

    let data = parseBillText(statements[i], extracted.source);
    data.fileName = file.name;
    data.statementIndex = i;
    data.statementCount = statements.length;

    if (i === 0 && data.diagnostics.retailerName) {
      onProgress(`Found ${data.diagnostics.retailerName}`, null);
    }

    data = await maybeImproveWithAi(data, statements[i], extracted.source, onProgress);
    bills.push(data);
  }

  return bills;
}

/** Step 5: AI fallback, only when regex genuinely fell short. */
async function maybeImproveWithAi(data, text, source, onProgress) {
  if (data.confidence !== 'low' || !isAiConfigured()) return data;

  onProgress('Double-checking with AI…', null);
  try {
    const aiData = await extractWithAI(text);
    if (!aiData) return data;

    const rescored = applyConfidence(mergeAiResult(data, aiData), source);
    return {
      ...rescored,
      fileName: data.fileName,
      statementIndex: data.statementIndex,
      statementCount: data.statementCount,
      diagnostics: { ...data.diagnostics, usedAi: true },
    };
  } catch (err) {
    // AI is a bonus path; never let it break the run.
    return { ...data, diagnostics: { ...data.diagnostics, aiError: err.message } };
  }
}

/**
 * Regex wins where it found something — it reads the document literally,
 * whereas a model can transcribe a plausible-looking wrong number. AI only
 * fills genuine gaps.
 */
export function mergeAiResult(regexData, aiData) {
  const merged = { ...regexData };
  for (const [key, value] of Object.entries(aiData)) {
    if (value == null) continue;
    if (key === 'diagnostics' || key === 'confidence' || key === 'missingFields') continue;
    if (merged[key] == null || merged[key] === '') merged[key] = value;
  }
  return merged;
}

function failed(file, reason) {
  return {
    retailer: null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    billingDays: null,
    totalKwh: null,
    dailyAverageKwh: null,
    tariffType: null,
    tariffRateCentsPerKwh: null,
    touRates: null,
    dailySupplyChargeCents: null,
    hasSolar: false,
    solarExportKwh: null,
    feedInTariffCents: null,
    existingSolarSizeKw: null,
    totalBillAmount: null,
    postcode: null,
    address: null,
    confidence: 'low',
    missingFields: [...CRITICAL_FIELDS, ...SECONDARY_FIELDS],
    fileName: file?.name ?? null,
    diagnostics: { error: reason },
  };
}

/**
 * Parse several uploaded files, reporting progress across the batch.
 * Files may each contain multiple statements, so the result is flattened.
 *
 * @param {File[]} files
 * @returns {Promise<object[]>}
 */
export async function extractMultipleBills(files, onProgress = () => {}) {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const label = files.length > 1 ? ` (file ${i + 1} of ${files.length})` : '';
    const bills = await extractBillData(files[i], (stage, pct) =>
      onProgress(`${stage}${label}`, pct)
    );
    results.push(...bills);
  }
  return results;
}
