#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["pillow"]
# ///
"""Rita PWA-ikonerna och delningsbilden i site/icons/.

Motivet är detsamma som i favicon.svg: en blå platta med vägmarkering.
Körs bara om när grafiken ändras — resultatet checkas in.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "site", "icons")
BLUE, DARK, WHITE = (28, 109, 208), (13, 17, 23), (255, 255, 255)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def plate(size, padding):
    """Blå platta med vägstripor. padding = andel tom kant (maskable-zon)."""
    scale = 4
    img = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size * scale
    pad = int(s * padding)
    box = (pad, pad, s - pad, s - pad)
    inner = s - 2 * pad
    d.rounded_rectangle(box, radius=int(inner * 0.22), fill=BLUE)

    # vägen: en avsmalnande kil som försvinner mot horisonten
    top, bottom = pad + inner * 0.10, s - pad - inner * 0.02
    d.polygon([(s / 2 - inner * 0.07, top), (s / 2 + inner * 0.07, top),
               (s / 2 + inner * 0.30, bottom), (s / 2 - inner * 0.30, bottom)],
              fill=(13, 17, 23, 70))

    # mittlinje i tre streck som växer nedåt
    y = top + inner * 0.06
    width, step = inner * 0.045, inner * 0.13
    while y < bottom - inner * 0.05:
        height = step * 0.55
        d.rounded_rectangle((s / 2 - width / 2, y, s / 2 + width / 2, y + height),
                            radius=width / 2, fill=WHITE)
        y += step
        width *= 1.35
        step *= 1.28
    return img.resize((size, size), Image.LANCZOS)


def social():
    """1200x630 för og:image / twitter:card."""
    img = Image.new("RGB", (1200, 630), DARK)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 1200, 8), fill=BLUE)
    img.paste(plate(220, 0.0), (80, 205), plate(220, 0.0))
    title = ImageFont.truetype(FONT, 72)
    sub = ImageFont.truetype(FONT.replace("-Bold", ""), 36)
    d.text((360, 230), "Körkortsfrågor", font=title, fill=WHITE)
    d.text((362, 330), "1865 gratis övningsfrågor inför teoriprovet",
           font=sub, fill=(154, 162, 174))
    d.text((362, 388), "korkort.eliasf.se", font=sub, fill=(90, 157, 251))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    plate(192, 0.0).save(f"{OUT}/icon-192.png")
    plate(512, 0.0).save(f"{OUT}/icon-512.png")
    plate(512, 0.12).save(f"{OUT}/icon-maskable-512.png")   # safe zone för Android
    plate(180, 0.0).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
    social().save(f"{OUT}/social.png")
    for name in sorted(os.listdir(OUT)):
        print(f"  {name}: {os.path.getsize(os.path.join(OUT, name)) // 1024} kB")


if __name__ == "__main__":
    main()
