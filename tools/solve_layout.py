# -*- coding: utf-8 -*-
"""Produce a verified SLOT_GRID for the 54-file dataset.

Structure
---------
* The cohort in a grade is decided per academic year (one cohort teaches all
  three homerooms of a grade), and it keeps that grade's students next year:
      112 高一 -> c112 ; 113 高二 -> c112 ; 114 高三 -> c112
* A homeroom is (cohort, letter).  Its letter must stay the SAME in every grade
  it occupies (that is what makes 112高一A -> 113高二A the same students).
* Inside one (academic year, grade) the three letters A/B/C must all be present,
  because a grade has exactly three parallel classes.
* A homeroom is in exactly one grade per academic year.

Letter rule: letter(Y, G) = CLASS_KEYS[(G + Y) % 3] gives cell (Y, G) a
permutation of A/B/C; a homeroom's letter follows from the letters of the cells
it occupies (one per year), and this program verifies the result is consistent.
"""
from collections import defaultdict

YEARS = [112, 113, 114]
GRADES = [1, 2, 3]
CLASS_KEYS = ["A", "B", "C"]
GRADE_ZH = {1: "一", 2: "二", 3: "三"}

# which cohort runs a grade in a given academic year (progression D/E/F style)
COHORT_OF = {
    ("112", 1): "112", ("112", 2): "111", ("112", 3): "110",
    ("113", 1): "113", ("113", 2): "112", ("113", 3): "111",
    ("114", 1): "114", ("114", 2): "113", ("114", 3): "112",
}

problems = []
rows = []

# letters per (year, grade): a permutation of A/B/C
cell_letters = {}
for y in YEARS:
    for g in GRADES:
        rot = (g + int(y)) % 3
        cell_letters[(y, g)] = [CLASS_KEYS[(rot + i) % 3] for i in range(3)]

# assign each cohort the three letters of the cell it runs, so its homerooms are
# (cohort, letter) and the letter is stable as long as the cohort keeps the same
# rotation across the years it occupies a grade
homeroom_letter = defaultdict(dict)      # cohort -> grade -> [letters]
for (y, g), cohort in COHORT_OF.items():
    letters = cell_letters[(int(y), g)]
    if g in homeroom_letter[cohort]:
        if sorted(homeroom_letter[cohort][g]) != sorted(letters):
            problems.append(
                f"cohort {cohort} grade {g}: letters differ across years "
                f"{homeroom_letter[cohort][g]} vs {letters}")
    homeroom_letter[cohort][g] = letters

# build rows: (year:int, grade, cohort, letter)
for y in YEARS:
    for g in GRADES:
        cohort = COHORT_OF[(str(y), g)]
        for L in homeroom_letter[cohort][g]:
            rows.append((y, g, cohort, L))

# ---------------------------------------------------------------- verification
seen = set()
for (y, g, c, L) in rows:
    if (y, g, L) in seen:
        problems.append(f"{y} 高{g}{L}班 assigned twice")
    seen.add((y, g, L))
for y in YEARS:
    for g in GRADES:
        ls = sorted(L for (yy, gg, _c, L) in rows if yy == y and gg == g)
        if ls != CLASS_KEYS:
            problems.append(f"{y} 高{g}: letters {ls}")
        cs = {c for (yy, gg, c, _L) in rows if yy == y and gg == g}
        if len(cs) != 3:
            problems.append(f"{y} 高{g}: cohorts {cs}")
# a homeroom keeps one letter: (cohort, letter) must not appear in two grades of
# the same academic year, and must appear in at most one grade per year
homeroom_years = defaultdict(set)
for (y, g, c, L) in rows:
    if (y, g) in homeroom_years[(c, L)]:
        problems.append(f"homeroom {c}{L} twice in {y} 高{g}")
    homeroom_years[(c, L)].add((y, g))
# a homeroom's grade must rise by exactly 1 each year
for (c, L), pairs in homeroom_years.items():
    ordered = sorted((int(y), g) for (y, g) in pairs)
    if not all(b[0] - a[0] == 1 and b[1] - a[1] == 1
               for a, b in zip(ordered, ordered[1:])):
        problems.append(f"homeroom {c}{L}: grades {ordered}")

print(f"rows: {len(rows)} (expect 27)")
print("\nclasses per (year, grade):")
for y in YEARS:
    for g in GRADES:
        items = sorted((L, c) for (yy, gg, c, L) in rows if yy == y and gg == g)
        print(f"  {y}學年 高{GRADE_ZH[g]}: " +
              " ".join(f"高{GRADE_ZH[g]}{L}班=cohort{c}" for L, c in items))

print("\nhomeroom continuations:")
for (c, L), pairs in sorted(homeroom_years.items()):
    ordered = sorted((int(y), g) for (y, g) in pairs)
    chain = " -> ".join(f"{y}高{GRADE_ZH[g]}{L}" for y, g in ordered)
    print(f"  cohort {c} {L}班: {chain}")

print("\nproblems:", len(problems))
for p in problems:
    print("  !!", p)
if not problems:
    print("  none — grid verified")
    print("\nemitted SLOT_GRID:")
    for (y, g, c, L) in rows:
        print(f'    ("{y}", {g}, "{c}", "{L}"),')
