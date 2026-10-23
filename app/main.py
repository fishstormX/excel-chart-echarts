"""xlsx2echarts HTTP API — uploads are parsed in memory only and never stored.

  GET  /api/v1/health
  POST /api/v1/convert   (multipart field `file`: .xlsx/.xlsm/.xltx/.xltm) → {"ok":true,"charts":[{..., "option":{...}}]}
  GET  /api/docs (Swagger UI) · /api/openapi.json
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import zipfile
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from xlsx2echarts import __version__, convert_xlsx
from app.ratelimit import client_ip, limiter

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("xlsx2echarts")

BASE_PATH = os.environ.get("X2E_BASE_PATH", "").rstrip("/")
MAX_BYTES = int(float(os.environ.get("X2E_MAX_MB", "10")) * 1024 * 1024)
MAX_UNZIPPED = int(float(os.environ.get("X2E_MAX_UNZIPPED_MB", "150")) * 1024 * 1024)
TIMEOUT = float(os.environ.get("X2E_TIMEOUT_S", "30"))
CONTACT_EN = ("This API is for testing only. For commercial use or partnership inquiries, contact stormnetwork@163.com "
              "(海口龙华区妙妙鱼传媒工作室 / Miaomiaoyu Media Studio, Longhua District, Haikou).")
CONTACT_ZH = "此接口仅供测试使用，如有商业使用或合作意向，请联系 stormnetwork@163.com（海口龙华区妙妙鱼传媒工作室）。"

app = FastAPI(
    title="xlsx2echarts API", version=__version__,
    description=(f"**{CONTACT_EN}** {CONTACT_ZH}\n\nConvert the native charts embedded in an Excel workbook "
                 "(DrawingML `xl/charts/chartN.xml`) into Apache ECharts `option` objects. Per-IP rate limits apply "
                 f"(HTTP 429 with Retry-After). Max upload {MAX_BYTES // 1048576} MB. Files are processed in memory and never stored."),
    docs_url=None, redoc_url=None, openapi_url="/api/openapi.json", servers=[{"url": BASE_PATH or "/"}],
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
LIMITED = {"/api/v1/convert"}


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def _err(status, code, message, **extra):
    return JSONResponse(status_code=status, content={"ok": False, "error": {"code": code, "message": message},
                                                     "detail": message, **extra})


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if limiter.enabled and request.method == "POST" and request.url.path.rstrip("/") in LIMITED:
        ip = client_ip(request.client.host if request.client else None, request.headers)
        wait = limiter.hit(ip)
        if wait is not None:
            msg = f"rate limited, retry after {wait}s. {CONTACT_EN}"
            return JSONResponse(status_code=429, headers={"Retry-After": str(wait)},
                                content={"ok": False, "error": {"code": "RATE_LIMITED", "message": msg}, "detail": msg,
                                         "retry_after": wait,
                                         "message": {"en": f"Rate limited, retry after {wait}s. {CONTACT_EN}",
                                                     "zh": f"请求过于频繁，请 {wait} 秒后再试。{CONTACT_ZH}"}})
    cl = request.headers.get("content-length")
    if request.method == "POST" and cl and cl.isdigit() and int(cl) > MAX_BYTES + 64 * 1024:
        return _err(413, "FILE_TOO_LARGE", f"file larger than {MAX_BYTES // 1048576} MB")
    return await call_next(request)


@app.exception_handler(APIError)
async def _api_error(_: Request, e: APIError):
    return _err(e.status, e.code, e.message)


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, e: RequestValidationError):
    msg = "; ".join(f"{'.'.join(str(x) for x in er.get('loc', [])[1:])}: {er.get('msg')}" for er in e.errors())
    return _err(422, "VALIDATION_ERROR", msg)


class Chart(BaseModel):
    index: int
    id: str = Field(description="chart part name, e.g. chart1")
    part: str = Field(description="zip part, e.g. xl/charts/chart1.xml")
    sheet: Optional[str] = Field(None, description="sheet the chart is placed on")
    anchor: Optional[str] = Field(None, description="cell range the chart covers, e.g. I2:O8")
    name: Optional[str] = None
    title: Optional[str] = None
    width: int = Field(description="approx. width in px (from the drawing anchor)")
    height: int
    types: List[str] = Field(description="DrawingML chart groups, e.g. ['barChart','lineChart']")
    usedFormulaFallback: bool = False
    warnings: List[str] = []
    option: Optional[dict] = Field(None, description="ECharts option. Optional key `x-numFmt` lists Excel number formats; "
                                                       "apply with x2e-runtime.js `X2E.prepare(option)` or ignore")


class ConvertResponse(BaseModel):
    ok: bool = True
    version: str
    filename: Optional[str]
    sheets: List[str]
    charts: List[Chart]
    warnings: List[str] = []
    evaluatedFormulas: int = 0


def _check(raw: bytes):
    if not raw:
        raise APIError(400, "EMPTY_FILE", "empty upload")
    if len(raw) > MAX_BYTES:
        raise APIError(413, "FILE_TOO_LARGE", f"file larger than {MAX_BYTES // 1048576} MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise APIError(415, "NOT_XLSX", "not an .xlsx/.xlsm/.xltx/.xltm file (OOXML zip expected; legacy .xls / .xlsb are not supported)")
    names = z.namelist()
    if "xl/workbook.xml" not in names:
        raise APIError(415, "NOT_XLSX", "zip has no xl/workbook.xml — not an Excel workbook")
    if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
        raise APIError(413, "TOO_LARGE_UNZIPPED", "workbook too large when uncompressed")


@app.get("/api/v1/health", tags=["v1"], summary="Service health, version and limits")
def health():
    return {"ok": True, "version": __version__, "max_upload_mb": MAX_BYTES // 1048576,
            "rate_limits": [{"count": n, "window_s": w} for n, w in limiter.rules], "stores_files": False}


@app.post("/api/v1/convert", tags=["v1"], response_model=ConvertResponse, summary="Convert every native chart in an OOXML workbook to an ECharts option")
async def convert(file: UploadFile = File(..., description=".xlsx / .xlsm / .xltx / .xltm workbook (≤ max_upload_mb)"),
                  show_missing_axes: bool = Form(False, description="show axes that lack <c:delete> (Excel hides them)"),
                  geojson: Optional[UploadFile] = File(None, description="optional GeoJSON FeatureCollection for regionMap (filled map) charts; "
                                                                           "default: bundled China provinces / world countries")):
    raw = await file.read(MAX_BYTES + 1)
    _check(raw)
    gj = None
    if geojson is not None:
        graw = await geojson.read(MAX_BYTES + 1)
        if len(graw) > MAX_BYTES:
            raise APIError(413, "GEOJSON_TOO_LARGE", "geojson file is too large")
        try:
            gj = json.loads(graw.decode("utf-8"))
            assert isinstance(gj, dict) and isinstance(gj.get("features"), list)
        except Exception:
            raise APIError(400, "BAD_GEOJSON", "geojson must be a GeoJSON FeatureCollection (UTF-8 JSON)")
    try:
        res = await asyncio.wait_for(asyncio.to_thread(convert_xlsx, raw, not show_missing_axes, gj), TIMEOUT)
    except asyncio.TimeoutError:
        raise APIError(504, "TIMEOUT", f"conversion took longer than {TIMEOUT:.0f}s")
    except APIError:
        raise
    except Exception as e:
        log.exception("convert failed")
        raise APIError(422, "CONVERT_FAILED", f"could not read workbook: {e}")
    finally:
        del raw
    return {"ok": True, "version": __version__, "filename": file.filename, **res}


@app.get("/api/docs", include_in_schema=False)
def docs():
    return get_swagger_ui_html(openapi_url=f"{BASE_PATH}/api/openapi.json", title="xlsx2echarts API")


_ui = os.environ.get("X2E_STATIC_DIR") or str(Path(__file__).resolve().parents[1] / "frontend")
if os.environ.get("X2E_SERVE_UI", "1") == "1" and Path(_ui, "index.html").is_file():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_ui, html=True), name="ui")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", 8766)))
