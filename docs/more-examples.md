# More examples

Side-by-side fidelity shots: **Excel / WPS** (left) vs **excel-echarts** (right).  
The main [README](../README.md) only shows two basics; this page is the rest of the gallery.

Live demo: [English](https://jev.fishmaple.cn/excelECharts/?lang=en) · [中文](https://jev.fishmaple.cn/excelECharts/?lang=zh)

> Spreadsheet crops were taken in WPS Spreadsheets (English UI). Office 2016 **chartEx** types (waterfall, treemap, …) and some filled maps show as “unavailable” in WPS — for those we show the ECharts output only.

---

## Combo · secondary axis (openpyxl)

Bar + line on a secondary value axis — a common Excel pattern.

| Excel / WPS | excel-echarts |
|---|---|
| ![openpyxl combo](screenshots/more/excel/openpyxl_combo.png) | ![openpyxl combo web](screenshots/more/web/openpyxl_combo.png) |

---

## Error bars · trendlines

Custom / percentage / stdDev error bars and several trendline kinds (linear, exp, poly, moving average).

| Excel / WPS | excel-echarts |
|---|---|
| ![errbars](screenshots/more/excel/errbars.png) | ![errbars web](screenshots/more/web/errbars.png) |

---

## Multi-level categories · 100% stacked

Nested category labels and percent-stacked series (edge cases from XlsxWriter).

| Excel / WPS | excel-echarts |
|---|---|
| ![edge](screenshots/more/excel/edge_multilevel.png) | ![edge web](screenshots/more/web/edge_multilevel.png) |

---

## Gantt-style bars

Category timeline rendered as a horizontal bar chart.

| Excel / WPS | excel-echarts |
|---|---|
| ![gantt](screenshots/more/excel/gantt.png) | ![gantt web](screenshots/more/web/gantt.png) |

---

## Microsoft templates

Pareto, funnel, and regional sales samples from Office-style templates.

### Pareto

| Excel / WPS | excel-echarts |
|---|---|
| ![pareto](screenshots/more/excel/ms_pareto.png) | ![pareto web](screenshots/more/web/ms_pareto.png) |

### Funnel

| Excel / WPS | excel-echarts |
|---|---|
| ![funnel](screenshots/more/excel/ms_funnel.png) | ![funnel web](screenshots/more/web/ms_funnel.png) |

### Regional sales

| Excel / WPS | excel-echarts |
|---|---|
| ![regional](screenshots/more/excel/ms_regional.png) | ![regional web](screenshots/more/web/ms_regional.png) |

---

## Office 2016 chartEx (ECharts side)

These live in `xl/charts/chartExN.xml`. WPS often cannot render them; excel-echarts maps them to native ECharts types.

| Waterfall | Treemap | Sample pack |
|---|---|---|
| ![waterfall](screenshots/more/web/office2016_waterfall.png) | ![treemap](screenshots/more/web/office2016_treemap.png) | ![all](screenshots/more/web/office2016_all.png) |

---

## Filled map

World region map → ECharts `map` + `visualMap` (built-in world / China province GeoJSON, or your own).

![world map](screenshots/more/web/maps_world.png)

---

## Full workbook sheets (optional reference)

Whole-sheet composites used while building the gallery:

| openpyxl sheet (Excel) | xlsxwriter sheet (Excel) | xlsxwriter sample (web) |
|---|---|---|
| ![openpyxl sheet](screenshots/more/excel/openpyxl_sheet.png) | ![xlsxwriter sheet](screenshots/more/excel/xlsxwriter_sheet.png) | ![sample all](screenshots/more/web/sample_xlsxwriter_all.png) |

---

How conversion works: [Architecture](architecture.md) · Chinese: [更多样例](more-examples.zh-CN.md)
