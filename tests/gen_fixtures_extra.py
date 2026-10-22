"""Extra fixtures exercising edge features (XlsxWriter writes Excel-style caches)."""
import datetime as dt, sys
import xlsxwriter
out = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
wb = xlsxwriter.Workbook(f"{out}/edge_xlsxwriter.xlsx")
ws = wb.add_worksheet("边界 Sheet")
pct = wb.add_format({"num_format": "0.0%"}); money = wb.add_format({"num_format": "#,##0.00"}); d = wb.add_format({"num_format": "yyyy\"年\"m\"月\"d\"日\""})
ws.write_row(0, 0, ["Grp", "Item", "A", "B", "Rate", "Date"])
rows = [("East", "x", 1200.5, 300, 0.12), ("East", "y", 800, 450.25, 0.34), ("West", "x", 1500, 120, 0.05), ("West", "y", 0, 900, 0.5), ("West", "z", 640, 640, 0.25)]
for i, r in enumerate(rows, 1):
    ws.write_row(i, 0, r[:2]); ws.write(i, 2, r[2], money); ws.write(i, 3, r[3], money); ws.write(i, 4, r[4], pct)
    ws.write_datetime(i, 5, dt.datetime(2025, 1, 1) + dt.timedelta(days=[0, 3, 10, 11, 30][i - 1]), d)
ws.write_formula(6, 2, "=SUM(C2:C6)", money, 4140.5)
c = wb.add_chart({"type": "column", "subtype": "percent_stacked"})
for col in (2, 3):
    c.add_series({"name": ["边界 Sheet", 0, col], "categories": ["边界 Sheet", 1, 0, 5, 1], "values": ["边界 Sheet", 1, col, 5, col],
                  "data_labels": {"value": True, "num_format": "#,##0"}, "fill": {"color": "#8064A2" if col == 2 else "#4BACC6"}})
c.set_title({"name": "Multi-level categories, 100% stacked"}); c.set_legend({"position": "top", "delete_series": [1]})
ws.insert_chart("H2", c)
l = wb.add_chart({"type": "line"})
l.add_series({"name": "Rate", "categories": ["边界 Sheet", 1, 5, 5, 5], "values": ["边界 Sheet", 1, 4, 5, 4], "marker": {"type": "square", "size": 7},
              "data_labels": {"value": True, "position": "above"}, "smooth": True, "line": {"dash_type": "dash"}})
l.set_x_axis({"date_axis": True, "num_format": "m/d", "name": "Uneven dates"}); l.set_y_axis({"log_base": 10, "name": "Rate (log)", "min": 0.01, "max": 1, "reverse": False})
l.set_title({"name": "Date axis (uneven) + log scale"}); ws.insert_chart("H20", l)
p = wb.add_chart({"type": "pie"})
p.add_series({"categories": ["边界 Sheet", 1, 1, 5, 1], "values": ["边界 Sheet", 1, 2, 5, 2], "points": [None, {"fill": {"color": "#FF0000"}}],
              "data_labels": {"percentage": True, "value": True, "separator": "\n", "leader_lines": True, "position": "outside_end"}})
p.set_rotation(45); p.set_title({"name": "Pie rotation 45, labels value+%"}); p.set_legend({"position": "left"})
ws.insert_chart("Q2", p)
r = wb.add_chart({"type": "radar", "subtype": "filled"})
for col in (2, 3): r.add_series({"name": ["边界 Sheet", 0, col], "categories": ["边界 Sheet", 1, 1, 5, 1], "values": ["边界 Sheet", 1, col, 5, col]})
r.set_title({"name": "Filled radar"}); ws.insert_chart("Q20", r)
b = wb.add_chart({"type": "bar"})
b.add_series({"name": "A", "categories": ["边界 Sheet", 1, 1, 5, 1], "values": ["边界 Sheet", 1, 2, 5, 2], "data_labels": {"value": True, "position": "inside_end"}, "gap": 50})
b.set_x_axis({"min": 0, "max": 2000, "major_unit": 500, "num_format": "#,##0", "major_gridlines": {"visible": True, "line": {"color": "#DDDDDD", "dash_type": "round_dot"}}})
b.set_y_axis({"reverse": True}); b.set_title({"none": True}); b.set_legend({"none": True}); b.set_chartarea({"fill": {"color": "#F7F7F7"}})
ws.insert_chart("Z2", b)
s = wb.add_chart({"type": "scatter", "subtype": "straight"})
s.add_series({"name": "xy", "categories": ["边界 Sheet", 1, 2, 5, 2], "values": ["边界 Sheet", 1, 3, 5, 3], "marker": {"type": "none"}})
s.set_title({"name": "Scatter straight lines"}); ws.insert_chart("Z20", s)
cs = wb.add_chartsheet("ChartSheet")
a = wb.add_chart({"type": "area", "subtype": "percent_stacked"})
for col in (2, 3): a.add_series({"name": ["边界 Sheet", 0, col], "categories": ["边界 Sheet", 1, 1, 5, 1], "values": ["边界 Sheet", 1, col, 5, col]})
a.set_title({"name": "Chartsheet: 100% area"}); cs.set_chart(a)
wb.close(); print("ok")
