"""rfuav_fhss_like: frequency-hopping drone control signal generator.

Parameterised by the RFUAV paper's drone RF fingerprint quantities:
  FHSBW  - per-burst occupied bandwidth (MHz)
  FHSDT  - burst duration (ms)
  FHSDC  - duty-cycle period, i.e. time between consecutive burst starts (ms)
  FHSPP  - hopping pattern period (ms); the channel sequence repeats with this period
plus hop_span (total band the hops cover) and a center frequency offset.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .events import SignalEvent
from .noise import band_limited_noise


@dataclass
class FHSSParams:
    fhsbw_mhz: float = 3.5
    fhsdt_ms: float = 0.56
    fhsdc_ms: float = 5.96
    fhspp_ms: float = 40.0
    hop_span_mhz: float = 20.0
    center_offset_mhz: float = 0.0
    burst_power: float = 1.0
    # augmentation knobs applied at generation time
    timing_jitter_ms: float = 0.0
    dropout_prob: float = 0.0
    # per-burst irregularity (real links are not clockwork):
    amp_jitter_db: float = 0.0        # per-burst power ~ N(0, amp_jitter_db)
    duration_jitter_frac: float = 0.0  # per-burst length +/- this fraction
    freq_jitter_mhz: float = 0.0       # per-burst center-frequency wobble
    notes: str = ""


def _burst_envelope(n: int, ramp_frac: float = 0.08) -> np.ndarray:
    """Raised-cosine on/off ramps so bursts don't have artificial hard edges."""
    env = np.ones(n)
    r = max(int(n * ramp_frac), 1)
    ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(r) / r)
    env[:r] = ramp
    env[-r:] = ramp[::-1]
    return env


def generate_fhss(
    params: FHSSParams,
    fs: float,
    duration_s: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, list[SignalEvent]]:
    """Generate a complex-baseband FHSS control signal frame.

    Returns unit-scale IQ (burst power = params.burst_power during ON time)
    and one SignalEvent per emitted burst.
    """
    n_total = int(round(fs * duration_s))
    iq = np.zeros(n_total, dtype=np.complex128)
    events: list[SignalEvent] = []

    bw = params.fhsbw_mhz * 1e6
    burst_len = max(int(round(params.fhsdt_ms * 1e-3 * fs)), 16)
    hop_period = params.fhsdc_ms * 1e-3
    if hop_period <= 0:
        raise ValueError("fhsdc_ms must be positive")

    # hopping channel plan: channels spaced by FHSBW across hop_span
    span = max(params.hop_span_mhz * 1e6, bw)
    n_channels = max(int(span // bw), 1)
    span = n_channels * bw
    channel_centers = (np.arange(n_channels) - (n_channels - 1) / 2.0) * bw + params.center_offset_mhz * 1e6

    # pattern repeats every FHSPP: draw a fixed random channel sequence of that length
    hops_per_pattern = max(int(round(params.fhspp_ms / params.fhsdc_ms)), 1)
    pattern = rng.integers(0, n_channels, size=hops_per_pattern)

    n_hops = int(np.ceil(duration_s / hop_period)) + 1
    for k in range(n_hops):
        if params.dropout_prob > 0 and rng.random() < params.dropout_prob:
            continue
        t0 = k * hop_period
        if params.timing_jitter_ms > 0:
            t0 += rng.uniform(-1, 1) * params.timing_jitter_ms * 1e-3
        i0 = int(round(t0 * fs))
        n_burst = burst_len
        if params.duration_jitter_frac > 0:
            n_burst = max(int(round(burst_len * (1 + rng.uniform(-1, 1) * params.duration_jitter_frac))), 16)
        if i0 >= n_total or i0 + n_burst <= 0:
            continue
        fc = float(channel_centers[pattern[k % hops_per_pattern]])
        if params.freq_jitter_mhz > 0:
            fc += rng.uniform(-1, 1) * params.freq_jitter_mhz * 1e6
        power = params.burst_power
        if params.amp_jitter_db > 0:
            power *= 10.0 ** (rng.normal(0.0, params.amp_jitter_db) / 10.0)
        burst = band_limited_noise(n_burst, bw / fs, fc / fs, rng, shape="gauss")
        burst *= _burst_envelope(n_burst) * np.sqrt(power)
        a, b = max(i0, 0), min(i0 + n_burst, n_total)
        iq[a:b] += burst[a - i0 : b - i0]
        events.append(
            SignalEvent(
                t_start=a / fs,
                t_end=b / fs,
                f_low=fc - bw / 2.0,
                f_high=fc + bw / 2.0,
                kind="fhss_burst",
            )
        )
    return iq, events
