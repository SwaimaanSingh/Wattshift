/**
 * Shared PDF text-layout reconstruction.
 *
 * PDF.js returns text as a flat list of positioned fragments, in whatever order
 * they happen to appear in the content stream. Australian bills are heavily
 * table-based, so a naive `items.map(i => i.str).join(' ')` scrambles labels
 * away from their values and makes regex matching unreliable.
 *
 * This module rebuilds visual lines: group fragments by their y coordinate,
 * sort each group left-to-right, and join with a separator wide enough to keep
 * table columns distinguishable.
 *
 * Used by BOTH the browser extractor (pdfExtractor.js) and the Node dev script
 * (scripts/extractSampleBills.mjs) so the text patterns are developed against
 * is byte-identical to the text they run against at runtime.
 */

// Fragments whose baselines are within this many points are on the same line.
const LINE_TOLERANCE = 2.5;
// Horizontal gap (points) beyond which we treat fragments as separate columns.
const COLUMN_GAP = 4;

/**
 * @param {Array} items - PDF.js textContent.items for a single page
 * @returns {string} page text with visual lines preserved
 */
export function itemsToLines(items) {
  const fragments = [];

  for (const item of items) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue;
    // transform = [a, b, c, d, e, f] — e is x, f is y in device space.
    const [, , , , x, y] = item.transform;
    fragments.push({
      x,
      y,
      str: item.str,
      width: item.width || 0,
    });
  }

  if (fragments.length === 0) return '';

  // Group into lines by y (descending — PDF origin is bottom-left).
  fragments.sort((a, b) => b.y - a.y || a.x - b.x);

  return linesToText(dedupeOverdraw(fragments));
}

/**
 * Some bills fake bold type by drawing the same string twice at (almost) the
 * same spot — the iO Energy sample renders as "YOUR DETAILSYOUR DETAILS".
 * Drop the duplicate so labels and values stay readable.
 *
 * @param {Array} sorted - fragments already sorted by y desc, x asc
 */
function dedupeOverdraw(sorted) {
  const OVERDRAW_TOLERANCE = 1.5;
  const out = [];
  for (const frag of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.str === frag.str &&
      Math.abs(prev.x - frag.x) < OVERDRAW_TOLERANCE &&
      Math.abs(prev.y - frag.y) < OVERDRAW_TOLERANCE
    ) {
      continue;
    }
    out.push(frag);
  }
  return out;
}

function linesToText(fragments) {

  const lines = [];
  let current = [fragments[0]];

  for (let i = 1; i < fragments.length; i++) {
    const frag = fragments[i];
    const lineY = current[0].y;
    if (Math.abs(frag.y - lineY) <= LINE_TOLERANCE) {
      current.push(frag);
    } else {
      lines.push(current);
      current = [frag];
    }
  }
  lines.push(current);

  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let text = '';
      let cursorX = null;
      for (const frag of line) {
        if (cursorX !== null) {
          const gap = frag.x - cursorX;
          // Wide gap = column boundary. Small gap = same word/phrase.
          if (gap > COLUMN_GAP) text += '  ';
          else if (gap > 0.5 && !text.endsWith(' ')) text += ' ';
        }
        text += frag.str;
        cursorX = frag.x + frag.width;
      }
      return text.replace(/\s+$/, '');
    })
    .filter((l) => l.trim() !== '')
    .join('\n');
}

/**
 * Normalise text for matching: collapse runs of whitespace within lines but
 * keep line breaks, and standardise unicode oddities that appear in bills
 * (non-breaking spaces, en/em dashes used as date separators, ligatures).
 */
export function normaliseText(text) {
  return text
    .replace(/ /g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}
