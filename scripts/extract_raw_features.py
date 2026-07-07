"""Raw-IQ feature extraction over frames of a real capture (V1).

Usage:
  python scripts/extract_raw_features.py "outputs/raw/DJI MINI3/pack1_0-1s.iq" \
      --drone DJI_MINI3 [--n-frames 5]

Writes outputs/real_samples/feature_params_iq.csv (appends per drone) and, if
image-based estimates exist for the same drone, prints an image-vs-IQ
comparison table to outputs/feature_method_comparison.csv.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.rfuav.iq_feature_extractor import extract_iq_features
from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq

FEATURE_KEYS = [
    "estimated_bandwidth_mhz",
    "estimated_burst_duration_ms",
    "estimated_hopping_interval_ms",
    "estimated_hop_span_mhz",
    "estimated_snr_db",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("iq_file")
    ap.add_argument("--drone", required=True)
    ap.add_argument("--fs", type=float, default=100e6)
    ap.add_argument("--duration-s", type=float, default=0.1)
    ap.add_argument("--n-frames", type=int, default=5)
    ap.add_argument("--stft-point", type=int, default=256)
    ap.add_argument("--thresh-db", type=float, default=5.0)
    args = ap.parse_args()

    n = int(args.fs * args.duration_s)
    rows = []
    for k in range(args.n_frames):
        iq = load_raw_iq(args.iq_file, count=n, offset_samples=k * n)
        if len(iq) < n:
            break
        feats = extract_iq_features(iq, args.fs, args.stft_point, args.thresh_db)
        feats.update(drone=args.drone, frame=k, source_file=Path(args.iq_file).name, method="raw_iq")
        rows.append(feats)
        print(
            f"[frame {k}] bursts={feats['n_burst_regions']} "
            f"bw={feats['estimated_bandwidth_mhz']:.2f}MHz "
            f"dur={feats['estimated_burst_duration_ms']:.3f}ms "
            f"hop={feats['estimated_hopping_interval_ms']}ms "
            f"span={feats['estimated_hop_span_mhz']:.1f}MHz "
            f"snr={feats['estimated_snr_db']:.1f}dB"
        )

    df = pd.DataFrame(rows)
    out = Path("outputs/real_samples/feature_params_iq.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        prev = pd.read_csv(out)
        df = pd.concat([prev[prev["drone"] != args.drone], df], ignore_index=True)
    df.to_csv(out, index=False)
    print(f"[done] raw-IQ features -> {out}")

    # image-vs-IQ method comparison, if image-based estimates exist
    img_csv = Path("outputs/real_samples/feature_params.csv")
    if img_csv.exists():
        img = pd.read_csv(img_csv)
        img = img[img["sample_id"].str.contains(args.drone)]
        if not img.empty:
            mine = df[df["drone"] == args.drone]
            comp_rows = []
            for key in FEATURE_KEYS:
                if key not in img.columns:
                    continue
                comp_rows.append(
                    {
                        "drone": args.drone,
                        "metric": key,
                        "image_based_mean": img[key].mean(),
                        "raw_iq_median": mine[key].median(),
                    }
                )
            comp = pd.DataFrame(comp_rows)
            comp_out = Path("outputs/feature_method_comparison.csv")
            if comp_out.exists():
                prev = pd.read_csv(comp_out)
                comp = pd.concat([prev[prev["drone"] != args.drone], comp], ignore_index=True)
            comp.to_csv(comp_out, index=False)
            print(f"[done] image-vs-IQ comparison -> {comp_out}")
            print(comp.to_string(index=False))


if __name__ == "__main__":
    main()
