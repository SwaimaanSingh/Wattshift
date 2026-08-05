# WattShift — project context

**Upload your bill. See your solar future.**

Mobile-first web app for Australian homeowners and small businesses. Upload an
electricity bill, get a recommended solar system size, savings range, bill
comparison, and battery scenarios. Stage 2 adds half-hourly modelling from
NEM12 smart meter data and a downloadable PDF report.

No signup. No email gate. Everything runs in the browser — bills and meter
data are never uploaded to a server.

---

## Quick start

```bash
npm install
npm run dev    # http://localhost:5173
npm run build  # static output in dist/
```

Optional `.env` keys (app works without them):

| Variable | What it adds |
|---|---|
| `VITE_GEMINI_API_KEY` | AI fallback for bills regex can't read |
| `VITE_GOOGLE_SOLAR_API_KEY` | Roof orientation, pitch, area from satellite |
| `VITE_ENQUIRY_FORM_ENDPOINT` | Formspree for quote enquiries (else mailto:) |

---

## App flow

```
Landing → bill upload → Results (Stage 1)
                              ↓
                    Stage 2 landing → Stage 2 results
```

**Stage 1** (`Results.jsx`): bill-derived sizing, savings, battery scenarios.

**Stage 2** (`Stage2/`):
- `Stage2Landing.jsx` — upload NEM12 meter data (recommended) or continue with
  bill data only. Optional manual fields: solar system size (kW), battery size
  (kWh).
- `Stage2Results.jsx` — interval or bill-only analysis, charts, PDF report.

When existing solar is **> 3 kW** (from landing input, NEM12 peak-export
detection, or results-page override), the UI and PDF switch from "recommend a
new system" to **assess existing system performance**:
- Heading: "How your system is performing"
- Show: generation, self-consumption %, export, grid dependence
- Hide: cost estimates, STC rebate, payback, solar sizer, get-quotes CTA

**Mid-file solar install:** `detectSetupChange()` sums monthly B1 export and
finds the first month that steps up ≥ 3× the prior monthly maximum and by
≥ 200 kWh (or the first month above 50 kWh after a zero-export lead-in). Data
from the 1st of that month onward is used for all analysis, charts, and PDF
figures (annualised from post-install length only). Pre-install months supply
the before/after grid-draw insight.

---

## Key services

| File | Role |
|---|---|
| `billParser.js` | PDF/OCR → retailer patterns → BillData |
| `calculationEngine.js` | Sizing, production, savings (Stage 1) |
| `nem12Parser.js` | Parse NEM12 CSV smart meter files |
| `intervalAnalysis.js` | Half-hourly solar/battery simulation (Stage 2) |
| `existingSystemEstimate.js` | Detect setup changes, estimate solar from export |
| `costEstimator.js` | Installed costs, STCs, payback |
| `reportGenerator.js` | Multi-page PDF (feasibility or performance mode) |
| `config/defaults.js` | Every modelling assumption |

---

## Modelling notes (read before changing calculations)

- **Home vs business modes** — separate slider ranges, battery presets, wording
  in `DEFAULTS.modes`.
- **Bill floor** — projected bill never below daily supply charge × 365.
- **Sizing** — targets 100% offset with 6.6 kW practical floor; user-adjustable
  slider recalculates live.
- **Self-consumption** — size-adjusted ratio; battery model uses capture curve
  vs daily production.
- **Existing solar on bill** — bill shows grid imports only; don't subtract
  existing kW from recommended size (double-counting).
- **Savings** — always ±15% range, never a single number.
- **Payback ranges** — use `formatPaybackYears()` in `formatters.js`; always
  display lower year first.

Full detail: see `README.md` and `BILL_FORMATS.md`.

---

## Project layout

```
src/
├── App.jsx                 routing / stage machine
├── components/
│   ├── Results.jsx         Stage 1 results
│   └── Stage2/             landing, results, charts, report download
├── services/               parsers, calculators, PDF
├── config/defaults.js      assumptions
└── utils/formatters.js     AUD currency, kWh, payback formatting
```

---

## Testing

```bash
npm run test:parser
node scripts/testCalcs.mjs
node scripts/testSelfConsumption.mjs
node scripts/testQuoteAssessor.mjs
```

---

## Conventions for contributors

- Match existing component patterns and Tailwind utility classes (`card`,
  `btn-primary`, `field`, `chip`).
- Minimize scope — focused diffs, no drive-by refactors.
- Comments only for non-obvious business logic.
- Bills and meter data stay client-side; never add server upload without
  explicit product decision.
