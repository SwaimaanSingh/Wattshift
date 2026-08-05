/**
 * Generate public/data/solarIrradiance.json.
 *
 *   node scripts/buildIrradiance.mjs
 *
 * Peak Sun Hours are annual-average daily figures for a horizontal plane,
 * consistent with BOM solar exposure grids and PVGIS for the same locations.
 * Monthly values come from a latitude-banded seasonality shape scaled to each
 * location's annual figure — the seasonal swing is driven almost entirely by
 * latitude, so this reproduces published monthly profiles closely while
 * keeping the table maintainable.
 *
 * Coverage: every South Australian postcode (5000–5999) plus the major
 * population centres of every other state and territory.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'data', 'solarIrradiance.json');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Seasonality shapes as ratios to the annual mean. Normalised at build time so
 * each averages exactly 1.0, which makes the monthly values reconstruct the
 * stated annual figure.
 */
const SHAPES = {
  // Southern temperate — strong summer/winter swing (Adelaide, Melbourne, Hobart)
  temperate: [1.464, 1.333, 1.071, 0.809, 0.612, 0.525, 0.568, 0.721, 0.94, 1.158, 1.333, 1.464],
  // Mid latitudes (Sydney, Perth, inland NSW)
  mild: [1.4, 1.29, 1.07, 0.85, 0.67, 0.59, 0.63, 0.77, 0.96, 1.14, 1.29, 1.4],
  // Subtropical (Brisbane, mid-Queensland, Pilbara)
  subtropical: [1.25, 1.18, 1.08, 0.94, 0.81, 0.75, 0.8, 0.92, 1.05, 1.15, 1.22, 1.25],
  // Tropical — the wet season suppresses summer output (Darwin, Cairns)
  tropical: [0.89, 0.88, 0.93, 1.01, 1.0, 0.96, 1.0, 1.07, 1.12, 1.12, 1.07, 0.96],
};

function normalise(shape) {
  const mean = shape.reduce((a, b) => a + b, 0) / shape.length;
  return shape.map((v) => v / mean);
}

const NORMALISED = Object.fromEntries(
  Object.entries(SHAPES).map(([k, v]) => [k, normalise(v)])
);

/** Pick a seasonality shape from latitude. */
function shapeFor(lat) {
  if (lat > -23.5) return NORMALISED.tropical;
  if (lat > -31) return NORMALISED.subtropical;
  if (lat > -34) return NORMALISED.mild;
  return NORMALISED.temperate;
}

function monthlyFrom(annual, lat) {
  const shape = shapeFor(lat);
  const psh = {};
  MONTHS.forEach((m, i) => {
    psh[m] = Math.round(annual * shape[i] * 10) / 10;
  });
  return psh;
}

/* ------------------------------------------------------------------ *
 * South Australia — full postcode coverage by region
 * ------------------------------------------------------------------ */

const SA_REGIONS = [
  { from: 5000, to: 5099, name: 'Adelaide metro', lat: -34.93, lng: 138.6, annual: 4.57 },
  { from: 5100, to: 5199, name: 'Adelaide northern suburbs', lat: -34.72, lng: 138.62, annual: 4.6 },
  { from: 5200, to: 5259, name: 'Adelaide Hills & Fleurieu', lat: -35.13, lng: 138.75, annual: 4.48 },
  { from: 5260, to: 5279, name: 'Coorong & Upper South East', lat: -35.9, lng: 140.0, annual: 4.55 },
  { from: 5280, to: 5299, name: 'Limestone Coast', lat: -37.83, lng: 140.78, annual: 4.25 },
  { from: 5300, to: 5349, name: 'Riverland & Murray Mallee', lat: -34.28, lng: 140.6, annual: 4.85 },
  { from: 5350, to: 5399, name: 'Barossa Valley', lat: -34.47, lng: 138.95, annual: 4.68 },
  { from: 5400, to: 5499, name: 'Mid North', lat: -33.83, lng: 138.6, annual: 4.75 },
  { from: 5500, to: 5599, name: 'Yorke Peninsula & Lower North', lat: -34.0, lng: 137.9, annual: 4.78 },
  { from: 5600, to: 5699, name: 'Eyre Peninsula', lat: -33.7, lng: 136.2, annual: 4.9 },
  { from: 5700, to: 5799, name: 'Far North', lat: -31.5, lng: 136.8, annual: 5.35 },
  { from: 5800, to: 5999, name: 'Adelaide', lat: -34.93, lng: 138.6, annual: 4.57 },
];

/** Well-known localities, so the confirmation prompt reads naturally. */
const SA_NAMES = {
  5000: 'Adelaide CBD', 5006: 'North Adelaide', 5007: 'Bowden & Brompton',
  5011: 'Woodville', 5015: 'Port Adelaide', 5019: 'Semaphore',
  5022: 'Henley Beach', 5024: 'West Beach', 5031: 'Mile End',
  5035: 'Keswick', 5038: 'Plympton', 5039: 'Edwardstown',
  5041: 'Colonel Light Gardens', 5042: 'Bedford Park', 5043: 'Marion',
  5044: 'Somerton Park', 5045: 'Glenelg', 5046: 'Oaklands Park',
  5047: 'Darlington', 5048: 'Brighton', 5049: "O'Halloran Hill",
  5050: 'Eden Hills', 5051: 'Blackwood & Craigburn Farm', 5052: 'Belair',
  5061: 'Unley', 5062: 'Mitcham', 5063: 'Eastwood', 5064: 'Glen Osmond',
  5065: 'Norwood', 5066: 'Burnside', 5067: 'Norwood South',
  5068: 'Kensington', 5069: 'College Park', 5070: 'Felixstow',
  5072: 'Magill', 5073: 'Tranmere', 5074: 'Campbelltown',
  5075: 'Newton', 5076: 'Athelstone', 5081: 'Prospect',
  5082: 'Fitzroy', 5083: 'Sefton Park', 5084: 'Blair Athol',
  5085: 'Enfield', 5086: 'Hillcrest', 5087: 'Windsor Gardens',
  5088: 'Holden Hill', 5089: 'Highbury', 5090: 'Tea Tree Gully',
  5091: 'Vista', 5092: 'Modbury', 5093: 'Para Vista',
  5094: 'Dry Creek', 5095: 'Mawson Lakes', 5096: 'Para Hills',
  5097: 'Redwood Park', 5098: 'Ingle Farm',
  5106: 'Salisbury', 5108: 'Salisbury North', 5110: 'Virginia',
  5112: 'Elizabeth', 5113: 'Elizabeth East', 5114: 'Smithfield',
  5115: 'Munno Para', 5116: 'Craigmore', 5117: 'Angle Vale',
  5118: 'Gawler', 5120: 'Two Wells', 5125: 'Golden Grove',
  5126: 'Greenwith', 5127: 'Wynn Vale', 5158: 'Hallett Cove',
  5159: 'Aberfoyle Park', 5162: 'Morphett Vale', 5163: 'Hackham',
  5164: 'Christie Downs', 5165: 'Christies Beach', 5166: 'Port Noarlunga',
  5167: 'Moana', 5168: 'Seaford', 5169: 'Aldinga Beach',
  5171: 'McLaren Vale', 5172: 'Willunga', 5173: 'Sellicks Beach',
  5201: 'Stirling', 5211: 'Victor Harbor', 5214: 'Goolwa',
  5231: 'Woodside', 5241: 'Balhannah', 5243: 'Echunga',
  5245: 'Bridgewater', 5250: 'Mount Barker', 5251: 'Nairne',
  5253: 'Murray Bridge', 5254: 'Strathalbyn', 5255: 'Milang',
  5259: 'Tailem Bend', 5268: 'Bordertown', 5271: 'Naracoorte',
  5275: 'Penola', 5280: 'Millicent', 5290: 'Mount Gambier',
  5330: 'Waikerie', 5333: 'Loxton', 5341: 'Renmark', 5343: 'Berri',
  5345: 'Barmera', 5352: 'Lyndoch', 5353: 'Angaston', 5355: 'Nuriootpa',
  5356: 'Tanunda', 5371: 'Kapunda', 5400: 'Freeling',
  5410: 'Kapunda region', 5417: 'Burra', 5453: 'Clare',
  5460: 'Balaklava', 5461: 'Balaklava & Saints', 5470: 'Snowtown',
  5491: 'Jamestown', 5501: 'Mallala', 5540: 'Port Pirie',
  5552: 'Ardrossan', 5554: 'Kadina', 5556: 'Wallaroo',
  5558: 'Moonta', 5573: 'Maitland', 5575: 'Minlaton',
  5600: 'Whyalla', 5606: 'Port Lincoln', 5607: 'Cummins',
  5608: 'Whyalla Norrie', 5630: 'Cowell', 5641: 'Cleve',
  5650: 'Wudinna', 5660: 'Streaky Bay', 5680: 'Ceduna',
  5690: 'Ceduna region', 5700: 'Port Augusta', 5710: 'Quorn',
  5713: 'Hawker', 5720: 'Leigh Creek', 5723: 'Coober Pedy',
  5725: 'Roxby Downs', 5730: 'Marla', 5734: 'Marree',
};

/* ------------------------------------------------------------------ *
 * Rest of Australia — major centres
 * ------------------------------------------------------------------ */

const OTHER = [
  // NSW
  ['2000', 'Sydney CBD', 'NSW', -33.87, 151.21, 4.3],
  ['2150', 'Parramatta', 'NSW', -33.82, 151.0, 4.35],
  ['2170', 'Liverpool', 'NSW', -33.92, 150.92, 4.35],
  ['2250', 'Gosford', 'NSW', -33.43, 151.34, 4.25],
  ['2300', 'Newcastle', 'NSW', -32.93, 151.78, 4.3],
  ['2444', 'Port Macquarie', 'NSW', -31.43, 152.91, 4.5],
  ['2450', 'Coffs Harbour', 'NSW', -30.3, 153.11, 4.6],
  ['2500', 'Wollongong', 'NSW', -34.42, 150.89, 4.2],
  ['2640', 'Albury', 'NSW', -36.08, 146.92, 4.6],
  ['2650', 'Wagga Wagga', 'NSW', -35.11, 147.37, 4.8],
  ['2750', 'Penrith', 'NSW', -33.75, 150.69, 4.4],
  ['2795', 'Bathurst', 'NSW', -33.42, 149.58, 4.6],
  ['2830', 'Dubbo', 'NSW', -32.25, 148.6, 4.9],
  ['2340', 'Tamworth', 'NSW', -31.09, 150.93, 5.0],
  ['2880', 'Broken Hill', 'NSW', -31.96, 141.47, 5.5],
  // ACT
  ['2600', 'Canberra', 'ACT', -35.28, 149.13, 4.5],
  ['2606', 'Woden', 'ACT', -35.35, 149.09, 4.5],
  ['2617', 'Belconnen', 'ACT', -35.24, 149.07, 4.5],
  ['2900', 'Tuggeranong', 'ACT', -35.42, 149.07, 4.5],
  ['2912', 'Gungahlin', 'ACT', -35.18, 149.13, 4.5],
  // VIC
  ['3000', 'Melbourne CBD', 'VIC', -37.81, 144.96, 3.8],
  ['3030', 'Werribee', 'VIC', -37.9, 144.66, 3.9],
  ['3175', 'Dandenong', 'VIC', -37.98, 145.21, 3.85],
  ['3199', 'Frankston', 'VIC', -38.14, 145.12, 3.85],
  ['3220', 'Geelong', 'VIC', -38.15, 144.36, 3.9],
  ['3280', 'Warrnambool', 'VIC', -38.38, 142.48, 3.8],
  ['3350', 'Ballarat', 'VIC', -37.56, 143.86, 3.8],
  ['3500', 'Mildura', 'VIC', -34.19, 142.16, 4.9],
  ['3550', 'Bendigo', 'VIC', -36.76, 144.28, 4.1],
  ['3630', 'Shepparton', 'VIC', -36.38, 145.4, 4.2],
  ['3690', 'Wodonga', 'VIC', -36.12, 146.89, 4.3],
  ['3844', 'Traralgon', 'VIC', -38.19, 146.54, 3.7],
  // QLD
  ['4000', 'Brisbane CBD', 'QLD', -27.47, 153.03, 5.0],
  ['4305', 'Ipswich', 'QLD', -27.61, 152.76, 5.0],
  ['4350', 'Toowoomba', 'QLD', -27.56, 151.95, 5.1],
  ['4217', 'Gold Coast', 'QLD', -28.0, 153.43, 4.9],
  ['4558', 'Sunshine Coast', 'QLD', -26.65, 153.07, 4.9],
  ['4655', 'Hervey Bay', 'QLD', -25.29, 152.85, 5.1],
  ['4670', 'Bundaberg', 'QLD', -24.87, 152.35, 5.2],
  ['4700', 'Rockhampton', 'QLD', -23.38, 150.51, 5.4],
  ['4740', 'Mackay', 'QLD', -21.14, 149.19, 5.3],
  ['4810', 'Townsville', 'QLD', -19.26, 146.82, 5.6],
  ['4825', 'Mount Isa', 'QLD', -20.73, 139.49, 6.1],
  ['4870', 'Cairns', 'QLD', -16.92, 145.77, 5.2],
  // WA
  ['6000', 'Perth CBD', 'WA', -31.95, 115.86, 5.2],
  ['6027', 'Joondalup', 'WA', -31.74, 115.77, 5.2],
  ['6160', 'Fremantle', 'WA', -32.05, 115.75, 5.15],
  ['6168', 'Rockingham', 'WA', -32.28, 115.73, 5.2],
  ['6210', 'Mandurah', 'WA', -32.53, 115.72, 5.1],
  ['6230', 'Bunbury', 'WA', -33.33, 115.64, 5.0],
  ['6330', 'Albany', 'WA', -35.03, 117.88, 4.7],
  ['6430', 'Kalgoorlie', 'WA', -30.75, 121.47, 5.7],
  ['6530', 'Geraldton', 'WA', -28.77, 114.61, 5.7],
  ['6714', 'Karratha', 'WA', -20.74, 116.85, 6.2],
  ['6721', 'Port Hedland', 'WA', -20.31, 118.61, 6.2],
  ['6725', 'Broome', 'WA', -17.96, 122.24, 6.0],
  // TAS
  ['7000', 'Hobart', 'TAS', -42.88, 147.33, 3.5],
  ['7050', 'Kingston', 'TAS', -42.98, 147.31, 3.5],
  ['7250', 'Launceston', 'TAS', -41.44, 147.14, 3.6],
  ['7310', 'Devonport', 'TAS', -41.18, 146.36, 3.7],
  ['7315', 'Ulverstone', 'TAS', -41.16, 146.17, 3.7],
  ['7320', 'Burnie', 'TAS', -41.06, 145.9, 3.6],
  // NT
  ['0800', 'Darwin', 'NT', -12.46, 130.84, 5.8],
  ['0830', 'Palmerston', 'NT', -12.49, 130.98, 5.8],
  ['0850', 'Katherine', 'NT', -14.47, 132.26, 6.0],
  ['0860', 'Tennant Creek', 'NT', -19.65, 134.19, 6.3],
  ['0870', 'Alice Springs', 'NT', -23.7, 133.88, 6.2],
  ['0880', 'Nhulunbuy', 'NT', -12.19, 136.78, 5.6],
];

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

const postcodes = {};

for (const region of SA_REGIONS) {
  for (let code = region.from; code <= region.to; code++) {
    const key = String(code);
    postcodes[key] = {
      name: SA_NAMES[code] || region.name,
      state: 'SA',
      lat: region.lat,
      lng: region.lng,
      psh: monthlyFrom(region.annual, region.lat),
      annual: region.annual,
    };
  }
}

for (const [code, name, state, lat, lng, annual] of OTHER) {
  postcodes[code] = {
    name,
    state,
    lat,
    lng,
    psh: monthlyFrom(annual, lat),
    annual,
  };
}

const output = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    units: 'peak sun hours per day (kWh/m2/day, horizontal plane)',
    note: 'Monthly values derived from a latitude-banded seasonality shape scaled to each location annual average.',
    count: Object.keys(postcodes).length,
  },
  postcodes,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(output), 'utf8');

const bytes = (await fs.stat(OUT)).size;
console.log(
  `Wrote ${Object.keys(postcodes).length} postcodes to public/data/solarIrradiance.json (${Math.round(bytes / 1024)} KB)`
);

// Sanity check: reconstructed annual should match the stated annual.
for (const key of ['5000', '5044', '3000', '0800', '7000']) {
  const p = postcodes[key];
  const mean = MONTHS.reduce((s, m) => s + p.psh[m], 0) / 12;
  console.log(
    `  ${key} ${p.name.padEnd(28)} annual ${p.annual}  monthly mean ${mean.toFixed(2)}`
  );
}
