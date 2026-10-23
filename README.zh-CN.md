<div align="center">

[English](README.md) · **简体中文**

# excel-echarts

**把 Excel 原生图表转成 Apache ECharts option — TypeScript & Python，运行时零 Excel 依赖，Node + 浏览器。**

开源 DrawingML → ECharts 转换器，自带 **CLI**、**SDK**、**REST API**；网页演示默认在浏览器本地完成，不必上传文件。

[![version](https://img.shields.io/badge/version-1.0.0-3d8bfd)](ts/package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js&logoColor=white)](ts/package.json)
[![python](https://img.shields.io/badge/python-3.8%2B-blue?logo=python&logoColor=white)](pyproject.toml)
[![demo](https://img.shields.io/badge/live%20demo-jev.fishmaple.cn%2FexcelECharts-orange)](https://jev.fishmaple.cn/excelECharts/?lang=zh)

![demo UI](docs/screenshots/web/ui_en.png)

</div>

## 快速上手 — CLI · SDK · API

同一套转换器，三种入口：

### CLI — 本地转换，不需要服务

```bash
# Node（GitHub Release）
npm i -g https://github.com/fishstormX/excel2Echarts/releases/download/v1.0.0/excel-echarts-1.0.0.tgz
excel-echarts book.xlsx -j -o out.json          # 只要一份 JSON
excel-echarts book.xlsx -o out/                 # 全量导出 + preview.html

# Python（GitHub Release）
pip install https://github.com/fishstormX/excel2Echarts/releases/download/v1.0.0/excel_echarts-1.0.0-py3-none-any.whl
xlsx2echarts book.xlsx -j -o out.json
xlsx2echarts book.xlsx -o out/
```

`-j` / `--json`：只产出一份 JSON（不加 `-o` 则打印到 stdout）。`-o out/` 仍是每图一个 JSON + `index.json` + `preview.html`。

### SDK — TypeScript & Python

```ts
import { convertXlsx, prepare } from "excel-echarts";
const { charts } = await convertXlsx("book.xlsx");
echarts.init(el).setOption(prepare(charts[0].option));
```

```python
from xlsx2echarts import convert_xlsx
res = convert_xlsx("book.xlsx")
```

### API — REST `/api/v1/*`

```bash
curl -s -F file=@book.xlsx https://jev.fishmaple.cn/excelECharts/api/v1/convert
```

→ [站内文档](https://jev.fishmaple.cn/excelECharts/api.html) · [Swagger](https://jev.fishmaple.cn/excelECharts/api/docs)

> 公共 API **仅供测试**。商业合作：[stormnetwork@163.com](mailto:stormnetwork@163.com)。

## 特性

- **只转原生图表** — 读取 `.xlsx` / `.xlsm` / `.xltx` / `.xltm` 里已插入的 DrawingML 图表（不是普通表格）。
- **类型覆盖广** — 柱/折/面积/饼/环/散点/气泡/雷达/组合+次轴；误差线与趋势线；Office 2016+ chartEx（瀑布、矩形树、旭日、直方图、帕累托、漏斗、箱须、区域地图）。
- **运行时零 Excel 依赖** — 转换时不用 openpyxl / ExcelJS / Office 自动化。
- **TS ≡ Python** — 同一文件输出相同 JSON（`tests/parity.py`）。
- **Node + 浏览器** — 同一套包。
- **主题色与数字格式** — `theme1.xml`、标签格式钩子。
- **演示偏本地** — 网页默认在浏览器里转；走 API 时上传只在内存，不落盘。
- **中英界面** — `?lang=zh` / `?lang=en`。

## 在线演示

👉 **[https://jev.fishmaple.cn/excelECharts/?lang=zh](https://jev.fishmaple.cn/excelECharts/?lang=zh)** · [English](https://jev.fishmaple.cn/excelECharts/?lang=en) · [API 说明](https://jev.fishmaple.cn/excelECharts/api.html)

页面内可直接试内置样例。

## 效果

左 = 表格软件中的图（WPS 表格，英文界面）。右 = excel-echarts 转换结果。

### 折线图

| Excel / WPS | excel-echarts |
|---|---|
| ![line](docs/screenshots/excel/user3_line.png) | ![line web](docs/screenshots/web/user3_line.png) |

### 组合图 · 次坐标轴

| Excel / WPS | excel-echarts |
|---|---|
| ![combo](docs/screenshots/excel/xlsxwriter_combo.png) | ![combo web](docs/screenshots/web/xlsxwriter_combo.png) |

更多对比（误差线、多层分类、甘特、MS 模板、chartEx、地图）：**[docs/more-examples.zh-CN.md](docs/more-examples.zh-CN.md)**。

## 覆盖与对照

这里的「效果基准」是：对真实工作簿相对 Excel/WPS 的**观感接近程度**，以及 **TS / Python 输出是否一致**。

| 检查项 | 状态 |
|---|---|
| 经典 DrawingML 图表组 | 支持 |
| 次坐标轴 / 多轴组合 | 支持 |
| 误差线 + 趋势线 | 支持（自定义渲染需 `prepare()`） |
| Office 2016 chartEx | 支持 |
| 主题色 + 数字格式 | 支持（常用格式子集） |
| 无 cache（openpyxl / pandas 风格） | 单元格 + 小型公式回退 |
| TypeScript ≡ Python | `tests/parity.py` |
| `.xls` / `.xlsb` | 不支持（仅 OOXML） |
| 像素级布局/字体 | 近似 |

内部原理：**[docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)**。

## 快速开始

### 安装

```bash
# GitHub Release v1.0.0
npm i https://github.com/fishstormX/excel2Echarts/releases/download/v1.0.0/excel-echarts-1.0.0.tgz
pip install https://github.com/fishstormX/excel2Echarts/releases/download/v1.0.0/excel_echarts-1.0.0-py3-none-any.whl
```

从源码：

```bash
git clone https://github.com/fishstormX/excel2Echarts.git
cd excel2Echarts/ts && npm i && npm run build
cd ../ && pip install -e .
```

### 转换

```bash
excel-echarts book.xlsx -j -o out.json   # 只要 JSON
excel-echarts book.xlsx -o out/          # 全量导出
```

### 本地 API / 网页

```bash
pip install -e ".[api]"
uvicorn app.main:app --port 8765
```

## API

| 路由 | 说明 |
|---|---|
| `POST /api/v1/convert` | multipart `file` → 图表 JSON |
| `GET /api/v1/health` | 健康检查 |
| `/api/docs` | Swagger |

环境变量默认：`X2E_RATE_LIMITS=3/10s,20/60s`，`X2E_MAX_MB=10` 等（见英文 README）。

## 文档

| 文档 | 内容 |
|---|---|
| [GitHub Releases](https://github.com/fishstormX/excel2Echarts/releases) | 打包好的 `.tgz`（npm）+ `.whl`（pip），打 `v*` 标签时由 Actions 自动构建 |
| [架构说明](docs/architecture.zh-CN.md) | 流水线、OOXML 映射、TS/Python 对等 |
| [更多样例](docs/more-examples.zh-CN.md) | 扩展对比图库 |
| [English README](README.md) | 英文主页 |

## 测试

```bash
python3 tests/gen_samples.py fixtures && python3 tests/gen_fixtures_extra.py fixtures
python3 tests/gen_errbars.py fixtures && python3 tests/gen_chartex.py fixtures
(cd ts && npm i && npm run build)
python3 tests/parity.py
```

## 已知限制

- 布局与字体为近似；颜色、数据、类型、轴、标签、图例力求一致。
- 3D 按 2D 渲染；stock/surface 退化为折线；图内图片/形状不转换。
- 数字格式与公式求值器均为常用子集。
- `regionMap`：世界 + 中国省级或自定义 GeoJSON；大陆公开发布地图可能需要审图号。
- openpyxl ≥3.1 无轴刻度时与 Excel 一样隐藏轴（可用 `--show-missing-axes` 覆盖）。

## License

[MIT](LICENSE) © 妙妙鱼 / fishstormX

## Acknowledgements

[Apache ECharts](https://echarts.apache.org/) · [ECMA-376 OOXML](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/) · [FastAPI](https://fastapi.tiangolo.com/)
