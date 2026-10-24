(function () {
  const $ = (s) => document.querySelector(s);
  const API = "api/v1/convert";
  const MAX = 10 * 1024 * 1024;
  let last = null, instances = [], geo = null;
  const PROMPT_EN = `Convert the native charts inside an Excel workbook (.xlsx/.xlsm/.xltx/.xltm) into Apache ECharts option JSON with excel-chart-echarts (xlsx2echarts).

Prefer local — files never leave the machine, zero dependencies:
  Node ≥18:  npm i -g https://github.com/fishstormX/excel-chart-echarts/releases/download/v1.0.0/excel-chart-echarts-1.0.0.tgz
             excel-chart-echarts book.xlsx -o out/        # one JSON per chart + index.json + preview.html
             import { convertXlsx } from "excel-chart-echarts"; const { charts } = await convertXlsx("book.xlsx");
  Python ≥3.8: pip install https://github.com/fishstormX/excel-chart-echarts/releases/download/v1.0.0/excel_chart_echarts-1.0.0-py3-none-any.whl
             xlsx2echarts book.xlsx -o out/   |   from xlsx2echarts import convert_xlsx

Otherwise call the public REST API (testing only; per-IP rate limit; max 10 MB; files never stored):
  curl -s -F file=@book.xlsx https://jev.fishmaple.cn/excelECharts/api/v1/convert
Result: {"charts":[{"sheet","anchor","title","types","warnings","option"}]} → echarts.init(el).setOption(option).
Optional key "x-numFmt" lists Excel number formats, and custom series (error bars, box-plot means/outliers) carry "x-renderItem"; apply both with prepare(option) from the package (or x2e-runtime.js) before setOption.
Only native Excel charts are converted, not plain tables. Docs: https://jev.fishmaple.cn/excelECharts/api.html
Commercial use: stormnetwork@163.com (妙妙鱼).`;
  const PROMPT_ZH = `用 excel-chart-echarts（xlsx2echarts）把 Excel 工作簿（.xlsx/.xlsm/.xltx/.xltm）里的原生图表转换成 Apache ECharts 的 option JSON。

优先本地运行（文件不离开本机，零依赖）：
  Node ≥18：  npm i -g https://github.com/fishstormX/excel-chart-echarts/releases/download/v1.0.0/excel-chart-echarts-1.0.0.tgz
             excel-chart-echarts 表格.xlsx -o out/        # 每个图表一个 JSON + index.json + preview.html
             import { convertXlsx } from "excel-chart-echarts"; const { charts } = await convertXlsx("表格.xlsx");
  Python ≥3.8：pip install https://github.com/fishstormX/excel-chart-echarts/releases/download/v1.0.0/excel_chart_echarts-1.0.0-py3-none-any.whl
             xlsx2echarts 表格.xlsx -o out/   |   from xlsx2echarts import convert_xlsx

否则调用公共 REST API（仅供测试；按 IP 限流；单文件 ≤10 MB；文件不保存）：
  curl -s -F file=@表格.xlsx https://jev.fishmaple.cn/excelECharts/api/v1/convert
返回：{"charts":[{"sheet","anchor","title","types","warnings","option"}]} → echarts.init(el).setOption(option)。
可选字段 "x-numFmt" 是 Excel 数字格式；误差线、箱线图均值/离群点是带 "x-renderItem" 的 custom 系列。setOption 前用包里的 prepare(option)（或 x2e-runtime.js）统一处理。
只转换 Excel 原生图表，不处理普通表格。文档：https://jev.fishmaple.cn/excelECharts/api.html?lang=zh
商业使用：stormnetwork@163.com（妙妙鱼）。`;

  function status(s) { $("#status").textContent = s; }
  function t(k, v) { return I18N.t(k, v); }

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "application/json" }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function convert(file) {
    if (!/\.xl[st][xm]$/i.test(file.name)) return status(t("e_type"));
    if (file.size > MAX) return status(t("e_size"));
    status(t("converting", { name: file.name }));
    geo = null;
    const gf = $("#geo") && $("#geo").files[0];
    if (gf) { try { geo = JSON.parse(await gf.text()); } catch (e) { return status(t("e_req") + ": GeoJSON " + e.message); } }
    if (window.ExcelECharts && typeof DecompressionStream !== "undefined" && !$("#useApi").checked) {
      try {
        const t0 = performance.now();
        const res = await ExcelECharts.convertXlsx(await file.arrayBuffer(), { excelCompat: !$("#showAxes").checked, geojson: geo });
        last = Object.assign({ ok: true, version: ExcelECharts.VERSION, filename: file.name, mode: "browser", ms: Math.round(performance.now() - t0) }, res);
        return render(last);
      } catch (e) { return status(t("e_req") + ": " + (e && e.message || e)); }
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("show_missing_axes", $("#showAxes").checked ? "true" : "false");
    if (gf) fd.append("geojson", gf);
    let r, j;
    try { r = await fetch(API, { method: "POST", body: fd }); j = await r.json(); }
    catch (e) { return status(t("e_req") + ": " + e); }
    if (r.status === 429) return status(t("e_rate", { s: j.retry_after || r.headers.get("Retry-After") || "?" }));
    if (!r.ok || !j.ok) return status(t("e_req") + ": " + ((j.error && j.error.message) || r.status));
    j.mode = "api"; last = j; render(j);
  }

  function render(j) {
    instances.forEach((c) => c.dispose()); instances = [];
    const root = $("#charts"); root.innerHTML = "";
    $("#btnAll").disabled = !j.charts.length;
    const f = j.evaluatedFormulas ? t("fEval", { k: j.evaluatedFormulas }) : "";
    status(t("done", { n: j.charts.length, name: j.filename, sheets: j.sheets.length, f }) + " · " + t(j.mode === "api" ? "modeApi" : "modeLocal", { ms: j.ms }));
    if (!j.charts.length) { root.innerHTML = `<div class="chart-card empty-res"></div>`; root.firstChild.textContent = t("none"); return; }
    j.charts.forEach((c) => {
      const card = document.createElement("article"); card.className = "chart-card";
      card.innerHTML = `<div class="chart-head"><h3></h3><span class="chart-meta"></span></div>
        <div class="chart-body"><div class="chart-view"><div class="cv"></div></div>
        <div class="chart-json"><div class="chart-actions"><button class="btn small b-copy"></button><button class="btn small b-dl"></button><button class="btn small b-png"></button></div><pre></pre></div></div>
        <div class="warn"></div>`;
      card.querySelector("h3").textContent = `#${c.index + 1} ${c.title || c.name || c.id}`;
      card.querySelector(".chart-meta").textContent = [c.sheet && `${c.sheet}${c.anchor ? "!" + c.anchor : ""}`, c.types.join(" + "), `${c.width}×${c.height}px`].filter(Boolean).join(" · ");
      card.querySelector(".warn").textContent = (c.warnings || []).map((w) => "⚠ " + w).join("\n");
      const json = JSON.stringify(c.option, null, 2);
      card.querySelector("pre").textContent = json;
      const bc = card.querySelector(".b-copy"); bc.textContent = t("copy");
      bc.onclick = async () => { try { await navigator.clipboard.writeText(json); bc.textContent = t("copied"); setTimeout(() => bc.textContent = t("copy"), 1400); } catch (e) {} };
      const bd = card.querySelector(".b-dl"); bd.textContent = t("dl");
      bd.onclick = () => download(`${(c.sheet || "chart").replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}_${c.id}.json`, json);
      root.appendChild(card);
      const el = card.querySelector(".cv");
      const w = Math.min(Math.max(c.width, 360), card.querySelector(".chart-view").clientWidth || 640);
      el.style.width = w + "px"; el.style.height = Math.max(Math.round(c.height * w / Math.max(c.width, 1)), 280) + "px";
      if (c.option) {
        const inst = echarts.init(el); instances.push(inst);
        ExcelECharts.registerMaps(echarts, c.option, { baseUrl: "geo/", geojson: geo }).then(() => inst.setOption(ExcelECharts.prepare(c.option)), (e) => status(t("e_req") + ": " + e));
        const bp = card.querySelector(".b-png"); bp.textContent = t("dlPng");
        bp.onclick = () => { const a = document.createElement("a"); a.href = inst.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }); a.download = `${c.id}.png`; a.click(); };
      }
    });
    window.__x2eRendered = j.charts.length;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#agentPrompt").textContent = PROMPT_EN; $("#agentPromptZh").textContent = PROMPT_ZH;
    $("#btnCopyAgent").onclick = async () => {
      const b = $("#btnCopyAgent");
      try { await navigator.clipboard.writeText(I18N.lang === "zh" ? PROMPT_ZH : PROMPT_EN); b.textContent = t("agentCopied"); setTimeout(() => b.textContent = t("agentCopy"), 1500); } catch (e) {}
    };
    $("#file").onchange = (e) => e.target.files[0] && convert(e.target.files[0]);
    const d = $("#drop");
    ["dragenter", "dragover"].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.remove("over"); }));
    d.addEventListener("drop", (e) => e.dataTransfer.files[0] && convert(e.dataTransfer.files[0]));
    $("#btnSample").onclick = async () => {
      const r = await fetch("samples/demo-xlsxwriter.xlsx"); const b = await r.blob();
      convert(new File([b], "demo-xlsxwriter.xlsx"));
    };
    const sample = (f) => async () => { const r = await fetch("samples/" + f); convert(new File([await r.blob()], f)); };
    $("#btnSample2").onclick = sample("demo-office2016.xlsx");
    $("#btnSample3").onclick = sample("demo-errorbars-trendlines.xlsx");
    $("#btnSample4").onclick = sample("demo-maps.xlsx");
    $("#btnSample5").onclick = sample("demo-gantt.xlsx");
    $("#btnAll").onclick = () => last && download((last.filename || "workbook").replace(/\.\w+$/, "") + ".echarts.json", JSON.stringify(last, null, 2));
    document.addEventListener("langchange", () => last && render(last));
    window.addEventListener("resize", () => instances.forEach((i) => i.resize()));
  });
})();
