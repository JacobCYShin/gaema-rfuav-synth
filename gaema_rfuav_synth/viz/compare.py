"""Real vs synthetic side-by-side comparison figure."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image


def compare_real_vs_synthetic(
    pairs: list[dict],
    out_path: str | Path,
    title: str = "RFUAV real vs synthetic (same-drone parameters)",
) -> None:
    """pairs: [{"real_img", "synth_img", "real_caption", "synth_caption"}, ...]"""
    n = len(pairs)
    fig, axes = plt.subplots(n, 2, figsize=(12, 4.2 * n), squeeze=False)
    for i, p in enumerate(pairs):
        for j, (img_key, cap_key, col_title) in enumerate(
            [("real_img", "real_caption", "REAL (RFUAV)"), ("synth_img", "synth_caption", "SYNTHETIC")]
        ):
            ax = axes[i][j]
            ax.imshow(Image.open(p[img_key]), aspect="auto")
            ax.set_xticks([])
            ax.set_yticks([])
            if i == 0:
                ax.set_title(col_title, fontsize=13, fontweight="bold")
            ax.set_xlabel(p[cap_key], fontsize=8.5, wrap=True)
    fig.suptitle(title, fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, 0.98))
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
