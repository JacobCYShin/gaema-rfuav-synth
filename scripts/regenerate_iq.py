"""Regenerate byte-identical IQ for a sample from specs.json (no stored IQ needed).

Usage:
  python scripts/regenerate_iq.py synth_00002_rfuav_fhss_like_DJI_MINI3 \
      [--specs outputs/synthetic_samples/specs.json] [--out outputs/regen]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gaema_rfuav_synth.dataset.exporter import spec_from_dict, synthesize


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sample_id")
    ap.add_argument("--specs", default="outputs/synthetic_samples/specs.json")
    ap.add_argument("--out", default="outputs/regen")
    args = ap.parse_args()

    specs = json.loads(Path(args.specs).read_text())
    if args.sample_id not in specs:
        raise SystemExit(f"{args.sample_id} not in {args.specs}; available: {list(specs)[:5]}...")
    spec = spec_from_dict(specs[args.sample_id])
    iq, events = synthesize(spec)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    inter = np.empty(2 * len(iq), dtype=np.float32)
    inter[0::2], inter[1::2] = iq.real, iq.imag
    dest = out / f"{args.sample_id}.iq"
    inter.tofile(dest)
    print(f"[done] {dest} ({len(iq)} complex samples, {len(events)} events, seed={spec.seed})")


if __name__ == "__main__":
    main()
