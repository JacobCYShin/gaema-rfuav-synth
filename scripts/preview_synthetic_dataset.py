"""Build outputs/preview_synthetic_grid.png and outputs/bbox_overlay_preview.png."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.viz.overlay import overlay_yolo
from gaema_rfuav_synth.viz.preview import preview_grid


def main() -> None:
    root = Path("outputs/synthetic_samples")
    meta = pd.read_csv(root / "metadata.csv")

    # grid: up to 3 samples per class + the SNR sweep
    items = []
    for label, grp in meta.groupby("label", sort=False):
        for _, r in grp.head(3).iterrows():
            snr = "-" if pd.isna(r["snr_db"]) else f"{r['snr_db']:.0f} dB"
            items.append(
                {
                    "img": root / "images" / r["filename"],
                    "caption": f"{label} | SNR {snr} | seed {r['random_seed']}",
                }
            )
    sweep = meta[meta["notes"].str.contains("snr_sweep", na=False)]
    for _, r in sweep.iterrows():
        items.append(
            {
                "img": root / "images" / r["filename"],
                "caption": f"SNR sweep {r['snr_db']:.0f} dB | {r['label']}",
            }
        )
    preview_grid(items, "outputs/preview_synthetic_grid.png", n_cols=4)
    print(f"[done] outputs/preview_synthetic_grid.png ({len(items)} tiles)")

    # bbox overlay: one busy sample (fhss+video with interference if present)
    cand = meta[meta["label"] == "rfuav_fhss_video_like"]
    r = (cand[cand["has_interference"]] if (cand["has_interference"]).any() else cand).iloc[0]
    sid = r["sample_id"]
    n = overlay_yolo(
        root / "images" / f"{sid}.png",
        root / "labels_yolo" / f"{sid}.txt",
        "outputs/bbox_overlay_preview.png",
    )
    print(f"[done] outputs/bbox_overlay_preview.png ({sid}, {n} boxes)")


if __name__ == "__main__":
    main()
