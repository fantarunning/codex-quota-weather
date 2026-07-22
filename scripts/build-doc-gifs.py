from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "images"
FRAMES = IMAGES / "frames"
PORTRAIT_FRAMES = FRAMES / "portrait"
DOCK_FRAMES = FRAMES / "dock"
USAGE_FRAMES = IMAGES / "usage-frames"
THEMES = ["rain", "meteor", "blossom", "snow", "beach"]
LABELS = {
    "rain": "Rainy Scenes",
    "meteor": "Kimi no Na wa",
    "blossom": "Spring Petals",
    "snow": "Silent Snow",
    "beach": "Ocean Breeze",
}
DOCK_SIDES = {
    "rain": "right",
    "meteor": "top",
    "blossom": "left",
    "snow": "bottom",
    "beach": "right",
}
DOCK_SIDE_LABELS = {
    "right": "Right edge",
    "top": "Top edge",
    "left": "Left edge",
    "bottom": "Bottom edge",
}
FRAME_NAME = re.compile(r"^\d+-bg(?P<background>\d+)-(?P<phase>hold|transition)-\d+\.png$")


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


def pick_evenly(paths: list[Path], count: int) -> list[Path]:
    if len(paths) <= count:
        return paths
    if count == 1:
        return [paths[len(paths) // 2]]
    return [paths[round(index * (len(paths) - 1) / (count - 1))] for index in range(count)]


def weather_showcase_canvas(source: Path, theme: str, background: int) -> Image.Image:
    panel = Image.open(source).convert("RGBA")
    panel.thumbnail((920, 514), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (1000, 640), "#080c14")
    x = (canvas.width - panel.width) // 2
    y = 22

    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rounded_rectangle(
        (x - 12, y - 12, x + panel.width + 12, y + panel.height + 12),
        radius=34,
        fill=(76, 139, 230, 62),
    )
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(22)))
    canvas.alpha_composite(panel, (x, y))

    draw = ImageDraw.Draw(canvas)
    title_font = documentation_font(27)
    hint_font = documentation_font(16)
    title = LABELS[theme]
    hint = f"Weather {THEMES.index(theme) + 1}/5  ·  Background {background + 1}/3"
    title_box = draw.textbbox((0, 0), title, font=title_font)
    hint_box = draw.textbbox((0, 0), hint, font=hint_font)
    draw.text(
        ((canvas.width - (title_box[2] - title_box[0])) / 2, 548),
        title,
        font=title_font,
        fill="#ffffff",
    )
    draw.text(
        ((canvas.width - (hint_box[2] - hint_box[0])) / 2, 590),
        hint,
        font=hint_font,
        fill="#93a4bd",
    )

    dot_y = 621
    dot_gap = 22
    start_x = canvas.width // 2 - dot_gap
    for index in range(3):
        color = "#7db7ff" if index == background else "#334155"
        draw.ellipse(
            (start_x + index * dot_gap - 4, dot_y - 4, start_x + index * dot_gap + 4, dot_y + 4),
            fill=color,
        )
    return canvas.convert("RGB")


def build_weather_showcase() -> None:
    frames = []
    durations = []
    for theme in THEMES:
        groups = {}
        for path in sorted((FRAMES / theme).glob("*.png")):
            match = FRAME_NAME.match(path.name)
            if not match:
                continue
            key = (int(match.group("background")), match.group("phase"))
            groups.setdefault(key, []).append(path)

        sequence = [
            (0, "hold", 2, 260),
            (1, "transition", 3, 110),
            (1, "hold", 2, 240),
            (2, "transition", 3, 110),
            (2, "hold", 2, 320),
        ]
        for background, phase, count, duration in sequence:
            selected = pick_evenly(groups.get((background, phase), []), count)
            if len(selected) != count:
                raise RuntimeError(
                    f"Incomplete documentation frames for {theme} bg={background} phase={phase}"
                )
            for path in selected:
                frame = weather_showcase_canvas(path, theme, background)
                frames.append(
                    frame.quantize(
                        colors=256,
                        method=Image.Quantize.MEDIANCUT,
                        dither=Image.Dither.FLOYDSTEINBERG,
                    )
                )
                durations.append(duration)

    frames[0].save(
        IMAGES / "weather-showcase.gif",
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=durations,
        loop=0,
        disposal=2,
    )


def compact_showcase_canvas(
    source: Path,
    theme: str,
    background: int,
    mode: str,
) -> Image.Image:
    panel = Image.open(source).convert("RGBA")
    if mode == "portrait":
        max_width, max_height = 360, 550
        mode_label = "Portrait"
    else:
        side = DOCK_SIDES[theme]
        vertical = side in {"top", "bottom"}
        max_width, max_height = (300, 540) if vertical else (650, 280)
        mode_label = f"Dock · {DOCK_SIDE_LABELS[side]}"

    scale = min(max_width / panel.width, max_height / panel.height, 1.3)
    panel = panel.resize(
        (max(1, round(panel.width * scale)), max(1, round(panel.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (800, 720), "#080c14")
    x = (canvas.width - panel.width) // 2
    y = 24 + (550 - panel.height) // 2

    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rounded_rectangle(
        (x - 16, y - 16, x + panel.width + 16, y + panel.height + 16),
        radius=30,
        fill=(76, 139, 230, 68),
    )
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(24)))
    canvas.alpha_composite(panel, (x, y))

    draw = ImageDraw.Draw(canvas)
    title_font = documentation_font(26)
    hint_font = documentation_font(16)
    title = f"{mode_label} · {LABELS[theme]}"
    hint = f"Weather {THEMES.index(theme) + 1}/5  ·  Background {background + 1}/3"
    title_box = draw.textbbox((0, 0), title, font=title_font)
    hint_box = draw.textbbox((0, 0), hint, font=hint_font)
    draw.text(
        ((canvas.width - (title_box[2] - title_box[0])) / 2, 600),
        title,
        font=title_font,
        fill="#ffffff",
    )
    draw.text(
        ((canvas.width - (hint_box[2] - hint_box[0])) / 2, 642),
        hint,
        font=hint_font,
        fill="#93a4bd",
    )
    dot_y = 687
    start_x = canvas.width // 2 - 22
    for index in range(3):
        color = "#7db7ff" if index == background else "#334155"
        draw.ellipse(
            (start_x + index * 22 - 4, dot_y - 4, start_x + index * 22 + 4, dot_y + 4),
            fill=color,
        )
    return canvas.convert("RGB")


def build_compact_showcase(mode: str) -> None:
    root = PORTRAIT_FRAMES if mode == "portrait" else DOCK_FRAMES
    frames = []
    durations = []
    for theme in THEMES:
        groups = {}
        for path in sorted((root / theme).glob("*.png")):
            match = FRAME_NAME.match(path.name)
            if not match:
                continue
            key = (int(match.group("background")), match.group("phase"))
            groups.setdefault(key, []).append(path)

        sequence = [
            (0, "hold", 2, 260),
            (1, "transition", 2, 120),
            (1, "hold", 2, 320),
        ]
        for background, phase, count, duration in sequence:
            selected = pick_evenly(groups.get((background, phase), []), count)
            if len(selected) != count:
                raise RuntimeError(
                    f"Incomplete {mode} frames for {theme} bg={background} phase={phase}"
                )
            for path in selected:
                frame = compact_showcase_canvas(path, theme, background, mode)
                frames.append(
                    frame.quantize(
                        colors=224,
                        method=Image.Quantize.MEDIANCUT,
                        dither=Image.Dither.FLOYDSTEINBERG,
                    )
                )
                durations.append(duration)

    output = "weather-portrait.gif" if mode == "portrait" else "weather-dock.gif"
    frames[0].save(
        IMAGES / output,
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=durations,
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

    build_weather_showcase()
    build_compact_showcase("portrait")
    build_compact_showcase("dock")
    build_grid()
    build_usage_demo()
    print(f"GIFs and theme grid written to {IMAGES}")


if __name__ == "__main__":
    main()
