"""Fit synthetic generator parameters from raw-IQ feature estimates (V1).

Reads outputs/real_samples/feature_params_iq.csv (from extract_raw_features.py)
and writes configs/fitted_params.yaml, which the exporter loads with highest
priority (fitted > real-informed overrides > paper Table 4).

Usage: python scripts/fit_drone_params.py --drone DJI_MINI3
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.rfuav.iq_feature_extractor import extract_iq_features
from gaema_rfuav_synth.signal.fhss_generator import FHSSParams, generate_fhss
from gaema_rfuav_synth.signal.snr import add_awgn_at_snr


def calibrate_burst_bw(
    target_measured_mhz: float,
    fhsdt_ms: float,
    fhsdc_ms: float,
    hop_span_mhz: float,
    fs: float = 100e6,
) -> float:
    """Closed-loop bandwidth calibration.

    The feature extractor over-measures narrow bursts by ~2 STFT bins
    (window mainlobe smearing), on real and synthetic alike. We therefore fit
    the generator's CONFIGURED bandwidth so that the MEASURED bandwidth of a
    generated signal matches the measured real value.
    """
    bw = max(target_measured_mhz * 0.6, 0.2)
    for _ in range(5):
        p = FHSSParams(
            fhsbw_mhz=bw, fhsdt_ms=fhsdt_ms, fhsdc_ms=fhsdc_ms,
            fhspp_ms=fhsdc_ms * 8, hop_span_mhz=hop_span_mhz,
        )
        sig, _ = generate_fhss(p, fs, 0.05, np.random.default_rng(0))
        noisy, _ = add_awgn_at_snr(sig, 15.0, np.random.default_rng(1))
        m = extract_iq_features(noisy, fs)["estimated_bandwidth_mhz"]
        if m is None:
            break
        err = m - target_measured_mhz
        if abs(err) / target_measured_mhz < 0.05:
            break
        bw = max(bw - err * 0.8, 0.1)
    return bw


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drone", required=True)
    ap.add_argument("--features", default="outputs/real_samples/feature_params_iq.csv")
    ap.add_argument("--iq", default=None, help="real raw IQ file for closed-loop level calibration")
    ap.add_argument("--out", default="configs/fitted_params.yaml")
    args = ap.parse_args()

    df = pd.read_csv(args.features)
    df = df[df["drone"] == args.drone]
    if df.empty:
        raise SystemExit(f"no raw-IQ features for {args.drone}; run extract_raw_features.py first")

    fhsdc = float(df["estimated_hopping_interval_ms"].median())
    bw_measured = float(df["estimated_bandwidth_mhz"].median())
    fhsdt = float(df["estimated_burst_duration_ms"].median())
    span = float(df["estimated_hop_span_mhz"].median())
    bw_cal = calibrate_burst_bw(bw_measured, fhsdt, fhsdc, span)
    fitted = {
        "burst_bw_mhz": round(bw_cal, 3),
        "burst_bw_measured_mhz": round(bw_measured, 3),
        "fhsdt_ms": round(float(df["estimated_burst_duration_ms"].median()), 4),
        "fhsdc_ms": round(fhsdc, 4),
        "hop_span_mhz": round(float(df["estimated_hop_span_mhz"].median()), 2),
        # irregularity from observed std, capped at physical limits (raw stds
        # are inflated by merged regions and missed detections)
        "timing_jitter_ms": round(
            min(float(df["estimated_hopping_interval_std_ms"].median() or 0.1) / 2, fhsdc / 4), 4
        ),
        "duration_jitter_frac": round(
            min(
                float(
                    (df["estimated_burst_duration_std_ms"].median() or 0.0)
                    / max(float(df["estimated_burst_duration_ms"].median()), 1e-6)
                ),
                0.3,
            ),
            3,
        ),
        "amp_jitter_db": 1.5,
        "freq_jitter_mhz": round(float(df["estimated_bandwidth_mhz"].median()) * 0.1, 3),
        "snr_db_observed": round(float(df["estimated_snr_db"].median()), 2),
        "burst_over_floor_db": round(float(df["burst_over_floor_db"].median()), 2),
        "fitted_from": str(df["source_file"].iloc[0]),
    }
    if "video_over_floor_db" in df and df["video_over_floor_db"].notna().any():
        fitted["video_over_floor_db"] = round(float(df["video_over_floor_db"].dropna().median()), 2)

    # video/TDD-slot population (wide bursts), if the real capture has one
    if "estimated_video_bandwidth_mhz" in df and df["estimated_video_bandwidth_mhz"].notna().any():
        vid = df[df["estimated_video_bandwidth_mhz"].notna()]
        fitted["vtsbw_mhz"] = round(float(vid["estimated_video_bandwidth_mhz"].median()), 2)
        if vid["estimated_video_center_mhz"].notna().any():
            fitted["video_center_mhz"] = round(float(vid["estimated_video_center_mhz"].median()), 2)
        if vid["estimated_video_slot_ms"].notna().any():
            fitted["video_slot_ms"] = round(float(vid["estimated_video_slot_ms"].median()), 4)
        if vid["estimated_video_duty"].notna().any():
            fitted["video_duty"] = round(float(vid["estimated_video_duty"].median()), 3)
        # spread the in-slot level distribution like real OFDM slots
        fitted["video_ripple_db"] = 6.0

    # closed-loop LEVEL calibration: the measured mean-over-floor is edge-diluted
    # on real and synthetic alike, so using the real measurement directly as the
    # generation target applies the bias twice. Generate -> measure -> nudge the
    # generator target until the synthetic MEASURES like the real capture.
    bg_path = Path("outputs/real_samples/backgrounds") / f"{args.drone}.npy"
    if bg_path.exists() and args.iq:
        from gaema_rfuav_synth.dataset import exporter as _exp
        from gaema_rfuav_synth.dataset.exporter import SynthSpec
        from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq
        from gaema_rfuav_synth.transform.stft import STFTPreset, compute_stft

        def over_stats(iq_arr):
            _, _, s = compute_stft(iq_arr, 100e6, STFTPreset(stft_point=256))
            over = s - np.median(s, axis=1, keepdims=True)
            return float(np.percentile(over, 99.0)), float((over > 12.0).mean())

        n = 10_000_000
        real_stats = [over_stats(load_raw_iq(args.iq, count=n, offset_samples=k * n)) for k in range(3)]
        real_p99 = float(np.median([s[0] for s in real_stats]))
        real_occ = float(np.median([s[1] for s in real_stats]))  # bright-cell occupancy
        real_burst_lvl = fitted["burst_over_floor_db"]
        has_video = fitted.get("video_over_floor_db") is not None
        label = "rfuav_fhss_video_like" if has_video else "rfuav_fhss_like"

        # duty from MEASURED bright-cell occupancy, not from region intervals
        # (merged regions inflate the interval-based duty). Cap at 0.45: above
        # ~0.5 the per-frequency median floor starts absorbing the slots, which
        # makes the measurement non-linear on real and synthetic alike.
        if has_video:
            bw_frac = fitted["vtsbw_mhz"] / 100.0
            fitted["video_duty"] = round(float(np.clip(real_occ / bw_frac, 0.05, 0.45)), 3)

        # closed-loop levels, duty held fixed. Damped steps with a +/-3 dB cap
        # and hard target caps keep the loop from running away when the
        # measurement responds sub-linearly.
        for it in range(6):
            _exp._FITTED_PARAMS_CACHE = {args.drone: dict(fitted)}
            spec = SynthSpec(
                label=label, seed=4242 + it, snr_db=10.0, drone=args.drone,
                fs=100e6, duration_s=0.1, background_path=str(bg_path),
            )
            iq, _ = _exp.synthesize(spec)
            m = extract_iq_features(iq, 100e6)
            synth_p99, synth_occ = over_stats(iq)
            done = True
            # narrow bursts: match the region-mean level (drives morphology gates)
            if m.get("burst_over_floor_db") is not None:
                err = float(np.clip(real_burst_lvl - m["burst_over_floor_db"], -3.0, 3.0))
                fitted["burst_over_floor_db"] = round(
                    float(np.clip(fitted["burst_over_floor_db"] + 0.8 * err, 3.0, 25.0)), 2
                )
                done &= abs(err) < 0.7
            # dominant wide component: match the frame-level bright tail (p99),
            # which is what the energy-histogram gate actually measures
            tail_key = "video_over_floor_db" if has_video else "burst_over_floor_db"
            err = float(np.clip(real_p99 - synth_p99, -3.0, 3.0))
            fitted[tail_key] = round(float(np.clip(fitted[tail_key] + 0.8 * err, 5.0, 30.0)), 2)
            done &= abs(err) < 0.7
            print(f"[level-cal {it}] p99 {synth_p99:.1f} vs {real_p99:.1f}, "
                  f"occ {synth_occ:.4f} vs {real_occ:.4f}, "
                  f"burst {m.get('burst_over_floor_db')} vs {real_burst_lvl}")
            if done:
                break
        _exp._FITTED_PARAMS_CACHE = None  # force reload from file afterwards

    out = Path(args.out)
    existing = yaml.safe_load(out.read_text()) if out.exists() else {}
    existing = existing or {}
    existing[args.drone] = fitted
    header = (
        "# Generated by scripts/fit_drone_params.py from real raw-IQ estimates.\n"
        "# Loaded by the exporter with priority: fitted > overrides > paper.\n"
    )
    out.write_text(header + yaml.safe_dump(existing, sort_keys=False))
    print(f"[done] {args.drone} -> {out}")
    print(yaml.safe_dump({args.drone: fitted}, sort_keys=False))


if __name__ == "__main__":
    main()
