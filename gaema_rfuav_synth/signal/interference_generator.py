"""Interference generators: wifi_like, lora_iot_like, mixed_interference.

These are morphology-level models (bandwidth / timing / chirp shape), not
protocol implementations.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .events import SignalEvent
from .fhss_generator import _burst_envelope
from .noise import band_limited_noise


@dataclass
class WifiParams:
    bw_mhz: float = 20.0
    center_offset_mhz: float = 0.0
    packet_ms_range: tuple[float, float] = (0.2, 2.0)
    mean_interarrival_ms: float = 3.0
    power: float = 1.0


@dataclass
class LoraParams:
    bw_mhz: float = 0.5
    center_offset_mhz: float = 0.0
    chirp_ms: float = 2.0
    n_chirps: int = 12
    gap_ms: float = 1.0
    power: float = 1.0
    up: bool = True


def generate_wifi(
    params: WifiParams, fs: float, duration_s: float, rng: np.random.Generator
) -> tuple[np.ndarray, list[SignalEvent]]:
    """Wi-Fi-like bursty wideband interference: OFDM-shaped packets with
    exponential inter-arrival times on a fixed channel."""
    n_total = int(round(fs * duration_s))
    iq = np.zeros(n_total, dtype=np.complex128)
    events: list[SignalEvent] = []
    bw = params.bw_mhz * 1e6
    fc = params.center_offset_mhz * 1e6

    t = float(rng.uniform(0, params.mean_interarrival_ms * 1e-3))
    while t < duration_s:
        pkt_s = rng.uniform(*params.packet_ms_range) * 1e-3
        i0 = int(round(t * fs))
        n = min(int(round(pkt_s * fs)), n_total - i0)
        if n > 32:
            burst = band_limited_noise(n, bw / fs, fc / fs, rng)
            burst *= _burst_envelope(n, 0.02) * np.sqrt(params.power)
            iq[i0 : i0 + n] += burst
            events.append(
                SignalEvent(i0 / fs, (i0 + n) / fs, fc - bw / 2, fc + bw / 2, "wifi_burst")
            )
        t += pkt_s + rng.exponential(params.mean_interarrival_ms * 1e-3)
    return iq, events


def generate_lora(
    params: LoraParams, fs: float, duration_s: float, rng: np.random.Generator
) -> tuple[np.ndarray, list[SignalEvent]]:
    """LoRa/IoT-like interference: repeated linear chirps sweeping bw_mhz."""
    n_total = int(round(fs * duration_s))
    iq = np.zeros(n_total, dtype=np.complex128)
    events: list[SignalEvent] = []
    bw = params.bw_mhz * 1e6
    fc = params.center_offset_mhz * 1e6
    chirp_s = params.chirp_ms * 1e-3
    n_chirp = max(int(round(chirp_s * fs)), 64)

    tt = np.arange(n_chirp) / fs
    k = (bw / chirp_s) * (1 if params.up else -1)  # Hz per second sweep rate
    f0 = fc - bw / 2 if params.up else fc + bw / 2
    base = np.exp(2j * np.pi * (f0 * tt + 0.5 * k * tt**2))
    base *= _burst_envelope(n_chirp, 0.03) * np.sqrt(params.power)

    t = float(rng.uniform(0, params.gap_ms * 1e-3))
    for _ in range(params.n_chirps):
        i0 = int(round(t * fs))
        if i0 >= n_total:
            break
        n = min(n_chirp, n_total - i0)
        iq[i0 : i0 + n] += base[:n]
        events.append(
            SignalEvent(i0 / fs, (i0 + n) / fs, fc - bw / 2, fc + bw / 2, "lora_chirp")
        )
        t += chirp_s + params.gap_ms * 1e-3
    return iq, events


def generate_mixed_interference(
    fs: float,
    duration_s: float,
    rng: np.random.Generator,
    n_wifi: int = 2,
    n_lora: int = 1,
    fs_margin_frac: float = 0.42,
) -> tuple[np.ndarray, list[SignalEvent]]:
    """Field-like mixture: several Wi-Fi channels + IoT chirps at random offsets."""
    iq = np.zeros(int(round(fs * duration_s)), dtype=np.complex128)
    events: list[SignalEvent] = []
    lim = fs * fs_margin_frac
    for _ in range(n_wifi):
        p = WifiParams(
            bw_mhz=float(rng.choice([10.0, 20.0])),
            center_offset_mhz=float(rng.uniform(-lim, lim)) / 1e6,
            mean_interarrival_ms=float(rng.uniform(2.0, 8.0)),
            power=float(rng.uniform(0.3, 1.5)),
        )
        x, ev = generate_wifi(p, fs, duration_s, rng)
        iq += x
        events += ev
    for _ in range(n_lora):
        p = LoraParams(
            bw_mhz=float(rng.uniform(0.125, 0.5)),
            center_offset_mhz=float(rng.uniform(-lim, lim)) / 1e6,
            chirp_ms=float(rng.uniform(1.0, 6.0)),
            n_chirps=int(rng.integers(4, 16)),
            power=float(rng.uniform(0.3, 1.5)),
            up=bool(rng.random() < 0.5),
        )
        x, ev = generate_lora(p, fs, duration_s, rng)
        iq += x
        events += ev
    return iq, events
