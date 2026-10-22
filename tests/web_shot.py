import sys, asyncio
from playwright.async_api import async_playwright
async def main(url, files, out, lang="en-US"):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1280, "height": 900}, locale=lang)
        pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(url, timeout=120000); await pg.wait_for_timeout(800)
        for i, f in enumerate(files.split(",")):
            await pg.set_input_files("#file", f)
            await pg.wait_for_function("window.__x2eRendered !== undefined || document.querySelector('.empty-res')", timeout=20000)
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=out.replace(".png", f"_{i}.png"), full_page=True)
            print(f, await pg.inner_text("#status"))
        print("errors:", errs); await b.close()
asyncio.run(main(*sys.argv[1:]))
