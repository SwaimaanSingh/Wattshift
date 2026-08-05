/**
 * Dev script: extract raw text from the sample bill PDFs so retailer regex
 * patterns can be built against real formatting rather than guesswork.
 *
 *   npm run extract
 *
 * Writes one .txt per sample into scripts/sample-text/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { itemsToLines, normaliseText } from '../src/services/textLayout.js';

const require = createRequire(import.meta.url);
const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = await import(pathToFileURL(pdfjsPath).href);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'sample-text');

const SAMPLES = [
  ['engie-adelaide-inn', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\1587-Adelaide Inn\\1. Pre-Sales\\Energy\\Adelaide Inn-Aug25\\Electricity Bills -Engie-24072025120950-0001.pdf'],
  ['mcsherry-march2026', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\3766-Chris McSherry (Somerton Park)\\1. Pre-Sales\\Energy\\March 2026 Energy Bill.pdf'],
  ['origin-farm-2024-11', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\1611-SFR Poultry Farm\\1. Pre-Sales\\Energy\\Farm 4 October 2024 to October 2025\\Origin_2024-11.pdf'],
  ['origin-farm-2025-10', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\1611-SFR Poultry Farm\\1. Pre-Sales\\Energy\\Farm 4 October 2024 to October 2025\\Origin_2025-10.pdf'],
  ['pte-hq-april', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\1610-PTE HQ\\1. Pre-Sales\\Energy\\April Bill.pdf'],
  ['mclaren-vale-caravan', 'G:\\.shortcut-targets-by-id\\1nZ89cHfOY6oHF3oS8ROQ64FU3zf6Lm8C\\0. Active Projects - Solar\\Projects\\1591 - McLaren Vale Caravan Park\\1. Pre-Sales\\Energy\\NMI 6292 - 3 April to 6 July 2025.pdf'],
  ['abe-chandra-sept25', 'G:\\.shortcut-targets-by-id\\1sunBIZ9jIPrE2eT9R7WnKjDgJOiDqevq\\0. Project Categories\\1. Solar and Battery Projects\\2. Completed Projects - Solar\\Residential\\1550-Abe Chandra\\1. Pre-Sales\\Energy\\Sept 25 Elec bill.pdf'],
  ['origin-college-park', 'G:\\.shortcut-targets-by-id\\1sunBIZ9jIPrE2eT9R7WnKjDgJOiDqevq\\0. Project Categories\\1. Solar and Battery Projects\\2. Completed Projects - Solar\\Residential\\1223 - Brad Jackson Home - College Park\\1. Pre-Sales\\Energy Bills\\Origin College Park.pdf'],
];

async function extract(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(normaliseText(itemsToLines(content.items)));
  }
  await doc.destroy();
  return pages;
}

await fs.mkdir(OUT_DIR, { recursive: true });

for (const [name, filePath] of SAMPLES) {
  try {
    const pages = await extract(filePath);
    const chars = pages.join('').length;
    const body = pages
      .map((t, i) => `\n===== PAGE ${i + 1} =====\n${t}`)
      .join('\n');
    await fs.writeFile(path.join(OUT_DIR, `${name}.txt`), body, 'utf8');
    console.log(
      `${name.padEnd(24)} ${String(pages.length).padStart(3)} pages  ${String(chars).padStart(7)} chars  ${chars < 200 ? '<-- LIKELY SCANNED (needs OCR)' : ''}`
    );
  } catch (err) {
    console.error(`${name.padEnd(24)} FAILED: ${err.message}`);
  }
}
