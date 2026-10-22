"""Render every chart of the given workbooks to PNG (one per chart) for visual review."""
import sys, json, asyncio, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from xlsx2echarts import convert_xlsx
from playwright.async_api import async_playwright
OUT = pathlib.Path(sys.argv[1]).resolve(); OUT.mkdir(parents=True, exist_ok=True)
for f in ("echarts.min.js", "x2e-runtime.js"): shutil.copy(ROOT / "frontend" / f, OUT / f)
async def main(files):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 820, "height": 520})
        for src in files:
            res = convert_xlsx(src)
            stem = pathlib.Path(src).stem
            for i, c in enumerate(res["charts"]):
                if not c.get("option"): print(stem, i, "null", c.get("warnings")); continue
                html = OUT / "p.html"
                html.write_text('<html><body style="margin:0"><div id=c style="width:800px;height:500px"></div><script src=echarts.min.js></script><script src=x2e-runtime.js></script><script>var o=%s;o=X2E.prepare(o);o.animation=false;echarts.init(document.getElementById("c")).setOption(o);</script></body></html>' % json.dumps(c["option"]), encoding="utf-8")
                errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
                await pg.goto(html.as_uri()); await pg.wait_for_timeout(500)
                await pg.screenshot(path=str(OUT / f"{stem}__{i}.png"), clip={"x":0,"y":0,"width":800,"height":500})
                if errs: print(stem, i, errs)
        await b.close()
asyncio.run(main(sys.argv[2:]))
