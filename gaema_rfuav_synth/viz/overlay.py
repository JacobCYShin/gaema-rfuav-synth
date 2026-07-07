"""YOLO bbox overlay rendering for label sanity checks."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

DET_COLORS = {0: "#ff4444", 1: "#44ff44", 2: "#44aaff", 3: "#ffaa00"}
DET_NAMES = {0: "fhss", 1: "video", 2: "wifi", 3: "lora"}


def overlay_yolo(image_path: str | Path, label_path: str | Path, out_path: str | Path) -> int:
    """Draw YOLO boxes onto the spectrogram PNG. Returns box count."""
    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size
    n = 0
    for line in Path(label_path).read_text().splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        cls, cx, cy, bw, bh = int(parts[0]), *map(float, parts[1:])
        x0, y0 = (cx - bw / 2) * w, (cy - bh / 2) * h
        x1, y1 = (cx + bw / 2) * w, (cy + bh / 2) * h
        color = DET_COLORS.get(cls, "white")
        draw.rectangle([x0, y0, x1, y1], outline=color, width=2)
        draw.text((x0 + 2, max(y0 - 12, 0)), DET_NAMES.get(cls, str(cls)), fill=color)
        n += 1
    img.save(out_path)
    return n
