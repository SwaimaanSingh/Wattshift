/**
 * Rasterise an on-screen chart so it can be dropped into a PDF.
 *
 * Recharts renders real SVG, so the chart can be serialised and drawn straight
 * onto a canvas. That is both sharper and far lighter than screenshotting the
 * DOM with html2canvas — no extra dependency, no layout reflow, and vector
 * text stays crisp at any scale.
 *
 * The one catch is styling: the chart's colours come from Tailwind classes,
 * which mean nothing once the SVG is detached from the document. So computed
 * styles are copied onto the clone as inline attributes before serialising.
 */

/** Properties that carry a chart's appearance and must survive detachment. */
const STYLE_PROPS = [
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
  'font-size', 'font-family', 'font-weight', 'text-anchor',
];

/**
 * @param {HTMLElement} container element holding (or being) an <svg>
 * @param {object} [options]
 * @param {number} [options.scale] pixel density; 2 keeps text crisp in print
 * @returns {Promise<{dataUrl: string, width: number, height: number}|null>}
 */
export async function svgToPng(container, { scale = 2 } = {}) {
  const source =
    container?.tagName?.toLowerCase() === 'svg' ? container : container?.querySelector?.('svg');
  if (!source) return null;

  const rect = source.getBoundingClientRect();
  const width = Math.ceil(rect.width) || 640;
  const height = Math.ceil(rect.height) || 260;

  const clone = source.cloneNode(true);
  inlineComputedStyles(source, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  // White plate behind the chart so it stays legible in a printed PDF even
  // when the page was viewed in dark mode.
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  backdrop.setAttribute('width', '100%');
  backdrop.setAttribute('height', '100%');
  backdrop.setAttribute('fill', '#ffffff');
  clone.insertBefore(backdrop, clone.firstChild);

  const markup = new XMLSerializer().serializeToString(clone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('chart image failed to load'));
    img.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

/**
 * Rasterise several charts at once, tolerating individual failures.
 *
 * A report with one missing chart is far better than no report at all, so a
 * chart that won't render resolves to null rather than rejecting the batch.
 *
 * @param {Record<string, HTMLElement|null>} refs
 * @returns {Promise<Record<string, object|null>>}
 */
export async function captureCharts(refs) {
  const entries = Object.entries(refs);
  const images = await Promise.all(
    entries.map(([, element]) => svgToPng(element).catch(() => null))
  );
  return Object.fromEntries(entries.map(([key], i) => [key, images[i]]));
}

function inlineComputedStyles(source, clone) {
  const from = [source, ...source.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];

  for (let i = 0; i < from.length && i < to.length; i++) {
    const computed = window.getComputedStyle(from[i]);
    let css = '';
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none' && value !== 'normal') css += `${prop}:${value};`;
    }
    if (css) to[i].setAttribute('style', css);
    to[i].removeAttribute('class');
  }
}
