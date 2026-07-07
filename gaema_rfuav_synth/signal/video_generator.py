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
    # TDD slot structure (DJI OcuSync-style video is bursty, not continuous):
    # when slot_period_ms is set, the link is ON for duty*slot_period every
    # slot_period, each slot emitted as its own burst with soft ramps.
    slot_period_ms: float | None = None
    duty: float = 1.0
    slot_jitter_ms: float = 0.0
    # in-band spectral ripple (log-normal, correlated over ~corr_khz): real
    # OFDM slots are not spectrally flat - pilots/fading spread the per-cell
    # level distribution by several dB
    spectral_ripple_db: float = 0.0
    ripple_corr_khz: float = 400.0
    notes: str = ""


def _apply_spectral_ripple(
    x: np.ndarray, fs: float, ripple_db: float, corr_khz: float, rng: np.random.Generator
) -> np.ndarray:
    """Multiply the signal's spectrum by a correlated log-normal gain."""
    n = len(x)
    spec = np.fft.fft(x)
    corr_bins = max(corr_khz * 1e3 / (fs / n), 1.0)
    g = gaussian_filter1d(rng.standard_normal(n), sigma=corr_bins, mode="wrap")
    g = g / (g.std() + 1e-12) * ripple_db
    return np.fft.ifft(spec * 10.0 ** (g / 20.0))


def _slot_envelope(n: int, ramp_frac: float = 0.03) -> np.ndarray:
    env = np.ones(n)
    r = max(int(n * ramp_frac), 1)
    ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(r) / r)
    env[:r] = ramp
    env[-r:] = ramp[::-1]
    return env


def generate_video(
    params: VideoParams,
    fs: float,
    duration_s: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, list[SignalEvent]]:
    n_total = int(round(fs * duration_s))
    iq = np.zeros(n_total, dtype=np.complex128)

    if params.slot_period_ms:
        # bursty TDD link: one band-limited burst per slot
        bw = params.vtsbw_mhz * 1e6
        fc = params.center_offset_mhz * 1e6
        period = params.slot_period_ms * 1e-3
        on_s = max(params.duty, 0.05) * period
        events: list[SignalEvent] = []
        k = 0
        while True:
            t0 = k * period
            if params.slot_jitter_ms > 0:
                t0 += rng.uniform(-1, 1) * params.slot_jitter_ms * 1e-3
            i0 = int(round(t0 * fs))
            if i0 >= n_total:
                break
            n = int(round(on_s * fs))
            a, b = max(i0, 0), min(i0 + n, n_total)
            if b - a > 64:
                slot = band_limited_noise(n, bw / fs, fc / fs, rng)
                if params.spectral_ripple_db > 0:
                    slot = _apply_spectral_ripple(
                        slot, fs, params.spectral_ripple_db, params.ripple_corr_khz, rng
                    )
                slot *= _slot_envelope(n) * np.sqrt(params.power)
                iq[a:b] += slot[a - i0 : b - i0]
                events.append(
                    SignalEvent(a / fs, b / fs, fc - bw / 2, fc + bw / 2, "video_signal")
                )
            k += 1
        return iq, events

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
