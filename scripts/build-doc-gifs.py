from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "images"
FRAMES = IMAGES / "frames"
USAGE_FRAMES = IMAGES / "usage-frames"
THEMES = ["rain", "meteor", "blossom", "snow", "beach"]
LABELS = {
    "rain": "Rainy Scenes",
    "meteor": "Kimi no Na wa",
    "blossom": "Spring Petals",
    "snow": "Silent Snow",
    "beach": "Ocean Breeze",
}


def gif_frame(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB")
    image.thumbnail((543, 318), Image.Resampling.LANCZOS)
    return image.quantize(colors=96, method=Image.Quantize.MEDIANCUT)


def save_gif(name: str, paths: list[Path], duration: int = 100) -> None:
    frames = [gif_frame(path) for path in paths]
    frames[0].save(
        IMAGES / name,
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=duration,
        loop=0,
        disposal=2,
    )


def build_grid() -> None:
    thumbs = []
    for theme in THEMES:
        image = Image.open(IMAGES / f"theme-{theme}.png").convert("RGB")
        image.thumbnail((480, 281), Image.Resampling.LANCZOS)
        thumbs.append((theme, image.copy()))

    canvas = Image.new("RGB", (1000, 960), "#111317")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=22)
    for index, (theme, image) in enumerate(thumbs):
        column = index % 2
        row = index // 2
        x = 20 + column * 490
        y = 20 + row * 310
        draw.text((x + 4, y), LABELS[theme], fill="white", font=font)
        canvas.paste(image, (x, y + 34))
    canvas.save(IMAGES / "themes-grid.png", optimize=True)


def documentation_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/System/Library/Fonts/STHeiti Medium.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def usage_canvas(source: Path, title: str, hint: str) -> Image.Image:
    panel = Image.open(source).convert("RGBA")
    panel.thumbnail((1080, 600), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (1200, 760), "#0b0f17")
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    x = (canvas.width - panel.width) // 2
    y = 32 + (600 - panel.height) // 2
    glow_draw.rounded_rectangle(
        (x - 18, y - 18, x + panel.width + 18, y + panel.height + 18),
        radius=30,
        fill=(73, 132, 218, 70),
    )
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(24)))
    canvas.alpha_composite(panel, (x, y))
    draw = ImageDraw.Draw(canvas)
    title_font = documentation_font(30)
    hint_font = documentation_font(18)
    title_box = draw.textbbox((0, 0), title, font=title_font)
    hint_box = draw.textbbox((0, 0), hint, font=hint_font)
    draw.text(((1200 - (title_box[2] - title_box[0])) / 2, 650), title, font=title_font, fill="#ffffff")
    draw.text(((1200 - (hint_box[2] - hint_box[0])) / 2, 706), hint, font=hint_font, fill="#93a4bd")
    return canvas.convert("RGB")


def build_usage_demo() -> None:
    stages = [
        ("landscape.png", "横版", "完整查看额度与今日用量"),
        ("portrait.png", "竖版", "点击 Codex 切换版式"),
        ("side-dock.png", "左右贴边", "拖到侧边，自动收成悬浮条"),
        ("top-dock.png", "上下贴边", "拖到上边或下边，自动改为竖向"),
    ]
    keyframes = [usage_canvas(USAGE_FRAMES / file, title, hint) for file, title, hint in stages]
    # GIF only supports 256 colours. Keep each stage crisp and avoid blended
    # transition frames, which waste the palette on intermediate gradients and
    # make photographic weather backgrounds look soft.
    frames = [
        frame.quantize(
            colors=256,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.FLOYDSTEINBERG,
        )
        for frame in keyframes
    ]
    frames[0].save(
        IMAGES / "usage-demo.gif",
        save_all=True,
        append_images=frames[1:],
        optimize=False,
        duration=[1400, 1200, 1200, 1200],
        loop=0,
        disposal=2,
    )


def main() -> None:
    for theme in ["blossom", "snow", "meteor"]:
        paths = sorted((FRAMES / theme).glob("*.png"))
        save_gif(f"effect-{theme}.gif", paths)

    showcase = []
    for theme in THEMES:
        paths = sorted((FRAMES / theme).glob("*.png"))
        showcase.extend(paths[::3][:8])
    save_gif("weather-showcase.gif", showcase, duration=140)
    build_grid()
    build_usage_demo()
    print(f"GIFs and theme grid written to {IMAGES}")


if __name__ == "__main__":
    main()
