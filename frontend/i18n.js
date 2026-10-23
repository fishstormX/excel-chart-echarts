/* xlsx2echarts i18n — default follows browser language (zh* → Chinese, else English). ?lang=en|zh overrides; remembered in localStorage. */
(function () {
  const VERSION = "1.1.1";
  const KEY = "x2e.lang";
  const D = {
    en: {
      title: "Excel Chart to ECharts Converter – xlsx to ECharts option JSON | xlsx2echarts",
      metaDesc: "Free online converter: upload an .xlsx/.xlsm/.xltx/.xltm and turn every native Excel chart (bar, line, area, pie, doughnut, scatter, radar, bubble, combo, secondary axis) into an Apache ECharts option JSON. Files are never stored.",
      apiTitle: "API & SDK – xlsx2echarts | Excel charts to ECharts",
      apiDesc: "REST API, Python SDK and CLI for converting native Excel charts (.xlsx/.xlsm/.xltx/.xltm DrawingML) into Apache ECharts option JSON.",
      h1: "xlsx2echarts — Excel charts → ECharts", langBtn: "中文",
      sub: "Open an Excel workbook → every native chart (DrawingML chartN.xml) is converted into an ECharts option: type, series, categories, axes, colours, labels, legend. Rendered side by side with copyable JSON. Plain tables are not charted.",
      navCli: "CLI", navSdk: "SDK", navApi: "API",
      entryCliTitle: "CLI", entryCliDesc: "Node (npx/bin) or Python CLI — JSON per chart + HTML preview, offline.", entryCliEx: "excel-echarts book.xlsx -o out/",
      entrySdkTitle: "SDK", entrySdkDesc: "TypeScript (Node + browser) and Python, zero dependencies, identical output.", entrySdkEx: "import { convertXlsx } from \"excel-echarts\"",
      entryApiTitle: "API", entryApiDesc: "REST /api/v1 · OpenAPI / Swagger.", entryApiEx: "POST /api/v1/convert",
      agentTitle: "Use with an Agent", agentHint: "Paste into Cursor / ChatGPT / Claude — prefers the local CLI/SDK (Node or Python), falls back to the public API.",
      agentCopy: "Copy prompt", agentCopied: "Copied!",
      notice: "⚠️ This service is for testing only. For commercial use or partnership inquiries, contact <a href='mailto:stormnetwork@163.com'>stormnetwork@163.com</a> (海口龙华区妙妙鱼传媒工作室 / Miaomiaoyu Media Studio, Longhua District, Haikou). The web page converts locally in your browser; the HTTP API has a {mb} MB per-file limit and a per-IP rate limit, and processes uploads in memory without storing them.",
      useApi: "Convert on the server (HTTP API) instead", privacy: "🔒 By default the workbook is converted entirely in your browser (TypeScript build) — it is never uploaded. Tick the box above to use the server API instead (in memory only, never stored).",
      modeLocal: "converted in your browser in {ms} ms, nothing uploaded", modeApi: "converted by the HTTP API",
      pick: "Choose Excel file", drop: "Drag an .xlsx / .xlsm / .xltx / .xltm here, or click to choose", sample: "Try a sample", sample2: "Office 2016 charts", sample3: "Error bars & trendlines", sample4: "Filled maps (world / China)", sample5: "Gantt (Excel template)", geoLabel: "GeoJSON for filled maps (optional):",
      showAxes: "Show axes Excel would hide (missing <c:delete>)",
      ready: "Ready", converting: "Converting {name}…", done: "{n} chart(s) found in {name} · {sheets} sheet(s){f}",
      fEval: " · {k} formula cell(s) recalculated", none: "No native Excel charts in this workbook (only plain tables). Insert a chart in Excel first.",
      copy: "Copy JSON", copied: "Copied!", dl: "Download JSON", dlAll: "Download all (index.json)", dlPng: "PNG",
      e_req: "Request failed", e_rate: "Too many requests — wait {s}s. This service is for testing only; for commercial use contact stormnetwork@163.com.",
      e_type: "Please choose an .xlsx, .xlsm, .xltx or .xltm file", e_size: "File too large (max {mb} MB)",
      howTitle: "What is converted", how: "<ul><li><b>Types</b>: column/bar (clustered, stacked, 100%), line (smooth, markers, stacked), area, pie, doughnut, scatter, bubble, radar, combo charts and secondary axes.</li><li><b>Office 2016 charts</b> (chartEx): waterfall (totals, connectors), treemap, sunburst, histogram (auto/bin width/bin count, overflow/underflow), pareto, funnel, box &amp; whisker (inclusive/exclusive quartiles, mean, outliers). Filled maps are reported as unsupported.</li><li><b>Error bars</b> (fixed, %, std dev, std error, custom; plus/minus/both, caps) aligned with clustered/stacked/horizontal bars, and <b>trendlines</b>: linear, exponential, logarithmic, polynomial, power, moving average.</li><li><b>Data</b>: cached values first; when missing (e.g. files written by openpyxl/pandas) the referenced cells are read and simple formulas (SUM, SUMIFS, COUNTIF, IF, arithmetic…) are recalculated.</li><li><b>Style</b>: title, legend position, axis titles/min/max/log/reverse, gridlines, number formats, data labels, series/point colours (theme colours resolved).</li><li>Not converted: filled maps (regionMap), 3-D perspective, trendline equation/R² labels.</li></ul>",
      foot: "xlsx2echarts v{v} · <a href='api.html'>API docs</a> · <a href='api/docs'>Swagger</a> · Contact <a href='mailto:stormnetwork@163.com'>stormnetwork@163.com</a> · 海口龙华区妙妙鱼传媒工作室",
    },
    zh: {
      title: "Excel 图表转 ECharts 在线工具 – xlsx 图表一键生成 ECharts option | xlsx2echarts",
      metaDesc: "免费在线工具：上传 .xlsx/.xlsm/.xltx/.xltm，把 Excel 原生图表（柱状、条形、折线、面积、饼图、环形、散点、雷达、气泡、组合图、次坐标轴）转换成 Apache ECharts option JSON。文件不落地、不保存。",
      apiTitle: "API 与 SDK – xlsx2echarts｜Excel 图表转 ECharts",
      apiDesc: "把 Excel 原生图表（.xlsx/.xlsm/.xltx/.xltm DrawingML）转换为 ECharts option JSON 的 REST API、Python SDK 与命令行。",
      h1: "xlsx2echarts — Excel 图表 → ECharts", langBtn: "English",
      sub: "打开 Excel 工作簿 → 其中每个原生图表（DrawingML chartN.xml）都会转换成 ECharts option：图表类型、系列、分类、坐标轴、颜色、数据标签、图例。左边渲染、右边可复制 JSON。普通表格不会被生成图表。",
      navCli: "CLI", navSdk: "SDK", navApi: "API",
      entryCliTitle: "命令行 CLI", entryCliDesc: "Node（npx/bin）或 Python 命令行：每个图表一个 JSON + HTML 预览，离线运行。", entryCliEx: "excel-echarts book.xlsx -o out/",
      entrySdkTitle: "SDK", entrySdkDesc: "TypeScript（Node + 浏览器）与 Python 双实现，零依赖，输出一致。", entrySdkEx: "import { convertXlsx } from \"excel-echarts\"",
      entryApiTitle: "API", entryApiDesc: "REST /api/v1 · OpenAPI / Swagger。", entryApiEx: "POST /api/v1/convert",
      agentTitle: "用 Agent 使用", agentHint: "粘贴到 Cursor / ChatGPT / Claude：优先本地 CLI/SDK，没有就调用公共 API。",
      agentCopy: "复制 Prompt", agentCopied: "已复制！",
      notice: "⚠️ 本服务仅供测试使用，如有商业使用或合作意向，请联系 <a href='mailto:stormnetwork@163.com'>stormnetwork@163.com</a>（海口龙华区妙妙鱼传媒工作室）。网页在浏览器本地转换；HTTP API 单文件限 {mb} MB、按 IP 限流，上传只在内存中处理，从不保存。",
      useApi: "改用服务器转换（HTTP API）", privacy: "🔒 默认完全在你的浏览器里转换（TypeScript 版），工作簿不会上传。勾选上面的选项才会改用服务器 API（只在内存中处理，从不保存）。",
      modeLocal: "在浏览器本地转换，耗时 {ms} ms，未上传", modeApi: "由 HTTP API 转换",
      pick: "选择 Excel 文件", drop: "把 .xlsx / .xlsm / .xltx / .xltm 拖到这里，或点击选择", sample: "试试示例", sample2: "Office 2016 图表", sample3: "误差线与趋势线", sample4: "着色地图（世界 / 中国）", sample5: "甘特图（Excel 模板）", geoLabel: "着色地图自定义 GeoJSON（可选）：",
      showAxes: "显示 Excel 会隐藏的坐标轴（缺少 <c:delete>）",
      ready: "就绪", converting: "正在转换 {name}…", done: "{name} 中找到 {n} 个图表 · {sheets} 个工作表{f}",
      fEval: " · 重新计算了 {k} 个公式单元格", none: "这个工作簿里没有 Excel 原生图表（只有普通表格）。请先在 Excel 中插入图表。",
      copy: "复制 JSON", copied: "已复制！", dl: "下载 JSON", dlAll: "全部下载（index.json）", dlPng: "PNG",
      e_req: "请求失败", e_rate: "请求过于频繁，请 {s} 秒后再试。本服务仅供测试，商业使用请联系 stormnetwork@163.com。",
      e_type: "请选择 .xlsx、.xlsm、.xltx 或 .xltm 文件", e_size: "文件过大（最大 {mb} MB）",
      howTitle: "转换范围", how: "<ul><li><b>类型</b>：柱形/条形（簇状、堆积、百分比堆积）、折线（平滑、标记、堆积）、面积、饼图、圆环、散点、气泡、雷达，组合图与次坐标轴。</li><li><b>Office 2016 新图表</b>（chartEx）：瀑布图（汇总点、连接线）、树状图、旭日图、直方图（自动/箱宽/箱数、上溢/下溢）、排列图（Pareto）、漏斗图、箱形图（包含/排除中值四分位、均值、离群点）。地图（regionMap）提示不支持。</li><li><b>误差线</b>（固定值、百分比、标准偏差、标准误差、自定义；正负/正/负、端帽），与簇状/堆积/条形图对齐；<b>趋势线</b>：线性、指数、对数、多项式、幂、移动平均。</li><li><b>数据</b>：优先用图表缓存值；没有缓存时（如 openpyxl/pandas 生成的文件）回到引用的单元格取值，并重新计算常见公式（SUM、SUMIFS、COUNTIF、IF、四则运算等）。</li><li><b>样式</b>：标题、图例位置、坐标轴标题/最小最大值/对数/逆序、网格线、数字格式、数据标签、系列与数据点颜色（解析主题色）。</li><li>暂不支持：填充地图（regionMap）、3D 透视、趋势线公式/R² 标签。</li></ul>",
      foot: "xlsx2echarts v{v} · <a href='api.html'>API 文档</a> · <a href='api/docs'>Swagger</a> · 联系 <a href='mailto:stormnetwork@163.com'>stormnetwork@163.com</a> · 海口龙华区妙妙鱼传媒工作室",
    },
  };
  const q = new URLSearchParams(location.search).get("lang");
  let lang = (q && q.toLowerCase().startsWith("zh")) ? "zh" : (q && q.toLowerCase().startsWith("en")) ? "en" : null;
  if (lang) { try { localStorage.setItem(KEY, lang); } catch (e) {} }
  else { try { lang = localStorage.getItem(KEY); } catch (e) {} }
  if (lang !== "zh" && lang !== "en") {
    const bl = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    lang = bl.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  const vars = { v: VERSION, mb: 10 };
  function t(k, v) {
    let s = (D[lang] && D[lang][k]) ?? D.en[k] ?? k;
    const all = Object.assign({}, vars, v || {});
    return s.replace(/\{(\w+)\}/g, (m, n) => (all[n] ?? m));
  }
  function apply() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    const tk = document.body.dataset.titleKey || "title", dk = document.body.dataset.descKey || "metaDesc";
    document.title = t(tk);
    document.querySelectorAll('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]').forEach((m) => m.setAttribute("content", t(dk)));
    document.querySelectorAll('meta[property="og:title"],meta[name="twitter:title"]').forEach((m) => m.setAttribute("content", document.title));
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-lang-only]").forEach((el) => { el.hidden = el.dataset.langOnly !== lang; });
    document.querySelectorAll(".ver").forEach((el) => { el.textContent = "v" + VERSION; });
    document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
  }
  function setLang(l) {
    lang = l === "zh" ? "zh" : "en";
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    const u = new URL(location.href); u.searchParams.set("lang", lang); history.replaceState(null, "", u);
    apply();
  }
  window.I18N = { t, apply, setLang, vars, get lang() { return lang; }, VERSION, dict: D };
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelectorAll("[data-lang-toggle]").forEach((b) => b.addEventListener("click", () => setLang(lang === "en" ? "zh" : "en")));
  });
})();
