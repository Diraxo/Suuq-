"""
Build the full SUUQIYE app-icon / splash / favicon asset set from the CLEAN
vector-quality master produced by scripts/build-suuqiye-master.py.

Master  : assets/brand/suuqiye-monogram-2048.png
          (white SUUQIYE monogram, transparent, de-wobbled + potrace-smoothed
           from the original supplied logo - shape/geometry/proportions intact)

Brand palette (unchanged - read from the project):
  primary indigo   #4F46E5   web/src/app/globals.css  --color-primary: 79 70 229
  deep indigo      #3F46BB   app.json android.adaptiveIcon.backgroundColor
  white            #FFFFFF   --color-primary-text

Outputs (filenames already wired into app.json / web / docs - kept as-is):
  assets/images/fursad-icon.png                 1024 RGB    squircle indigo gradient + white mark
  assets/images/fursad-favicon.png               256 RGBA   rounded tile + large white mark
  assets/images/fursad-logo.png                 1024 RGBA   squircle tile, transparent outside
  assets/images/fursad-splash.png               1024 RGBA   white mark only, transparent (no tile)
  assets/images/fursad-adaptive-foreground.png  1024 RGBA   white mark only, Android safe zone
  assets/images/fursad-adaptive-background.png  1024 RGB    radial indigo gradient (adaptive bg)
  assets/images/suuqiye-play-icon-512.png        512 RGBA   Play Store listing icon, padded
  web/public/favicon.png  /fursad-icon.png  /fursad-logo.png    web mirrors
  docs/suuqiye-icon.png   /favicon.png                          legal-site mirrors
"""
import os
import numpy as np
from PIL import Image, ImageDraw

MASTER = "assets/brand/suuqiye-monogram-2048.png"
SS = 4  # supersample factor for crisp masks

INDIGO = np.array([79, 70, 229], float)        # #4F46E5
INDIGO_EDGE = np.array([63, 70, 187], float)    # #3F46BB

# --------------------------------------------------------------------------
# 1. load the clean master, trim to the mark
# --------------------------------------------------------------------------
_m = Image.open(MASTER).convert("RGBA")
_m = _m.crop(_m.getbbox())
_alpha = np.asarray(_m).astype(float)[..., 3] / 255.0


def mark_image(rgb):
    h, w = _alpha.shape
    solid = np.ones((h, w, 3)) * np.array(rgb, float)
    return Image.fromarray(np.dstack([solid, _alpha * 255.0]).astype(np.uint8), "RGBA")


WHITE_MARK = mark_image([255, 255, 255])
print(f"clean master mark: {WHITE_MARK.size}")


# --------------------------------------------------------------------------
# 2. reusable pieces
# --------------------------------------------------------------------------
def squircle_mask(size, margin_ratio=0.018, n=5.0):
    S = size * SS
    m = margin_ratio * S
    xs = np.linspace(0, S - 1, S)
    x, y = np.meshgrid(xs, xs)
    half = (S - 1) / 2.0
    r = half - m
    d = (np.abs((x - half) / r) ** n) + (np.abs((y - half) / r) ** n)
    a = np.clip((1.0 - d) * (r * 0.5) + 0.5, 0.0, 1.0)
    return Image.fromarray((a * 255).astype(np.uint8), "L").resize((size, size), Image.LANCZOS)


def rounded_rect_mask(size, radius_ratio=0.22, margin_ratio=0.0):
    S = size * SS
    m = margin_ratio * S
    rad = radius_ratio * (S - 2 * m)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([m, m, S - 1 - m, S - 1 - m], radius=rad, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def indigo_field(size):
    """subtle radial indigo: primary in the centre easing to the deeper edge tone."""
    S = size
    xs = np.linspace(-1, 1, S)
    x, y = np.meshgrid(xs, xs)
    t = np.clip(np.sqrt(x * x + y * y) / 1.35, 0, 1)[..., None]
    field = INDIGO * (1 - t) + INDIGO_EDGE * t
    return Image.fromarray(field.astype(np.uint8), "RGB")


def place(mark, canvas_size, occupy):
    scale = (canvas_size * occupy) / max(mark.size)
    new = (max(1, round(mark.size[0] * scale)), max(1, round(mark.size[1] * scale)))
    m = mark.resize(new, Image.LANCZOS)
    c = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    c.paste(m, ((canvas_size - new[0]) // 2, (canvas_size - new[1]) // 2), m)
    return c


def icon_tile(size, occupy=0.62, transparent_outside=False, corner_n=5.0,
              margin_ratio=0.018, radius_ratio=None):
    """indigo-gradient tile + centred white mark."""
    base = indigo_field(size).convert("RGBA")
    if radius_ratio is not None:
        mask = rounded_rect_mask(size, radius_ratio=radius_ratio)
    else:
        mask = squircle_mask(size, margin_ratio=margin_ratio, n=corner_n)
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.paste(base, (0, 0), mask)
    tile.alpha_composite(place(WHITE_MARK, size, occupy))
    if transparent_outside:
        return tile
    flat = Image.new("RGBA", (size, size), tuple(INDIGO_EDGE.astype(int)) + (255,))
    flat.alpha_composite(tile)
    return flat.convert("RGB")


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print(f"  {path:48} {im.size[0]}x{im.size[1]} {im.mode:4} {os.path.getsize(path)/1024:7.1f} KB")


# --------------------------------------------------------------------------
# 3. emit the set
# --------------------------------------------------------------------------
icon_1024 = icon_tile(1024)                                  # iOS / general
logo_1024 = icon_tile(1024, transparent_outside=True)        # web/app logo tile

# Favicon: built at 1024, downscaled to 256. Full-bleed rounded tile, large
# mark (dominant shape at ~16px browser-tab size), corners transparent.
_fav = indigo_field(1024).convert("RGBA")
_fav_tile = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
_fav_tile.paste(_fav, (0, 0), rounded_rect_mask(1024, radius_ratio=0.24))
_fav_tile.alpha_composite(place(WHITE_MARK, 1024, 0.80))
favicon = _fav_tile.resize((256, 256), Image.LANCZOS)

save(icon_1024, "assets/images/fursad-icon.png")
save(favicon, "assets/images/fursad-favicon.png")
save(logo_1024, "assets/images/fursad-logo.png")

# Splash: the SUUQIYE monogram ONLY - clean white symbol, transparent.
# expo-splash-screen composites it on backgroundColor (#4F46E5). No inner
# app-icon tile. The mark occupies ~64% of the square so that, once Android 12
# masks its system-splash icon to a circle, the apparent size still matches
# the first frame of this JS splash.
splash = place(WHITE_MARK, 1024, 0.64)
save(splash, "assets/images/fursad-splash.png")

# Play Store listing icon: 512, 32-bit RGBA (alpha channel present, fully
# opaque), FULL-BLEED indigo gradient - no baked corner mask, Google Play
# applies its own. Monogram padded to ~58% so nothing is cropped by Play's
# mask. Well under 1 MB.
_play = indigo_field(512).convert("RGBA")
_play.alpha_composite(place(WHITE_MARK, 512, 0.58))
save(_play, "assets/images/suuqiye-play-icon-512.png")

# Android adaptive foreground: white mark only, transparent, inside the safe
# zone (content within the central 66dp circle of the 108dp canvas). Occupy
# ratio kept at the audited 0.44 so the safe-zone geometry does not change.
save(place(WHITE_MARK, 1024, 0.44), "assets/images/fursad-adaptive-foreground.png")

# Android adaptive background: the SAME radial indigo used by every other tile,
# so the launcher icon reads identically to the iOS icon instead of a flat fill.
save(indigo_field(1024), "assets/images/fursad-adaptive-background.png")

# web mirrors
save(favicon.copy(), "web/public/favicon.png")
save(icon_1024.copy(), "web/public/fursad-icon.png")
save(logo_1024.copy(), "web/public/fursad-logo.png")

# legal-site mirrors (docs/): rounded tile like the favicon, plus a crisp 256 icon
save(logo_1024.copy(), "docs/suuqiye-icon.png")
save(favicon.copy(), "docs/favicon.png")

print("done.")
