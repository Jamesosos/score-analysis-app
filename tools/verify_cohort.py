# -*- coding: utf-8 -*-
"""Verify cross-year continuity for the 54-file layout.

Two things must hold:
1. A homeroom chain (intake, letter) keeps the SAME students as it rises a
   grade: 高一A(112) -> 高二A(113) -> 高三A(114) must have identical 學號/姓名.
2. Inside one (academic year, grade), the three classes A/B/C must hold three
   DIFFERENT student groups.
"""
import json
import os
import re
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

# Resolved from this file's location so the script works from any CWD.
BASE = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = BASE / "demo-data"


def intake_of(year, grade):
    """The intake that entered 高一 in `year - (grade-1)`: grade = 1 + (year - intake)."""
    return str(int(year) - (grade - 1))


problems = []
rosters = defaultdict(dict)          # (intake, letter) -> {(year, grade): entries}
by_cell = defaultdict(dict)          # (year, grade) -> letter -> entries
sizes_by_folder = defaultdict(dict)

with open(os.path.join(OUT, "manifest.json"), encoding="utf-8") as fh:
    listing = json.load(fh)["files"]

for rel in listing:
    year, sem, fname = rel.split("/")
    year_num = year.replace("學年", "")
    m = re.fullmatch(r"高(.)(.)班\.xlsx", fname)
    if not m:
        problems.append(f"unparsable filename {rel}")
        continue
    grade_zh, letter = m.groups()
    grade = "一二三".index(grade_zh) + 1
    ws = load_workbook(os.path.join(OUT, rel.replace("/", os.sep))).active
    rows = list(ws.iter_rows(values_only=True))
    hi = next((i for i, r in enumerate(rows) if r and r[0] == "學號"), None)
    if hi is None:
        problems.append(f"{rel}: no header row")
        continue
    # 7-digit 學號 = academic year (3) + homeroom letter (1) + seat number (3),
    # so the academic-year part necessarily changes each year.  Student identity
    # across years is therefore (seat number, 姓名).
    entries = {(int(str(r[0])[-3:]), r[1]) for r in rows[hi + 1:]
               if r and r[0] is not None}
    intake = intake_of(year_num, grade)
    sizes_by_folder[f"{year}/{sem}"][f"高{grade_zh}{letter}"] = len(entries)
    if sem == "上學期":
        rosters[(intake, letter)][(year_num, grade)] = entries
        by_cell[(year_num, grade)][letter] = entries
    else:
        first = by_cell.get((year_num, grade), {}).get(letter)
        if first is not None and first != entries:
            problems.append(f"{rel}: 下學期 roster differs from 上學期")

print("homeroom continuity (same students as the grade rises):")
kept_total = lost_total = 0
for (intake, letter) in sorted(rosters):
    d = rosters[(intake, letter)]
    yrs = sorted(d)
    for a, b in zip(yrs, yrs[1:]):
        same = d[a] & d[b]
        kept_total += len(same)
        lost_total += len(d[a]) - len(same)
        print(f"  intake {intake} {letter}班: {a[0]}高{a[1]} -> {b[0]}高{b[1]}  "
              f"{len(same)}/{len(d[a])} identical 學號+姓名")
print(f"\ntotal students carried forward: {kept_total}, dropped: {lost_total}")

print("\nthree classes inside one grade must hold different students:")
cells_ok = 0
for (year, grade) in sorted(by_cell):
    d = by_cell[(year, grade)]
    letters = sorted(d)
    overlaps = []
    for i in range(len(letters)):
        for j in range(i + 1, len(letters)):
            inter = d[letters[i]] & d[letters[j]]
            if inter:
                overlaps.append(f"{letters[i]}/{letters[j]}={len(inter)}")
    ok = len(letters) == 3 and not overlaps
    cells_ok += ok
    print(f"  {year}學年 高{'一二三'[grade-1]}: classes={letters} sizes="
          f"{[len(d[L]) for L in letters]} "
          f"{'OK (disjoint)' if ok else 'OVERLAP ' + ','.join(overlaps)}")
print(f"\n{cells_ok}/9 (year, grade) cells hold three disjoint student groups")

print("\nfiles per semester folder (classes per grade):")
for folder in sorted(sizes_by_folder):
    classes = sizes_by_folder[folder]
    grades = defaultdict(list)
    for name in classes:
        grades[name[1]].append(name)
    print(f"  {folder}: {len(classes)} files  " +
          " | ".join(f"高{g}: {len(v)}班" for g, v in sorted(grades.items())))

print("\nproblems:", len(problems))
for p in problems[:20]:
    print("  !!", p)
if not problems:
    print("  none")
