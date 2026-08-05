# WattShift

**Upload your bill. See your solar future.**

A mobile-first web app for Australian homeowners. Upload an electricity bill,
get a recommended solar system size, an honest savings range, a before/after
bill comparison, and battery scenarios.

No signup. No email gate. No manual data entry unless the parser genuinely
can't read the bill. Everything runs in the browser — bills are never uploaded
anywhere.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Optional API keys — the app works fully without them:

```bash
cp .env.example .env
```

| Variable | What it adds if set | Behaviour if unset |
|---|---|---|
| `VITE_GEMINI_API_KEY` | AI fallback for bills regex can't read | Skips straight to the manual form |
| `VITE_GOOGLE_SOLAR_API_KEY` | Roof orientation, pitch and area from satellite data | Uses typical local roof assumptions, no error shown |
| `VITE_ENQUIRY_FORM_ENDPOINT` | Posts quote enquiries to Formspree | Falls back to a `mailto:` link — no backend needed |

Build for production (static output in `dist/`, deploys to Vercel or Netlify
as-is):

```bash
npm run build
```

---

## Verifying the bill parser

The retailer patterns were written against eight real bills covering six
retailers, and there is a test suite that checks extraction against figures
transcribed by hand from those PDFs.

```bash
npm run extract        # PDF -> scripts/sample-text/*.txt
npm run test:parser    # patterns vs hand-checked ground truth
node scripts/testCalcs.mjs   # calculation engine sanity checks
```

`npm run extract` reads the sample bills from their original paths (see the
`SAMPLES` array in `scripts/extractSampleBills.mjs`) — point it at your own
files to add cases. Two of the samples are scans with no text layer;
`node scripts/ocrScannedBills.mjs` OCRs those.

Current status: **79 parser assertions, 61 calculation checks, plus dedicated
self-consumption and quote-checker suites — all passing.**

```bash
node scripts/testSelfConsumption.mjs   # battery/self-consumption model
node scripts/testQuoteAssessor.mjs     # quote checker pricing verdicts
```

Extracted bill text is written to `scripts/sample-text/`, which is gitignored —
it contains real customer data and must not be committed.

`BILL_FORMATS.md` documents what each sample taught us and why the parser is
built the way it is. Read it before changing anything in `retailerPatterns/`.

---

## How a bill becomes an estimate

```
PDF or photo
  ↓  pdfExtractor.js      PDF.js, or Tesseract OCR for scans and photos
  ↓  textLayout.js        rebuild visual lines from positioned fragments
  ↓  statementSplitter.js split multi-statement files into separate bills
  ↓  retailerPatterns/    detect retailer, run its patterns
  ↓  confidence.js        score the result, list what's missing
  ↓  aiProvider.js        only if confidence is low and a key is set
  ↓  FallbackForm.jsx     only if that also fails — pre-filled, gaps only
  ↓  calculationEngine.js sizing, production, savings
```

### Retailer coverage

| Retailer | Verified against a real bill |
|---|---|
| AGL | Yes — residential TOU with solar |
| Origin Energy | Yes — residential TOU (scanned) and C&I demand |
| Alinta Energy | Yes — business flat rate |
| Lumo Energy | Yes — residential flat with solar |
| ENGIE | Yes — C&I demand (scanned) |
| iO Energy | Yes — business TOU with solar |
| EnergyAustralia | **No sample supplied** — detection only, generic extraction |
| Simply Energy | **No sample supplied** — detection only, generic extraction |
| Red Energy | **No sample supplied** — detection only, generic extraction |
| Anything else | `generic.js` catch-all patterns |

The three unverified modules are clearly marked with `verified = false`. They
will detect the retailer correctly but their extraction is unproven — add a
sample bill to the test suite before relying on them.

---

## Things worth knowing before you change the modelling

Every assumption lives in `src/config/defaults.js`. A few deserve explanation:

**Home and business are separate modes.** `DEFAULTS.modes` swaps the slider
ranges, quick sizes, battery presets, practical minimum, network-threshold
warnings and wording as a set — a home tops out at 30 kW / 30 kWh, a business
at 200 kW / 200 kWh. Switching modes never touches the extracted bill data, so
it costs nothing and needs no re-upload. Above 50 kWh/day the app *suggests*
business but never forces it.

**Savings can offset the whole bill.** Self-consumed energy displaces retail
imports; export is credited at the feed-in tariff with no separate ceiling.
Together they can pay down energy *and* the connection fee. Savings stop at a
fully offset bill (`currentBill`) rather than showing a net credit — retailers
treat surplus credits inconsistently — and `savingsCapped` is exposed so the
UI can say why the number stopped moving. The connection fee itself is still
reported as `supplyChargeAnnual`.

**Sizing targets 100% offset of annual consumption, with a 6.6 kW floor.**
The coverage figure is shown to one decimal and deliberately not rounded to
"standard" sizes. But below roughly 6.6 kW the fixed costs of an installation
barely change while the STC rebate shrinks, so a mathematically correct 1.5 kW
recommendation is useless advice. `calculateSystemSize` returns both
`coverageKw` and `recommendedKw` plus a `practicalFloorApplied` flag, and the
UI explains itself whenever the floor is what set the number. Still capped at
30 kW at the top end.

**System size is user-adjustable.** The recommendation is a starting position,
not a verdict — a slider (3–30 kW) recalculates production, savings, the bill
comparison and every battery scenario live. A "nearly zero bill" solver
bisects for the smallest size that reduces the bill to roughly just the supply
charge; it reports `reachable: false` rather than lying when even 30 kW can't
get there on a low feed-in tariff.

**"Covers X%" is capped in the display at 100%+.** Oversizing legitimately
produces figures like 861%, which reads as a bug rather than as information.
The real ratio stays available under Technical details.

**Self-consumption is adjusted for system size.** The 35% / 55% / 70% / 80%
table is calibrated for a system sized to roughly cover annual usage. A system
much smaller than the load self-consumes a far greater share of what it makes,
so the ratio is scaled by production ÷ consumption. Without this, undersized
systems would have their savings badly understated — and with a free-moving
size slider, that adjustment now matters a great deal more.

**Self-consumption is driven by battery size relative to daily production.**
`calculateSelfConsumption()` starts from a base ratio (30% home, 55% business —
businesses run through the solar day), works out how much of a day's export a
battery could hold after round-trip losses, and applies an asymptotic capture
curve for diminishing returns. This matters because a 10 kWh battery is
transformative on a 6.6 kW system and a rounding error on a 500 kW one; an
earlier model keyed off capacity alone and reported identical figures for every
large battery on a big system.

Verify it with `node scripts/testSelfConsumption.mjs`.

*Known trade-off:* with no battery the ratio is independent of system size, so
a 6.6 kW and a 30 kW system on the same house both report 30%. Savings stay
bounded because self-consumed energy is capped at actual consumption and the
bill is floored at the supply charge, but the displayed percentage flatters an
oversized system. Worth revisiting if oversizing becomes a common path.

**Capacity fields accept values beyond their slider.** The sliders cover the
sizes worth offering; the number input next to each one accepts anything up to
a hard cap of 500. Past the slider's end it pins to the maximum while the
calculations use what was typed, and a note explains what that size implies
(export limiting, AEMO registration, network approval). Typing is debounced
300 ms so a half-typed "1" in "150" doesn't recalculate the page at 1 kW.

**A bill from a home that already has solar shows grid imports only** — the
power its panels feed straight into the house never appears. So the size
calculated from such a bill *is* the extra capacity needed; subtracting the
existing system would double-count generation that has already been netted off.
This is why `additionalKwNeeded` is not `required − existing`.

**Commercial bills unbundle the cost of a kWh** across energy, network,
environmental and regulated charges. Reading only the retail energy rate
understates the true marginal cost by roughly 3x, so when that structure is
detected the parser sums every per-kWh charge instead. Demand charges are
excluded — solar reliably offsets energy, not peak demand.

**Savings are always a range** (±15%), never a single number.

**OCR results are capped at "medium" confidence.** The scanned samples produced
values like `24756 c/kWh` where a decimal point was lost. A plausible-looking
wrong number is more dangerous than an admitted gap, so out-of-range values are
discarded and fall through to the AI fallback.

### Solar irradiance data

`public/data/solarIrradiance.json` — 1,068 postcodes: every South Australian
postcode (5000–5999) plus the major centres of every other state and territory.
Regenerate with:

```bash
node scripts/buildIrradiance.mjs
```

Peak Sun Hours are annual-average daily figures consistent with BOM solar
exposure grids and PVGIS. Monthly values come from a latitude-banded
seasonality shape scaled to each location's annual figure. Unknown postcodes
resolve to the nearest one in the same region; geolocation resolves to the
nearest known coordinate.

---

## Swapping the AI provider

`src/services/aiProvider.js` is the only file that needs to change. Everything
else calls `extractWithAI(text)` and receives the same `BillData` shape. A
working Ollama implementation is already in the file — change `AI_PROVIDER` to
`'ollama'` to use a local model instead of Gemini.

Whatever the provider returns is range-checked before it reaches the
calculator, so a hallucinated 3900 c/kWh rate is discarded rather than
displayed.

Note that regex results always win over AI where both found a value — the
patterns read the document literally, whereas a model can transcribe a
plausible-looking wrong number. AI only fills genuine gaps.

---

## Project layout

```
src/
├── components/          UI, one screen or card per file
├── services/
│   ├── billParser.js         orchestrator
│   ├── pdfExtractor.js       PDF.js + Tesseract
│   ├── textLayout.js         visual-line reconstruction (shared with scripts/)
│   ├── statementSplitter.js  multi-statement PDFs
│   ├── retailerPatterns/     one module per retailer + shared toolkit
│   ├── aiProvider.js         swappable AI fallback
│   ├── confidence.js         scoring (no browser APIs — testable in Node)
│   ├── solarDataService.js   PSH lookup + geolocation
│   ├── googleSolarApi.js     roof detection
│   ├── calculationEngine.js  sizing, production, savings
│   ├── resultsLink.js        shareable-link encode/decode
│   └── summaryPdf.js         one-page PDF export
├── config/defaults.js   every assumption, in one place
└── utils/formatters.js  Australian currency, number and date formatting
```

## Sharing an estimate

"Copy link" encodes the estimate into query parameters — postcode, daily usage,
rates, system size, battery — so opening the link rebuilds the results page
with no upload. Only figures already on screen are encoded: never the bill
itself, a name, or a street address. Web Share is offered where the device
supports it, and the PDF summary embeds the monthly chart by inlining computed
styles onto a clone of the SVG before rasterising it (its colours come from CSS
classes that mean nothing once the SVG is detached from the document).

---

## Disclaimer

These estimates are for guidance only and do not constitute engineering advice.
Actual performance depends on site conditions, equipment selection, and
installation quality. Consult a CEC-accredited installer for system design.
