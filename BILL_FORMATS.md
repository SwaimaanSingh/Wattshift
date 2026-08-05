# Bill format notes (built from real sample bills)

Everything in `src/services/retailerPatterns/` was written against the eight
sample bills, not from guesswork. Re-generate the reference text any time with:

```bash
npm run extract          # digital PDFs -> scripts/sample-text/*.txt
node scripts/ocrScannedBills.mjs   # scanned PDFs -> *.ocr.txt
```

## Sample inventory

| Sample | Retailer | Type | Text layer | Notes |
|---|---|---|---|---|
| abe-chandra-sept25 | Lumo Energy | Residential, solar | digital | Two rate periods (1 Jul price change) |
| mcsherry-march2026 | AGL | Residential TOU, solar | digital | Two-tier feed-in tariff |
| pte-hq-april | iO Energy | Business TOU, solar | digital | Doubled text; export *charges* |
| mclaren-vale-caravan | Alinta Energy | Business flat | digital | Two rate periods, estimated read |
| origin-farm-2024-11 / -2025-10 | Origin Energy | C&I demand | digital | Unbundled network/env charges |
| origin-college-park | Origin Energy | Residential TOU + CL1 | **scanned** | OCR only |
| engie-adelaide-inn | ENGIE | C&I demand | **scanned** | OCR only; 43-page multi-month bundle |

## Retailer coverage

| Retailer | Module | Verified against a real bill |
|---|---|---|
| AGL | `agl.js` | yes |
| Origin Energy | `origin.js` | yes |
| Alinta Energy | `alintaEnergy.js` | yes |
| Lumo Energy | `lumoEnergy.js` | yes |
| iO Energy | `ioEnergy.js` | yes |
| ENGIE | `engie.js` | yes |
| EnergyAustralia | `energyAustralia.js` | **no** |
| Simply Energy | `simplyEnergy.js` | **no** |
| Red Energy | `redEnergy.js` | **no** |
| Momentum Energy | `momentumEnergy.js` | **no** |
| Amber Electric | `amberElectric.js` | **no** |
| Powershop | `powershop.js` | **no** |
| OVO Energy | `ovoEnergy.js` | **no** |
| Tango Energy | `tangoEnergy.js` | **no** |
| GloBird Energy | `globirdEnergy.js` | **no** |
| ReAmped Energy | `reampedEnergy.js` | **no** |
| Dodo Power & Gas | `dodoPowerGas.js` | **no** |

For the unverified ones, **detection** is solid — it keys off the brand, the
domain and the legal entity, all of which are stable and publicly known.
**Extraction** runs on the shared patterns in `generic.js` and is unproven
against those retailers' real layouts. Each module says so in its header.

Two test suites, with different purchase:

```bash
npm run test:parser      # real PDF text — the regression guard
npm run test:retailers   # synthetic fixtures — label-variant coverage
```

`test:retailers` fixtures are written from label *wording*, not transcribed
from real statements. A pass means the patterns handle that wording; it does
not mean they handle that retailer's layout. It catches regexes that never
fire, unit errors, and detection collisions between retailers who name each
other in a footer (Lumo/Red, Simply/ENGIE, Powershop/Shell, Momentum/Hydro
Tasmania, Tango/Pacific Hydro).

## Findings that shaped the parser

**1. Layout must be reconstructed, not concatenated.**
PDF.js returns positioned fragments in content-stream order. Joining them
scrambles labels away from values on these table-heavy bills. `textLayout.js`
groups fragments by y-coordinate and sorts by x, so a row like
`Peak  1,669.952 kWh  $0.53  $885.07` survives intact. Both the browser
extractor and the dev scripts use this same module, so patterns are developed
against exactly the text they run against.

**2. Some bills draw every string twice (fake bold).**
The iO Energy bill renders as `YOUR DETAILSYOUR DETAILS`. Handled by dropping
fragments with identical text at effectively identical coordinates.

**3. The mailing address is not the supply address.**
The AGL sample is addressed to `PINE POINT SA 5571` but the supply address is
`SOMERTON PARK SA 5044`. Using the wrong one puts the site ~150 km away and
changes the irradiance figure. Postcode extraction always prefers a postcode
near a "supply address"/"tax invoice for" marker and only falls back to the
first postcode in the document.

**4. Total usage is often not stated — it has to be summed.**
AGL never prints a total; it lists Peak 1,669.952 + Off peak 666.791 +
Shoulder 53.13. Three independent strategies are tried in order, and they
cross-check each other:
  1. an explicit total line,
  2. the sum of tariff component rows,
  3. average daily usage × billing days.

**5. Rates appear in both dollars and cents, sometimes on the same bill.**
`$0.3903`, `39.259 c/kWh`, `8.219200 $/Day`, `1.953000 $/kVA`. The unit token is
captured alongside the number and normalised to cents; where no unit exists a
magnitude heuristic applies (a "rate" below 5 is dollars, above is cents).

**6. Mid-period price changes split a bill into two rate blocks.**
Lumo, Alinta and Origin residential samples all do this — usually at 1 July.
Component rows are collected as a list and consumption-weighted, so the tariff
reported is the rate the customer actually paid, not just the first match.

**7. Export is not always a credit.**
The iO Energy bill *charges* $0.02/kWh for daytime export and pays a rebate
only in the evening. Feed-in tariffs are therefore consumption-weighted across
all export rows and are allowed to come out negative.

**8. Register naming is inconsistent between retailers.**
Standard NEM convention is E1 = import, B1 = export, which the iO Energy bill
follows exactly (E1 2,118.97 = sum of usage rows). The Origin C&I bill labels
them the other way round — `B1 Import Usage -15.420 kWh`, `E1 Export Usage
49,255.250 kWh` — while its own `Consumption this period:` line agrees with E1.
Register labels are therefore only used as a weak signal; explicit
consumption/usage lines always win.

**9. Commercial bills unbundle what residential bills combine.**
The Origin and ENGIE C&I bills split the variable cost into energy + network
volume + environmental + regulated charges. Reading only "Energy Charges" would
understate the true cost of a kWh by roughly 3x. When an unbundled structure is
detected, an effective rate is derived as
`(total ex-GST charges − fixed charges) / total kWh` and flagged as blended.

**10a. Rendering for OCR must not use requestAnimationFrame.**
PDF.js schedules canvas rendering with `requestAnimationFrame` under its
default `intent: 'display'`. Browsers stop firing rAF whenever the tab isn't
compositing — a backgrounded tab, or a phone switching apps mid-upload — so
`page.render()` never settles and OCR hangs forever behind the progress bar.
Rendering with `intent: 'print'` schedules on timers instead and completes
regardless of visibility (measured: indefinite hang → 104 ms). The same class
of bug applies to any rAF-driven UI, which is why the chart's bar animation is
disabled and the animated counters carry a timeout backstop.

**10b. OCR resolution decides whether a bill is readable at all.**
At 2x, Tesseract dropped decimal points on the Origin residential scan —
`24.756 c/kWh` became `24756`, which fails the plausibility check and sends an
otherwise-readable bill to the manual form. At 3x the decimals survive.
Scale is capped so the canvas stays inside mobile Safari's limits.

**10c. Not every bill puts the unit on the quantity.**
Origin's residential layout is
`Peak  14  LG032103550  603.105  39.259 c/kWh  $236.77` — bill days and meter
number sit between the label and the figures, and the quantity has no "kWh"
after it. Without a row shape for this, nothing parsed and the tariff fell back
to the first `c/kWh` on the page, which is the *controlled load* rate: 15.8c
instead of 39.4c. A rate-carrying row must also state a cost, otherwise the
tariff calendar Alinta prints at the foot of its bill
(`Peak - Step 1  48.862 c/kWh  All day`) reads as 1 kWh of usage.

**11. One field, a dozen labels — so the patterns are a fallback chain.**
The same figure is called "Total usage", "Energy used", "Units used", "kWh
used", "Consumption this period" or "You used ... kWh" depending on the
retailer. Supply is "Supply charge", "Service charge", "Daily charge",
"Service to Property Charge" or "Network charge"; the amount payable is
"Amount due", "Balance due", "Amount payable" or "Please pay". Each field runs
an ordered list of patterns, specific wording first, and only reports nothing
once every variant has missed.

Two guards keep the loose end of those chains honest:
  - A total-usage candidate is rejected if its own line carries daily, average
    or comparison wording. Without it, "Average daily usage 63.84 kWh" and
    "Same time last year 1,204 kWh" both read as the period total.
  - The ambiguous supply labels ("network charge", "fixed charge",
    "customer charge") are accepted only on a line that states an explicit
    per-day rate, because on the commercial samples "Network charges" heads a
    whole section of c/kWh rows rather than naming a daily charge.

**12. A feed-in tariff is too small for the magnitude heuristic.**
Finding #5's rule — a rate below 5 is dollars, above is cents — is right for
usage rates but wrong for feed-in, which now sits at 2-5c across the market.
It turned "4.5 c/kWh" into 450c, which then failed the plausibility check and
was discarded, losing the field entirely. The feed-in patterns therefore pin
the unit themselves rather than inferring it.

**10. OCR text is noisy.**
The scanned samples produced `24756 c/kWh` (lost decimal point) and `$2458`.
Anything from the OCR path is capped at "medium" confidence, and values that
fail a sanity range (e.g. a usage rate outside 5–200 c/kWh) are discarded so
they fall through to the AI fallback rather than silently producing a wrong
estimate.
