from PIL import Image
import os

pairs = [
    ("../../assets/screen shots/photo_2026-08-12_20-52-14.jpg", "01-home.png"),
    ("../../assets/screen shots/photo_2026-08-12_20-52-16.jpg", "02-search.png"),
    ("../../assets/screen shots/photo_2026-08-12_20-52-23.jpg", "03-post.png"),
    ("../../assets/screen shots/photo_2026-08-12_20-52-19.jpg", "04-chat.png"),
    ("../../assets/screen shots/photo_2026-08-12_20-52-24.jpg", "05-favorites.png"),
    ("../../assets/screen shots/photo_2026-08-12_20-52-30.jpg", "06-seller.png"),
]

CROP_TOP = 40  # px, removes OS status bar row for a clean consistent frame

for src, dst in pairs:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    cropped = im.crop((0, CROP_TOP, w, h))
    cropped.save(os.path.join("input", dst))
    print(dst, cropped.size)
