<div align="center">

**English** · [简体中文](https://github.com/fishstormX/excel-chart-echarts/blob/main/README.zh-CN.md)

# excel-chart-echarts

**Converts embedded native Excel charts (DrawingML) into Apache ECharts options — not arbitrary sheet data → charts.**

TypeScript & Python · zero Excel runtime deps · Node + browser · CLI · SDK · optional REST API

[![npm](https://img.shields.io/npm/v/excel-chart-echarts.svg)](https://www.npmjs.com/package/excel-chart-echarts)
[![PyPI](https://img.shields.io/pypi/v/excel-chart-echarts.svg)](https://pypi.org/project/excel-chart-echarts/)
[![license](https://img.shields.io/badge/license-MIT-green)](https://github.com/fishstormX/excel-chart-echarts/blob/main/LICENSE)
[![demo](https://img.shields.io/badge/live%20demo-jev.fishmaple.cn%2FexcelECharts-orange)](https://jev.fishmaple.cn/excelECharts/)

</div>

## Install

```bash
# Node / TypeScript (this package)
npm i excel-chart-echarts
# or globally for the CLI:
npm i -g excel-chart-echarts

# Python (same product; import name stays xlsx2echarts)
pip install excel-chart-echarts
```

Studio: **妙妙鱼** · Author: [fishstormX](https://github.com/fishstormX) · Contact: stormnetwork@163.com

## Quick start

### CLI

```bash
excel-chart-echarts book.xlsx -j -o out.json   # one JSON
excel-chart-echarts book.xlsx -o out/          # per-chart JSON + preview.html

# Python CLI (same flags)
xlsx2echarts book.xlsx -j -o out.json
xlsx2echarts book.xlsx -o out/
```

### SDK

```ts
import { convertXlsx, prepare } from "excel-chart-echarts";
const { charts } = await convertXlsx("book.xlsx");
echarts.init(el).setOption(prepare(charts[0].option));
```

```python
from xlsx2echarts import convert_xlsx
res = convert_xlsx("book.xlsx")
# res["charts"][i]["option"] → ECharts option
```

### Live demo & API

- Demo: [https://jev.fishmaple.cn/excelECharts/](https://jev.fishmaple.cn/excelECharts/)
- API docs: [api.html](https://jev.fishmaple.cn/excelECharts/api.html) · [Swagger](https://jev.fishmaple.cn/excelECharts/api/docs)

```bash
curl -s -F file=@book.xlsx https://jev.fishmaple.cn/excelECharts/api/v1/convert
```

> Public API is **for testing only**. Commercial / partnership: stormnetwork@163.com (妙妙鱼).

## What it does

- Reads **native charts already embedded** in `.xlsx` / `.xlsm` / `.xltx` / `.xltm` (DrawingML), not plain tables.
- Bar / line / area / pie / scatter / radar / combo + secondary axis; error bars & trendlines; Office 2016+ chartEx (waterfall, treemap, sunburst, …).
- TypeScript ≡ Python JSON for the same file.
- Zero Excel libraries at convert time (OOXML XML only).

## Full docs

Repo README (examples, fidelity table, architecture):

- English: https://github.com/fishstormX/excel-chart-echarts#readme
- 简体中文: https://github.com/fishstormX/excel-chart-echarts/blob/main/README.zh-CN.md
- More examples: https://github.com/fishstormX/excel-chart-echarts/blob/main/docs/more-examples.md

## License

MIT · https://github.com/fishstormX/excel-chart-echarts/blob/main/LICENSE
