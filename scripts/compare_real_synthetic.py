"""Real-vs-synthetic comparison: preview image + numeric metrics.

Outputs:
  outputs/preview_real_vs_synthetic.png     side-by-side spectrograms
  outputs/real_vs_synthetic_metrics.csv     bandwidth / burst duration / hopping
                                            interval (real mean vs synthetic)
  outputs/real_vs_synthetic_energy_hist.png grayscale-intensity (energy proxy)
                                            histograms, real vs synthetic

Comparison set = rfuav_config.yaml `compare_drones` (V0 gate: DJI_MINI3 +
FUTABA_T14SG; extend after they pass).
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import image_sizes, load_stft_preset, load_yaml
from gaema_rfuav_synth.dataset.exporter import SynthSpec, export_sample
from gaema_rfuav_synth.rfuav.paper_params import DRONE_PROFILES
from gaema_rfuav_synth.rfuav.feature_extractor import extract_features
from gaema_rfuav_synth.rfuav.sample_loader import load_real_image
from gaema_rfuav_synth.viz.compare import compare_real_vs_synthetic

COMPARE_SNR_DB = 14.0
COMPARE_SEED = 777


def fmt(v, unit=""):
    try:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return "-"
        return f"{float(v):.2f}{unit}"
    except (TypeError, ValueError):
        return "-"


def main() -> None:
    cfg = load_yaml("rfuav_config.yaml")
    syn_cfg = load_yaml("synthetic_config.yaml")
    preset = load_stft_preset(None, role="compare_preset")
    npy_size, png_size = image_sizes()
    dur_ms = cfg["real_image"]["duration_ms"]
    span = cfg["real_image"]["span_mhz"]

    real_root = Path("outputs/real_samples")
    meta = pd.read_csv(real_root / "metadata.csv")
    out_dir = Path("outputs/compare_synthetic")

    pairs, metric_rows, hist_data = [], [], []
    for k, drone in enumerate(cfg["compare_drones"]):
        prof = DRONE_PROFILES[drone]
        rows = meta[meta["notes"].str.contains(f"drone={drone}")]
        if rows.empty:
            print(f"[warn] no real samples for {drone}, skipping")
            continue

        # real: feature estimates averaged over all downloaded images
        real_feats, real_ints = [], []
        for _, r in rows.iterrows():
            intensity = load_real_image(real_root / "images" / r["filename"])
            real_ints.append(intensity)
            real_feats.append(extract_features(intensity, dur_ms, span))
        real_df = pd.DataFrame(real_feats)

        # synthetic: same drone parameters, comparison preset.
        # The published ImageSet frames for the gate drones show the FHSS
        # control link only (no persistent video band), so compare fhss-only.
        # Fitted params (configs/fitted_params.yaml) apply automatically via
        # the exporter; a real background pool is used when available (it
        # already carries ambient interference, so nothing extra is injected).
        label = "rfuav_fhss_like"
        frame = syn_cfg["frame"]["presets"][syn_cfg["frame"]["preset"]]
        fitted_yaml = Path("configs/fitted_params.yaml")
        fitted = {}
        if fitted_yaml.exists():
            import yaml

            fitted = (yaml.safe_load(fitted_yaml.read_text()) or {}).get(drone, {})
        bg = Path("outputs/real_samples/backgrounds") / f"{drone}.npy"
        spec = SynthSpec(
            label=label,
            seed=COMPARE_SEED + k,
            snr_db=float(fitted.get("snr_db_observed", COMPARE_SNR_DB)),
            drone=drone,
            fs=float(frame["fs"]),
            duration_s=float(frame["duration_s"]),
            burst_bw_floor_mhz=float(syn_cfg["fhss"]["burst_bw_floor_mhz"]),
            burst_bw_divisor=float(syn_cfg["fhss"]["burst_bw_divisor"]),
            background_path=str(bg) if bg.exists() else None,
            inject_interference=[] if bg.exists() else ["wifi_like"],
            interference_power=0.3,
            notes="compare",
        )
        sid = f"cmp_{drone}"
        m, fp = export_sample(spec, sid, out_dir, preset, npy_size, png_size)
        synth_img = out_dir / "images" / f"{sid}.png"
        # measure the synthetic through the SAME path as real (rendered image -> grayscale)
        synth_int = load_real_image(synth_img)
        synth_feats = extract_features(synth_int, dur_ms, span)

        hist_data.append((drone, np.concatenate([x.ravel() for x in real_ints]), synth_int.ravel()))

        for key, paper_val in [
            ("estimated_bandwidth_mhz", None),
            ("estimated_burst_duration_ms", prof.fhsdt_ms),
            ("estimated_hopping_interval_ms", prof.fhsdc_ms),
            ("estimated_snr_db", None),
        ]:
            metric_rows.append(
                {
                    "drone": drone,
                    "metric": key,
                    "paper_value": paper_val,
                    "real_mean": real_df[key].mean(),
                    "real_std": real_df[key].std(),
                    "synthetic": synth_feats[key],
                }
            )

        r0 = rows.iloc[0]
        rf0 = real_feats[0]
        pairs.append(
            {
                "real_img": real_root / "images" / r0["filename"],
                "synth_img": synth_img,
                "real_caption": (
                    f"{drone} REAL | paper: FHSBW {prof.fhsbw_mhz} MHz, FHSDT {prof.fhsdt_ms} ms, "
                    f"FHSDC {prof.fhsdc_ms} ms | est(mean of {len(rows)}): "
                    f"bw {fmt(real_df['estimated_bandwidth_mhz'].mean(), ' MHz')}, "
                    f"burst {fmt(real_df['estimated_burst_duration_ms'].mean(), ' ms')}, "
                    f"hop {fmt(real_df['estimated_hopping_interval_ms'].mean(), ' ms')}"
                ),
                "synth_caption": (
                    f"{label} | SNR {m.snr_db} dB, seed {m.random_seed} | est: "
                    f"bw {fmt(synth_feats['estimated_bandwidth_mhz'], ' MHz')}, "
                    f"burst {fmt(synth_feats['estimated_burst_duration_ms'], ' ms')}, "
                    f"hop {fmt(synth_feats['estimated_hopping_interval_ms'], ' ms')}"
                ),
            }
        )
        print(f"[cmp] {drone} done")

    compare_real_vs_synthetic(pairs, "outputs/preview_real_vs_synthetic.png")
    pd.DataFrame(metric_rows).to_csv("outputs/real_vs_synthetic_metrics.csv", index=False)

    fig, axes = plt.subplots(1, len(hist_data), figsize=(6 * len(hist_data), 4), squeeze=False)
    bins = np.linspace(0, 1, 80)
    for ax, (drone, real_v, synth_v) in zip(axes[0], hist_data):
        ax.hist(real_v, bins=bins, density=True, alpha=0.55, label="real", color="#3477c9")
        ax.hist(synth_v, bins=bins, density=True, alpha=0.55, label="synthetic", color="#e07b39")
        ax.set_yscale("log")
        ax.set_title(f"{drone} intensity (energy proxy) histogram")
        ax.set_xlabel("grayscale intensity")
        ax.legend()
    fig.tight_layout()
    fig.savefig("outputs/real_vs_synthetic_energy_hist.png", dpi=140)
    plt.close(fig)

    print("[done] outputs/preview_real_vs_synthetic.png")
    print("[done] outputs/real_vs_synthetic_metrics.csv")
    print("[done] outputs/real_vs_synthetic_energy_hist.png")


if __name__ == "__main__":
    main()
