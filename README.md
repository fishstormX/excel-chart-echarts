# excel-echarts (xlsx2echarts) — Excel charts → ECharts options

[English](README.md) | [中文](README.zh-CN.md)

Convert **native Excel charts** already embedded in `.xlsx` / `.xlsm` / `.xltx` / `.xltm` (DrawingML `xl/charts/chartN.xml`, not plain tables) into Apache ECharts `option` JSON.

- **TypeScript** (npm `excel-echarts`, Node ≥18 + browsers, zero runtime deps: ZIP central-directory parse, `node:zlib` / `DecompressionStream('deflate-raw')`, small namespace-aware XML parser)
- **Python** (PyPI `excel-echarts`, import `xlsx2echarts`, stdlib `zipfile` + `xml.etree` only)
- Both implementations emit **identical JSON** for the same input (`tests/parity.py` on `fixtures/`)
- Live demo (EN/ZH i18n): [English](https://jev.fishmaple.cn/excelECharts/?lang=en) · [中文](https://jev.fishmaple.cn/excelECharts/?lang=zh) (browser-local by default, no upload) · API docs: `/excelECharts/api.html`

> The public API is for testing only. For commercial use or partnership, contact stormnetwork@163.com (海口龙华区妙妙鱼传媒工作室).

## Live demo · Screenshots

[English demo](https://jev.fishmaple.cn/excelECharts/?lang=en) · [中文](https://jev.fishmaple.cn/excelECharts/?lang=zh) (or use the language toggle; default follows the browser).

![English demo UI](docs/screenshots/web/ui_en.png)

Left = chart in a spreadsheet (WPS Spreadsheets, English UI). Right = same workbook via excel-echarts (ECharts).

### Line chart

| Excel / WPS | excel-echarts |
|---|---|
| ![line](docs/screenshots/excel/user3_line.png) | ![line web](docs/screenshots/web/user3_line.png) |

### Combo · secondary axis

| Excel / WPS | excel-echarts |
|---|---|
| ![combo](docs/screenshots/excel/xlsxwriter_combo.png) | ![combo web](docs/screenshots/web/xlsxwriter_combo.png) |

More gallery shots (error bars, multi-level categories, Gantt, MS templates, Office 2016 chartEx, maps, …) live under [`docs/screenshots/more/`](docs/screenshots/more/). Try the built-in samples on the [live demo](https://jev.fishmaple.cn/excelECharts/?lang=en).

## Quick start

```bash
# Node / TypeScript
npm i https://jev.fishmaple.cn/excelECharts/dl/excel-echarts-1.1.1.tgz   # after npm publish: npm i excel-echarts
excel-echarts book.xlsx -o out/        # one JSON per chart + index.json + preview.html (local echarts.min.js, no CDN)

# Python
pip install https://jev.fishmaple.cn/excelECharts/dl/excel_echarts-1.1.1-py3-none-any.whl
xlsx2echarts book.xlsx -o out/         # or: python -m xlsx2echarts
```

```ts
import { convertXlsx, prepare } from "excel-echarts";
const { charts } = await convertXlsx("book.xlsx");        // path | Uint8Array | ArrayBuffer | Blob
echarts.init(el).setOption(prepare(charts[0].option));      // prepare() turns x-numFmt into formatter functions
```

```python
from xlsx2echarts import convert_xlsx
res = convert_xlsx("book.xlsx")   # {"charts":[{sheet, anchor, title, types, warnings, option, ...}], "sheets", "warnings", "evaluatedFormulas"}
```

HTTP API (FastAPI, `app/main.py`): `POST /api/v1/convert` (multipart `file`), `GET /api/v1/health`, Swagger `/api/docs`.
Env: `X2E_RATE_LIMITS` (default `3/10s,20/60s`, `off` to disable), `X2E_MAX_MB` (10), `X2E_MAX_UNZIPPED_MB` (150), `X2E_TIMEOUT_S` (30), `X2E_BASE_PATH`, `X2E_SERVE_UI`, `X2E_TRUSTED_PROXIES`. Uploads stay in memory; nothing is saved.

## Chart output fields

| Field | Meaning |
|---|---|
| `sheet` / `anchor` | Sheet and cell range (sheet → drawing → chart + twoCellAnchor); empty for chart sheets |
| `width` / `height` | Pixel size estimated from column/row sizes |
| `title` / `name` / `types` | Title, drawing name, chart groups (e.g. `["barChart","lineChart"]`) |
| `usedFormulaFallback` | No cached values; values taken from cells (formulas recalculated when needed) |
| `option` | ECharts option; optional `x-numFmt` hooks; `type:"custom"` series with `x-renderItem` + `x-cfg` (error bars, box overlays) resolved by `prepare()`; regionMap → `type:"map"` + `visualMap` + `x-geo` (register via `registerMaps`); unmatched → `option: null` + warning |

## Mapping overview

| Excel (DrawingML) | ECharts |
|---|---|
| `barChart` / `bar3DChart`, `barDir` col/bar | `bar`; category on yAxis when bar |
| clustered / stacked / percentStacked | none / `stack` / `stack` + 0–100% axis |
| `lineChart` / `areaChart` | `line` (+ `areaStyle` for area) |
| `pieChart` / doughnut | `pie` with radius / startAngle |
| `scatterChart` / `bubbleChart` | `scatter` (+ per-point `symbolSize` for bubble) |
| `radarChart` | `radar` + `indicator` |
| combo plotArea / secondary axis | multi-axis `xAxisIndex` / `yAxisIndex` |
| `c:errBars` / `c:trendline` | custom `errorBar` series / `markLine` or sampled `line` |
| Office 2016 chartEx (`waterfall`, `treemap`, `sunburst`, histogram, `paretoLine`, `funnel`, `boxWhisker`, `regionMap`) | matching ECharts types (see Chinese README for the full table) |

Data prefers `numCache` / `strCache` / `multiLvlStrCache`; otherwise formula refs resolve from cells (shared strings, shared formulas, dates, small formula evaluator).

## Tests

```bash
python3 tests/gen_samples.py fixtures && python3 tests/gen_fixtures_extra.py fixtures
python3 tests/gen_errbars.py fixtures
python3 tests/gen_chartex.py fixtures
(cd ts && npm i && npm run build)
python3 tests/parity.py
node ts/dist/cli.js fixtures/*.xlsx -o out && python3 tests/screenshot.py file://$PWD/out/preview.html shot.png
```

## Known limitations

- Value-axis auto scale follows Excel when min is unset; max is left to ECharts.
- Empty series name when there is no `c:tx` and no legend (no fake “Series1”).
- chartEx `regionMap`: countries / China provinces or custom GeoJSON only (no Bing geocoding). Publishing maps in mainland China may require a surveying license.
- Error bars need `prepare()` (or your own `renderItem`). Trendlines omit formula/R² text.
- 3D charts render as 2D; `stockChart` / `surfaceChart` degrade to lines; images/shapes/text boxes inside charts are skipped.
- Number formats cover a common subset; conditional color segments are ignored.
- Formula evaluator covers common functions only; unsupported → blank point + `warnings`.
- Layout/fonts are approximate; colors, data, types, axes, labels, legends aim to match.
- Axis-hide rule matches openpyxl ≥3.1 (no `<c:delete>` / `<c:tickLblPos>` → hidden labels); use `--show-missing-axes` / `excelCompat:false` to show.
- OOXML only: `.xlsx` / `.xlsm` / `.xltx` / `.xltm` (macros not run). Legacy `.xls` / `.xlsb` unsupported. Pivot charts use cached values as normal charts.

See [README.zh-CN.md](README.zh-CN.md) for the full Chinese mapping tables and notes.
