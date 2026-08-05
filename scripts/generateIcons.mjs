/**
 * Render the PWA install icons from the favicon's lightning bolt.
 *
 *   npm run icons
 *
 * The bolt lives in public/favicon.svg on a 32x32 grid. Rather than keep a
 * second copy of the artwork, the path is scaled out of that same grid here so
 * the installed icon and the browser tab can never drift apart.
 *
 * Three shapes, because the platforms want different things:
 *  - `icon-*.png`      rounded tile, used as-is by Android and desktop
 *  - `icon-maskable`   full bleed with the bolt inside the safe zone, so
 *                      Android can crop it to whatever shape the launcher uses
 *  - `apple-touch-icon` full bleed square and fully opaque — iOS applies its
 *                      own rounding and renders transparency as black
 */
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const GREEN = '#16a34a';
const GRID = 32; // favicon.svg viewBox
const CORNER = 8; // favicon.svg rx

/** The bolt, copied verbatim from public/favicon.svg. */
const BOLT =
  'M18.6 5.2a.7.7 0 0 1 1.22.73L16.4 13.2h5.1a.7.7 0 0 1 .55 1.13L13.1 26.6a.7.7 0 0 1-1.23-.7l3.4-7.6h-5.1a.7.7 0 0 1-.55-1.13L18.6 5.2Z';

// Ink-on-grid bounds of the bolt, used to centre it when it is scaled down.
const BOLT_BOX = { x: 8.9, y: 5.0, w: 13.3, h: 22.0 };

function roundedRect(ctx, size) {
  const r = (CORNER / GRID) * size;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
}

/**
 * @param {number} size    output edge length in px
 * @param {object} options
 * @param {boolean} options.rounded  round the tile corners
 * @param {number} options.boltScale bolt height as a share of the tile
 */
function render(size, { rounded, boltScale }) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = GREEN;
  if (rounded) {
    roundedRect(ctx, size);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }

  // Scale so the bolt's own height lands on boltScale x the tile, then centre
  // its bounding box rather than the 32-grid it was drawn on.
  const scale = (size * boltScale) / BOLT_BOX.h;
  ctx.save();
  ctx.translate(
    (size - BOLT_BOX.w * scale) / 2 - BOLT_BOX.x * scale,
    (size - BOLT_BOX.h * scale) / 2 - BOLT_BOX.y * scale
  );
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(BOLT));
  ctx.restore();

  return canvas.toBuffer('image/png');
}

const ICONS = [
  // Matches favicon proportions: 22/32 of the tile.
  ['icon-192.png', 192, { rounded: true, boltScale: 0.6875 }],
  ['icon-512.png', 512, { rounded: true, boltScale: 0.6875 }],
  // Maskable safe zone is the middle 80%; 55% keeps the bolt well inside it.
  ['icon-maskable-512.png', 512, { rounded: false, boltScale: 0.55 }],
  ['apple-touch-icon.png', 180, { rounded: false, boltScale: 0.6875 }],
];

for (const [name, size, options] of ICONS) {
  const png = render(size, options);
  writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${png.length} bytes`);
}
