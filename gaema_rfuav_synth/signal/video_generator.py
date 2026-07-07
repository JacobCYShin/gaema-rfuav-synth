"""rfuav_video_like: drone video-transmission wideband signal generator.

Modelled as a continuous OFDM-like wideband emission of bandwidth VTSBW at a
center-frequency offset, with slow amplitude ripple so the spectrogram texture
is not perfectly flat (real video links show frame-rate power variation).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter1d

from .events import SignalEvent
from .noise import band_limited_noise


@dataclass
class VideoParams:
    vtsbw_mhz: float = 10.0
    center_offset_mhz: float = 0.0
    power: float = 1.0
    t_start_ms: float = 0.0
    duration_ms: float | None = None  # None -> until end of frame
    ripple_depth: float = 0.15  # fractional slow AM depth
    ripple_rate_hz: float = 120.0
    notes: str = ""


def generate_video(
    params: VideoParams,
    fs: float,
    duration_s: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, list[SignalEvent]]:
    n_total = int(round(fs * duration_s))
    iq = np.zeros(n_total, dtype=np.complex128)

    t0 = params.t_start_ms * 1e-3
    t1 = duration_s if params.duration_ms is None else min(t0 + params.duration_ms * 1e-3, duration_s)
    i0, i1 = int(round(t0 * fs)), int(round(t1 * fs))
    n = i1 - i0
    if n <= 0:
        return iq, []

    bw = params.vtsbw_mhz * 1e6
    fc = params.center_offset_mhz * 1e6
    sig = band_limited_noise(n, bw / fs, fc / fs, rng)

    if params.ripple_depth > 0:
        # slow random AM: smoothed noise at ~ripple_rate_hz
        n_ctrl = max(int((t1 - t0) * params.ripple_rate_hz) * 4, 8)
        ctrl = gaussian_filter1d(rng.standard_normal(n_ctrl), sigma=2.0)
        ctrl = ctrl / (np.max(np.abs(ctrl)) + 1e-12)
        env = 1.0 + params.ripple_depth * np.interp(
            np.linspace(0, 1, n), np.linspace(0, 1, n_ctrl), ctrl
        )
        sig *= env

    p = np.mean(np.abs(sig) ** 2)
    sig *= np.sqrt(params.power / p)
    iq[i0:i1] = sig
    events = [
        SignalEvent(
            t_start=t0,
            t_end=t1,
            f_low=fc - bw / 2.0,
            f_high=fc + bw / 2.0,
            kind="video_signal",
        )
    ]
    return iq, events
