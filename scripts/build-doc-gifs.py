from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "images"
FRAMES = IMAGES / "frames"
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
    print(f"GIFs and theme grid written to {IMAGES}")


if __name__ == "__main__":
    main()
