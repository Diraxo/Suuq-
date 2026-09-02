"""
Color-only rebrand of the SUUQIYE monogram.

Source : assets/images/WhatsApp Image 2026-09-02 at 09.52.08.jpeg
         (green 3D monogram on a blue studio background)
Output : assets/images/suuqiye-play-icon-512.png
         512x512, 32-bit RGBA, transparent background, mark recolored to the
         existing SUUQIYE brand indigo. Shape / geometry / shading untouched.

Brand colors pulled from the project:
  primary indigo  #4F46E5  (web/src/app/globals.css --color-primary: 79 70 229)
  adaptive-icon   #3F46BB  (app.json android.adaptiveIcon.backgroundColor)
  accent coral    #FF6B6B  (--color-accent: 255 107 107)
The uploaded mark is a single-color element, so it maps to the single closest
brand color: the primary indigo.
"""
import numpy as np
from PIL import Image

SRC = "assets/images/WhatsApp Image 2026-09-02 at 09.52.08.jpeg"
OUT = "assets/images/suuqiye-play-icon-512.png"
BRAND = np.array([79, 70, 229], float)      # #4F46E5

img = np.asarray(Image.open(SRC).convert("RGB")).astype(float)
R, G, B = img[..., 0], img[..., 1], img[..., 2]

# --- 1. matte the green mark out of the blue background -------------------
# "greenness" score: strongly positive on the mark, strongly negative on the
# blue floor. A soft ramp across zero gives a clean anti-aliased alpha.
score = G - np.maximum(R, B)
alpha = np.clip((score + 12.0) / 24.0, 0.0, 1.0)

# kill the faint blue contact-shadow / vignette that squeaks through
alpha[score < -4] = 0.0

# --- 2. recolor: keep the mark's own shading, swap the hue --------------
# luminance of every mark pixel, normalised so the mark's body maps to 1.0
lum = 0.2126 * R + 0.7152 * G + 0.0722 * B
body = np.median(lum[alpha > 0.5])
ratio = (lum / body)[..., None]

# multiplicative recolor preserves 3D form; specular hotspots (ratio > 1)
# roll off toward white exactly as they do in the source render
shade = BRAND * np.clip(ratio, 0.0, 1.0)
spec = np.clip(ratio - 1.0, 0.0, None)
recolored = shade + (255.0 - shade) * np.clip(spec * 0.9, 0.0, 1.0)
recolored = np.clip(recolored, 0, 255)

rgba = np.dstack([recolored, alpha * 255.0]).astype(np.uint8)
mark = Image.fromarray(rgba, "RGBA")

# --- 3. crop to the mark, pad, center on a 512 transparent canvas -------
bbox = mark.getbbox()
mark = mark.crop(bbox)

CANVAS = 512
PAD = 0.80  # mark occupies 80% of the canvas -> ~10% padding each side
scale = (CANVAS * PAD) / max(mark.size)
new = (max(1, round(mark.size[0] * scale)), max(1, round(mark.size[1] * scale)))
mark = mark.resize(new, Image.LANCZOS)

canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
canvas.paste(mark, ((CANVAS - new[0]) // 2, (CANVAS - new[1]) // 2), mark)
canvas.save(OUT, "PNG")

import os
print(f"wrote {OUT}  {canvas.size}  {os.path.getsize(OUT)/1024:.1f} KB")
