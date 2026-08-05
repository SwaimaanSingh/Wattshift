/**
 * Google Solar API — Building Insights.
 *
 * Optional. With no key configured, or outside the API's coverage (most rural
 * Australia), the caller silently falls back to typical local roof
 * assumptions. A missing roof lookup is never surfaced as an error.
 */
import { azimuthToCompass } from '../utils/formatters.js';

const ENDPOINT = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';
const TIMEOUT_MS = 12000;

export function isSolarApiConfigured() {
  return Boolean(import.meta.env?.VITE_GOOGLE_SOLAR_API_KEY);
}

/**
 * @typedef {Object} RoofData
 * @property {boolean} detected
 * @property {string} orientation      compass code, e.g. 'N'
 * @property {number} azimuthDegrees
 * @property {number} pitchDegrees
 * @property {number|null} usableAreaM2
 * @property {number|null} maxPanels
 * @property {number|null} maxSystemKw
 * @property {number|null} sunshineHours  annual, from the API's quantiles
 * @property {number|null} segmentCount
 */

/**
 * Look up roof geometry for a coordinate.
 * @returns {Promise<RoofData|null>} null when unavailable for any reason
 */
export async function getRoofData(lat, lng) {
  const key = import.meta.env?.VITE_GOOGLE_SOLAR_API_KEY;
  if (!key || lat == null || lng == null) return null;

  const url =
    `${ENDPOINT}?location.latitude=${lat}&location.longitude=${lng}` +
    `&requiredQuality=LOW&key=${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    // 404 simply means no building data here — common outside metro areas.
    if (!res.ok) return null;
    return interpret(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function interpret(payload) {
  const potential = payload?.solarPotential;
  const segments = potential?.roofSegmentStats;
  if (!Array.isArray(segments) || segments.length === 0) return null;

  // Rank segments by usable area, but prefer orientations that actually
  // generate — a big south-facing plane is not the one to quote.
  const scored = segments
    .map((segment) => {
      const area = segment.stats?.areaMeters2 ?? 0;
      const azimuth = segment.azimuthDegrees ?? 0;
      const pitch = segment.pitchDegrees ?? 0;
      return { segment, area, azimuth, pitch, score: area * orientationWeight(azimuth) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  // Sunshine quantiles are hours per year per m²; the median captures typical
  // shading from trees and neighbouring buildings.
  const quantiles = potential?.maxSunshineHoursPerYear
    ? null
    : best.segment.stats?.sunshineQuantiles;
  const sunshineHours =
    potential?.maxSunshineHoursPerYear ??
    (Array.isArray(quantiles) ? quantiles[Math.floor(quantiles.length / 2)] : null);

  const maxPanels = potential?.maxArrayPanelsCount ?? null;
  const panelWatts = potential?.panelCapacityWatts ?? null;

  return {
    detected: true,
    orientation: azimuthToCompass(best.azimuth),
    azimuthDegrees: Math.round(best.azimuth),
    pitchDegrees: Math.round(best.pitch * 10) / 10,
    usableAreaM2: Math.round(
      scored.reduce((sum, s) => sum + (s.score > 0 ? s.area : 0), 0)
    ),
    maxPanels,
    maxSystemKw:
      maxPanels && panelWatts ? Math.round((maxPanels * panelWatts) / 100) / 10 : null,
    sunshineHours: sunshineHours ? Math.round(sunshineHours) : null,
    segmentCount: segments.length,
  };
}

/**
 * Southern-hemisphere weighting used only to choose which roof face to quote.
 * 0° azimuth is north in the API's convention.
 */
function orientationWeight(azimuth) {
  const a = ((azimuth % 360) + 360) % 360;
  const fromNorth = a > 180 ? 360 - a : a; // 0 (north) .. 180 (south)
  // Floored so a south-facing plane still counts for something rather than
  // dropping out of the ranking entirely.
  return Math.max(0.35, Math.cos((fromNorth * Math.PI) / 180));
}
