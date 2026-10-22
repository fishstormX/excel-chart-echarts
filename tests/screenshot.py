import sys, asyncio
from playwright.async_api import async_playwright
async def main(url, out, w=1500):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": w, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto(url); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=out, full_page=True)
        print("errors:", errs); await b.close()
asyncio.run(main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1500))
