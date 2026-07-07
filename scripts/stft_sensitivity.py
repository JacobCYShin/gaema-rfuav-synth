"""Fig.8-style STFT sensitivity analysis (required V0 deliverable).

Real raw IQ:
  python scripts/stft_sensitivity.py --iq outputs/raw/xxx.dat --fs 100e6 \
      --title "FUTABA T14SG (real raw IQ)" --out outputs/stft_sensitivity_real.png
Synthetic IQ (regenerated from spec, no --iq needed):
  python scripts/stft_sensitivity.py --synthetic-drone DJI_MINI3 \
      --out outputs/stft_sensitivity_synthetic.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.dataset.exporter import SynthSpec, synthesize
from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq
from gaema_rfuav_synth.viz.sensitivity import stft_sensitivity_figure


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iq", default=None, help="raw IQ file (RFUAV interleaved float32)")
    ap.add_argument("--fs", type=float, default=100e6)
    ap.add_argument("--duration-s", type=float, default=0.1)
    ap.add_argument("--frame", type=int, default=0)
    ap.add_argument("--synthetic-drone", default=None, help="generate rfuav_fhss_video_like for this drone")
    ap.add_argument("--snr-db", type=float, default=14.0)
    ap.add_argument("--seed", type=int, default=777)
    ap.add_argument("--title", default=None)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.iq:
        n = int(args.fs * args.duration_s)
        iq = load_raw_iq(args.iq, count=n, offset_samples=args.frame * n)
        if len(iq) == 0:
            raise SystemExit("no samples read")
        title = args.title or f"{Path(args.iq).name} frame {args.frame} (real raw IQ)"
    elif args.synthetic_drone:
        spec = SynthSpec(
            label="rfuav_fhss_video_like",
            seed=args.seed,
            snr_db=args.snr_db,
            drone=args.synthetic_drone,
            fs=args.fs,
            duration_s=args.duration_s,
        )
        iq, _ = synthesize(spec)
        title = args.title or f"{args.synthetic_drone} synthetic (SNR {args.snr_db} dB, seed {args.seed})"
    else:
        raise SystemExit("pass --iq or --synthetic-drone")

    stft_sensitivity_figure(iq, args.fs, args.out, title)
    print(f"[done] {args.out}")


if __name__ == "__main__":
    main()
