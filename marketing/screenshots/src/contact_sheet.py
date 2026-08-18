from PIL import Image
import os

files = [
    "01-discover.png", "02-find.png", "03-sell.png",
    "04-connect.png", "05-save.png", "06-trust.png",
]

THUMB_W = 220
gap = 12
imgs = []
for f in files:
    im = Image.open(os.path.join("output", f))
    ratio = THUMB_W / im.width
    thumb = im.resize((THUMB_W, int(im.height * ratio)))
    imgs.append(thumb)

h = max(i.height for i in imgs)
w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
sheet = Image.new("RGB", (w, h), "white")
x = 0
for i in imgs:
    sheet.paste(i, (x, 0))
    x += i.width + gap

sheet.save("output/_contact_sheet.png")
print(sheet.size)
