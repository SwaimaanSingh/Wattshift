/**
 * Client-side text extraction from an uploaded bill.
 *
 * Digital PDFs (the overwhelming majority of Australian bills) go through
 * PDF.js. Photos/scans fall back to Tesseract OCR, which is slow, so it is
 * loaded lazily and only when actually needed.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { itemsToLines, normaliseText } from './textLayout.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Below this, a "digital" PDF is really a scan with a thin text layer.
const MIN_DIGITAL_CHARS = 150;
// Bundled statements can run to dozens of pages; OCR-ing them all would take
// minutes. The useful data is always in the first few pages of each bill.
const MAX_OCR_PAGES = 4;

// Backstops so a stalled step surfaces as a message rather than a spinner
// that never ends. Generous — a slow phone genuinely takes several seconds
// per page.
const RENDER_TIMEOUT_MS = 20000;
const RECOGNISE_TIMEOUT_MS = 60000;

// iOS Safari refuses canvases beyond roughly 16.7M pixels; stay well under.
const MAX_OCR_CANVAS_PIXELS = 12_000_000;
const PREFERRED_OCR_SCALE = 3;

/** Highest scale up to 3x that keeps the canvas within mobile limits. */
function ocrScaleFor(page) {
  const base = page.getViewport({ scale: 1 });
  const atPreferred = base.width * PREFERRED_OCR_SCALE * base.height * PREFERRED_OCR_SCALE;
  if (atPreferred <= MAX_OCR_CANVAS_PIXELS) return PREFERRED_OCR_SCALE;

  const fitted = Math.sqrt(MAX_OCR_CANVAS_PIXELS / (base.width * base.height));
  return Math.max(1.5, Math.min(PREFERRED_OCR_SCALE, fitted));
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/**
 * @typedef {Object} ExtractedText
 * @property {string} text        Full document text, visual lines preserved
 * @property {string[]} pages     Per-page text
 * @property {'pdf-text'|'ocr'} source
 * @property {number} pageCount
 */

/**
 * @param {File} file
 * @param {(stage: string, pct: number|null) => void} [onProgress]
 * @returns {Promise<ExtractedText>}
 */
export async function extractText(file, onProgress = () => {}) {
  const isImage =
    file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(file.name);

  if (isImage) {
    onProgress('Reading your photo…', null);
    const text = await ocrImage(file, onProgress);
    return { text, pages: [text], source: 'ocr', pageCount: 1 };
  }

  onProgress('Reading your bill…', null);
  const result = await extractFromPdf(file);

  if (result.text.replace(/\s/g, '').length >= MIN_DIGITAL_CHARS) return result;

  // Scanned PDF — no usable text layer.
  onProgress('This looks like a scan. Reading the text…', null);
  const ocrPages = await ocrPdf(file, onProgress);
  return {
    text: ocrPages.join('\n'),
    pages: ocrPages,
    source: 'ocr',
    pageCount: result.pageCount,
  };
}

/**
 * Open a PDF, surviving a broken worker.
 *
 * PDF.js normally parses on a Web Worker loaded from a separate chunk. If that
 * chunk fails — a stale dev cache, a strict CSP, an extension blocking blob
 * workers, an offline reload — `getDocument` rejects and every bill lands on
 * the manual form with no clue why. Parsing on the main thread is slower but
 * always available, so it is worth one silent retry before giving up.
 */
async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const open = () =>
    pdfjsLib.getDocument({
      data: bytes.slice(), // getDocument transfers the buffer; keep a clean copy
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;

  try {
    return await open();
  } catch (err) {
    if (workerDisabled) throw err;

    console.warn(
      'WattShift: PDF.js worker unavailable, retrying on the main thread.',
      err
    );
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    pdfjsLib.GlobalWorkerOptions.workerPort = null;
    workerDisabled = true;
    return open();
  }
}

let workerDisabled = false;

async function extractFromPdf(file) {
  const doc = await loadPdf(file);
  const pages = [];

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(normaliseText(itemsToLines(content.items)));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return {
    text: pages.join('\n'),
    pages,
    source: 'pdf-text',
    pageCount: pages.length,
  };
}

/**
 * Render PDF pages to canvas, then OCR each one.
 * @returns {Promise<string[]>} per-page text
 */
async function ocrPdf(file, onProgress) {
  const doc = await loadPdf(file);
  const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
  const worker = await createOcrWorker();
  const out = [];

  try {
    for (let p = 1; p <= pageCount; p++) {
      onProgress(`Reading page ${p} of ${pageCount}…`, (p - 1) / pageCount);
      const page = await doc.getPage(p);
      // Bill rate tables are 8–9pt. At 2x, Tesseract drops decimal points
      // ("24.756 c/kWh" -> "24756"), which fails the plausibility check and
      // sends an otherwise-readable bill to the manual form. 3x recovers them.
      // Capped so the canvas stays within mobile Safari's limits.
      const viewport = page.getViewport({ scale: ocrScaleFor(page) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // intent:'print' is essential, not cosmetic. With the default 'display'
      // intent PDF.js schedules its render chunks with requestAnimationFrame,
      // which the browser stops firing whenever the tab isn't compositing —
      // a backgrounded tab, or a phone switching apps mid-upload. The render
      // promise then never settles and OCR hangs behind the progress bar
      // forever. 'print' schedules with timers instead, so it completes
      // regardless of visibility.
      await withTimeout(
        page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise,
        RENDER_TIMEOUT_MS,
        `Rendering page ${p} took too long`
      );

      const { data } = await withTimeout(
        worker.recognize(canvas),
        RECOGNISE_TIMEOUT_MS,
        `Reading the text on page ${p} took too long`
      );
      out.push(normaliseText(data.text));

      // Free the backing store promptly — several full-page canvases at once
      // will exhaust memory on older phones.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }

  return out;
}

async function ocrImage(file, onProgress) {
  const worker = await createOcrWorker();
  try {
    onProgress('Reading the text in your photo…', 0.3);
    const { data } = await withTimeout(
      worker.recognize(file),
      RECOGNISE_TIMEOUT_MS,
      'Reading the text in your photo took too long'
    );
    return normaliseText(data.text);
  } finally {
    await worker.terminate();
  }
}

async function createOcrWorker() {
  // Lazy — tesseract.js pulls in a multi-megabyte wasm core plus language
  // data, and most users never hit this path.
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng');
}
