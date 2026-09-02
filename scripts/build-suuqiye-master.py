"""
Build a clean, vector-quality master of the EXISTING SUUQIYE monogram.

Source : assets/images/WhatsApp Image 2026-09-02 at 09.52.08.jpeg
         (green 3D interlocking monogram on a blue studio background, ~163x249 px)

This does NOT redesign the mark. It lifts the exact silhouette off the source,
removes JPEG stair-stepping / contour wobble, traces it to smooth Bezier paths
(potrace) and emits:

  assets/brand/suuqiye-monogram.svg          vector master (white fill, viewBox-normalised)
  assets/brand/suuqiye-monogram-2048.png     RGBA, white mark, transparent, trimmed+centred
  assets/brand/suuqiye-monogram-mask.png     L, the 1-bit silhouette that was traced (for review)

Everything downstream (icons, splash, favicons) is rebuilt from the SVG/PNG
master by build-suuqiye-brand-assets.py.
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
import potrace

SRC = "assets/images/WhatsApp Image 2026-09-02 at 09.52.08.jpeg"
OUT_DIR = "assets/brand"
os.makedirs(OUT_DIR, exist_ok=True)

# --------------------------------------------------------------------------
# 1. lift the mark off the blue background at native resolution
# --------------------------------------------------------------------------
img = np.asarray(Image.open(SRC).convert("RGB")).astype(float)
R, G, B = img[..., 0], img[..., 1], img[..., 2]
score = G - np.maximum(R, B)                     # >0 on the green mark, <0 on blue floor
alpha = np.clip((score + 12.0) / 24.0, 0.0, 1.0)
alpha[score < -4] = 0.0

mask = Image.fromarray((alpha * 255).astype(np.uint8), "L")
mask = mask.crop(mask.getbbox())
src_w, src_h = mask.size
print(f"source mark silhouette: {src_w}x{src_h}")

# --------------------------------------------------------------------------
# 2. de-wobble the contour
#    Upscale far past target, then smooth with a blur that is ~1.1 SOURCE
#    pixels wide (so it erases trace wobble / compression jaggies) but well
#    under the smallest real feature, then re-threshold to a crisp bilevel.
#    Shape, thickness, curves, openings and silhouette are preserved.
# --------------------------------------------------------------------------
UP = 16                                          # 163->2608, 249->3984
big = mask.resize((src_w * UP, src_h * UP), Image.LANCZOS)
big_a = (np.asarray(big).astype(float) / 255.0 > 0.5).astype(np.uint8)

smooth = Image.fromarray(big_a * 255, "L").filter(ImageFilter.GaussianBlur(UP * 1.7))
s = np.asarray(smooth).astype(float) / 255.0
# crisp re-threshold at 0.5 with a ~1px anti-aliased transition
bilevel = (s >= 0.5).astype(np.uint8)

# pad a little so potrace never runs a path along the image border
pad = UP * 4
bl = np.pad(bilevel, pad, mode="constant")
Image.fromarray(bl * 255, "L").save(f"{OUT_DIR}/suuqiye-monogram-mask.png")

# --------------------------------------------------------------------------
# 3. trace to smooth Bezier paths
# --------------------------------------------------------------------------
bmp = potrace.Bitmap(bl.astype(bool))
path = bmp.trace(
    turdsize=int((UP * 2.0) ** 2),   # drop specks smaller than ~2 source px
    turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
    alphamax=1.334,                  # fully smooth corners
    opticurve=1,
    opttolerance=0.35,
)

H, W = bl.shape


def _xy(p):
    return (p.x, p.y)


def flatten(curve, steps=48):
    """potrace curve -> list of (x, y) polygon points (Beziers flattened)."""
    pts = [_xy(curve.start_point)]
    for seg in curve:
        p0 = pts[-1]
        if seg.is_corner:
            pts.append(_xy(seg.c))
            pts.append(_xy(seg.end_point))
        else:
            c1, c2, p1 = _xy(seg.c1), _xy(seg.c2), _xy(seg.end_point)
            for i in range(1, steps + 1):
                t = i / steps
                mt = 1 - t
                x = (mt**3) * p0[0] + 3 * (mt**2) * t * c1[0] + 3 * mt * (t**2) * c2[0] + (t**3) * p1[0]
                y = (mt**3) * p0[1] + 3 * (mt**2) * t * c1[1] + 3 * mt * (t**2) * c2[1] + (t**3) * p1[1]
                pts.append((x, y))
    return pts


# --------------------------------------------------------------------------
# 4a. render a clean raster master (supersampled polygon fill).
#     Walk potrace's contour tree: outer contours paint the mark, their
#     direct children are holes, grandchildren are islands, etc.
# --------------------------------------------------------------------------
SS = 2
# potracer always emits the image frame as the first contour; drop any contour
# that spans (almost) the whole canvas so only the real mark contours remain.
_all = [flatten(curve) for curve in path]
polys = []
for p in _all:
    xs = [q[0] for q in p]
    ys = [q[1] for q in p]
    if min(xs) <= 1 and min(ys) <= 1 and max(xs) >= W - 1 and max(ys) >= H - 1:
        continue
    polys.append(p)


def poly_area(p):
    a = 0.0
    for i in range(len(p)):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % len(p)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2.0


def point_in(poly, x, y):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def rep_point(poly):
    # midpoint of the polygon's vertical centre scanline that lies inside it
    ys = [p[1] for p in poly]
    y = (min(ys) + max(ys)) / 2.0
    xs = sorted(
        (poly[i][0] + (poly[(i + 1) % len(poly)][0] - poly[i][0]) *
         (y - poly[i][1]) / ((poly[(i + 1) % len(poly)][1] - poly[i][1]) or 1e-9))
        for i in range(len(poly))
        if (poly[i][1] > y) != (poly[(i + 1) % len(poly)][1] > y)
    )
    return ((xs[0] + xs[1]) / 2.0, y) if len(xs) >= 2 else (poly[0][0], y)

# nesting depth of each contour = how many other contours contain its rep point
order = sorted(range(len(polys)), key=lambda i: poly_area(polys[i]), reverse=True)
canvas = Image.new("L", (W * SS, H * SS), 0)
draw = ImageDraw.Draw(canvas)
for i in order:
    px, py = rep_point(polys[i])
    depth = sum(1 for j in range(len(polys)) if j != i and point_in(polys[j], px, py))
    fill = 255 if depth % 2 == 0 else 0
    draw.polygon([(x * SS, y * SS) for x, y in polys[i]], fill=fill)

master_a = canvas.resize((W, H), Image.LANCZOS)
master_a = master_a.crop(master_a.getbbox())
mw, mh = master_a.size

TARGET = 2048
scale = (TARGET * 0.98) / max(mw, mh)
rw, rh = round(mw * scale), round(mh * scale)
mark = master_a.resize((rw, rh), Image.LANCZOS)

white = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
solid = Image.new("RGBA", (rw, rh), (255, 255, 255, 255))
white.paste(solid, ((TARGET - rw) // 2, (TARGET - rh) // 2), mark)
white.save(f"{OUT_DIR}/suuqiye-monogram-2048.png")
print(f"raster master: {white.size}  mark {rw}x{rh}")

# --------------------------------------------------------------------------
# 4b. emit an SVG vector master - real cubic Beziers straight from potrace,
#     normalised to a tight, centred 1024 viewBox.
# --------------------------------------------------------------------------
kept = [c for c, p in zip(list(path), _all) if p in polys]

minx = miny = 1e9
maxx = maxy = -1e9
for poly in polys:
    for x, y in poly:
        minx, miny = min(minx, x), min(miny, y)
        maxx, maxy = max(maxx, x), max(maxy, y)
bw, bh = maxx - minx, maxy - miny
VB = 1024.0
k = (VB * 0.96) / max(bw, bh)
ox = (VB - bw * k) / 2 - minx * k
oy = (VB - bh * k) / 2 - miny * k


def T(p):
    return f"{p.x * k + ox:.2f},{p.y * k + oy:.2f}"


def curve_d(curve):
    d = [f"M{T(curve.start_point)}"]
    for seg in curve:
        if seg.is_corner:
            d.append(f"L{T(seg.c)}L{T(seg.end_point)}")
        else:
            d.append(f"C{T(seg.c1)} {T(seg.c2)} {T(seg.end_point)}")
    d.append("Z")
    return "".join(d)


paths = " ".join(curve_d(c) for c in kept)
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
    f'width="1024" height="1024">\n'
    f'  <path fill="#FFFFFF" fill-rule="evenodd" d="{paths}"/>\n'
    f'</svg>\n'
)
with open(f"{OUT_DIR}/suuqiye-monogram.svg", "w") as f:
    f.write(svg)
print(f"vector master: {OUT_DIR}/suuqiye-monogram.svg  ({len(kept)} sub-paths, {len(svg)} bytes)")
