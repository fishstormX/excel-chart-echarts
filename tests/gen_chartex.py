"""Hand-crafted Office 2016 chartEx fixtures (openpyxl/XlsxWriter cannot write chartEx).
Data sheets are written with XlsxWriter; drawing + xl/charts/chartExN.xml parts are injected with the same
structure Excel 2016+ writes (mc:AlternateContent/mc:Choice Requires="cx1" → cx:chart r:id, chartData with
numDim/strDim caches, plotAreaRegion/series layoutId, layoutPr, axis ids 0/1/2)."""
import io, re, sys, zipfile
from xml.sax.saxutils import escape
import xlsxwriter

OUT = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
NSD = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
       'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
       'xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"')


def col(c):
    s = ""
    c += 1
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def rng(sheet, c, r1, r2, c2=None):
    q = f"'{sheet}'" if " " in sheet else sheet
    return f"{q}!${col(c)}${r1 + 1}:${col(c if c2 is None else c2)}${r2 + 1}"


def lvl(vals, num=False, fmt="General"):
    pts = "".join(f'<cx:pt idx="{i}">{escape(str(v))}</cx:pt>' for i, v in enumerate(vals) if v not in (None, ""))
    return f'<cx:lvl ptCount="{len(vals)}"{f" formatCode={chr(34)}{fmt}{chr(34)}" if num else ""}>{pts}</cx:lvl>'


def strdim(f, levels):  # levels: leaf first
    return f'<cx:strDim type="cat"><cx:f>{f}</cx:f>{"".join(lvl(l) for l in levels)}</cx:strDim>'


def numdim(f, vals, typ="val", fmt="General", cache=True):
    return f'<cx:numDim type="{typ}"><cx:f>{f}</cx:f>{lvl(vals, True, fmt) if cache else ""}</cx:numDim>'


def tx(text, f=None):
    return f'<cx:tx><cx:txData>{f"<cx:f>{f}</cx:f>" if f else ""}<cx:v>{escape(text)}</cx:v></cx:txData></cx:tx>'


def title(text):
    return (f'<cx:title pos="t" align="ctr" overlay="0">{tx(text)}<cx:txPr><a:bodyPr spcFirstLastPara="1" vertOverflow="ellipsis" '
            f'horzOverflow="overflow" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"/><a:lstStyle/>'
            f'<a:p><a:pPr algn="ctr" rtl="0"><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="0"/><a:t>{escape(text)}</a:t></a:r></a:p></cx:txPr></cx:title>')


def chart_xml(data, series, axes, ttl, legend='<cx:legend pos="t" align="ctr" overlay="0"/>'):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cx:chartSpace {NSD}><cx:chartData>{data}</cx:chartData>'
            f'<cx:chart>{title(ttl) if ttl else ""}<cx:plotArea><cx:plotAreaRegion>{series}</cx:plotAreaRegion>{axes}</cx:plotArea>'
            f'{legend}</cx:chart></cx:chartSpace>')


CAT_AX = '<cx:axis id="0"><cx:catScaling gapWidth="{g}"/><cx:tickLabels/></cx:axis>'
VAL_AX = '<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>'
UID = "{%08X-0000-4000-8000-000000000000}"


def ser(layout, i, name, nf, extra="", labels=True, owner=None):
    lab = ('<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>'
           if labels else "")
    return (f'<cx:series layoutId="{layout}" uniqueId="{UID % (i + 1)}"{f" ownerIdx={chr(34)}{owner}{chr(34)}" if owner is not None else ""}>'
            f'{tx(name, nf) if name else ""}{lab}<cx:dataId val="{i}"/>{extra}</cx:series>')


def build(path, sheets, charts):
    """sheets: {name: rows}; charts: [(sheet_name, (c1, r1, c2, r2), name, chartXml)]"""
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    for name, rows in sheets.items():
        ws = wb.add_worksheet(name)
        for r, row in enumerate(rows):
            for c, v in enumerate(row):
                if v is not None:
                    ws.write(r, c, v)
    wb.close()
    zin = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    files = {n: zin.read(n) for n in zin.namelist()}
    order = list(sheets)
    ct = files["[Content_Types].xml"].decode()
    by_sheet = {}
    for i, ch in enumerate(charts, 1):
        by_sheet.setdefault(ch[0], []).append((i, ch))
    for di, (sname, lst) in enumerate(by_sheet.items(), 1):
        sidx = order.index(sname) + 1
        anchors, drels = [], []
        for k, (i, (_, (c1, r1, c2, r2), cname, xml)) in enumerate(lst, 1):
            files[f"xl/charts/chartEx{i}.xml"] = xml.encode()
            ct = ct.replace("</Types>", f'<Override PartName="/xl/charts/chartEx{i}.xml" ContentType="application/vnd.ms-office.chartex+xml"/></Types>')
            drels.append(f'<Relationship Id="rId{k}" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx{i}.xml"/>')
            anchors.append(
                f'<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>{c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
                f'<xdr:to><xdr:col>{c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
                f'<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
                f'<mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1">'
                f'<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{k + 1}" name="{escape(cname)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
                f'<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex">'
                f'<cx:chart xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId{k}"/>'
                f'</a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice><mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/>'
                f'<xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></a:xfrm>'
                f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/>'
                f'<a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This chart isn\'t available in your version of Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp>'
                f'</mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>')
        files[f"xl/drawings/drawing{di}.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + "".join(anchors) + "</xdr:wsDr>").encode()
        files[f"xl/drawings/_rels/drawing{di}.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(drels) + "</Relationships>").encode()
        ct = ct.replace("</Types>", f'<Override PartName="/xl/drawings/drawing{di}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>')
        sp = f"xl/worksheets/sheet{sidx}.xml"
        sx = files[sp].decode()
        sx = sx.replace("</worksheet>", '<drawing r:id="rIdDr1"/></worksheet>')
        files[sp] = sx.encode()
        files[f"xl/worksheets/_rels/sheet{sidx}.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rIdDr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing{di}.xml"/>'
            "</Relationships>").encode()
    files["[Content_Types].xml"] = ct.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n in ["[Content_Types].xml"] + [n for n in files if n != "[Content_Types].xml"]:
            z.writestr(n, files[n])


def lcg(seed, n, lo, hi):
    out, x = [], seed
    for _ in range(n):
        x = (x * 1103515245 + 12345) % 2147483648
        out.append(lo + (x % 10000) / 10000 * (hi - lo))
    return out


# ---------------- data ----------------
WF = [("Opening", 1000), ("Sales", 600), ("Services", 250), ("Returns", -180), ("Capex", -1900), ("Tax", -120),
      ("Grant", 500), ("Closing", 150)]
HI = [("Asia", "China", "Shanghai", 42), (None, None, "Beijing", 35), (None, None, "Shenzhen", 28), (None, "Japan", "Tokyo", 30),
      (None, None, "Osaka", 12), ("Europe", "Germany", "Berlin", 18), (None, None, "Munich", 14), (None, "France", "Paris", 22),
      ("Americas", "USA", "New York", 33), (None, None, "San Francisco", 26), (None, "Brazil", None, 15)]
SCORES = [round(x, 1) for x in lcg(7, 80, 38, 99)]
PARETO = [("Late delivery", 48), ("Damaged", 21), ("Wrong item", 33), ("Billing", 9), ("Late delivery", 12), ("Other", 6), ("Damaged", 4)]
FUNNEL = [("Visits", 12000), ("Sign-ups", 5400), ("Trials", 2300), ("Quotes", 1100), ("Orders", 480)]
BOX_C = ["Course A"] * 12 + ["Course B"] * 12 + ["Course C"] * 12
B1 = [round(x) for x in lcg(3, 36, 50, 95)]
B2 = [round(x) for x in lcg(11, 36, 40, 100)]
B1[5] = 15; B2[30] = 160  # outliers

sheets = {
    "Waterfall": [["Item", "Amount"]] + [list(r) for r in WF],
    "Hierarchy": [["Region", "Country", "City", "Sales"]] + [list(r) for r in HI],
    "Histogram": [["Score"]] + [[s] for s in SCORES],
    "Pareto": [["Reason", "Count"]] + [list(r) for r in PARETO],
    "Funnel": [["Stage", "Users"]] + [list(r) for r in FUNNEL],
    "Box": [["Course", "2025", "2026"]] + [[c, a, b] for c, a, b in zip(BOX_C, B1, B2)],
    "Map": [["Country", "Value"], ["China", 10], ["France", 7]],
}
n = len(WF)
wf = chart_xml(
    f'<cx:data id="0">{strdim(rng("Waterfall", 0, 1, n), [[r[0] for r in WF]])}{numdim(rng("Waterfall", 1, 1, n), [r[1] for r in WF], fmt="#,##0")}</cx:data>',
    ser("waterfall", 0, "Amount", "Waterfall!$B$1",
        f'<cx:layoutPr><cx:visibility connectorLines="1"/><cx:subtotals><cx:idx val="0"/><cx:idx val="{n - 1}"/></cx:subtotals></cx:layoutPr>'),
    CAT_AX.format(g="0.5") + VAL_AX, "Cash flow 2026 (waterfall)")
nh = len(HI)
lv = [[r[2] for r in HI], [r[1] for r in HI], [r[0] for r in HI]]
tm = chart_xml(
    f'<cx:data id="0">{strdim(rng("Hierarchy", 0, 1, nh, 2), lv)}{numdim(rng("Hierarchy", 3, 1, nh), [r[3] for r in HI], "size")}</cx:data>',
    ser("treemap", 0, "Sales", "Hierarchy!$D$1", '<cx:layoutPr><cx:parentLabelLayout val="banner"/></cx:layoutPr>', labels=False),
    "", "Sales by region (treemap)")
sb = chart_xml(
    f'<cx:data id="0">{strdim(rng("Hierarchy", 0, 1, nh, 2), lv)}{numdim(rng("Hierarchy", 3, 1, nh), [r[3] for r in HI], "size")}</cx:data>',
    ser("sunburst", 0, "Sales", "Hierarchy!$D$1", "", labels=False), "", "Sales by region (sunburst)", legend="")
ns = len(SCORES)
h1 = chart_xml(f'<cx:data id="0">{numdim(rng("Histogram", 0, 1, ns), SCORES)}</cx:data>',
               ser("clusteredColumn", 0, "Score", "Histogram!$A$1", '<cx:layoutPr><cx:binning intervalClosed="r"/></cx:layoutPr>'),
               CAT_AX.format(g="0") + VAL_AX, "Scores — automatic bins (Scott)", legend="")
h2 = chart_xml(f'<cx:data id="0">{numdim(rng("Histogram", 0, 1, ns), SCORES)}</cx:data>',
               ser("clusteredColumn", 0, "Score", "Histogram!$A$1",
                   '<cx:layoutPr><cx:binning intervalClosed="r" underflow="50" overflow="90"><cx:binSize val="10"/></cx:binning></cx:layoutPr>'),
               CAT_AX.format(g="0") + VAL_AX, "Bin width 10, underflow ≤50, overflow >90", legend="")
h3 = chart_xml(f'<cx:data id="0">{numdim(rng("Histogram", 0, 1, ns), SCORES, cache=False)}</cx:data>',
               ser("clusteredColumn", 0, None, None, '<cx:layoutPr><cx:binning intervalClosed="l"><cx:binCount val="6"/></cx:binning></cx:layoutPr>', labels=False),
               CAT_AX.format(g="0.1") + VAL_AX, "6 bins, [a,b) — no cache (formula fallback)", legend="")
npar = len(PARETO)
pa = chart_xml(
    f'<cx:data id="0">{strdim(rng("Pareto", 0, 1, npar), [[r[0] for r in PARETO]])}{numdim(rng("Pareto", 1, 1, npar), [r[1] for r in PARETO])}</cx:data>',
    ser("clusteredColumn", 0, "Count", "Pareto!$B$1", '<cx:layoutPr><cx:aggregation/></cx:layoutPr>', labels=False)
    + '<cx:series layoutId="paretoLine" ownerIdx="0" uniqueId="{00000002-0000-4000-8000-000000000000}"><cx:axisId val="2"/></cx:series>',
    CAT_AX.format(g="0") + VAL_AX + '<cx:axis id="2"><cx:valScaling max="1" min="0"/><cx:units unit="percentage"/><cx:tickLabels/></cx:axis>',
    "Complaints (pareto)", legend='<cx:legend pos="b" align="ctr" overlay="0"/>')
nf = len(FUNNEL)
fu = chart_xml(
    f'<cx:data id="0">{strdim(rng("Funnel", 0, 1, nf), [[r[0] for r in FUNNEL]])}{numdim(rng("Funnel", 1, 1, nf), [r[1] for r in FUNNEL], fmt="#,##0")}</cx:data>',
    ser("funnel", 0, "Users", "Funnel!$B$1", ""),
    '<cx:axis id="0"><cx:catScaling gapWidth="0.06"/><cx:tickLabels/></cx:axis>', "Sales funnel", legend="")
nb = len(BOX_C)
bx = chart_xml(
    f'<cx:data id="0">{strdim(rng("Box", 0, 1, nb), [BOX_C])}{numdim(rng("Box", 1, 1, nb), B1)}</cx:data>'
    f'<cx:data id="1">{strdim(rng("Box", 0, 1, nb), [BOX_C])}{numdim(rng("Box", 2, 1, nb), B2)}</cx:data>',
    ser("boxWhisker", 0, "2025", "Box!$B$1", '<cx:layoutPr><cx:visibility meanLine="1" meanMarker="1" nonoutliers="0" outliers="1"/>'
        '<cx:statistics quartileMethod="exclusive"/></cx:layoutPr>', labels=False)
    + ser("boxWhisker", 1, "2026", "Box!$C$1", '<cx:layoutPr><cx:visibility meanLine="0" meanMarker="1" nonoutliers="1" outliers="1"/>'
          '<cx:statistics quartileMethod="inclusive"/></cx:layoutPr>', labels=False),
    CAT_AX.format(g="1") + VAL_AX, "Exam scores (box & whisker)")
mp = chart_xml(
    f'<cx:data id="0">{strdim(rng("Map", 0, 1, 2), [["China", "France"]])}{numdim(rng("Map", 1, 1, 2), [10, 7])}</cx:data>',
    ser("regionMap", 0, "Value", "Map!$B$1", '<cx:layoutPr><cx:regionLabelLayout val="showAll"/><cx:geography cultureLanguage="en-US" cultureRegion="US" attribution="Powered by Bing"/></cx:layoutPr>', labels=False),
    "", "Filled map")
charts = [("Waterfall", (3, 1, 11, 19), "Waterfall 1", wf),
          ("Hierarchy", (5, 1, 13, 19), "Treemap 1", tm), ("Hierarchy", (14, 1, 22, 19), "Sunburst 1", sb),
          ("Histogram", (2, 1, 10, 17), "Histogram 1", h1), ("Histogram", (11, 1, 19, 17), "Histogram 2", h2),
          ("Histogram", (2, 18, 10, 34), "Histogram 3", h3),
          ("Pareto", (3, 1, 11, 19), "Pareto 1", pa), ("Funnel", (3, 1, 11, 17), "Funnel 1", fu),
          ("Box", (4, 1, 13, 20), "Box 1", bx), ("Map", (3, 1, 10, 15), "Map 1", mp)]
build(f"{OUT}/chartex_excel2016.xlsx", sheets, charts)
print("ok")
