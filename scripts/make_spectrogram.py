"""Convert a raw IQ file (RFUAV-format interleaved float32) to spectrogram PNG/NPY.

Usage:
  python scripts/make_spectrogram.py path/to/file.iq --fs 100e6 --preset rfuav_paper_best
Works on RFUAV raw packs and on IQ files exported by this harness.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.config import image_sizes, load_stft_preset
from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq
from gaema_rfuav_synth.transform.spectrogram import render_png, save_npy
from gaema_rfuav_synth.transform.stft import compute_stft


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("iq_file")
    ap.add_argument("--fs", type=float, default=100e6)
    ap.add_argument("--duration-s", type=float, default=0.1, help="seconds per frame")
    ap.add_argument("--frame", type=int, default=0, help="frame index into the file")
    ap.add_argument("--preset", default=None)
    ap.add_argument("--out-dir", default="outputs")
    args = ap.parse_args()

    preset = load_stft_preset(args.preset)
    npy_size, png_size = image_sizes()
    n = int(args.fs * args.duration_s)
    iq = load_raw_iq(args.iq_file, count=n, offset_samples=args.frame * n)
    if len(iq) == 0:
        raise SystemExit("no samples read (frame beyond end of file?)")

    f, t, s_db = compute_stft(iq, args.fs, preset)
    stem = Path(args.iq_file).stem + f"_f{args.frame}_{preset.name}"
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    render_png(s_db, str(out / f"{stem}.png"), preset, size=png_size)
    save_npy(s_db, str(out / f"{stem}.npy"), size=npy_size)
    print(f"[done] {out / stem}.png / .npy ({len(iq)} samples, preset={preset.name})")


if __name__ == "__main__":
    main()
