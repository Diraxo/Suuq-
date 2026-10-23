# Upscale the 574x1240 source shots 2.5x with Lanczos + light unsharp so the browser
# does not have to bilinear-stretch them.
import os
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'input')
dst = os.path.join(here, '..', '.tmp', 'input-2x')
os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.lower().endswith('.png'):
        continue
    im = Image.open(os.path.join(src, f)).convert('RGB')
    im = im.resize((im.width * 5 // 2, im.height * 5 // 2), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    im.save(os.path.join(dst, f))
