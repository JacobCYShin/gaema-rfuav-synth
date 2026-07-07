"""Spectrogram export: dB array -> NPY (downsampled) and full-bleed PNG.

At fs=100 MS/s and 0.1 s frames the raw STFT matrix is ~20M cells, so we
max-pool down to a target size before saving/rendering. Max pooling (not mean)
preserves short FHSS bursts, mirroring how they remain visible in RFUAV's
rendered images.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from .colormap import resolve_colormap
from .stft import STFTPreset, normalize_db


def pool_to_size(s_db: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    """Max-pool a (freq, time) dB array down to at most (out_h, out_w), then
    bilinear-resize to exactly that size."""
    h, w = s_db.shape
    fh, fw = max(h // out_h, 1), max(w // out_w, 1)
    if fh > 1 or fw > 1:
        hh, ww = (h // fh) * fh, (w // fw) * fw
        s_db = s_db[:hh, :ww].reshape(hh // fh, fh, ww // fw, fw).max(axis=(1, 3))
    img = Image.fromarray(s_db.astype(np.float32), mode="F").resize(
        (out_w, out_h), Image.BILINEAR
    )
    return np.asarray(img, dtype=np.float32)


def save_npy(s_db: np.ndarray, path: str, size: tuple[int, int] = (640, 640)) -> np.ndarray:
    arr = pool_to_size(s_db, size[0], size[1])
    np.save(path, arr)
    return arr


def render_png(
    s_db: np.ndarray,
    path: str,
    preset: STFTPreset,
    size: tuple[int, int] = (1460, 1710),  # (height, width) - matches RFUAV ImageSet JPEGs
) -> None:
    """Full-bleed image: freq axis vertical with +f at the top (origin='lower'
    convention of RFUAV's imshow calls), time left->right."""
    arr = pool_to_size(s_db, size[0], size[1])
    vmin, vmax = normalize_db(arr, preset)
    norm = np.clip((arr - vmin) / max(vmax - vmin, 1e-9), 0.0, 1.0)
    cmap = resolve_colormap(preset.colormap)
    rgba = cmap(norm)
    rgb = (rgba[..., :3] * 255).astype(np.uint8)
    # row 0 of the array is the lowest frequency; flip so +f is at the image top
    Image.fromarray(rgb[::-1]).save(path)
