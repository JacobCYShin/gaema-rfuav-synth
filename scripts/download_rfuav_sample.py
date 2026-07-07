"""Download a small subset of real RFUAV spectrogram images from Hugging Face.

Usage: python scripts/download_rfuav_sample.py [--n-images 6]
Writes outputs/real_samples/images/<drone>/*.jpg and metadata.csv.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import load_yaml
from gaema_rfuav_synth.dataset.metadata import SampleMeta, write_metadata_csv
from gaema_rfuav_synth.labeling.taxonomy import class_id
from gaema_rfuav_synth.rfuav.paper_params import DRONE_PROFILES, HF_FOLDER_NAMES
from gaema_rfuav_synth.rfuav.sample_loader import download_drone_images


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-images", type=int, default=None)
    args = ap.parse_args()

    cfg = load_yaml("rfuav_config.yaml")
    n_images = args.n_images or cfg["images_per_drone"]
    out_root = Path("outputs/real_samples")
    rows: list[SampleMeta] = []

    for drone in cfg["drones"]:
        folder = HF_FOLDER_NAMES[drone]
        prof = DRONE_PROFILES[drone]
        dest = out_root / "images" / drone
        print(f"[download] {folder} -> {dest}")
        paths = download_drone_images(folder, dest, n_images=n_images, split=cfg["split"])
        for i, p in enumerate(paths):
            has_video = prof.vtsbw_mhz is not None
            rows.append(
                SampleMeta(
                    sample_id=f"real_{drone}_{i:03d}",
                    filename=str(p.relative_to(out_root / "images")),
                    label="rfuav_fhss_video_like" if has_video else "rfuav_fhss_like",
                    class_id=class_id("rfuav_fhss_video_like" if has_video else "rfuav_fhss_like"),
                    center_freq_mhz=prof.mf_ghz * 1000,
                    sample_rate=100e6,
                    duration_ms=cfg["real_image"]["duration_ms"],
                    snr_db=None,
                    fhsbw_mhz=prof.fhsbw_mhz,
                    fhsdt_ms=prof.fhsdt_ms,
                    fhsdc_ms=prof.fhsdc_ms,
                    fhspp_ms=prof.fhspp_ms,
                    vtsbw_mhz=prof.vtsbw_mhz,
                    has_fhss=True,
                    has_video=has_video,
                    has_interference=True,  # field captures include ambient interference
                    source="real",
                    source_dataset="kitofrank/RFUAV ImageSet-AllDrones-MatlabPipeline",
                    random_seed=None,
                    notes=f"drone={drone}; label is morphology-level (paper Table 4 params attached)",
                )
            )

    write_metadata_csv(rows, out_root / "metadata.csv")
    print(f"[done] {len(rows)} real images, metadata -> {out_root / 'metadata.csv'}")


if __name__ == "__main__":
    main()
