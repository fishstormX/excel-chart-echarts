# Architecture

How excel-chart-echarts turns **native Excel charts** into ECharts options — without Excel libraries, without a browser automation step, and with **bit-identical** TypeScript / Python output.

Chinese: [架构说明](architecture.zh-CN.md)

---

## Goals

| Goal | Approach |
|---|---|
| Read real Excel charts | Parse OOXML DrawingML (`xl/charts/chartN.xml`) and chartEx (`chartExN.xml`) inside the zip |
| No Excel runtime deps | Own ZIP central-directory reader + small namespace-aware XML parser (TS); stdlib `zipfile` + `xml.etree` (Python) |
| Same result everywhere | Shared mapping rules; `tests/parity.py` asserts TS ≡ Python JSON on fixtures |
| Usable in Node **and** browser | Same converter; browser build uses `DecompressionStream('deflate-raw')` |
| Faithful visuals | Theme colors, axes, labels, legend, numFmt hooks, error bars / trendlines / combo axes |

Non-goals: editing workbooks, running VBA macros, converting **plain tables** into charts, pixel-perfect layout engines.

---

## Pipeline

```
.xlsx / .xlsm / .xltx / .xltm
        │
        ▼
   Open as ZIP ──► workbook.xml.rels → sheets → drawings → charts / chartEx
        │
        ▼
   For each chart part:
     1. Resolve series data (numCache / strCache / multiLvlStrCache,
        else formula → cells, shared formulas, small formula evaluator)
     2. Map chart groups (bar / line / area / pie / scatter / radar / bubble / …)
        and chartEx layouts (waterfall / treemap / sunburst / funnel / …)
     3. Axes, legend, title, colors (theme1.xml + spPr), labels, numFmt
     4. Emit ECharts `option` (+ optional `x-numFmt`, `x-renderItem`, `x-geo`)
        │
        ▼
   { charts: [...], sheets, warnings, evaluatedFormulas }
        │
        ▼
   prepare(option)   // turn x-numFmt / x-renderItem hooks into real functions
   registerMaps(...) // for regionMap
```

CLI also writes one JSON per chart, `index.json`, and a local `preview.html` (bundled `echarts.min.js`, no CDN).

---

## Data model (OOXML → ECharts)

### Classic charts (`chartN.xml`)

DrawingML chart groups become ECharts series:

| DrawingML | ECharts |
|---|---|
| `barChart` / `bar3DChart` | `bar` (category on yAxis when `barDir=bar`) |
| clustered / stacked / percentStacked | none / `stack` / `stack` + 0–100% axis |
| `lineChart` / `areaChart` | `line` (+ `areaStyle`) |
| `pieChart` / doughnut / ofPie | `pie` (`radius`, `startAngle`) |
| `scatterChart` / `bubbleChart` | `scatter` (+ per-point `symbolSize`) |
| `radarChart` | `radar` + `indicator` |
| combo `plotArea` | multi series + `xAxisIndex` / `yAxisIndex` (secondary axis on the right) |
| `c:errBars` | `custom` series, `x-renderItem: "errorBar"` |
| `c:trendline` | `markLine` (linear scatter) or sampled `line` series |

Axes (`catAx` / `valAx` / `dateAx`), legend, title, gridlines, `numFmt`, `dLbls`, and `spPr` fills/lines are mapped field-by-field. Unspecified series colors cycle theme accent1–6 (Excel’s deepen/lighten rules beyond 6).

### Office 2016+ chartEx (`chartExN.xml`)

Linked from drawings via `mc:AlternateContent` → relationship type `…/2014/relationships/chartEx`. Data lives in `cx:chartData` (`cx:strDim` / `cx:numDim` levels). Layout ids:

| `layoutId` | ECharts |
|---|---|
| `waterfall` | stacked `bar` (Increase / Decrease / Total) + connector `markLine` |
| `treemap` / `sunburst` | `treemap` / `sunburst` |
| histogram (`binning`) | `bar` gap 0 (Scott rule when auto) |
| `paretoLine` | sorted columns + cumulative % line on secondary axis |
| `funnel` | centered horizontal stacked bars |
| `boxWhisker` | `boxplot` + custom overlays |
| `regionMap` | `map` + continuous `visualMap` + `x-geo` |

### Formula fallback

Many writers (openpyxl, pandas) omit caches. The converter then:

1. Parses formula refs (`'Sheet'!$B$2:$B$10`, multi-area, defined names)
2. Reads shared / inline strings and cell values
3. Recalculates a **small** function set (`SUM`, `IF`, `AVERAGE`, …) when cached formula results are missing

Unsupported formulas → blank point + `warnings`.

---

## TypeScript ↔ Python parity

| Layer | TypeScript | Python |
|---|---|---|
| Package | `excel-chart-echarts` (npm) | `excel-chart-echarts` (PyPI), import `xlsx2echarts` |
| ZIP / XML | `ts/src/zip.ts`, `xml.ts` | `zipfile`, `xml.etree` |
| Convert | `ts/src/converter.ts` + `chartex.ts` | `xlsx2echarts/converter.py` + `chartex.py` |
| CLI | `excel-chart-echarts` / `xlsx2echarts` (alias `excel-echarts`) | same script names |
| Check | `tests/parity.py` diffs JSON field-by-field (incl. `excelCompat` modes) |

Both sides intentionally avoid Excel engines (no openpyxl / ExcelJS at **runtime**). Those libraries appear only in **test fixture generators**.

---

## Runtime hooks

Raw `option` may carry non-ECharts keys that `prepare()` resolves in the host:

- `x-numFmt` → axis / label / tooltip formatters (Excel format codes, dates, serials)
- `x-renderItem` + `x-cfg` → `renderItem` for error bars and box overlays
- `x-geo` → needs `registerMaps(echarts, option, { baseUrl | maps | geojson })` before `setOption`

---

## HTTP API shape

Optional FastAPI app (`app/main.py`):

- `POST /api/v1/convert` — multipart `file` → JSON result (in-memory only)
- `GET /api/v1/health`
- Env: `X2E_RATE_LIMITS`, `X2E_MAX_MB`, `X2E_MAX_UNZIPPED_MB`, `X2E_TIMEOUT_S`, `X2E_BASE_PATH`, `X2E_SERVE_UI`, `X2E_TRUSTED_PROXIES`

Public demo: uploads processed in memory and discarded.

---

## Limits (design)

Documented in the README; the important architectural ones:

- OOXML only (`.xlsx` / `.xlsm` / `.xltx` / `.xltm`); no BIFF `.xls` / `.xlsb`
- Layout/fonts are approximate (ECharts ≠ Excel layout engine); data, types, axes, colors, labels aim to match
- 3D charts flatten to 2D; stock/surface degrade; chart-embedded images/shapes skipped
- `regionMap`: built-in world + China provinces, or custom GeoJSON — no Bing geocoding

---

## Repo map

```
ts/src/           TypeScript converter, ZIP/XML, CLI
xlsx2echarts/     Python package (same behavior)
app/              Optional FastAPI + static UI
frontend/         Web demo (i18n EN/ZH)
tests/            Fixture generators + parity + screenshot helpers
docs/             Architecture, more examples, screenshots
```

See also: [More examples](more-examples.md) · [README](../README.md)
