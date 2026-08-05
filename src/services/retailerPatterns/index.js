/**
 * Pattern router: pick the retailer module whose fingerprint best matches the
 * bill text, then run it.
 *
 * Each module scores itself 0–3 rather than returning a boolean, because
 * retailer names cross-contaminate — Lumo's footer mentions "Red Energy Pty
 * Ltd" (the EvenPay® trademark owner), and "Origin" appears in unrelated
 * boilerplate. The highest score wins; ties fall back to document order.
 */
import * as agl from './agl.js';
import * as alintaEnergy from './alintaEnergy.js';
import * as amberElectric from './amberElectric.js';
import * as dodoPowerGas from './dodoPowerGas.js';
import * as energyAustralia from './energyAustralia.js';
import * as engie from './engie.js';
import * as generic from './generic.js';
import * as globirdEnergy from './globirdEnergy.js';
import * as ioEnergy from './ioEnergy.js';
import * as lumoEnergy from './lumoEnergy.js';
import * as momentumEnergy from './momentumEnergy.js';
import * as origin from './origin.js';
import * as ovoEnergy from './ovoEnergy.js';
import * as powershop from './powershop.js';
import * as reampedEnergy from './reampedEnergy.js';
import * as redEnergy from './redEnergy.js';
import * as simplyEnergy from './simplyEnergy.js';
import * as tangoEnergy from './tangoEnergy.js';

/**
 * Order matters only for score ties.
 *
 * The modules verified against a real sample bill come first, so that where a
 * bill genuinely mentions two brands at equal strength — a retailer footer
 * naming a parent company, say — the one whose extraction is known to work
 * wins the tie.
 */
export const RETAILERS = [
  agl,
  origin,
  energyAustralia,
  simplyEnergy,
  alintaEnergy,
  redEnergy,
  lumoEnergy,
  engie,
  ioEnergy,
  momentumEnergy,
  amberElectric,
  powershop,
  ovoEnergy,
  tangoEnergy,
  globirdEnergy,
  reampedEnergy,
  dodoPowerGas,
];

/**
 * @param {string} text
 * @returns {{module: object, name: string|null, score: number}}
 */
export function detectRetailer(text) {
  let best = null;
  let bestScore = 0;

  for (const module of RETAILERS) {
    const score = module.detect(text) || 0;
    if (score > bestScore) {
      best = module;
      bestScore = score;
    }
  }

  if (!best) return { module: generic, name: null, score: 0 };
  return { module: best, name: best.displayName, score: bestScore };
}

/**
 * Detect the retailer and extract, all in one step.
 * @param {string} text
 * @returns {{data: object, retailerId: string, retailerName: string|null}}
 */
export function parseWithPatterns(text) {
  const { module, name } = detectRetailer(text);
  const data = module.parse(text);
  return {
    data: { ...data, retailer: data.retailer ?? name },
    retailerId: module.id,
    retailerName: name,
  };
}

export { generic };
