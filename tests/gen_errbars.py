"""Classic charts with error bars and all trendline types (XlsxWriter writes Excel-style c:errBars / c:trendline)."""
import sys
import xlsxwriter
out = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
wb = xlsxwriter.Workbook(f"{out}/errbars_trendlines.xlsx")
ws = wb.add_worksheet("Data")
ws.write_row(0, 0, ["Month", "A", "B", "C", "ErrPlus", "ErrMinus", "X", "Y", "Ygrowth"])
A = [42, 55, 48, 63, 70, 66]; B = [30, 28, 35, 33, 40, 45]; Cc = [12, -8, 15, 10, -5, 9]
EP = [3, 5, 2, 6, 4, 3]; EM = [2, 2, 4, 3, 5, 2]
X = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; Y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1, 18.0, 20.3]
YG = [1.5, 2.3, 3.4, 5.2, 7.9, 11.6, 17.8, 26.0, 39.5, 58.9]
for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun"], 1):
    ws.write_row(i, 0, [m, A[i - 1], B[i - 1], Cc[i - 1], EP[i - 1], EM[i - 1]])
for i in range(10):
    ws.write(i + 1, 6, X[i]); ws.write(i + 1, 7, Y[i]); ws.write(i + 1, 8, YG[i])
cats = ["Data", 1, 0, 6, 0]
def ser(col, **kw):
    return {"name": ["Data", 0, col], "categories": cats, "values": ["Data", 1, col, 6, col], **kw}

c = wb.add_chart({"type": "column"})
c.add_series(ser(1, y_error_bars={"type": "fixed", "value": 4}))
c.add_series(ser(2, y_error_bars={"type": "percentage", "value": 10, "direction": "plus", "end_style": 0}))
c.add_series(ser(3, y_error_bars={"type": "custom", "plus_values": ["Data", 1, 4, 6, 4], "minus_values": ["Data", 1, 5, 6, 5],
                                  "line": {"color": "#C00000", "width": 1.5}}))
c.set_title({"name": "Clustered column: fixed / % plus no-cap / custom"}); c.set_legend({"position": "bottom"})
ws.insert_chart("K2", c)

s = wb.add_chart({"type": "column", "subtype": "stacked"})
s.add_series(ser(1, y_error_bars={"type": "standard_error"}))
s.add_series(ser(2, y_error_bars={"type": "fixed", "value": 5, "direction": "minus"}))
s.set_title({"name": "Stacked column: std error / fixed minus"}); ws.insert_chart("K20", s)

h = wb.add_chart({"type": "bar"})
h.add_series(ser(1, y_error_bars={"type": "percentage", "value": 8}))
h.add_series(ser(2, y_error_bars={"type": "fixed", "value": 3}, trendline={"type": "linear"}))
h.set_title({"name": "Horizontal bar: error bars + linear trend"}); ws.insert_chart("S2", h)

l = wb.add_chart({"type": "line"})
l.add_series(ser(1, marker={"type": "circle"}, y_error_bars={"type": "standard_deviation", "value": 1}))
l.add_series(ser(2, marker={"type": "diamond"}, trendline={"type": "polynomial", "order": 3}))
l.add_series(ser(1, name="A (moving avg)", trendline={"type": "moving_average", "period": 3}, line={"none": True}, marker={"type": "none"}))
l.set_title({"name": "Line: std dev error bars, poly(3) & moving average"}); ws.insert_chart("S20", l)

sc = wb.add_chart({"type": "scatter"})
xs = ["Data", 1, 6, 10, 6]
sc.add_series({"name": "Linear-ish", "categories": xs, "values": ["Data", 1, 7, 10, 7], "marker": {"type": "circle"},
               "x_error_bars": {"type": "fixed", "value": 0.3}, "y_error_bars": {"type": "percentage", "value": 10},
               "trendline": {"type": "linear", "forward": 1}})
sc.add_series({"name": "Growth", "categories": xs, "values": ["Data", 1, 8, 10, 8], "marker": {"type": "square"},
               "trendline": {"type": "exponential", "name": "Exp fit"}})
sc.set_title({"name": "Scatter: x/y error bars, exp trend"}); ws.insert_chart("K38", sc)

t = wb.add_chart({"type": "scatter"})
t.add_series({"name": "Y", "categories": xs, "values": ["Data", 1, 7, 10, 7], "marker": {"type": "circle"}, "trendline": {"type": "log"}})
t.add_series({"name": "Growth", "categories": xs, "values": ["Data", 1, 8, 10, 8], "marker": {"type": "triangle"},
              "trendline": {"type": "power", "line": {"color": "#7030A0", "dash_type": "dash"}}})
t.add_series({"name": "Growth ", "categories": xs, "values": ["Data", 1, 8, 10, 8], "marker": {"type": "none"},
              "trendline": {"type": "polynomial", "order": 2, "display_equation": True}})
t.set_title({"name": "Scatter: log / power / poly(2) trendlines"}); ws.insert_chart("S38", t)
wb.close(); print("ok")
