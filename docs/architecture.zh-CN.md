# 架构说明

excel-chart-echarts 如何把 **Excel 原生图表** 转成 ECharts option：不用 Excel 库、不做浏览器自动化，TypeScript / Python 输出 **逐字段一致**。

English: [Architecture](architecture.md)

---

## 目标

| 目标 | 做法 |
|---|---|
| 读真正的 Excel 图表 | 解析 OOXML DrawingML（`xl/charts/chartN.xml`）与 chartEx（`chartExN.xml`） |
| 运行时零 Excel 依赖 | 自研 ZIP 中央目录 + 小型命名空间 XML 解析（TS）；标准库 `zipfile` + `xml.etree`（Python） |
| 两端结果一致 | 同一套映射；`tests/parity.py` 在 fixtures 上断言 TS ≡ Python |
| Node **与** 浏览器 | 同一转换器；浏览器用 `DecompressionStream('deflate-raw')` |
| 视觉尽量贴近 | 主题色、坐标轴、标签、图例、numFmt 钩子、误差线 / 趋势线 / 组合次轴 |

非目标：改写工作簿、执行 VBA、把**普通表格**变成图表、像素级布局引擎对齐。

---

## 流水线

```
.xlsx / .xlsm / .xltx / .xltm
        │
        ▼
   打开 ZIP ──► workbook.xml.rels → sheets → drawings → charts / chartEx
        │
        ▼
   每个图表部件：
     1. 取数（numCache / strCache / multiLvlStrCache，
        否则公式 → 单元格、共享公式、小型公式求值器）
     2. 映射经典图表组与 chartEx layout
     3. 轴、图例、标题、颜色（theme1.xml + spPr）、标签、numFmt
     4. 输出 ECharts `option`（及可选 `x-numFmt` / `x-renderItem` / `x-geo`）
        │
        ▼
   { charts, sheets, warnings, evaluatedFormulas }
        │
        ▼
   prepare(option) / registerMaps(...)
```

CLI 还会写出每图一个 JSON、`index.json`，以及本地 `preview.html`（内置 `echarts.min.js`，无 CDN）。

---

## 数据模型（OOXML → ECharts）

### 经典图表（`chartN.xml`）

| DrawingML | ECharts |
|---|---|
| `barChart` / `bar3DChart` | `bar`（`barDir=bar` 时分类轴在 y） |
| clustered / stacked / percentStacked | 无 / `stack` / `stack` + 0–100% 轴 |
| `lineChart` / `areaChart` | `line`（+ `areaStyle`） |
| `pieChart` / 圆环 / ofPie | `pie` |
| `scatterChart` / `bubbleChart` | `scatter`（气泡逐点 `symbolSize`） |
| `radarChart` | `radar` + `indicator` |
| 组合图 | 多系列 + `xAxisIndex` / `yAxisIndex`（次轴在右） |
| `c:errBars` | `custom` + `x-renderItem: "errorBar"` |
| `c:trendline` | `markLine` 或采样 `line` |

轴、图例、标题、网格、`numFmt`、`dLbls`、`spPr` 逐项映射。未指定系列色按主题 accent1–6 循环（超过 6 个按 Excel 加深/变浅）。

### Office 2016+ chartEx

经 `mc:AlternateContent` 关联；数据在 `cx:chartData`。`layoutId`：`waterfall` / `treemap` / `sunburst` / 直方图 / `paretoLine` / `funnel` / `boxWhisker` / `regionMap` → 对应 ECharts 类型（详见英文版表格）。

### 公式回退

openpyxl、pandas 等常不写 cache：解析引用 → 读单元格 → 必要时用小型求值器重算；不支持的函数 → 空点 + `warnings`。

---

## TypeScript ↔ Python 对等

| 层 | TypeScript | Python |
|---|---|---|
| 包名 | `excel-chart-echarts` | `excel-chart-echarts`（导入名 `xlsx2echarts`） |
| ZIP / XML | `ts/src/zip.ts`、`xml.ts` | `zipfile`、`xml.etree` |
| 转换 | `converter.ts` + `chartex.ts` | `converter.py` + `chartex.py` |
| 校验 | `tests/parity.py` 逐字段比对（含 `excelCompat`） |

运行时**不**依赖 openpyxl / ExcelJS；它们只用于生成测试 fixtures。

---

## 运行时钩子

- `x-numFmt` → `prepare()` 变成 formatter
- `x-renderItem` + `x-cfg` → 误差线 / 箱线图叠加
- `x-geo` → 先 `registerMaps(...)` 再 `setOption`

---

## HTTP API

可选 FastAPI（`app/main.py`）：`POST /api/v1/convert`、`GET /api/v1/health`；环境变量见 README。公共演示只在内存处理上传，不落盘。

---

## 设计边界

- 仅 OOXML；无 `.xls` / `.xlsb`
- 布局/字体近似；数据、类型、轴、颜色、标签力求一致
- 3D 压成 2D；stock/surface 退化；图内图片/形状跳过
- `regionMap`：内置世界 + 中国省级或自定义 GeoJSON，无 Bing 地理编码

---

## 仓库结构

```
ts/src/           TypeScript 转换器、ZIP/XML、CLI
xlsx2echarts/     Python 包（行为一致）
app/              可选 FastAPI + 静态 UI
frontend/         Web 演示（中英 i18n）
tests/            fixtures 生成 + parity + 截图
docs/             架构、更多样例、截图
```

另见：[更多样例](more-examples.zh-CN.md) · [README](../README.zh-CN.md)
