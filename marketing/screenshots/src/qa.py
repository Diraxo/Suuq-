from PIL import Image
import os

files = [
    "01-discover.png", "02-find.png", "03-sell.png",
    "04-connect.png", "05-save.png", "06-trust.png",
]

print(f"{'file':<20}{'size':<14}{'mode':<8}{'has_alpha_used'}")
for f in files:
    p = os.path.join("output", f)
    im = Image.open(p)
    has_alpha = False
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        alphas = rgba.getchannel("A").getextrema()
        has_alpha = alphas[0] < 255
    print(f"{f:<20}{str(im.size):<14}{im.mode:<8}{has_alpha}")
