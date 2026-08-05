/**
 * Peak Sun Hours lookup and location detection.
 */

let cache = null;
let inflight = null;

/** Load (and memoise) the irradiance table. */
export async function loadIrradiance() {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = fetch(`${import.meta.env.BASE_URL}data/solarIrradiance.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load solar data (${res.status})`);
      return res.json();
    })
    .then((json) => {
      cache = json;
      inflight = null;
      return json;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });

  return inflight;
}

/**
 * Find irradiance data for a postcode.
 *
 * Falls back progressively: exact match, then the numerically nearest
 * postcode sharing the first two digits (same broad region), then the nearest
 * in the same state, then Adelaide.
 *
 * @param {string} postcode
 * @returns {Promise<{postcode: string, exact: boolean, ...}>}
 */
export async function lookupPostcode(postcode) {
  const data = await loadIrradiance();
  const table = data.postcodes;
  const key = String(postcode || '').padStart(4, '0');

  if (table[key]) return { postcode: key, exact: true, ...table[key] };

  const target = Number(key);
  if (Number.isFinite(target)) {
    const nearest = nearestNumeric(table, target);
    if (nearest) {
      return { postcode: nearest.key, exact: false, ...table[nearest.key] };
    }
  }

  return { postcode: '5000', exact: false, ...table['5000'] };
}

function nearestNumeric(table, target) {
  const prefix = Math.floor(target / 100);
  let best = null;
  let bestDistance = Infinity;
  let bestPrefixMatch = false;

  for (const key of Object.keys(table)) {
    const value = Number(key);
    if (!Number.isFinite(value)) continue;

    const distance = Math.abs(value - target);
    const prefixMatch = Math.floor(value / 100) === prefix;

    // A same-region postcode always beats a numerically closer one from
    // another region (postcode numbers jump across state boundaries).
    if (prefixMatch && !bestPrefixMatch) {
      best = { key };
      bestDistance = distance;
      bestPrefixMatch = true;
      continue;
    }
    if (prefixMatch === bestPrefixMatch && distance < bestDistance) {
      best = { key };
      bestDistance = distance;
    }
  }

  return best;
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Nearest known location to a coordinate.
 * @returns {Promise<object>} irradiance entry plus `distanceKm`
 */
export async function nearestToCoords(lat, lng) {
  const data = await loadIrradiance();
  const table = data.postcodes;

  let best = null;
  let bestDistance = Infinity;

  for (const [key, entry] of Object.entries(table)) {
    const d = distanceKm(lat, lng, entry.lat, entry.lng);
    if (d < bestDistance) {
      bestDistance = d;
      best = { postcode: key, ...entry };
    }
  }

  return best ? { ...best, exact: false, distanceKm: Math.round(bestDistance) } : null;
}

/**
 * Browser geolocation, wrapped so the caller gets a friendly message rather
 * than a bare PositionError.
 * @returns {Promise<{lat: number, lng: number}>}
 */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error("This browser can't share your location."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const messages = {
          1: 'Location permission was declined. Enter your postcode instead.',
          2: "Couldn't determine your location. Enter your postcode instead.",
          3: 'Finding your location took too long. Enter your postcode instead.',
        };
        reject(new Error(messages[err.code] || 'Location unavailable.'));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

/** True for a syntactically valid Australian postcode. */
export function isValidPostcode(value) {
  return /^\d{4}$/.test(String(value || '').trim());
}
