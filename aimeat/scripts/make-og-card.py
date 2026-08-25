"""Build the 1200x630 social card from the AIMEAT wordmark.

The wordmark alone cannot BE the og:image: it is 576x157, which is under the 600px width most
platforms want for a large card and a 3.67 aspect nothing renders without heavy letterboxing. So it
goes on the canvas the format asks for, on the house ground, with the address under it.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (255, 255, 255)          # the wordmark ships on a white plate, so the canvas matches it
ACCENT = (232, 86, 74)        # --accent
TEXT_DIM = (110, 110, 125)

card = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(card)

# A hairline of accent along the top, the same device the current card uses.
draw.rectangle([0, 0, W, 6], fill=ACCENT)

logo = Image.open(r"e:/aimeat_logo.png").convert("RGBA")
# Wide enough to read as the subject, with room to breathe: half the canvas width.
target_w = 600
scale = target_w / logo.width
logo = logo.resize((target_w, int(logo.height * scale)), Image.LANCZOS)

lx = (W - logo.width) // 2
ly = (H - logo.height) // 2 - 30
card.paste(logo, (lx, ly), logo)


def font(size):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


sub = "AI Memory Exchange and Action Transfer"
f = font(30)
w = draw.textbbox((0, 0), sub, font=f)[2]
draw.text(((W - w) // 2, ly + logo.height + 46), sub, font=f, fill=TEXT_DIM)

dom = "aimeat.io"
fd = font(26)
wd = draw.textbbox((0, 0), dom, font=fd)[2]
draw.text(((W - wd) // 2, H - 78), dom, font=fd, fill=ACCENT)

out = r"e:/dev/GitHub/aimeat-protocol/aimeat/public/og-image-logo.png"
card.save(out, "PNG", optimize=True)
print("wrote", out, card.size)
