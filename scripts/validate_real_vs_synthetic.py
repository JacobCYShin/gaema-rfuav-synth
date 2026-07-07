"""Quantitative real-vs-synthetic validation gate (V1).

Apples-to-apples: the SAME raw-IQ feature extractor runs on N real frames and
M synthetic frames (fitted params + real background), then relative errors are
checked against configs/validation_config.yaml thresholds. The energy-
histogram criterion compares dB-over-floor distributions with the Wasserstein
distance, gated at baseline_factor x the median real-vs-real pairwise distance.

Usage:
  python scripts/validate_real_vs_synthetic.py --drone DJI_MINI3 \
      --iq "outputs/raw/DJI MINI3/pack1_0-1s.iq"
"""
from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import wasserstein_distance

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import load_yaml
from gaema_rfuav_synth.dataset.exporter import SynthSpec, synthesize
from gaema_rfuav_synth.rfuav.iq_feature_extractor import extract_iq_features
from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq
from gaema_rfuav_synth.transform.stft import STFTPreset, compute_stft

METRICS = {
    "bandwidth": ("estimated_bandwidth_mhz", "bandwidth_rel_err"),
    "burst_duration": ("estimated_burst_duration_ms", "burst_duration_rel_err"),
    "hopping_interval": ("estimated_hopping_interval_ms", "hopping_interval_rel_err"),
}


def db_over_floor_hist(iq: np.ndarray, fs: float, cfg: dict) -> np.ndarray:
    preset = STFTPreset(stft_point=int(cfg["stft_point"]))
    _, _, s_db = compute_stft(iq, fs, preset)
    over = s_db - np.median(s_db, axis=1, keepdims=True)
    lo, hi = cfg["hist_range_db"]
    hist, _ = np.histogram(over, bins=int(cfg["hist_bins"]), range=(lo, hi), density=True)
    return hist


def hist_distance(h1: np.ndarray, h2: np.ndarray, cfg: dict) -> float:
    lo, hi = cfg["hist_range_db"]
    centers = np.linspace(lo, hi, int(cfg["hist_bins"]), endpoint=False) + (hi - lo) / cfg["hist_bins"] / 2
    return float(wasserstein_distance(centers, centers, h1 + 1e-12, h2 + 1e-12))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drone", required=True)
    ap.add_argument("--iq", required=True, help="real raw IQ file")
    ap.add_argument("--fs", type=float, default=100e6)
    ap.add_argument("--seed", type=int, default=1234)
    args = ap.parse_args()

    vcfg = load_yaml("validation_config.yaml")
    acfg = vcfg["analysis"]
    thr = vcfg["thresholds"]
    n = int(args.fs * float(acfg["frame_duration_s"]))
    stft_point = int(acfg["stft_point"])
    thresh_db = float(acfg["thresh_db"])

    # --- real frames
    real_feats, real_hists = [], []
    for k in range(int(acfg["n_real_frames"])):
        iq = load_raw_iq(args.iq, count=n, offset_samples=k * n)
        if len(iq) < n:
            break
        real_feats.append(extract_iq_features(iq, args.fs, stft_point, thresh_db))
        real_hists.append(db_over_floor_hist(iq, args.fs, acfg))
    real = pd.DataFrame(real_feats)
    print(f"[real] {len(real)} frames analyzed")

    # --- synthetic frames (fitted params via exporter priority; real background if available)
    bg_path = Path("outputs/real_samples/backgrounds") / f"{args.drone}.npy"
    snr = float(real["estimated_snr_db"].median())
    synth_feats, synth_hists = [], []
    for j in range(int(acfg["n_synth_frames"])):
        spec = SynthSpec(
            label="rfuav_fhss_like",
            seed=args.seed + j,
            snr_db=snr,
            drone=args.drone,
            fs=args.fs,
            duration_s=float(acfg["frame_duration_s"]),
            background_path=str(bg_path) if bg_path.exists() else None,
        )
        iq, _ = synthesize(spec)
        synth_feats.append(extract_iq_features(iq, args.fs, stft_point, thresh_db))
        synth_hists.append(db_over_floor_hist(iq, args.fs, acfg))
    synth = pd.DataFrame(synth_feats)
    print(f"[synth] {len(synth)} frames generated (snr={snr:.1f} dB, background={'real' if bg_path.exists() else 'awgn'})")

    # --- feature criteria
    rows, all_pass = [], True
    for name, (key, thr_key) in METRICS.items():
        rv, sv = float(real[key].median()), float(synth[key].median())
        err = abs(sv - rv) / max(abs(rv), 1e-9)
        ok = err <= float(thr[thr_key])
        all_pass &= ok
        rows.append(
            {"drone": args.drone, "metric": name, "real": round(rv, 4), "synthetic": round(sv, 4),
             "rel_err": round(err, 4), "threshold": thr[thr_key], "pass": ok}
        )

    # --- energy histogram criterion
    rr = [hist_distance(a, b, acfg) for a, b in itertools.combinations(real_hists, 2)]
    baseline = float(np.median(rr)) if rr else 0.0
    rs = [hist_distance(a, b, acfg) for a in real_hists for b in synth_hists]
    dist = float(np.median(rs))
    limit = baseline * float(thr["energy_hist_baseline_factor"])
    ok = dist <= limit if baseline > 0 else False
    all_pass &= ok
    rows.append(
        {"drone": args.drone, "metric": "energy_hist_wasserstein_db", "real": round(baseline, 4),
         "synthetic": round(dist, 4), "rel_err": round(dist / max(baseline, 1e-9), 3),
         "threshold": f"<= {thr['energy_hist_baseline_factor']}x real baseline", "pass": ok}
    )

    report = pd.DataFrame(rows)
    out = Path("outputs/validation_report.csv")
    if out.exists():
        prev = pd.read_csv(out)
        report = pd.concat([prev[prev["drone"] != args.drone], report], ignore_index=True)
    report.to_csv(out, index=False)
    print(report[report["drone"] == args.drone].to_string(index=False))
    print(f"\n[{'PASS' if all_pass else 'FAIL'}] {args.drone} -> {out}")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
