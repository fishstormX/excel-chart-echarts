# 更多样例

左右对比：**Excel / WPS**（左）vs **excel-echarts**（右）。  
主 [README](../README.zh-CN.md) 只保留两个基础例；本页是其余图库。
源工作簿在 [`examples/`](../examples/)（英文文件名）。

在线演示：[English](https://jev.fishmaple.cn/excelECharts/?lang=en) · [中文](https://jev.fishmaple.cn/excelECharts/?lang=zh)

> 表格侧截图来自 WPS 表格（英文界面）。Office 2016 **chartEx**（瀑布、矩形树等）和部分填充地图在 WPS 里常显示 “unavailable”，这类只放 ECharts 结果。

---

## 组合图 · 次坐标轴（openpyxl）

源文件：[`examples/openpyxl-combo.xlsx`](../examples/openpyxl-combo.xlsx)

柱 + 折线次坐标轴，Excel 里很常见。

| Excel / WPS | excel-echarts |
|---|---|
| ![openpyxl combo](screenshots/more/excel/openpyxl_combo.png) | ![openpyxl combo web](screenshots/more/web/openpyxl_combo.png) |

---

## 误差线 · 趋势线

源文件：[`examples/errorbars-trendlines.xlsx`](../examples/errorbars-trendlines.xlsx)

自定义 / 百分比 / 标准差误差线，以及线性、指数、多项式、移动平均等趋势线。

| Excel / WPS | excel-echarts |
|---|---|
| ![errbars](screenshots/more/excel/errbars.png) | ![errbars web](screenshots/more/web/errbars.png) |

---

## 多层分类 · 百分比堆积

源文件：[`examples/multilevel-categories.xlsx`](../examples/multilevel-categories.xlsx)

嵌套分类标签与百分比堆积（XlsxWriter 边界样例）。

| Excel / WPS | excel-echarts |
|---|---|
| ![edge](screenshots/more/excel/edge_multilevel.png) | ![edge web](screenshots/more/web/edge_multilevel.png) |

---

## 甘特风格条形图

源文件：[`examples/gantt-bars.xlsx`](../examples/gantt-bars.xlsx)

分类时间线，横向条形图。

| Excel / WPS | excel-echarts |
|---|---|
| ![gantt](screenshots/more/excel/gantt.png) | ![gantt web](screenshots/more/web/gantt.png) |

---

## Microsoft 模板

帕累托、漏斗、区域销售等 Office 风格模板。

### 帕累托

源文件：[`examples/ms-pareto-cost.xlsx`](../examples/ms-pareto-cost.xlsx)

| Excel / WPS | excel-echarts |
|---|---|
| ![pareto](screenshots/more/excel/ms_pareto.png) | ![pareto web](screenshots/more/web/ms_pareto.png) |

### 漏斗

源文件：[`examples/ms-sales-funnel.xltx`](../examples/ms-sales-funnel.xltx)

| Excel / WPS | excel-echarts |
|---|---|
| ![funnel](screenshots/more/excel/ms_funnel.png) | ![funnel web](screenshots/more/web/ms_funnel.png) |

### 区域销售

源文件：[`examples/ms-regional-sales.xltx`](../examples/ms-regional-sales.xltx)

| Excel / WPS | excel-echarts |
|---|---|
| ![regional](screenshots/more/excel/ms_regional.png) | ![regional web](screenshots/more/web/ms_regional.png) |

---

## Office 2016 chartEx（仅 ECharts 侧）

源文件：[`examples/office2016-chartex.xlsx`](../examples/office2016-chartex.xlsx)

部件在 `xl/charts/chartExN.xml`。WPS 往往无法渲染；excel-echarts 映射到原生 ECharts 类型。

| 瀑布图 | 矩形树图 | 样例合集 |
|---|---|---|
| ![waterfall](screenshots/more/web/office2016_waterfall.png) | ![treemap](screenshots/more/web/office2016_treemap.png) | ![all](screenshots/more/web/office2016_all.png) |

---

## 填充地图

源文件：[`examples/filled-maps.xlsx`](../examples/filled-maps.xlsx)

区域地图 → ECharts `map` + `visualMap`（内置世界 / 中国省级，或自定义 GeoJSON）。

![world map](screenshots/more/web/maps_world.png)

---

## 整表合成图（参考）

源文件：[`openpyxl-combo.xlsx`](../examples/openpyxl-combo.xlsx)、[`combo-secondary-axis.xlsx`](../examples/combo-secondary-axis.xlsx)

| openpyxl 整表（Excel） | xlsxwriter 整表（Excel） | xlsxwriter 样例（web） |
|---|---|---|
| ![openpyxl sheet](screenshots/more/excel/openpyxl_sheet.png) | ![xlsxwriter sheet](screenshots/more/excel/xlsxwriter_sheet.png) | ![sample all](screenshots/more/web/sample_xlsxwriter_all.png) |

---

转换原理：[架构说明](architecture.zh-CN.md) · English: [More examples](more-examples.md)
