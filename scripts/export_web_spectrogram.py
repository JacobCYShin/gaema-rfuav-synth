#!/usr/bin/env python3
"""Export a deterministic validated IQ -> STFT replay asset for the web UI."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import load_stft_preset, load_yaml
from gaema_rfuav_synth.dataset.exporter import SynthSpec, synthesize
from gaema_rfuav_synth.labeling.bbox import events_to_yolo_lines
from gaema_rfuav_synth.labeling.taxonomy import DET_CLASSES
from gaema_rfuav_synth.signal.impairments import ImpairmentParams
from gaema_rfuav_synth.transform.spectrogram import pool_to_size
from gaema_rfuav_synth.transform.stft import compute_stft, normalize_db


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ASSET_DIR = REPO_ROOT / "apps" / "drone-rf-sim" / "public" / "assets" / "spectro"


def _impairments(config: dict) -> ImpairmentParams:
    values = config["impairments"]
    return ImpairmentParams(
        dc_offset_db=values.get("dc_offset_db"),
        iq_gain_imbalance_db=values.get("iq_gain_imbalance_db", 0.0),
        iq_phase_imbalance_deg=values.get("iq_phase_imbalance_deg", 0.0),
        edge_rolloff_frac=values.get("edge_rolloff_frac", 0.0),
        edge_rolloff_db=values.get("edge_rolloff_db", 20.0),
    )


def export_web_spectrogram(profile_path: Path, output_dir: Path) -> dict:
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    synthetic = load_yaml("synthetic_config.yaml")
    validation = load_yaml("validation_config.yaml")
    preset = load_stft_preset()
    duration_s = float(validation["analysis"]["frame_duration_s"])
    spec = SynthSpec(
        label="rfuav_fhss_video_like",
        seed=int(profile["seed"]),
        snr_db=float(profile["level_cal_db"]),
        drone=profile["drone"],
        fs=float(profile["span_hz"]),
        duration_s=duration_s,
        burst_bw_floor_mhz=float(synthetic["fhss"]["burst_bw_floor_mhz"]),
        burst_bw_divisor=float(synthetic["fhss"]["burst_bw_divisor"]),
        impairments=_impairments(synthetic),
    )

    iq, events = synthesize(spec)
    frequencies, _, stft_db = compute_stft(iq, spec.fs, preset)
    stft_min_db, stft_max_db = normalize_db(stft_db, preset)

    n_freq = int(validation["analysis"]["stft_point"])
    n_time = len(profile["fhss"]["hops"])
    display_db = pool_to_size(stft_db, n_freq, n_time)
    normalized = np.clip(
        (display_db - stft_min_db) / max(stft_max_db - stft_min_db, 1e-9),
        0.0,
        1.0,
    )
    time_major = np.rint(normalized.T * 255.0).astype(np.uint8)

    output_dir.mkdir(parents=True, exist_ok=True)
    data_name = "spectrogram.u8.bin"
    labels_name = "labels.json"
    manifest_name = "manifest.json"
    time_major.tofile(output_dir / data_name)

    class_names = {value: key for key, value in DET_CLASSES.items()}
    labels = []
    for line in events_to_yolo_lines(events, spec.duration_s, spec.fs):
        class_id, center_t, center_f, width_t, height_f = line.split()
        label_id = int(class_id)
        labels.append(
            {
                "class_id": label_id,
                "kind": class_names[label_id],
                "cx": float(center_t),
                "cy": float(center_f),
                "w": float(width_t),
                "h": float(height_f),
            }
        )
    (output_dir / labels_name).write_text(
        json.dumps(labels, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    manifest = {
        "version": 1,
        "drone": profile["drone"],
        "profile": profile_path.name,
        "fs_hz": float(spec.fs),
        "center_freq_hz": float(profile["center_freq_hz"]),
        "freq_min_hz": float(profile["center_freq_hz"] + frequencies.min()),
        "freq_max_hz": float(profile["center_freq_hz"] + frequencies.max()),
        "n_time": int(time_major.shape[0]),
        "n_freq": int(time_major.shape[1]),
        "row_dt_s": float(spec.duration_s / time_major.shape[0]),
        "duration_s": float(spec.duration_s),
        "db_min": float(stft_min_db),
        "db_max": float(stft_max_db),
        "display_db_min": float(profile["db_min"]),
        "display_db_max": float(profile["db_max"]),
        "colormap": profile["colormap"],
        "data": data_name,
        "labels": labels_name,
        "loop": True,
        "seed": int(spec.seed),
    }
    (output_dir / manifest_name).write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile",
        type=Path,
        default=DEFAULT_ASSET_DIR / "profile_DJI_MINI3.json",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_ASSET_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = export_web_spectrogram(args.profile, args.output_dir)
    print(
        f"{args.output_dir / manifest['data']} "
        f"({manifest['n_time']}x{manifest['n_freq']}, seed={manifest['seed']})"
    )


if __name__ == "__main__":
    main()
