import sys
from PIL import Image
p = sys.argv[1]
im = Image.open(p).convert('RGB')
if im.size != (1320, 2868):
    im = im.resize((1320, 2868), Image.LANCZOS)
im.save(p)
