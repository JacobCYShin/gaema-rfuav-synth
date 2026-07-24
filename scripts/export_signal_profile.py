#!/usr/bin/env python3
"""Export the validated RF morphology as a compact web display profile.

This script deliberately delegates parameter resolution and waveform event
generation to the existing validated pipeline. It does not derive a second RF
model: fitted > real-informed > paper priority remains owned by exporter.py.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import load_stft_preset, load_yaml
from gaema_rfuav_synth.dataset.exporter import (
    SynthSpec,
    _fitted_params,
    _gen_fhss,
    _gen_video,
    _profile,
)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEB_ASSET_DIR = REPO_ROOT / "apps" / "drone-rf-sim" / "public" / "assets" / "spectro"


def build_signal_profile(drone: str, seed: int | None = None) -> dict:
    synthetic = load_yaml("synthetic_config.yaml")
    validation = load_yaml("validation_config.yaml")
    frame = synthetic["frame"]["presets"]["rfuav_full"]
    fitted = _fitted_params(drone)
    paper = _profile(SynthSpec(label="rfuav_fhss_video_like", seed=0, drone=drone))
    if not fitted:
        raise ValueError(f"{drone!r} has no fitted parameters in configs/fitted_params.yaml")

    resolved_seed = int(seed if seed is not None else synthetic["plan"]["base_seed"])
    spec = SynthSpec(
        label="rfuav_fhss_video_like",
        seed=resolved_seed,
        snr_db=float(fitted["snr_db_observed"]),
        drone=drone,
        fs=float(frame["fs"]),
        duration_s=float(frame["duration_s"]),
    )

    # Use the same RNG sequence and existing generators as synthesize().
    rng = np.random.default_rng(resolved_seed)
    _, fhss_events, fhss = _gen_fhss(spec, rng)
    _, _, video = _gen_video(spec, rng)

    db_min, db_max = map(float, validation["analysis"]["hist_range_db"])
    stft = load_stft_preset()
    return {
        "version": 1,
        "drone": drone,
        "seed": resolved_seed,
        "center_freq_hz": float(paper.mf_ghz * 1e9),
        "span_hz": float(spec.fs),
        # Validation works in dB over the per-frequency noise floor, so zero
        # is the measured-floor reference rather than a new absolute RF level.
        "noise_floor_db": 0.0,
        "level_cal_db": float(fitted["snr_db_observed"]),
        "fhss": {
            "bw_hz": float(fhss.fhsbw_mhz * 1e6),
            "burst_s": float(fhss.fhsdt_ms * 1e-3),
            "dwell_s": float(fhss.fhsdc_ms * 1e-3),
            "hop_span_hz": float(fhss.hop_span_mhz * 1e6),
            "hops": [round(float(event.f_center), 3) for event in fhss_events],
            "timing_jitter_s": float(fhss.timing_jitter_ms * 1e-3),
            "duration_jitter_frac": float(fhss.duration_jitter_frac),
            "amp_jitter_db": float(fhss.amp_jitter_db),
            "freq_jitter_hz": float(fhss.freq_jitter_mhz * 1e6),
            "level_over_floor_db": float(fitted["burst_over_floor_db"]),
        },
        "video": {
            "bw_hz": float(video.vtsbw_mhz * 1e6),
            "center_offset_hz": float(video.center_offset_mhz * 1e6),
            "tdd_period_s": float(video.slot_period_ms * 1e-3),
            "duty": float(video.duty),
            "jitter": float(video.slot_jitter_ms * 1e-3),
            "spectral_ripple_db": float(video.spectral_ripple_db),
            "level_over_floor_db": float(fitted["video_over_floor_db"]),
        },
        "db_min": db_min,
        "db_max": db_max,
        "colormap": stft.colormap,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--drone", default="DJI_MINI3")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = args.output or DEFAULT_WEB_ASSET_DIR / f"profile_{args.drone}.json"
    profile = build_signal_profile(args.drone, args.seed)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
