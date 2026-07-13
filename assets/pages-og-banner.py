#!/usr/bin/env python3
"""
@file assets/pages-og-banner.py
@description Regenerates the AIMEAT Pages social-share banner (Open Graph / Twitter
    card image), 1200x630. Chosen design "A": warm coral-framed white card with the
    AIME(heart)AT wordmark and the canonical positioning tagline.

    The banner is referenced by the AIMEAT Pages app's <head> og:image / twitter:image
    and is hosted in the node's public storage at key `brand/pages-og.png`
    (owner-addressed /v1/pub/... URL). This script only PRODUCES the PNG; to make a new
    version live, overwrite that SAME storage key (og:image URL stays identical, so the
    app itself does NOT need republishing), then flush the LinkedIn cache via
    https://www.linkedin.com/post-inspector/.

    Tagline is the canonical line from the dev organism Marketing workspace
    (ws-mr71fkbrsl7): "a digital agency where people, agents and apps work under one
    roof — and everyone owns their own data" (both "agency" and "office" approved;
    always land the data-ownership line).

@usage  python assets/pages-og-banner.py        # writes assets/pages-og.png
@version-history
    v1.0.0 — 2026-07-12 — Initial: extracted from the session that added the OG card.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = Path(__file__).resolve().parent
LOGO = HERE / "aimeat_logo.png"
OUT = HERE / "pages-og.png"

W, H = 1200, 630
CORAL = (232, 86, 74, 255)   # --accent
GRAY = (75, 85, 99, 255)     # --text-dim
MUTED = (156, 163, 175, 255) # --text-muted

# Windows font paths; swap for your platform's Arial/Helvetica equivalents if needed.
FONT_DIR = Path("C:/Windows/Fonts")
F_TAG = ImageFont.truetype(str(FONT_DIR / "arial.ttf"), 38)
F_OWN = ImageFont.truetype(str(FONT_DIR / "arialbd.ttf"), 36)
F_FOOT = ImageFont.truetype(str(FONT_DIR / "arial.ttf"), 26)

TAGLINE = "People, agents and apps under one roof."
OWNLINE = "Everyone owns their own data."
FOOTER = "aimeat.io"


def vgrad(top, bot):
    """Vertical RGB gradient, top -> bottom, returned as RGBA."""
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img.convert("RGBA")


def logo_clean():
    """Load the wordmark and key out its opaque white background to transparency."""
    lg = Image.open(LOGO).convert("RGBA")
    px = lg.load()
    for y in range(lg.height):
        for x in range(lg.width):
            r, g, b, a = px[x, y]
            if a and min(r, g, b) > 232:
                px[x, y] = (0, 0, 0, 0)
    return lg


def ctext(d, y, txt, f, fill):
    """Horizontally-centered text at row y."""
    bb = d.textbbox((0, 0), txt, font=f)
    d.text(((W - (bb[2] - bb[0])) // 2, y), txt, font=f, fill=fill)


def main():
    img = vgrad((255, 227, 221), (255, 242, 238))  # warm coral frame

    # soft drop shadow for the white card
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([(44, 52), (1156, 596)], radius=40, fill=(70, 20, 15, 70))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22)))

    d = ImageDraw.Draw(img)
    d.rounded_rectangle([(40, 40), (1160, 584)], radius=40, fill=(255, 255, 255, 255))

    lg = logo_clean()
    lw = 560
    lh = int(lg.height * lw / lg.width)
    lg = lg.resize((lw, lh), Image.LANCZOS)
    img.alpha_composite(lg, ((W - lw) // 2, 130))

    d.rounded_rectangle([(W // 2 - 60, 340), (W // 2 + 60, 346)], radius=3, fill=CORAL)
    ctext(d, 382, TAGLINE, F_TAG, GRAY)
    ctext(d, 442, OWNLINE, F_OWN, CORAL)
    ctext(d, 532, FOOTER, F_FOOT, MUTED)

    img.convert("RGB").save(OUT, "PNG")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
