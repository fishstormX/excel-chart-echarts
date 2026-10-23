# excel-echarts（xlsx2echarts）— Excel 原生图表 → ECharts option

把 `.xlsx/.xlsm/.xltx/.xltm` 里**已经插入的 Excel 图表**（DrawingML `xl/charts/chartN.xml`，不是普通表格）转换成 Apache ECharts 的 `option` JSON。

- **TypeScript 主实现**（npm 包 `excel-echarts`，Node ≥18 + 浏览器，零运行时依赖：自带 ZIP 中央目录解析、`node:zlib` / `DecompressionStream('deflate-raw')` 解压、命名空间感知的小型 XML 解析器）
- **Python 实现**（PyPI 包名 `excel-echarts`，导入名 `xlsx2echarts`，只用标准库 `zipfile` + `xml.etree`）
- 两个实现对同一输入输出**完全相同的 JSON**，由 `tests/parity.py` 在 `fixtures/` 上校验
- 在线版：<https://jev.fishmaple.cn/excelECharts/>（默认浏览器本地转换，不上传）· API 文档：`/excelECharts/api.html`

> 本服务（公共 API）仅供测试使用，如有商业使用或合作意向，请联系 stormnetwork@163.com（妙妙鱼）。

## 快速开始

```bash
# Node / TypeScript
npm i https://github.com/fishstormX/excel2Echarts/releases/download/v1.0.0/excel-echarts-1.0.0.tgz   # 发布到 npm 后：npm i excel-echarts
excel-echarts book.xlsx -o out/        # 每个图表一个 JSON + index.json + preview.html（本地 echarts.min.js，无 CDN）

# Python
pip install https://github.com/fishstormX/excel2Echarts/releases/download/v1.0.0/excel_echarts-1.0.0-py3-none-any.whl
xlsx2echarts book.xlsx -o out/         # 或 python -m xlsx2echarts
```

```ts
import { convertXlsx, prepare } from "excel-echarts";
const { charts } = await convertXlsx("book.xlsx");        // 路径 | Uint8Array | ArrayBuffer | Blob
echarts.init(el).setOption(prepare(charts[0].option));      // prepare() 把 x-numFmt 变成 formatter 函数
```

```python
from xlsx2echarts import convert_xlsx
res = convert_xlsx("book.xlsx")   # {"charts":[{sheet, anchor, title, types, warnings, option, ...}], "sheets", "warnings", "evaluatedFormulas"}
```

HTTP API（FastAPI，`app/main.py`）：`POST /api/v1/convert`（multipart `file`），`GET /api/v1/health`，Swagger `/api/docs`。
环境变量：`X2E_RATE_LIMITS`（默认 `3/10s,20/60s`，`off` 关闭）、`X2E_MAX_MB`（默认 10）、`X2E_MAX_UNZIPPED_MB`（150）、`X2E_TIMEOUT_S`（30）、`X2E_BASE_PATH`、`X2E_SERVE_UI`、`X2E_TRUSTED_PROXIES`。上传只在内存处理，不保存。

## 每个图表的输出

| 字段 | 说明 |
|---|---|
| `sheet` / `anchor` | 图表所在工作表与覆盖的单元格区域（由 sheet → drawing → chart 关系与 twoCellAnchor 解析），图表工作表 anchor 为空 |
| `width` / `height` | 按列宽/行高估算的像素尺寸 |
| `title` / `name` / `types` | 标题、绘图对象名、图表组（如 `["barChart","lineChart"]`） |
| `usedFormulaFallback` | 没有缓存值、改为从单元格（必要时重算公式）取数 |
| `option` | ECharts option；可选 `x-numFmt`：`[{path, formatCode, date?, serial?, tooltip?}]` 数字格式钩子（`tooltip:true` → tooltip.valueFormatter；`serial` → Excel 日期序列号按日期格式显示）；`type:"custom"` 系列带 `x-renderItem` + `x-cfg`（误差线 `errorBar`、箱形图 `boxPoints`/`boxMeanLine`），`prepare()` 会换成 `renderItem` 函数。regionMap 输出 `type:"map"` 系列 + `visualMap` + `x-geo:{map,source}`，渲染前用 `registerMaps(echarts, option, {baseUrl|maps|geojson})` 注册地图；无法匹配时 `option` 为 `null` 并给出 warning |

## 映射表

| Excel (DrawingML) | ECharts |
|---|---|
| `barChart`/`bar3DChart`，`barDir` col/bar | `bar`；bar 时分类轴放到 yAxis |
| `grouping` clustered / stacked / percentStacked | 无 / `stack` / `stack` + 归一化为百分比、轴 0–100%（数据标签仍显示原值，同 Excel） |
| `gapWidth` / `overlap` | `barCategoryGap` / `barGap` |
| `lineChart`（marker、smooth、stacked、percentStacked） | `line` + `symbol/showSymbol`、`smooth`、`stack` |
| `areaChart` | `line` + `areaStyle`（堆积时 `stack`） |
| `pieChart`/`pie3DChart`/`ofPieChart`、`doughnutChart`（`holeSize`、`firstSliceAng`、`explosion`、多环） | `pie`，`radius:[内,外]`、`startAngle = 90 − firstSliceAng`、`selected` |
| `scatterChart`（`scatterStyle`，`a:ln/noFill` 表示仅标记） | `scatter`（仅标记）或数值轴上的 `line`；线性趋势线 → `markLine` |
| `c:errBars`：`errDir` x/y、`errBarType` both/plus/minus、`errValType` fixedVal/percentage/stdDev/stdErr/cust（`c:plus`/`c:minus` 引用或字面量）、`noEndCap`、`spPr` | `custom` 系列（`x-renderItem:"errorBar"`），数据 `[x, y, low, high]`；柱形图按 ECharts barLayout 同样的算法计算簇内偏移，堆积柱以累计值为中心，条形图沿 x 方向；`stdDev` 与 Excel 一样以全系列均值为中心 |
| `c:trendline`：`linear`/`exp`/`log`/`poly`(2–6)/`power`/`movingAvg`(`period`)、`forward`/`backward`、`intercept`(线性)、`name`、`spPr` | 散点：线性仍为 `markLine`，其它类型为采样 41 点的 `line` 系列；柱/折线：x = 1…n 的 `line` 系列（曲线 `smooth`）；图例名同 Excel（如 `Expon. (Series1)`、`3 per. Mov. Avg. (…)`） |
| `bubbleChart`（`bubbleSize`、`bubbleScale`、`sizeRepresents`） | `scatter` + 逐点 `symbolSize` |
| `radarChart`（marker / filled / standard） | `radar` + `indicator`（max 自动取整） |
| 同一 `plotArea` 多个图表组 | 组合图；`axId` → `xAxisIndex` / `yAxisIndex`，次坐标轴放右侧 |
| `dateAx` / 日期格式分类 | 等间隔 → 格式化后的类目；不等间隔 → `time` 轴 |
| `title`（rich / strRef / 自动标题）、`autoTitleDeleted` | `title` |
| `legend` `legendPos` r/l/t/b/tr、`legendEntry/delete` | `legend` 位置/方向、`legend.data` |
| 轴 `title`、`scaling` min/max/`logBase`/`orientation`、`majorUnit`、`delete`、`tickLblPos`、`txPr` 旋转/字号/颜色 | `name`、`min/max`、`log`、`inverse`、`interval`、`axisLabel` |
| `majorGridlines` / `minorGridlines` | `splitLine` / `minorSplitLine` |
| `numFmt`（sourceLinked → 源单元格格式） | `x-numFmt` 钩子；百分比堆积用 `{value}%` |
| `dLbls` showVal/showPercent/showCatName/showSerName、`separator`、`dLblPos`、`numFmt` | `label.formatter`（`{c}` `{d}%` `{b}` `{a}`）、`label.position`；固定格式时逐点预格式化 |
| `spPr` `solidFill`/`gradFill`（`srgbClr`/`schemeClr`/`sysClr`/`prstClr` + `lumMod/lumOff/tint/shade/alpha`，主题色来自 `theme1.xml`）、`dPt`、`a:ln` 宽度/虚线 | `itemStyle.color`、逐点颜色、`lineStyle` |
| 未指定颜色 | 主题 accent1–6 循环（>6 个系列按 Excel 规则加深/变浅） |
| `dispBlanksAs` gap/zero/span | `null` / 0 / `connectNulls` |

### Office 2016 新图表（`xl/charts/chartExN.xml`，命名空间 `http://schemas.microsoft.com/office/drawing/2014/chartex`）

drawing 中通过 `mc:AlternateContent/mc:Choice` → `a:graphicData` → `cx:chart r:id` 关联（关系类型 `…/2014/relationships/chartEx`）；数据在 `cx:chartData/cx:data`（`cx:strDim`/`cx:numDim` 的 `cx:lvl` 缓存，多个 `lvl` = 层级，叶子在前），缓存为空时按 `cx:f` 从单元格取值（二维区域按列拆成层级，`dir="row"` 按行）。

| chartEx `layoutId` | ECharts |
|---|---|
| `waterfall`（`layoutPr/subtotals/idx`、`visibility connectorLines`、`dataPt`） | 堆积 `bar`：透明底座 + 「Increase / Decrease / Total」三个系列（默认 accent1/2/3，`dataPt` 覆盖）；跨 0 的柱拆成正负两段；汇总点从 0 画到该值并重置累计；连接线 → `markLine`；标签按源格式预格式化 |
| `treemap`（`parentLabelLayout` banner/overlapping/none） | `treemap`（squarify），顶层分支按 accent 色、子节点继承；父级名称 → `upperLabel` 横幅 |
| `sunburst` | `sunburst`，顶层分支着色、子级继承 |
| `clusteredColumn` + `binning`（`binSize`/`binCount`/自动、`underflow`/`overflow`、`intervalClosed` r/l） | 直方图 `bar`（gap 0）；自动箱宽 = Scott 规则 3.5σ/n^⅓（与 Excel 相同），首箱 `[a,b]` 其余 `(a,b]`，溢出箱 `≤u` / `>o` |
| `clusteredColumn` + `aggregation` / 文本类别 | 按类别求和的柱形 |
| `paretoLine`（`ownerIdx`） | 柱按降序排序 + 次坐标轴 0–100% 的累计百分比折线 |
| `funnel` | 居中的横向堆积条（透明左边距 = (max−v)/2），类别轴自上而下，与 Excel 外观一致 |
| `boxWhisker`（`statistics quartileMethod` inclusive/exclusive、`visibility meanMarker/meanLine/nonoutliers/outliers`） | `boxplot`（须 = 1.5·IQR 内的最小/最大值）+ `custom` 叠加均值 ×、离群点、内部点、均值连线（偏移与 ECharts boxplotLayout 相同，多系列对齐） |
| `regionMap` | ECharts `map` 系列 + 连续 `visualMap`（颜色取 `cx:valueColors` 或系列色由浅到深）。内置地图：中国省级（34 个，含港澳台）与世界国家（231 个），区域名支持中文/英文/拼音/ISO 代码等别名（如 “广东省”“广东”“Guangdong”，“美国”“USA”）；也可传入自定义 GeoJSON（SDK `geojson` 参数、CLI `--geojson`、HTTP `geojson` 字段、网页上传），优先匹配自定义要素（属性 name/NAME/name_zh/…/code）。未匹配的区域名给 warning；一个都匹配不上时 `option: null` + warning。边界数据：Natural Earth（公有领域，1:50m 国家 + 1:10m 省级，已简化）；世界地图中台湾并入中国。注意：在中国大陆公开发布地图可能需要审图号 |

**数据来源**：优先 `numCache/strCache/multiLvlStrCache`；没有缓存（openpyxl、pandas 写出的文件常见）时按公式引用（如 `'Sheet 1'!$B$2:$B$10`、多区域、定义名称）回到单元格取值：共享字符串、内联字符串、共享公式平移、日期序列号按单元格日期格式转换；缓存公式缺失时用内置小型求值器重算（四则、比较、`&`、`SUM/SUMIF(S)/COUNT(A)/COUNTIF(S)/AVERAGE(IF(S))/MIN/MAX/IF/IFERROR/ROUND*/ABS/INT/MOD/AND/OR/NOT/CONCAT/LEN/UPPER/LOWER/PRODUCT`）。

## 测试

```bash
python3 tests/gen_samples.py fixtures && python3 tests/gen_fixtures_extra.py fixtures   # openpyxl/XlsxWriter 只用于生成测试文件
python3 tests/gen_errbars.py fixtures    # 误差线 + 各类趋势线（XlsxWriter）
python3 tests/gen_chartex.py fixtures    # 手写 chartEx 部件（结构同 Excel 2016+ 输出）
(cd ts && npm i && npm run build)
python3 tests/parity.py            # Python vs TS 输出逐字段比对（含 excelCompat 两种模式）
node ts/dist/cli.js fixtures/*.xlsx -o out && python3 tests/screenshot.py file://$PWD/out/preview.html shot.png
```

## 已知限制

- 数值轴自动刻度：未设置最小值时按 Excel 规则——数据全为正且 min > 5/6·max 时，轴起点为 min − (max−min)/2 向下取整到主刻度（无主刻度时交给 ECharts `scale:true`），否则从 0 开始；最大值交给 ECharts。
- 系列没有 `c:tx` 且图表没有图例时，系列名为空（不显示 “Series1”）；tooltip 使用与数据标签 / 坐标轴相同的数字格式。

- chartEx：`regionMap` 仅支持国家 / 中国省级（或自定义 GeoJSON），不做 Bing 地理编码（城市、邮编、其它国家的州省需自带 GeoJSON）；树状图 `overlapping` 父标签按横幅近似；旭日图标签统一径向；瀑布图图例名固定为英文 Increase/Decrease/Total；chartEx 的样式部件（`chartStyle`/`colors`）不读取，颜色取 `spPr` 或主题 accent。
- 误差线需要 `prepare()`（或自己提供 renderItem）才会绘制；`stdErr` 采用 σ/√n。趋势线不显示公式与 R²；类别图上的趋势线忽略 `forward/backward`；`intercept` 只对线性生效。
- 3D 图按 2D 渲染；`stockChart`、`surfaceChart` 退化为折线；高低点连线、涨跌柱、`dropLines`、图表内图片/形状/文本框不转换。
- 数字格式只实现常用子集（`0`、`0.00`、`#,##0`、`%`、科学计数、日期时间片段、正负分段）；条件格式 `[>100]`、颜色段会被忽略。
- 公式求值器只覆盖常用函数；不支持的函数/外部引用/数组公式 → 该点为空，并在 `warnings` 中说明。
- 尺寸、字体、间距是按 Excel 默认值近似（ECharts 与 Excel 布局引擎不同），颜色、数据、类型、坐标轴、标签与图例力求一致。
- **坐标轴隐藏规则**：openpyxl ≥3.1 默认图表既不写 `<c:delete>` 也不写 `<c:tickLblPos>`，Excel 打开时坐标轴不显示；本工具在此情形下同样隐藏轴标签（会给 warning），可用 `--show-missing-axes` / `excelCompat:false` 显示。
- 支持 OOXML：`.xlsx` / `.xlsm` / `.xltx` / `.xltm`（宏不执行）；旧版 `.xls`（BIFF）与二进制 `.xlsb` 不支持；数据透视图按普通图表处理（使用缓存值）。
