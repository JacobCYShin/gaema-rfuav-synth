"""Estimate morphology features from downloaded real RFUAV spectrogram images.

Writes outputs/real_samples/npy/*.npy (grayscale intensity) and
outputs/real_samples/feature_params.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import load_yaml
from gaema_rfuav_synth.dataset.metadata import FeatureParams, write_feature_csv
from gaema_rfuav_synth.rfuav.feature_extractor import extract_features
from gaema_rfuav_synth.rfuav.sample_loader import load_real_image


def main() -> None:
    cfg = load_yaml("rfuav_config.yaml")
    root = Path("outputs/real_samples")
    meta = pd.read_csv(root / "metadata.csv")
    (root / "npy").mkdir(exist_ok=True)

    rows: list[FeatureParams] = []
    for _, r in meta.iterrows():
        img_path = root / "images" / r["filename"]
        intensity = load_real_image(img_path)
        np.save(root / "npy" / f"{r['sample_id']}.npy", intensity.astype(np.float32))
        feats = extract_features(
            intensity,
            duration_ms=cfg["real_image"]["duration_ms"],
            span_mhz=cfg["real_image"]["span_mhz"],
        )
        rows.append(
            FeatureParams(
                sample_id=r["sample_id"],
                source="real",
                label=r["label"],
                estimated_bandwidth_mhz=feats["estimated_bandwidth_mhz"],
                estimated_burst_duration_ms=feats["estimated_burst_duration_ms"],
                estimated_hopping_interval_ms=feats["estimated_hopping_interval_ms"],
                estimated_hopping_period_ms=feats["estimated_hopping_period_ms"],
                estimated_snr_db=feats["estimated_snr_db"],
                estimated_video_bandwidth_mhz=feats["estimated_video_bandwidth_mhz"],
                signal_type=r["label"],
                notes=(
                    f"bursts={feats['n_burst_regions']}, videos={feats['n_video_regions']}; "
                    "estimates from colormapped JPEG grayscale; snr is an intensity-ratio proxy"
                ),
            )
        )
        print(
            f"[feat] {r['sample_id']}: bw={feats['estimated_bandwidth_mhz']}, "
            f"burst={feats['estimated_burst_duration_ms']}ms, hop={feats['estimated_hopping_interval_ms']}ms"
        )

    write_feature_csv(rows, root / "feature_params.csv")
    print(f"[done] feature_params -> {root / 'feature_params.csv'}")


if __name__ == "__main__":
    main()
