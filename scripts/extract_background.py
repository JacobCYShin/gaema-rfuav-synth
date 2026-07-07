"""Build a real-background pool from a raw IQ capture (V1).

Usage:
  python scripts/extract_background.py "outputs/raw/DJI MINI3/pack1_0-1s.iq" \
      --drone DJI_MINI3

Writes outputs/real_samples/backgrounds/<drone>.npy (complex64).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.rfuav.background_extractor import extract_background
from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("iq_file")
    ap.add_argument("--drone", required=True)
    ap.add_argument("--fs", type=float, default=100e6)
    ap.add_argument("--read-s", type=float, default=1.0, help="seconds of raw IQ to scan")
    ap.add_argument("--max-total-s", type=float, default=0.3)
    ap.add_argument("--margin-db", type=float, default=1.5)
    ap.add_argument("--min-run-ms", type=float, default=0.5)
    args = ap.parse_args()

    iq = load_raw_iq(args.iq_file, count=int(args.fs * args.read_s))
    pool, quiet_frac = extract_background(
        iq, args.fs,
        min_run_ms=args.min_run_ms, max_total_s=args.max_total_s, margin_db=args.margin_db,
    )
    out = Path("outputs/real_samples/backgrounds") / f"{args.drone}.npy"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.save(out, pool)
    print(
        f"[done] {out}: {len(pool)/args.fs*1e3:.1f} ms of background "
        f"({len(pool)} samples, quiet fraction {quiet_frac:.1%}, "
        f"power {float(np.mean(np.abs(pool)**2)):.3e})"
    )


if __name__ == "__main__":
    main()
