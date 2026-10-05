# -*- coding: utf-8 -*-
"""Check that the 學號 encodes the right academic year and homeroom letter.

學號 is 7 digits: <academic year:3><homeroom letter:1 = A=1,B=2,C=3><seat:3>.
"""
import json
import os
import re
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook

# Resolved from this file's location so the script works from any CWD.
BASE = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = BASE / "demo-data"
LETTER_DIGIT = {"A": "1", "B": "2", "C": "3"}
problems = []
seen_per_year = {}
banner = []

with open(os.path.join(OUT, "manifest.json"), encoding="utf-8") as fh:
    listing = json.load(fh)["files"]

for rel in listing:
    year, sem, fname = rel.split("/")
    year_num = year.replace("學年", "")
    grade_zh, letter = re.fullmatch(r"高(.)(.)班\.xlsx", fname).groups()
    ws = load_workbook(os.path.join(OUT, rel.replace("/", os.sep))).active
    if ws.merged_cells.ranges:
        banner.append(rel)
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "學號")
    for r in rows[hi + 1:]:
        if not r or r[0] is None:
            continue
        sid = str(r[0])
        if len(sid) != 7:
            problems.append(f"{rel}: 學號 {sid} not 7 digits")
            continue
        if sid[:3] != year_num:
            problems.append(f"{rel}: 學號 {sid} year part != {year_num}")
        if sid[3] != LETTER_DIGIT[letter]:
            problems.append(f"{rel}: 學號 {sid} letter digit != {letter}")
        seen_per_year.setdefault(year_num, set()).add(sid)

print("學號 prefix / letter digit checks done")
for y in sorted(seen_per_year):
    print(f"  {y}學年: {len(seen_per_year[y])} distinct 學號 "
          f"(unique within the academic year: "
          f"{len(seen_per_year[y]) == len({s for yy in [y] for s in seen_per_year[yy]})})")

# duplicates inside one academic year
for y in sorted(seen_per_year):
    dupes = [s for s, c in Counter(seen_per_year[y]).items() if c > 1]
    if dupes:
        problems.append(f"{y}學年 duplicate 學號: {dupes[:5]}")

print(f"\nbanner files ({len(banner)}):")
for b in banner:
    print("  " + b)

print("\nproblems:", len(problems))
for p in problems[:20]:
    print("  !!", p)
if not problems:
    print("  none — 學號 encoding verified")
