from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
DESKTOP_DIR = ROOT / "desktop"
PNG_PATH = DESKTOP_DIR / "icon.png"
ICO_PATH = DESKTOP_DIR / "icon.ico"
ICNS_PATH = DESKTOP_DIR / "icon.icns"

SIZE = 1024
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    for y in range(size):
        ratio = y / (size - 1)
        color = tuple(int(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(3))
        for x in range(size):
            pixels[x, y] = (*color, 255)
    return gradient


def radial_glow(size: int, center: tuple[int, int], radius: int, color: tuple[int, int, int], alpha: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    x, y = center
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(radius // 2))
    glow = Image.new("RGBA", (size, size), (*color, 0))
    glow.putalpha(mask)
    return glow


def draw_icon() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    body_mask = Image.new("L", (SIZE, SIZE), 0)
    body_draw = ImageDraw.Draw(body_mask)
    body_rect = (72, 72, 952, 952)
    body_draw.rounded_rectangle(body_rect, radius=220, fill=255)

    body = vertical_gradient(SIZE, (8, 20, 38), (6, 14, 28))
    body = ImageChops.screen(body, radial_glow(SIZE, (270, 210), 260, (56, 189, 248), 150))
    body = ImageChops.screen(body, radial_glow(SIZE, (760, 820), 280, (37, 99, 235), 165))
    canvas = Image.composite(body, canvas, body_mask)

    border = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.rounded_rectangle(body_rect, radius=220, outline=(255, 255, 255, 42), width=8)
    canvas.alpha_composite(border)

    shadow_mask = Image.new("L", (SIZE, SIZE), 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_draw.rounded_rectangle((180, 220, 844, 868), radius=128, fill=180)
    shadow = Image.new("RGBA", (SIZE, SIZE), (4, 10, 21, 0))
    shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(50)))
    canvas.alpha_composite(shadow)

    monogram_points = [
        (258, 764),
        (258, 280),
        (376, 280),
        (512, 472),
        (648, 280),
        (766, 280),
        (766, 764),
        (648, 764),
        (648, 464),
        (512, 650),
        (376, 464),
        (376, 764),
    ]
    monogram_mask = Image.new("L", (SIZE, SIZE), 0)
    monogram_draw = ImageDraw.Draw(monogram_mask)
    monogram_draw.polygon(monogram_points, fill=255)
    monogram = vertical_gradient(SIZE, (137, 249, 255), (56, 132, 255))
    monogram = ImageChops.screen(monogram, radial_glow(SIZE, (512, 350), 180, (255, 255, 255), 110))
    canvas = Image.composite(monogram, canvas, monogram_mask)

    monogram_glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    monogram_glow.putalpha(monogram_mask.filter(ImageFilter.GaussianBlur(28)))
    glow_overlay = Image.new("RGBA", (SIZE, SIZE), (59, 130, 246, 56))
    glow_overlay.putalpha(monogram_glow.getchannel("A"))
    canvas.alpha_composite(glow_overlay)

    spark_mask = Image.new("L", (SIZE, SIZE), 0)
    spark_draw = ImageDraw.Draw(spark_mask)
    spark_draw.polygon([(694, 236), (752, 178), (810, 236), (752, 294)], fill=255)
    spark_draw.rounded_rectangle((724, 312, 780, 332), radius=18, fill=220)
    spark_draw.rounded_rectangle((700, 338, 744, 356), radius=12, fill=180)
    spark = vertical_gradient(SIZE, (251, 191, 36), (249, 115, 22))
    canvas = Image.composite(spark, canvas, spark_mask)

    spark_glow = Image.new("RGBA", (SIZE, SIZE), (251, 146, 60, 0))
    spark_glow.putalpha(spark_mask.filter(ImageFilter.GaussianBlur(24)))
    canvas.alpha_composite(spark_glow)

    return canvas


def main() -> None:
    image = draw_icon()
    PNG_PATH.parent.mkdir(parents=True, exist_ok=True)
    image.save(PNG_PATH)
    image.save(ICO_PATH, sizes=ICON_SIZES)

    try:
        image.save(
            ICNS_PATH,
            sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
        )
    except OSError:
        pass

    print(f"Generated {PNG_PATH}")
    print(f"Generated {ICO_PATH}")
    if ICNS_PATH.exists():
        print(f"Generated {ICNS_PATH}")


if __name__ == "__main__":
    main()
