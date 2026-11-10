"""
Build the native (OS-drawn) launch image: the SUUQIYE monogram on the same
translucent white disc that app/index.tsx draws behind it, so the native ->
JS splash handoff shows one identical picture.
Geometry (dp): disc 192 (also the Android 12 splash mask diameter), mark 160.
app.json expo-splash-screen: image = this file, imageWidth = 192.
Output: assets/images/fursad-splash-native.png (1024 RGBA, transparent bg).
Run from repo root: python scripts/build-suuqiye-native-splash.py
"""
from PIL import Image, ImageDraw
N, SS, DISC, MARK = 1024, 4, 192, 160
disc = Image.new("RGBA", (N * SS, N * SS), (0, 0, 0, 0))
ImageDraw.Draw(disc).ellipse((0, 0, N * SS - 1, N * SS - 1), fill=(255, 255, 255, 51))  # white @ 0.2 like the JS glow
canvas = disc.resize((N, N), Image.LANCZOS)
m = round(N * MARK / DISC)
mark = Image.open("assets/images/fursad-splash.png").convert("RGBA").resize((m, m), Image.LANCZOS)
canvas.alpha_composite(mark, ((N - m) // 2, (N - m) // 2))
# Pure-white rgb everywhere (alpha carries the shape): the splash plugin rescales with a
# non-premultiplied resampler, so black rgb under soft edges would show as a dark blurry fringe.
px = canvas.load()
for y in range(N):
    for x in range(N):
        a = px[x, y][3]
        px[x, y] = (255, 255, 255, a)
canvas.save("assets/images/fursad-splash-native.png")
print("wrote", canvas.size)
