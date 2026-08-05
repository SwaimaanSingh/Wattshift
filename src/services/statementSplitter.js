/**
 * Split a multi-statement PDF into individual bills.
 *
 * Customers often upload a single file containing a year of statements — the
 * ENGIE sample is a 43-page bundle of monthly C&I bills. Parsing that as one
 * document produces nonsense: the billing period stretches across every
 * statement and consumption figures from different months get mixed.
 *
 * Splitting is done on page boundaries. A page begins a new statement when it
 * carries both a statement-header phrase and an account identifier — the
 * combination that every sample's first page has and no continuation page does.
 */

const HEADER_PHRASE =
  /(your\s+(?:business\s+)?electricity\s+(?:account|bill|tax\s+invoice)|tax\s+invoice|electricity\s+account|your\s+electricity\s+account)/i;

const ACCOUNT_PHRASE = /account\s*(?:number|no\.?|details)\b/i;

/**
 * @param {string[]} pages - per-page text
 * @returns {string[]} one text blob per statement
 */
export function splitStatements(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return [];
  if (pages.length === 1) return [pages[0]];

  const starts = [];
  for (let i = 0; i < pages.length; i++) {
    if (i === 0 || isStatementStart(pages[i])) starts.push(i);
  }

  // No repeat headers — it's a single statement spread over several pages.
  if (starts.length <= 1) return [pages.join('\n')];

  const out = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : pages.length;
    const chunk = pages.slice(from, to).join('\n');
    if (chunk.replace(/\s/g, '').length > 100) out.push(chunk);
  }

  return out.length > 0 ? out : [pages.join('\n')];
}

function isStatementStart(pageText) {
  return HEADER_PHRASE.test(pageText) && ACCOUNT_PHRASE.test(pageText);
}
