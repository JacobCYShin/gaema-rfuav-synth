"""Generate the V0 synthetic preview dataset from configs/synthetic_config.yaml.

Writes outputs/synthetic_samples/{images,npy,labels_yolo,iq}/ plus
metadata.csv, feature_params.csv and specs.json. IQ files are NOT saved by
default: specs.json (+ seed) regenerates byte-identical IQ via
scripts/regenerate_iq.py.
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import image_sizes, load_stft_preset, load_yaml
from gaema_rfuav_synth.dataset.exporter import SynthSpec, export_sample, spec_to_dict
from gaema_rfuav_synth.dataset.metadata import write_feature_csv, write_metadata_csv
from gaema_rfuav_synth.signal.impairments import ImpairmentParams


def frame_settings(cfg: dict, preset_name: str | None) -> dict:
    frame = cfg["frame"]
    name = preset_name or frame["preset"]
    p = frame["presets"][name]
    return dict(fs=float(p["fs"]), duration_s=float(p["duration_s"]), save_iq=bool(frame["save_iq"]))


def build_plan(cfg: dict, frame_preset: str | None = None) -> list[SynthSpec]:
    plan = cfg["plan"]
    aug = cfg["augmentation"]
    imp_cfg = cfg["impairments"]
    imp = ImpairmentParams(
        dc_offset_db=imp_cfg.get("dc_offset_db"),
        iq_gain_imbalance_db=imp_cfg.get("iq_gain_imbalance_db", 0.0),
        iq_phase_imbalance_deg=imp_cfg.get("iq_phase_imbalance_deg", 0.0),
        edge_rolloff_frac=imp_cfg.get("edge_rolloff_frac", 0.0),
        edge_rolloff_db=imp_cfg.get("edge_rolloff_db", 20.0),
    )
    base = dict(
        **frame_settings(cfg, frame_preset),
        burst_bw_floor_mhz=float(cfg["fhss"]["burst_bw_floor_mhz"]),
        burst_bw_divisor=float(cfg["fhss"]["burst_bw_divisor"]),
        impairments=imp,
    )
    seed = itertools.count(plan["base_seed"])
    drones = plan["drones"]
    default_snr = float(cfg["snr"]["default_db"])
    specs: list[SynthSpec] = []

    for label, count in plan["per_class"].items():
        for i in range(count):
            drone = drones[i % len(drones)] if label.startswith("rfuav_") else None
            snr = None if label == "noise_only" else default_snr
            # vary augmentation across repeats for coverage
            extra = {}
            if i % 3 == 1:
                extra["freq_shift_mhz"] = float(aug["freq_shift_mhz_range"][1]) / 2
            if i % 3 == 2 and label.startswith("rfuav_"):
                extra.update(
                    fading_depth_db=float(aug["fading_depth_db"]),
                    timing_jitter_ms=float(aug["timing_jitter_ms"]),
                    dropout_prob=float(aug["dropout_prob"]),
                    inject_interference=["wifi_like"],
                )
            specs.append(SynthSpec(label=label, seed=next(seed), snr_db=snr, drone=drone, **base, **extra))

    # SNR sweep for one class/drone
    sweep = cfg["snr"]["sweep"]
    step = float(plan.get("snr_sweep_step_db", sweep["step_db"]))
    snr = float(sweep["start_db"])
    while snr <= float(sweep["stop_db"]) + 1e-9:
        specs.append(
            SynthSpec(
                label=plan["snr_sweep_class"],
                seed=next(seed),
                snr_db=snr,
                drone=plan["snr_sweep_drone"],
                notes="snr_sweep",
                **base,
            )
        )
        snr += step
    return specs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", default=None, help="STFT preset name (default from stft_config)")
    ap.add_argument("--frame-preset", default=None, help="rfuav_full | dev_light")
    ap.add_argument("--out", default="outputs/synthetic_samples")
    args = ap.parse_args()

    cfg = load_yaml("synthetic_config.yaml")
    preset = load_stft_preset(args.preset)
    npy_size, png_size = image_sizes()
    out_dir = Path(args.out)

    specs = build_plan(cfg, args.frame_preset)
    metas, feats, spec_dump = [], [], {}
    for i, spec in enumerate(specs):
        sample_id = f"synth_{i:05d}_{spec.label}" + (f"_{spec.drone}" if spec.drone else "")
        meta, fp = export_sample(spec, sample_id, out_dir, preset, npy_size, png_size)
        metas.append(meta)
        feats.append(fp)
        spec_dump[sample_id] = spec_to_dict(spec)
        print(f"[{i + 1}/{len(specs)}] {sample_id} (snr={spec.snr_db}, seed={spec.seed})")

    write_metadata_csv(metas, out_dir / "metadata.csv")
    write_feature_csv(feats, out_dir / "feature_params.csv")
    with open(out_dir / "specs.json", "w") as fh:
        json.dump(spec_dump, fh, indent=1)
    print(f"[done] {len(specs)} samples -> {out_dir} (stft={preset.name})")


if __name__ == "__main__":
    main()
