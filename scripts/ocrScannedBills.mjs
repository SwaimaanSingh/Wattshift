/**
 * Dev script: rasterise + OCR the scanned (image-only) sample bills so we can
 * build retailer patterns for them too.
 *
 *   node scripts/ocrScannedBills.mjs
 *
 * Only needed for samples that `npm run extract` reported as 0 chars.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'sample-text');

const SAMPLES = [
  ['engie-adelaide-inn', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\1587-Adelaide Inn\\1. Pre-Sales\\Energy\\Adelaide Inn-Aug25\\Electricity Bills -Engie-24072025120950-0001.pdf', 4],
  ['origin-college-park', 'G:\\.shortcut-targets-by-id\\1sunBIZ9jIPrE2eT9R7WnKjDgJOiDqevq\\0. Project Categories\\1. Solar and Battery Projects\\2. Completed Projects - Solar\\Residential\\1223 - Brad Jackson Home - College Park\\1. Pre-Sales\\Energy Bills\\Origin College Park.pdf', 4],
];

const worker = await createWorker('eng');
await fs.mkdir(OUT_DIR, { recursive: true });

for (const [name, filePath, maxPages] of SAMPLES) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pageCount = Math.min(doc.numPages, maxPages);
  const out = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    // 300 DPI-ish: PDF user space is 72 dpi, so scale 3 ≈ 216 dpi (plenty for
    // 10pt bill text and much faster than 4x).
    const viewport = page.getViewport({ scale: 3 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const png = canvas.toBuffer('image/png');
    const { data: { text } } = await worker.recognize(png);
    out.push(`\n===== PAGE ${p} (OCR) =====\n${text.trim()}`);
    console.log(`${name} page ${p}: ${text.trim().length} chars`);
  }

  await doc.destroy();
  await fs.writeFile(path.join(OUT_DIR, `${name}.ocr.txt`), out.join('\n'), 'utf8');
}

await worker.terminate();
console.log('done');
