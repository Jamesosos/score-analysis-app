# -*- coding: utf-8 -*-
"""Read the icons back with Pillow and verify size, mode and transparency."""
import os
from pathlib import Path

from PIL import Image

# Resolved from this file's location so the script works from any CWD.
BASE = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = BASE / "icons"
problems = []

print(f"{'file':<22}{'mode':<6}{'size':<12}{'bytes':>8}   alpha corner/TL  center-colour")
for name, expect in (("icon-192.png", (192, 192)),
                     ("icon-512.png", (512, 512)),
                     ("apple-touch-icon.png", (180, 180))):
    path = os.path.join(OUT, name)
    if not os.path.exists(path):
        problems.append(f"{name} MISSING")
        continue
    with Image.open(path) as im:
        im.load()
        mode, size = im.mode, im.size
        rgba = im.convert("RGBA")
        px = rgba.load()
        w, h = size
        # corners must be fully transparent (rounded square)
        corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
        tl = px[0, 0]
        # centre of the icon should be an opaque bar (white) or gradient
        centre = px[w // 2, h // 2]
        # a point just inside the left edge, halfway down: gradient, opaque
        edge = px[max(1, int(w * 0.06)), h // 2]
        alpha_ok = all(c[3] == 0 for c in corners)
        opaque_ok = all(rgba.getpixel(p)[3] == 255
                        for p in ((w // 2, h // 2), (w // 2, h - 4)))
        if size != expect:
            problems.append(f"{name}: size {size} != {expect}")
        if mode != "RGBA":
            problems.append(f"{name}: mode {mode} != RGBA")
        if not alpha_ok:
            problems.append(f"{name}: corners not transparent: {corners}")
        if not opaque_ok:
            problems.append(f"{name}: expected opaque pixels are translucent")
        # count fully transparent pixels (should be a modest rounded-corner area)
        small = rgba.resize((64, 64), Image.NEAREST)
        clear = sum(1 for p in list(small.getdata()) if p[3] == 0)
        bytes_ = os.path.getsize(path)
        print(f"{name:<22}{mode:<6}{str(size):<12}{bytes_:>8}   "
              f"{'transparent' if alpha_ok else 'OPAQUE!':<16} "
              f"centre={centre} edge={edge} clear64={clear}")

# sanity: the gradient really runs from #4f46e5-ish to #0ea5e9-ish
with Image.open(os.path.join(OUT, "icon-512.png")) as im:
    g = im.convert("RGBA")
    tl = g.getpixel((int(512 * 0.12), int(512 * 0.06)))
    br = g.getpixel((int(512 * 0.88), int(512 * 0.94)))
    print(f"\ngradient top-left sample {tl[:3]}  (target #4f46e5 = (79,70,229))")
    print(f"gradient bottom-right sample {br[:3]}  (target #0ea5e9 = (14,165,233))")

print("\nproblems:", len(problems))
for p in problems:
    print("  !!", p)
if not problems:
    print("  none — icons verified")
