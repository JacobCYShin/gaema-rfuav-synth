"""Train/valid split into RFUAV-style ImageFolder layout.

RFUAV classification uses torchvision ImageFolder:
  Dataset/{train,valid}/<ClassName>/<imgs>
This reorganizes our flat images/ + metadata.csv into that layout (copies).
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pandas as pd


def split_imagefolder(
    metadata_csv: str | Path,
    images_dir: str | Path,
    out_dir: str | Path,
    valid_ratio: float = 0.2,
    seed: int = 0,
) -> dict[str, int]:
    df = pd.read_csv(metadata_csv)
    rng = np.random.default_rng(seed)
    out_dir = Path(out_dir)
    counts = {"train": 0, "valid": 0}
    for label, group in df.groupby("label"):
        idx = rng.permutation(len(group))
        n_valid = int(round(len(group) * valid_ratio))
        for j, (_, row) in enumerate(group.iloc[idx].iterrows()):
            split = "valid" if j < n_valid else "train"
            src = Path(images_dir) / row["filename"]
            dst = out_dir / split / str(label) / row["filename"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            counts[split] += 1
    return counts
