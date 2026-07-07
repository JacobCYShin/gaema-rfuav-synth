"""RFUAV real-sample access.

Two paths:
  1. Spectrogram JPEGs from Hugging Face `kitofrank/RFUAV` (cheap, ~1 MB/img)
     under ImageSet-AllDrones-MatlabPipeline/{train,valid}/<drone>/.
  2. Raw IQ: interleaved float32 (I,Q,I,Q,...) .iq/.dat/.bin at fs=100 MS/s.
     Raw packs are only distributed as >=1.2 GB rar archives, so V0 does not
     download them automatically; `load_raw_iq` covers locally extracted files.
"""
from __future__ import annotations

import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import json
import numpy as np
from PIL import Image

HF_DATASET = "kitofrank/RFUAV"
HF_API_TREE = "https://huggingface.co/api/datasets/{ds}/tree/main/{path}"
HF_RESOLVE = "https://huggingface.co/datasets/{ds}/resolve/main/{path}"
IMAGESET_PREFIX = "ImageSet-AllDrones-MatlabPipeline"


def list_hf_folder(path: str, dataset: str = HF_DATASET) -> list[dict]:
    url = HF_API_TREE.format(ds=dataset, path=urllib.parse.quote(path))
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.load(resp)


def download_file(path: str, dest: Path, dataset: str = HF_DATASET) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return dest
    url = HF_RESOLVE.format(ds=dataset, path=urllib.parse.quote(path))
    urllib.request.urlretrieve(url, dest)
    return dest


def download_drone_images(
    hf_drone_folder: str,
    out_dir: Path,
    n_images: int = 6,
    split: str = "train",
) -> list[Path]:
    """Download the first n spectrogram JPEGs for one drone."""
    folder = f"{IMAGESET_PREFIX}/{split}/{hf_drone_folder}"
    entries = [e for e in list_hf_folder(folder) if e.get("type") == "file"]
    entries = sorted(entries, key=lambda e: e["path"])[:n_images]
    paths = []
    for e in entries:
        fname = Path(e["path"]).name
        paths.append(download_file(e["path"], out_dir / fname))
    return paths


def load_real_image(path: str | Path) -> np.ndarray:
    """Load a real spectrogram JPEG as float32 grayscale intensity in [0,1].

    Row 0 = top of the image = highest frequency (same convention as our PNGs).
    """
    img = Image.open(path).convert("L")
    return np.asarray(img, dtype=np.float32) / 255.0


def load_raw_iq(path: str | Path, count: int | None = None, offset_samples: int = 0) -> np.ndarray:
    """Read RFUAV raw IQ: interleaved float32, I even / Q odd indices.

    ``count`` is the number of complex samples to read (None = all).
    """
    n_floats = -1 if count is None else count * 2
    raw = np.fromfile(path, dtype=np.float32, count=n_floats, offset=offset_samples * 8)
    if len(raw) % 2:
        raw = raw[:-1]
    return raw[0::2] + 1j * raw[1::2]


def load_sidecar_xml(path: str | Path) -> dict:
    """Parse an RFUAV per-pack .xml sidecar into a flat {tag: text} dict."""
    root = ET.parse(path).getroot()
    return {el.tag: (el.text or "").strip() for el in root.iter() if el is not root}
