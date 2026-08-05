/**
 * Encode and decode a results link.
 *
 * The whole estimate is reconstructable from a handful of numbers, so a link
 * can carry them and skip the upload entirely. Only figures already visible on
 * screen go in — never the bill, the address, or anything identifying beyond
 * the postcode the customer chose to work with.
 */

/**
 * @param {object} args
 * @returns {string} absolute URL
 */
export function buildResultsUrl({
  billData,
  solarData,
  roofData,
  systemKw,
  batteryKwh,
  mode,
}) {
  const params = new URLSearchParams();

  const put = (key, value, decimals = 2) => {
    if (value == null || Number.isNaN(value)) return;
    params.set(key, Number(value).toFixed(decimals).replace(/\.?0+$/, ''));
  };

  params.set('pc', String(solarData?.postcode ?? ''));
  put('kwh', billData?.dailyAverageKwh, 3); // daily average
  put('days', billData?.billingDays, 0);
  put('tariff', billData?.tariffRateCentsPerKwh);
  put('supply', billData?.dailySupplyChargeCents);
  put('fit', billData?.feedInTariffCents);
  put('kw', systemKw, 1);
  put('batt', batteryKwh, 1);

  if (roofData?.orientation) params.set('or', roofData.orientation);
  put('pitch', roofData?.pitchDegrees, 1);
  if (roofData?.shading && roofData.shading !== 'none') {
    params.set('shade', roofData.shading);
  }
  if (billData?.retailer) params.set('r', billData.retailer);
  if (mode === 'business') params.set('mode', 'business');

  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?${params.toString()}`;
}

/**
 * Read a results link back into the shapes the app works with.
 * @returns {{billData: object, postcode: string, roofData: object,
 *            systemKw: number|null, batteryKwh: number}|null}
 */
export function readResultsUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const postcode = params.get('pc');
  const daily = Number(params.get('kwh'));

  // Both are required — without them there is no estimate to rebuild.
  if (!/^\d{4}$/.test(String(postcode || '')) || !(daily > 0)) return null;

  const num = (key) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && params.get(key) !== null ? value : null;
  };

  const days = num('days') || 91;

  return {
    postcode,
    systemKw: num('kw'),
    batteryKwh: num('batt') ?? 0,
    mode: params.get('mode') === 'business' ? 'business' : 'home',
    roofData: {
      orientation: params.get('or') || 'N',
      pitchDegrees: num('pitch') ?? 22.5,
      shading: params.get('shade') || 'none',
      detected: false,
    },
    billData: {
      retailer: params.get('r'),
      dailyAverageKwh: daily,
      billingDays: days,
      totalKwh: daily * days,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      tariffType: null,
      tariffRateCentsPerKwh: num('tariff'),
      touRates: null,
      dailySupplyChargeCents: num('supply'),
      hasSolar: false,
      solarExportKwh: null,
      feedInTariffCents: num('fit'),
      existingSolarSizeKw: null,
      totalBillAmount: null,
      postcode,
      address: null,
      confidence: 'medium',
      missingFields: [],
      fromSharedLink: true,
      diagnostics: { textSource: 'shared-link' },
    },
  };
}

/** Copy text, falling back to a hidden textarea where the API is blocked. */
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or insecure context — fall through.
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

/** True when the device can offer a native share sheet. */
export const canNativeShare = () => typeof navigator !== 'undefined' && Boolean(navigator.share);
