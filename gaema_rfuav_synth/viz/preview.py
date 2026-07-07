"""Synthetic dataset grid preview."""
from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image


def preview_grid(
    items: list[dict],
    out_path: str | Path,
    n_cols: int = 4,
    title: str = "Synthetic dataset preview",
) -> None:
    """items: [{"img": path, "caption": str}, ...]"""
    n = len(items)
    n_rows = math.ceil(n / n_cols)
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(4.0 * n_cols, 3.6 * n_rows), squeeze=False)
    for k in range(n_rows * n_cols):
        ax = axes[k // n_cols][k % n_cols]
        ax.set_xticks([])
        ax.set_yticks([])
        if k < n:
            ax.imshow(Image.open(items[k]["img"]), aspect="auto")
            ax.set_xlabel(items[k]["caption"], fontsize=8)
        else:
            ax.axis("off")
    fig.suptitle(title, fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
