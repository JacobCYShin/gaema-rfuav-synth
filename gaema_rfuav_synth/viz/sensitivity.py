"""Fig.8-style STFT-point sensitivity grid (RFUAV paper's STFT ablation).

Renders the same IQ frame at multiple STFT sizes x colormaps so the effect of
time/frequency resolution trade-off on burst morphology can be inspected for
both real raw IQ and synthetic IQ.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..transform.colormap import resolve_colormap
from ..transform.spectrogram import pool_to_size
from ..transform.stft import STFTPreset, compute_stft, normalize_db

DEFAULT_STFT_POINTS = [64, 128, 256, 512, 1024]
DEFAULT_COLORMAPS = ["jet", "hot", "parula_like"]


def stft_sensitivity_figure(
    iq: np.ndarray,
    fs: float,
    out_path: str | Path,
    title: str,
    stft_points: list[int] | None = None,
    colormaps: list[str] | None = None,
    cell_size: tuple[int, int] = (240, 320),
) -> None:
    stft_points = stft_points or DEFAULT_STFT_POINTS
    colormaps = colormaps or DEFAULT_COLORMAPS
    n_r, n_c = len(stft_points), len(colormaps)
    fig, axes = plt.subplots(n_r, n_c, figsize=(3.4 * n_c, 2.6 * n_r), squeeze=False)

    for i, pt in enumerate(stft_points):
        preset = STFTPreset(
            name=f"pt{pt}", stft_point=pt, window="hamming", overlap_ratio=0.5,
            normalization="fixed_db", dynamic_range_db=70,
        )
        f, t, s_db = compute_stft(iq, fs, preset)
        arr = pool_to_size(s_db, cell_size[0], cell_size[1])
        vmin, vmax = normalize_db(arr, preset)
        for j, cm in enumerate(colormaps):
            ax = axes[i][j]
            ax.imshow(
                arr[::-1], aspect="auto", cmap=resolve_colormap(cm),
                vmin=vmin, vmax=vmax, interpolation="nearest",
            )
            ax.set_xticks([])
            ax.set_yticks([])
            if j == 0:
                ax.set_ylabel(f"STFT {pt}", fontsize=10)
            if i == 0:
                ax.set_title(cm, fontsize=11)
    fig.suptitle(title, fontsize=13)
    fig.tight_layout(rect=(0, 0, 1, 0.965))
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
