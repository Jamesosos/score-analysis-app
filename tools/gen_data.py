# -*- coding: utf-8 -*-
"""Generate demo Taiwanese junior-high/senior-high style grade Excel files.

One file == one class (homeroom).  3 academic years x 2 semesters x 6 classes = 36 files.
Deliberate edge cases for parser robustness testing.
"""
import json
import math
import os
import random
import tempfile
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# Paths are resolved from this file's location, so the script can be run from
# any working directory (and from a fresh clone anywhere on disk).
BASE = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = BASE / "demo-data"
# Scratch space for the created_files.txt log: in the OS temp dir, so it never
# lands inside the repository or in the user's home directory.
WRITE_WORK = Path(tempfile.gettempdir()) / "grade-data-work"
WRITE_WORK.mkdir(parents=True, exist_ok=True)

HEADERS = ["學號", "姓名", "中文科", "英文科", "數學科", "歷史科", "地理科",
           "物理科", "化學科", "生物科", "電腦科", "操行", "操行調整", "總分", "名次"]

# ---------------------------------------------------------------- name pool
SURNAMES = [
    "陳", "林", "黃", "張", "李", "王", "吳", "劉", "蔡", "楊",
    "許", "鄭", "謝", "洪", "邱", "曾", "廖", "賴", "徐", "周",
    "葉", "蘇", "莊", "江", "呂", "何", "蕭", "羅", "高", "潘",
    "簡", "朱", "鍾", "彭", "游", "詹", "胡", "施", "沈", "余",
    "盧", "梁", "宋", "方", "范", "鄧", "杜", "傅", "侯", "曹",
    "溫", "薛", "翁", "卓", "柯", "阮", "連", "歐", "藍", "龔",
]

MALE_GIVEN = [
    "志明", "家豪", "建宏", "俊傑", "宇軒", "宥廷", "承恩", "柏翰", "冠廷", "子睿",
    "威廷", "哲宇", "浩宇", "偉誠", "宗翰", "文彬", "國華", "信宏", "明毅", "世豪",
    "宗霖", "士豪", "孟哲", "逸凡", "定謙", "泓睿", "昱翔", "宸緯", "捷安", "弘翊",
    "泰宇", "劭齊", "昱豪", "健銘", "裕翔",
]

FEMALE_GIVEN = [
    "嘉欣", "婉婷", "雅涵", "怡君", "淑芬", "美玲", "郁婷", "詩涵", "雨柔", "佩珊",
    "佳穎", "書妍", "語彤", "芯羽", "芷涵", "思妤", "筱婷", "惠雯", "宛真", "采潔",
    "以恩", "昀蓁", "詠晴", "芮慈", "沛慈", "映潔", "若晴", "千瑜", "曼瑄", "子瑜",
    "佩妤", "詠婕", "羽婕", "妍希", "姿穎",
]

NEUTRAL_GIVEN = [
    "安琪", "宇恩", "定瑜", "宥均", "品妍", "宥蓁", "哲宇", "家瑋", "翊安", "晨希",
    "唯安", "品睿", "亮瑜", "昊恩", "彥廷", "思翰", "恬恬", "睿霖",
]

# extra given names so a full school (~450 distinct students) never repeats
MALE_GIVEN += [
    "建志", "振業", "宏斌", "立翔", "育誠", "尚恩", "東霖", "秉叡", "奕辰", "承翰",
    "定軒", "宣佑", "建佑", "思遠", "柏均", "柏睿", "致遠", "展毅", "書豪", "浩宸",
    "祐誠", "翔安", "詠翔", "進財", "瑞霖", "嘉倫", "維廷", "誌遠", "賢明", "毅安",
]

FEMALE_GIVEN += [
    "心妍", "以晴", "可晴", "巧芸", "玉婷", "伃庭", "妘臻", "宜蓁", "尚蓉", "怡瑄",
    "欣儀", "玥彤", "芸安", "姿妤", "宥晴", "思穎", "恬羽", "柔均", "家瑜", "書羽",
    "曼寧", "梓晴", "涵瑜", "翊慈", "凱莉", "喬安", "湘芸", "童安", "雅筑", "慈恩",
]

NEUTRAL_GIVEN += [
    "之妍", "予安", "元熙", "沐恩", "和謙", "承羲", "芯語", "宣儒", "映辰", "洛安",
    "恩慈", "書昀", "晨安", "晴安", "詠安", "雲安", "靖安", "頤安", "樂安", "蘊安",
]


def build_name_pool():
    """Deterministic, de-duplicated pool of Chinese names (need ~340)."""
    pool = []
    seen = set()
    for s in SURNAMES:
        for g in MALE_GIVEN + FEMALE_GIVEN + NEUTRAL_GIVEN:
            n = s + g
            if n not in seen:
                seen.add(n)
                pool.append(n)
    rnd = random.Random(20240101)
    rnd.shuffle(pool)
    return pool


NAME_POOL = build_name_pool()


class NameBag:
    """Hands out unique names, never repeating within the whole school."""

    def __init__(self, pool):
        self._pool = list(pool)
        self._i = 0

    def take(self):
        if self._i >= len(self._pool):
            raise RuntimeError("name pool exhausted")
        n = self._pool[self._i]
        self._i += 1
        return n


# --------------------------------------------------------------- score model
SUBJECTS = ["中文科", "英文科", "數學科", "歷史科", "地理科",
            "物理科", "化學科", "生物科", "電腦科"]

BASE_MEAN = {
    "中文科": 72.0, "英文科": 68.0, "數學科": 62.0, "歷史科": 70.0,
    "地理科": 69.0, "物理科": 64.0, "化學科": 66.0, "生物科": 69.0,
    "電腦科": 73.0,
}
BASE_SD = {
    "中文科": 13.0, "英文科": 14.5, "數學科": 16.0, "歷史科": 13.5,
    "地理科": 13.5, "物理科": 15.0, "化學科": 14.5, "生物科": 13.5,
    "電腦科": 13.0,
}
# ability weight vs. subject-specific aptitude weight
W_ABILITY = 11.0
W_APTITUDE = 7.0
W_NOISE = 6.0

# year/semester difficulty jitter (shared by all subjects in that paper)
PAPER_JITTER = {
    ("112", "上學期"): 0.8, ("112", "下學期"): -0.6,
    ("113", "上學期"): -0.4, ("113", "下學期"): 1.1,
    ("114", "上學期"): -1.3, ("114", "下學期"): 0.3,
}

CONDUCT_GRADES = ["A", "A", "A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "C", "D"]
CONDUCT_ADJ = [0.0, 0.0, 0.0, 0.0, 1.0, 1.5, 2.0, 2.5, -1.0, -1.5, -2.0, -2.5,
               0.5, -0.5, 3.0, -3.0]


def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, int(round(v))))


def draw_ability(rnd):
    """Std-normal-ish ability, lightly truncated to (-3.2, 3.2)."""
    for _ in range(20):
        v = rnd.gauss(0.0, 1.0)
        if -3.2 < v < 3.2:
            return round(v, 4)
    return 0.0


def make_student(rnd, cohort, sid_no, name_bag, letter="A"):
    """sid_no is the student's *permanent* seat number inside the class,
    so 學號 stays stable when classmates drop out or transfer in."""
    return {
        "cohort": cohort,
        "sid_no": sid_no,
        "letter": letter,
        "name": name_bag.take(),
        "ability": draw_ability(rnd),
        "apt": {s: round(rnd.gauss(0.0, 1.0), 4) for s in SUBJECTS},
        "transferred": False,
    }


def annual_update(rnd, st):
    """Between academic years: ability drifts a little, aptitude reshuffles a bit."""
    st["ability"] = round(st["ability"] + rnd.gauss(0.0, 0.22), 4)
    for s in SUBJECTS:
        st["apt"][s] = round(st["apt"][s] + rnd.gauss(0.0, 0.35), 4)


def subject_score(rnd, st, subj, year, sem):
    jitter = PAPER_JITTER[(year, sem)]
    ability = st["ability"]
    # mild ceiling/floor effect: very able students gain slightly less per point
    a = ability * W_ABILITY if ability < 0 else ability * W_ABILITY * 0.93
    v = BASE_MEAN[subj] + jitter + a + st["apt"][subj] * W_APTITUDE + rnd.gauss(0.0, W_NOISE)
    return clamp(v)


# ------------------------------------------------------------- cohort roster
YEARS = ["112", "113", "114"]
SEMESTERS = ["上學期", "下學期"]
CLASS_KEYS = ["A", "B", "C"]

# ============================================================================
# Layout  (3 academic years x 3 grades x 3 homerooms x 2 semesters = 54 files)
# ----------------------------------------------------------------------------
# Each (academic year, grade) is run by ONE intake (a "班群"), which is split
# into its three parallel homerooms A/B/C:
#   112學年 高一 = intake 112 -> 高一A + 高一B + 高一C
#   112學年 高二 = intake 111 -> 高二A + 高二B + 高二C
#   112學年 高三 = intake 110 -> 高三A + 高三B + 高三C   (and so on for 113/114)
# An intake is identified by the academic year it entered 高一, so
#   grade(intake, year) = 1 + (year - intake)  in 1..3.
#
# CONTINUITY MODEL — one homeroom letter = one class of students, kept for the
# whole 3-year run (the user's "同一批學生逐年升級" case):
#   高一A(112) -> 高二A(113) -> 高三A(114)      same 學號, same 姓名
#   高一B(112) -> 高二B(113) -> 高三B(114)
#   高一C(112) -> 高二C(113) -> 高三C(114)
# Intakes 111 and 110 (which are already 高二 / 高三 in 112學年) are continued
# the same way:
#   高二A/B/C(112) -> 高三A/B/C(113)            same students
#   高三A/B/C(112)                              graduating year
#
# The freshly entering intakes of 113 and 114 give the next generation:
#   高一A/B/C(113) -> 高二A/B/C(114)
#   高一A/B/C(114)
# ============================================================================
SLOT_GRID = [
    # 112學年
    ("112", 1, "112", "A"), ("112", 1, "112", "B"), ("112", 1, "112", "C"),
    ("112", 2, "111", "A"), ("112", 2, "111", "B"), ("112", 2, "111", "C"),
    ("112", 3, "110", "A"), ("112", 3, "110", "B"), ("112", 3, "110", "C"),
    # 113學年
    ("113", 1, "113", "A"), ("113", 1, "113", "B"), ("113", 1, "113", "C"),
    ("113", 2, "112", "A"), ("113", 2, "112", "B"), ("113", 2, "112", "C"),
    ("113", 3, "111", "A"), ("113", 3, "111", "B"), ("113", 3, "111", "C"),
    # 114學年
    ("114", 1, "114", "A"), ("114", 1, "114", "B"), ("114", 1, "114", "C"),
    ("114", 2, "113", "A"), ("114", 2, "113", "B"), ("114", 2, "113", "C"),
    ("114", 3, "112", "A"), ("114", 3, "112", "B"), ("114", 3, "112", "C"),
]

# sanity checks
_seen_slot = set()
_cell_letters = {}
for (y, g, c, k) in SLOT_GRID:
    assert g == 1 + (int(y) - int(c)), f"{y}學年 intake {c} cannot be in grade {g}"
    assert (y, g, k) not in _seen_slot, f"duplicate class {y}學年 高{g}{k}班"
    _seen_slot.add((y, g, k))
    _cell_letters.setdefault((y, g), set()).add(k)
assert all(v == set(CLASS_KEYS) for v in _cell_letters.values()), \
    {k: sorted(v) for k, v in _cell_letters.items() if v != set(CLASS_KEYS)}
# each homeroom (intake, letter) must rise exactly one grade per academic year
_homerooms = {}
for (y, g, c, k) in SLOT_GRID:
    _homerooms.setdefault((c, k), []).append((int(y), g))
for (c, k), pairs in _homerooms.items():
    ordered = sorted(pairs)
    assert all(b[0] - a[0] == 1 and b[1] - a[1] == 1
               for a, b in zip(ordered, ordered[1:])), \
        f"homeroom {c}{k} grades do not rise by 1: {ordered}"

# intake families (used for continuity checks)
COHORT_ANCHORS = sorted({c for (_y, _g, c, _k) in SLOT_GRID}, key=int)


def slots_for_year(year):
    """[(grade, cohort, class_key)] for one academic year (9 entries)."""
    return sorted((g, c, k) for (y, g, c, k) in SLOT_GRID if y == year)


def cohort_start_grade(cohort):
    """Grade the cohort is in during the first academic year of this dataset."""
    return 1 + (112 - int(cohort))


def cohort_grade(cohort, year):
    """Grade (1-3) the cohort is in for that academic year, else None."""
    g = 1 + (int(year) - int(cohort))
    return g if 1 <= g <= 3 else None


def slots_for_year(year):
    """[(grade, cohort, class_key)] for one academic year (always 6 entries)."""
    return sorted((g, c, k) for (y, g, c, k) in SLOT_GRID if y == year)


def slot_id(year, grade, class_key):
    """Stable identifier for a class file, used to key per-file plans."""
    return (year, grade, class_key)


def slot_key(cohort, class_key, year):
    """Roster identity for one homeroom in one academic year.

    A homeroom is (intake, letter) and is keyed per academic year, so the same
    intake+letter in the next year is the SAME students one grade higher:
        112高一A -> 113高二A -> 114高三A
    """
    return (cohort, class_key, year)


def build_rosters(rnd, name_bag):
    """rosters[slot_key] -> student list, built academic year by academic year."""
    rosters = {}

    def advance(src, cohort_label, letter):
        dst = []
        for st in src:
            annual_update(rnd, st)
            dst.append(st)
        if len(dst) > 28 and rnd.random() < 0.40:
            dst.pop(rnd.randrange(len(dst)))                # 轉學 / 休學
        if len(dst) < 36 and rnd.random() < 0.30:
            next_no = max(s["sid_no"] for s in dst) + 1
            st = make_student(rnd, cohort_label, next_no, name_bag, letter)
            st["transferred"] = True
            st["ability"] = round(rnd.gauss(-0.12, 0.85), 4)
            dst.append(st)                                  # 轉學生
        return dst

    for year in YEARS:
        prev_year = str(int(year) - 1)
        for (y, grade, cohort, class_key) in SLOT_GRID:
            if y != year:
                continue
            key = slot_key(cohort, class_key, year)
            if key in rosters:
                continue
            # the same intake + letter one grade lower last academic year is the
            # same homeroom, so its students carry forward
            prev = None
            if grade > 1:
                prev = rosters.get(slot_key(cohort, class_key, prev_year))
            if prev is not None:
                rosters[key] = advance(prev, cohort, class_key)
            else:
                rosters[key] = [make_student(rnd, cohort, i + 1, name_bag, class_key)
                                for i in range(rnd.randint(28, 36))]
    return rosters


# ---------------------------------------------------------- edge case planner
def plan_edge_cases(rnd):
    """Per-file plan: which (row index, subject index) get blank / 缺考 / 0.

    Row indices are capped at 36, the largest possible class size, and any
    index beyond a given file's real size is simply dropped at write time.
    """
    out = {}
    for year in YEARS:
        for sem in SEMESTERS:
            for (grade, cohort, class_key) in slots_for_year(year):
                key = slot_id(year, grade, class_key)
                plan = {"blank": [], "absent": [], "zero": []}
                rows = rnd.sample(range(36), 6)
                subs = rnd.sample(range(9), 6)
                plan["blank"] = [(rows[0], subs[0]), (rows[1], subs[1])]
                plan["absent"] = [(rows[2], subs[2])]
                plan["zero"] = [(rows[3], subs[3])]
                if rnd.random() < 0.35:
                    plan["blank"].append((rows[4], subs[4]))
                if rnd.random() < 0.25:
                    plan["absent"].append((rows[5], subs[5]))
                out[key] = plan
    return out


def main():
    rnd = random.Random(20250421)
    name_bag = NameBag(NAME_POOL)
    rosters = build_rosters(rnd, name_bag)
    edge = plan_edge_cases(rnd)

    # exactly 3 files with a merged banner on row 1 → header moves to row 2
    # (these are the only files where the real header row is row 2)
    MERGED_TITLE_FILES = {
        ("112", "上學期", 1, "C"),   # 112學年/上學期/高一C班.xlsx
        ("113", "下學期", 2, "C"),   # 113學年/下學期/高二C班.xlsx
        ("114", "上學期", 3, "C"),   # 114學年/上學期/高三C班.xlsx
    }
    created = []
    summary = []
    keep = set()

    for year in YEARS:
        for sem in SEMESTERS:
            folder = os.path.join(OUT, f"{year}學年", sem)
            os.makedirs(folder, exist_ok=True)
            for (grade, cohort, class_key) in slots_for_year(year):
                grade_zh = "一二三"[grade - 1]
                roster = rosters[slot_key(cohort, class_key, year)]
                fname = f"高{grade_zh}{class_key}班.xlsx"
                path = os.path.join(folder, fname)
                info = write_file(
                    path=path, rnd=rnd, roster=roster, year=year, sem=sem,
                    grade=grade, class_key=class_key,
                    plan=edge[slot_id(year, grade, class_key)],
                    fancy=(rnd.random() < 0.5),
                    banner=((year, sem, grade, class_key) in MERGED_TITLE_FILES),
                )
                created.append(path)
                keep.add(os.path.normcase(os.path.abspath(path)))
                summary.append(info)

    # prune stale files from earlier runs (e.g. other layouts) so the tree is exact
    removed = []
    for root, _dirs, files in os.walk(OUT):
        for fn in files:
            full = os.path.normcase(os.path.abspath(os.path.join(root, fn)))
            if fn.lower() == "manifest.json":
                continue                      # regenerated below from disk
            if not fn.lower().endswith(".xlsx") or full not in keep:
                removed.append(os.path.join(root, fn))
    for p in removed:
        os.remove(p)

    # ---- manifest.json built from the files that are ACTUALLY on disk, so the
    # list can never drift from reality.  Sorted for stable diffs.
    on_disk = []
    for root, _dirs, files in os.walk(OUT):
        for fn in sorted(files):
            if fn.lower().endswith(".xlsx"):
                rel = os.path.relpath(os.path.join(root, fn), OUT)
                on_disk.append(rel.replace(os.sep, "/"))
    on_disk.sort()
    manifest_path = os.path.join(OUT, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump({"files": on_disk}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"CREATED {len(created)} files   (pruned {len(removed)} stale)")
    for s in summary:
        print("  {:<52} size={:>2} banner={} fancy={}".format(
            s["rel"], s["size"], s["banner"], s["fancy"]))
    with open(os.path.join(WRITE_WORK, "created_files.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(created))
    print(f"\nmanifest.json written with {len(on_disk)} paths")
    print("\nBANNER FILES (header row is row 2):")
    for (y, s, g, k) in sorted(MERGED_TITLE_FILES):
        print(f"  {y}學年/{s}/高{'一二三'[g-1]}{k}班.xlsx")


def write_file(path, rnd, roster, year, sem, grade, class_key, plan,
               fancy, banner):
    size = len(roster)

    blank_map = {}
    absent_map = {}
    zero_map = {}
    for (ri, si) in plan["blank"]:
        if ri < size:
            blank_map.setdefault(ri, set()).add(si)
    for (ri, si) in plan["absent"]:
        if ri < size:
            absent_map.setdefault(ri, set()).add(si)
    for (ri, si) in plan["zero"]:
        if ri < size:
            zero_map.setdefault(ri, set()).add(si)
    # A "缺考" row would double up with the previous academic year's blank cell
    # for the same student, so blank and 缺考 always land on disjoint rows.
    # de-conflict: a cell can be only one anomaly
    for ri in list(absent_map):
        absent_map[ri] -= blank_map.get(ri, set())
        absent_map[ri] -= zero_map.get(ri, set())
        if not absent_map[ri]:
            del absent_map[ri]
    for ri in list(zero_map):
        zero_map[ri] -= blank_map.get(ri, set())
        if not zero_map[ri]:
            del zero_map[ri]
    if len(blank_map) < 2:
        for ri in range(size):
            if ri not in blank_map:
                blank_map[ri] = {rnd.randrange(9)}
                if len(blank_map) >= 2:
                    break
    if not absent_map:
        for ri in range(size):
            if ri not in blank_map:
                absent_map[ri] = {rnd.randrange(9)}
                break
    if not zero_map:
        for ri in range(size):
            if ri not in blank_map and ri not in absent_map:
                zero_map[ri] = {rnd.randrange(9)}
                break

    # ---- generate rows
    rows = []
    for idx, st in enumerate(roster):
        # 7-digit 學號: academic year (3) + homeroom letter (1) + seat number (3).
        # The letter comes from the student's cohort, so it stays the same as the
        # student moves from 高一A班 to 高二A班 to 高三A班.
        sid = int(f"{year}{class_key_int(st.get('letter', class_key))}"
                  f"{st['sid_no']:03d}")
        row = {"學號": sid, "姓名": st["name"]}
        scores = {}
        for si, subj in enumerate(SUBJECTS):
            if idx in blank_map and si in blank_map[idx]:
                row[subj] = None                     # 缺考：空白儲存格
                scores[subj] = 0
            elif idx in absent_map and si in absent_map[idx]:
                row[subj] = "缺考"                    # 缺考：文字
                scores[subj] = 0
            elif idx in zero_map and si in zero_map[idx]:
                row[subj] = 0                        # 真的考 0 分
                scores[subj] = 0
            else:
                v = subject_score(rnd, st, subj, year, sem)
                row[subj] = v
                scores[subj] = v
        # 操行: A most common, D very rare, but all four grades must appear
        r = rnd.random()
        if r < 0.030:
            row["操行"] = "D"
        elif r < 0.150:
            row["操行"] = "C"
        elif r < 0.450:
            row["操行"] = "B"
        else:
            row["操行"] = "A"
        row["操行調整"] = round(rnd.choice(CONDUCT_ADJ) + rnd.choice([0.0, 0.5, -0.5]), 1)
        row["總分"] = sum(scores[s] for s in SUBJECTS)
        rows.append(row)

    # ---- ranking: total desc, standard competition ranking
    totals = sorted((r["總分"] for r in rows), reverse=True)
    rank_of = {}
    for i, t in enumerate(totals):
        if t not in rank_of:
            rank_of[t] = i + 1
    for r in rows:
        r["名次"] = rank_of[r["總分"]]

    # ---- build workbook
    wb = Workbook()
    ws = wb.active
    ws.title = f"高{'一二三'[grade - 1]}{class_key}班"
    header_row = 1
    if banner:
        ws.merge_cells("A1:O1")
        c = ws.cell(row=1, column=1,
                    value=f"{year}學年 {sem} 高{'一二三'[grade-1]}{class_key}班 成績表")
        c.font = Font(name="Microsoft JhengHei", size=16, bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.fill = PatternFill("solid", fgColor="4F46E5")
        ws.row_dimensions[1].height = 34
        header_row = 2

    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for col, h in enumerate(HEADERS, start=1):
        c = ws.cell(row=header_row, column=col, value=h)
        c.font = Font(name="Microsoft JhengHei", size=11, bold=True)
        c.alignment = Alignment(horizontal="center", vertical="center")
        if fancy or banner:
            c.fill = PatternFill("solid", fgColor="E0E7FF")
            c.border = border

    for i, r in enumerate(rows):
        rr = header_row + 1 + i
        for col, h in enumerate(HEADERS, start=1):
            c = ws.cell(row=rr, column=col, value=r[h])
            c.font = Font(name="Microsoft JhengHei", size=11)
            if fancy or banner:
                c.border = border
            if h == "姓名":
                c.alignment = Alignment(horizontal="center")
            elif h == "學號":
                c.alignment = Alignment(horizontal="center")
                c.number_format = "0"
            elif h == "操行":
                c.alignment = Alignment(horizontal="center")
            elif h == "操行調整":
                c.number_format = "0.0"
                c.alignment = Alignment(horizontal="center")
            else:
                c.alignment = Alignment(horizontal="center")
        if fancy:
            ws.row_dimensions[rr].height = 18

    if fancy or banner:
        widths = [10, 10, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 10, 8, 7]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = ws.cell(row=header_row + 1, column=3)

    wb.save(path)
    return {"rel": os.path.relpath(path, OUT), "size": size,
            "banner": banner, "fancy": fancy}


def class_key_int(k):
    return {"A": 1, "B": 2, "C": 3}[k]


if __name__ == "__main__":
    main()
