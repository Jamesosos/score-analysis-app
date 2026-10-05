# -*- coding: utf-8 -*-
"""Check score distributions, cross-year student continuity, and 操行 spread."""
import os
import re
import statistics as st
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

# Resolved from this file's location so the script works from any CWD.
BASE = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = BASE / "demo-data"
SUBJECTS = ["中文科", "英文科", "數學科", "歷史科", "地理科",
            "物理科", "化學科", "生物科", "電腦科"]

per_subj = defaultdict(list)
total_scores = []
cohort_students = defaultdict(dict)   # cohort -> {year: {(id,name)}}
by_class = defaultdict(dict)          # (grade,class) -> {year: {(id,name)}}
conduct = defaultdict(int)

for root, _d, fns in os.walk(OUT):
    for fn in fns:
        if not fn.lower().endswith(".xlsx"):
            continue
        path = os.path.join(root, fn)
        rel = os.path.relpath(path, OUT)
        year = re.match(r"(\d{3})學年", rel).group(1)
        grade, cls = re.match(r"高(.)(.)班", fn).groups()
        ws = load_workbook(path).active
        rows = list(ws.iter_rows(values_only=True))
        hi = next(i for i, r in enumerate(rows) if r and r[0] == "學號")
        hdr = rows[hi]
        for r in rows[hi + 1:]:
            if not r or r[0] is None:
                continue
            for subj in SUBJECTS:
                v = r[hdr.index(subj)]
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    per_subj[subj].append(v)
            total_scores.append(r[hdr.index("總分")])
            conduct[r[hdr.index("操行")]] += 1
            by_class[(grade, cls)][year] = by_class[(grade, cls)].get(year, set())
            by_class[(grade, cls)][year].add(r[hdr.index("姓名")])

print("subject  n     mean    sd    min  max")
for s in SUBJECTS:
    v = per_subj[s]
    print(f"{s:<6} {len(v):<5} {st.mean(v):7.2f} {st.pstdev(v):6.2f}  {min(v):>3}  {max(v):>3}")
allv = [x for v in per_subj.values() for x in v]
print(f"ALL    {len(allv):<5} {st.mean(allv):7.2f} {st.pstdev(allv):6.2f}  {min(allv):>3}  {max(allv):>3}")
print("total-score mean/sd:", round(st.mean(total_scores), 1), round(st.pstdev(total_scores), 1))
print("操行 counts:", dict(conduct), "total", sum(conduct.values()))

print("\ncross-year name continuity (same homeroom label, different years):")
for key in sorted(by_class):
    d = by_class[key]
    yrs = sorted(d)
    overlap = []
    for a, b in zip(yrs, yrs[1:]):
        inter = d[a] & d[b]
        overlap.append(f"{a}->{b}: {len(inter)}/{len(d[a])} same students")
    print(f"  高{key[0]}{key[1]}班  sizes={[len(d[y]) for y in yrs]}  " + " | ".join(overlap))

# ability correlation: rank each student by total, then check subject means of top vs bottom
print("\nper-file sanity: top-5 vs bottom-5 by 總分 (mean per subject)")
path = os.path.join(OUT, "113學年", "上學期", "高三A班.xlsx")
ws = load_workbook(path).active
rows = list(ws.iter_rows(values_only=True))
hi = next(i for i, r in enumerate(rows) if r and r[0] == "學號")
hdr = rows[hi]
data = [r for r in rows[hi + 1:] if r and r[0] is not None]
data.sort(key=lambda r: -r[hdr.index("總分")])
for label, chunk in (("top5", data[:5]), ("bottom5", data[-5:])):
    means = {}
    for s in SUBJECTS:
        vals = [r[hdr.index(s)] for r in chunk
                if isinstance(r[hdr.index(s)], (int, float))]
        means[s] = round(st.mean(vals), 1) if vals else None
    print(f"  {label}: 總分 {[r[hdr.index('總分')] for r in chunk]}")
    print(f"         {means}")
