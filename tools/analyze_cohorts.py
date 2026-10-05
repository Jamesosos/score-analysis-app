# -*- coding: utf-8 -*-
"""Maximise "different students in the three parallel classes of a grade".

A grade needs 3 classes per academic year.  Three classes hold different student
groups only if three DIFFERENT cohorts sit in that grade that year.  A cohort is
an intake, so grade(cohort, year) = 1 + (year - cohort) and a cohort occupies
exactly one grade per year.

This searches every possible intake set + grade assignment and reports how many
of the 9 (year, grade) cells can have three distinct cohorts.
"""
import itertools
from collections import defaultdict

YEARS = [112, 113, 114]
GRADES = [1, 2, 3]


def grade_of(c, y):
    g = 1 + (y - c)
    return g if 1 <= g <= 3 else None


# every intake that can be in some grade during 112..114
CANDIDATES = list(range(108, 119))
print("candidate intakes:", CANDIDATES)
for c in CANDIDATES:
    gs = [f"{y}:{'一二三'[grade_of(c,y)-1]}" for y in YEARS if grade_of(c, y)]
    print(f"  intake {c}: " + " ".join(gs))

# For each (year, grade), which intakes can staff it?
avail = {(y, g): [c for c in CANDIDATES if grade_of(c, y) == g]
         for y in YEARS for g in GRADES}
print("\nintakes available per (year, grade):")
for (y, g), cs in sorted(avail.items()):
    print(f"  {y} 高{g}: {cs}")

# A grade needs 3 classes; if >= 3 intakes are available the classes can hold
# different students.  Check how many are available.
print("\ncells that can hold three different student groups:")
good = 0
for (y, g), cs in sorted(avail.items()):
    ok = len(cs) >= 3
    good += ok
    print(f"  {y} 高{g}: {len(cs)} intake(s) {cs}  {'OK' if ok else 'SAME STUDENTS'}")
print(f"\n{good}/9 cells can hold three different cohorts")

# A cohort may only be used once per year, so an intake set assigned to a year
# must have distinct grades.  Show one optimal arrangement.
print("\noptimal arrangement attempt (assign 3 intakes per grade, per year):")
assign = {}
for y in YEARS:
    used = set()
    for g in GRADES:
        pick = [c for c in avail[(y, g)] if c not in used][:3]
        # pad with repeated intakes if not enough (forced duplicates)
        while len(pick) < 3:
            extra = [c for c in CANDIDATES if grade_of(c, y) == g and c not in pick]
            pick.append(extra[0] if extra else pick[-1])
        assign[(y, g)] = pick
        used.update(pick)
    print(f"  {y}: " + " | ".join(f"高{g}<-{assign[(y,g)]}" for g in GRADES))
