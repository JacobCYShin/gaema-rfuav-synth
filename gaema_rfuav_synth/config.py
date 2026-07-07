"""YAML config loading helpers."""
from __future__ import annotations

from pathlib import Path

import yaml

from .transform.stft import STFTPreset

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"


def load_yaml(name: str) -> dict:
    with open(CONFIG_DIR / name) as fh:
        return yaml.safe_load(fh)


def load_stft_preset(name: str | None = None, role: str = "default_preset") -> STFTPreset:
    cfg = load_yaml("stft_config.yaml")
    name = name or cfg[role]
    p = cfg["presets"][name]
    return STFTPreset(
        name=name,
        stft_point=int(p["stft_point"]),
        window=p["window"],
        overlap_ratio=float(p["overlap_ratio"]),
        colormap=p["colormap"],
        normalization=p["normalization"],
        dynamic_range_db=float(p.get("dynamic_range_db", 70)),
    )


def image_sizes() -> tuple[tuple[int, int], tuple[int, int]]:
    cfg = load_yaml("stft_config.yaml")["image"]
    return tuple(cfg["npy_size"]), tuple(cfg["png_size"])
