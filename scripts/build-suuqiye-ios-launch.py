"""
Build the iOS-only native launch image: the SUUQIYE monogram with the same
eight category-icon chips that orbit it on the in-app splash (app/index.tsx).
Geometry mirrors app/index.tsx exactly (ORBIT_RADIUS 100, CHIP_SIZE 46,
RING 292pt, mark 160pt, chips resting at translateY -5) at 3x, so the native
launch screen -> JS splash handoff has no jump.

Output: assets/images/suuqiye-launch-ios.png  (876x876 RGBA, transparent bg;
        the indigo field comes from the expo-splash-screen backgroundColor)
Run from repo root: python scripts/build-suuqiye-ios-launch.py
"""
import json, math
from PIL import Image, ImageDraw, ImageFont

S = 3
SS = 4  # supersample
ORBIT_R, CHIP, RING, MARK = 100, 46, 292, 160
CHIP_RADIUS = 16
VI = "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons"
ion = json.load(open(f"{VI}/glyphmaps/Ionicons.json"))
mci = json.load(open(f"{VI}/glyphmaps/MaterialCommunityIcons.json"))
ITEMS = [("ion", "car-outline", -90), ("ion", "restaurant-outline", -45), ("ion", "phone-portrait-outline", 0),
         ("mci", "sofa-outline", 45), ("ion", "home-outline", 90), ("ion", "shirt-outline", 135),
         ("ion", "football-outline", 180), ("ion", "briefcase-outline", -135)]

W = RING * S * SS
canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
for fam, name, ang in ITEMS:
    glyph = chr((ion if fam == "ion" else mci)[name])
    ttf = f"{VI}/Fonts/{'Ionicons' if fam == 'ion' else 'MaterialCommunityIcons'}.ttf"
    cx = (RING / 2 + ORBIT_R * math.cos(math.radians(ang))) * S * SS
    cy = (RING / 2 + ORBIT_R * math.sin(math.radians(ang)) - 5) * S * SS
    half = CHIP * S * SS / 2
    chip = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(chip)
    box = (cx - half, cy - half, cx + half, cy + half)
    r = CHIP_RADIUS * S * SS
    d.rounded_rectangle(box, r, fill=(255, 255, 255, 31))  # rgba(255,255,255,.12)
    # 1pt border rgba(255,255,255,.22), drawn inside the chip
    bw = S * SS
    ring = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(box, r, outline=(255, 255, 255, 56), width=bw)
    chip = Image.alpha_composite(chip, ring)
    font = ImageFont.truetype(ttf, 20 * S * SS)
    d = ImageDraw.Draw(chip)
    d.text((cx, cy), glyph, font=font, fill=(255, 255, 255, 255), anchor="mm")
    canvas = Image.alpha_composite(canvas, chip)

canvas = canvas.resize((RING * S, RING * S), Image.LANCZOS)
mark = Image.open("assets/images/fursad-splash.png").convert("RGBA").resize((MARK * S, MARK * S), Image.LANCZOS)
off = (RING * S - MARK * S) // 2
canvas.alpha_composite(mark, (off, off))
canvas.save("assets/images/suuqiye-launch-ios.png")
print("wrote", canvas.size)
