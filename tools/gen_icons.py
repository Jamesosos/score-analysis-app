# -*- coding: utf-8 -*-
"""Generate the PWA icons with Pillow.

Design: rounded square with a dark blue-purple -> sky-blue diagonal gradient,
three white rounded bars of increasing height, and a small white check mark.
Drawn at 4x and downsampled for antialiasing; outside the rounded square is
fully transparent (RGBA).
"""
import os
from pathlib import Path

from PIL import Image, ImageDraw

# Paths are resolved from this file's location, so the script can be run from
# any working directory (and from a fresh clone anywhere on disk).
ROOT = Path(__file__).resolve().parent.parent      # -> grade-app/
OUT = ROOT / "icons"
SS = 4                      # supersampling factor
CANVAS = 512                # design canvas size in pixels (square)

TOP_LEFT = (0x4F, 0x46, 0xE5)      # #4f46e5
BOT_RIGHT = (0x0E, 0xA5, 0xE9)     # #0ea5e9
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def gradient(size):
    """Diagonal (top-left -> bottom-right) two-colour gradient."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    denom = 2.0 * (size - 1) if size > 1 else 1.0
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = (lerp(TOP_LEFT[0], BOT_RIGHT[0], t),
                        lerp(TOP_LEFT[1], BOT_RIGHT[1], t),
                        lerp(TOP_LEFT[2], BOT_RIGHT[2], t))
    return img


def draw_icon(size):
    """Render one icon at `size` x `size` pixels (already antialiased)."""
    S = size * SS
    canvas = gradient(S).convert("RGBA")

    # --- rounded-square mask (transparent outside the corners)
    radius = int(round(S * 0.22))              # iOS-ish squircle radius
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1],
                                           radius=radius, fill=255)
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(canvas, (0, 0), mask)

    d = ImageDraw.Draw(icon)

    # --- bar chart: three rounded bars, heights increasing left -> right
    left = S * 0.215
    right = S * 0.735
    bottom = S * 0.775
    bar_w = (right - left) / 3.66
    gap = (right - left - 3 * bar_w) / 2.0
    tops = [S * 0.420, S * 0.295, S * 0.165]     # increasing heights
    r = bar_w * 0.42
    for i, top in enumerate(tops):
        x0 = left + i * (bar_w + gap)
        d.rounded_rectangle([x0, top, x0 + bar_w, bottom],
                            radius=r, fill=WHITE)

    # --- small check mark in the lower-right, clear of the bars
    ck = [(S * 0.740, S * 0.856), (S * 0.812, S * 0.932), (S * 0.940, S * 0.782)]
    lw = S * 0.058
    d.line(ck, fill=WHITE, width=int(round(lw)), joint="curve")
    for (x, y) in ck:                            # round every vertex
        d.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=WHITE)

    return icon.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [("icon-192.png", 192), ("icon-512.png", 512),
               ("apple-touch-icon.png", 180)]
    for name, size in targets:
        img = draw_icon(size)
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(f"wrote {name:<22} {size}x{size}")


if __name__ == "__main__":
    main()
