# -*- coding: utf-8 -*-
"""Independently re-open every generated workbook and validate its contents."""
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook

# Resolved from this file's location so the script works from any CWD.
BASE = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = BASE / "demo-data"
EXPECTED = ["學號", "姓名", "中文科", "英文科", "數學科", "歷史科", "地理科",
            "物理科", "化學科", "生物科", "電腦科", "操行", "操行調整", "總分", "名次"]
SUBJECTS = EXPECTED[2:11]

problems = []
stats = defaultdict(list)
banner_files = []
all_names_by_year = defaultdict(set)
name_owner = {}
pool_check = Counter()


def add_problem(path, msg):
    problems.append(f"{os.path.relpath(path, OUT)}: {msg}")


files = []
for root, _dirs, fns in os.walk(OUT):
    for fn in sorted(fns):
        if fn.lower().endswith(".xlsx"):
            files.append(os.path.join(root, fn))
files.sort()

print(f"found {len(files)} xlsx files")
if len(files) != 54:
    add_problem(OUT, f"expected 54 files, found {len(files)}")

# ---------------------------------------------------------------- structural
folders = sorted({os.path.dirname(os.path.relpath(p, OUT)) for p in files})
print(f"folders: {len(folders)}")
if len(folders) != 6:
    add_problem(OUT, f"expected 6 folders, found {len(folders)}")
for f in folders:
    n = sum(1 for p in files if os.path.dirname(os.path.relpath(p, OUT)) == f)
    if n != 9:
        add_problem(f, f"expected 9 files in this folder, found {n}")

# ------------------------------------------------------------------ manifest
import json
manifest_path = os.path.join(OUT, "manifest.json")
if not os.path.exists(manifest_path):
    add_problem(OUT, "manifest.json missing")
else:
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh).get("files", [])
    on_disk = sorted(os.path.relpath(p, OUT).replace(os.sep, "/") for p in files)
    if manifest != on_disk:
        missing = sorted(set(on_disk) - set(manifest))
        extra = sorted(set(manifest) - set(on_disk))
        add_problem(OUT, f"manifest mismatch missing={missing[:5]} extra={extra[:5]}")
    else:
        print(f"manifest.json matches all {len(manifest)} files on disk")
    for entry in manifest:
        if not os.path.exists(os.path.join(OUT, entry.replace("/", os.sep))):
            add_problem(OUT, f"manifest entry does not exist: {entry}")

per_file = {}
for path in files:
    rel = os.path.relpath(path, OUT)
    wb = load_workbook(path)          # values only, default
    wb_formula = None
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    # ---- find the header row
    header_row_idx = None
    for i, r in enumerate(rows):
        if r and r[0] == "學號":
            header_row_idx = i
            break
    if header_row_idx is None:
        add_problem(path, "no row starting with 學號 found")
        continue
    header = [c for c in rows[header_row_idx] if c is not None]
    if header != EXPECTED:
        add_problem(path, f"header mismatch: {header}")

    # ---- merged banner?
    if ws.merged_cells.ranges:
        rng = str(list(ws.merged_cells.ranges)[0])
        banner_files.append((rel, header_row_idx + 1, rng,
                             rows[0][0] if rows else None))
        if header_row_idx != 1:
            add_problem(path, f"merged banner but header row is {header_row_idx+1}")
    else:
        if header_row_idx != 0:
            add_problem(path, f"no banner but header row is {header_row_idx+1}")

    data = [r for r in rows[header_row_idx + 1:] if r and r[0] is not None]
    n = len(data)
    if not (28 <= n <= 36):
        add_problem(path, f"class size {n} outside 28..36")
    stats["size"].append(n)

    seen_ids, seen_names = set(), set()
    totals, ranks = [], []
    blank_cells = absent_cells = zero_cells = 0
    conduct_chars = Counter()
    bad_adj = 0
    tid = re.match(r"(\d{3})學年", rel)
    year = tid.group(1) if tid else "?"

    for ri, row in enumerate(data, start=header_row_idx + 2):
        sid, name = row[0], row[1]
        scores = row[2:11]
        conduct, adj, total, rank = row[11], row[12], row[13], row[14]

        # 學號
        if not isinstance(sid, int):
            add_problem(path, f"row {ri}: 學號 not an int: {sid!r}")
        elif not (1000000 <= sid <= 9999999):
            add_problem(path, f"row {ri}: 學號 not 7 digits: {sid}")
        if sid in seen_ids:
            add_problem(path, f"row {ri}: duplicate 學號 {sid}")
        seen_ids.add(sid)

        # 姓名
        if not isinstance(name, str) or not (2 <= len(name) <= 4):
            add_problem(path, f"row {ri}: bad 姓名 {name!r}")
        if not re.fullmatch(r"[\u4e00-\u9fff]+", str(name)):
            add_problem(path, f"row {ri}: 姓名 not all Chinese: {name!r}")
        if name in seen_names:
            add_problem(path, f"row {ri}: duplicate 姓名 in class {name}")
        seen_names.add(name)
        all_names_by_year[year].add(name)
        pool_check[name] += 1
        if name in name_owner and name_owner[name] != sid:
            pass          # same student expected across years
        name_owner.setdefault(name, sid)

        # subjects
        computed = 0
        for gi, v in zip(range(9), scores):
            subj = SUBJECTS[gi]
            if v is None:
                blank_cells += 1
            elif isinstance(v, str):
                if v == "缺考":
                    absent_cells += 1
                else:
                    add_problem(path, f"row {ri} {subj}: unexpected text {v!r}")
            elif isinstance(v, bool):
                add_problem(path, f"row {ri} {subj}: bool value")
            elif isinstance(v, (int, float)):
                if isinstance(v, float) and not v.is_integer():
                    add_problem(path, f"row {ri} {subj}: fractional score {v}")
                if not (0 <= v <= 100):
                    add_problem(path, f"row {ri} {subj}: out of range {v}")
                computed += int(v)
                if v == 0:
                    zero_cells += 1
            else:
                add_problem(path, f"row {ri} {subj}: bad type {type(v)}")

        if computed != total:
            add_problem(path, f"row {ri}: 總分 {total} != sum {computed}")
        totals.append(total)

        if conduct not in ("A", "B", "C", "D"):
            add_problem(path, f"row {ri}: 操行 {conduct!r} not A-D")
        conduct_chars[conduct] += 1

        if not isinstance(adj, (int, float)) or isinstance(adj, bool):
            add_problem(path, f"row {ri}: 操行調整 not numeric: {adj!r}")
            bad_adj += 1

        ranks.append(rank)

    # ranking: standard competition ranking on 總分 desc
    expect_rank = {}
    for i, t in enumerate(sorted(totals, reverse=True)):
        expect_rank.setdefault(t, i + 1)
    for (row, t, rk) in zip(data, totals, ranks):
        if expect_rank[t] != rk:
            add_problem(path, f"row {row[0]}: 名次 {rk} != expected {expect_rank[t]}")
            break

    stats["blank"].append(blank_cells)
    stats["absent"].append(absent_cells)
    stats["zero"].append(zero_cells)
    stats["conduct"].append(dict(conduct_chars))

    if blank_cells < 2:
        add_problem(path, f"only {blank_cells} blank score cells (need >=2)")
    if absent_cells < 1:
        add_problem(path, f"no 缺考 text cell")
    if zero_cells < 1:
        add_problem(path, f"no score 0 cell")

    per_file[rel] = {"size": n, "header_row": header_row_idx + 1,
                     "rows": data, "sheet": ws.title}

# --------------------------------------------------------- cross-year checks
# same cohort family keeps the same names/IDs across years
samples = defaultdict(dict)
for rel, info in per_file.items():
    m = re.match(r"(\d{3})學年[\\/](上學期|下學期)[\\/]高(.)(.)班", rel)
    if not m:
        add_problem(rel, "filename/folder pattern not recognised")
        continue
    year, sem, grade, cls = m.groups()
    # the homeroom label's owner cohort differs per year by design; check that
    # student names persist year over year for at least one class label
    samples[(grade, cls)][year] = {(r[0], r[1]) for r in info["rows"]}

# duplicates across the whole school
dupes = [n for n, c in pool_check.items() if c > 1]
print(f"\ndistinct names: {len(pool_check)}   names used more than once: {len(dupes)}")
print(f"names reused across years (expected, same students): {len(dupes)}")
for year in sorted(all_names_by_year):
    print(f"  {year}學年 distinct students: {len(all_names_by_year[year])}")

print("\nsizes:", sorted(stats["size"]))
print("blank cells per file min/avg/max:",
      min(stats["blank"]), round(sum(stats["blank"]) / len(stats["blank"]), 2), max(stats["blank"]))
print("缺考 cells per file min/avg/max:",
      min(stats["absent"]), round(sum(stats["absent"]) / len(stats["absent"]), 2), max(stats["absent"]))
print("zero-score cells per file min/avg/max:",
      min(stats["zero"]), round(sum(stats["zero"]) / len(stats["zero"]), 2), max(stats["zero"]))

agg = Counter()
for d in stats["conduct"]:
    agg.update(d)
print("操行 distribution:", dict(agg))

print("\nfiles with a merged banner on row 1 (%d):" % len(banner_files))
for (rel, hrow, rng, title) in banner_files:
    print(f"  {rel}  header_row={hrow}  merged={rng}  title={title!r}")

# header row distribution
hr = Counter(i["header_row"] for i in per_file.values())
print("\nheader row distribution:", dict(hr))

# per-year/per-folder listing
print("\n--- tree ---")
for folder in folders:
    print(folder)
    for rel, info in sorted(per_file.items()):
        if os.path.dirname(rel) == folder:
            print(f"    {os.path.basename(rel):<12} students={info['size']:<3} "
                  f"header_row={info['header_row']} sheet={info['sheet']}")

# ------------------------------------------------------------- preview print
preview_rel = os.path.join("113學年", "上學期", "高一A班.xlsx")
if preview_rel not in per_file:
    # fall back to any file
    preview_rel = sorted(per_file)[0]
info = per_file[preview_rel]
print(f"\n--- preview: {preview_rel} (header row {info['header_row']}) ---")
wb = load_workbook(os.path.join(OUT, preview_rel))
ws = wb.active
for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
    if i <= info["header_row"] + 3:
        print(f"  row{i}: {row}")

print("\n=== PROBLEMS: %d ===" % len(problems))
for p in problems[:80]:
    print("  !!", p)
if not problems:
    print("  none — all checks passed")
sys.exit(1 if problems else 0)
