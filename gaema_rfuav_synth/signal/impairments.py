"""Receiver front-end impairments.

These are the main drivers of the sim-to-real gap for spectrogram data
(cf. CSRD2025, arXiv:2508.19552): DC offset (center spike), IQ imbalance
(image tones), CFO, phase noise, and band-edge roll-off of the receive filter
(the dark bands at the top/bottom of real RFUAV spectrograms).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class ImpairmentParams:
    dc_offset_db: float | None = -18.0  # DC spike power relative to frame mean power; None = off
    iq_gain_imbalance_db: float = 0.2
    iq_phase_imbalance_deg: float = 1.0
    cfo_hz: float = 0.0
    phase_noise_std: float = 0.0  # rad per sample (random-walk step)
    edge_rolloff_frac: float = 0.04  # fraction of band tapered at each edge; 0 = off
    edge_rolloff_db: float = 20.0


def apply_dc_offset(iq: np.ndarray, level_db: float) -> np.ndarray:
    p = np.mean(np.abs(iq) ** 2)
    amp = np.sqrt(p * 10.0 ** (level_db / 10.0))
    return iq + amp


def apply_iq_imbalance(iq: np.ndarray, gain_db: float, phase_deg: float) -> np.ndarray:
    g = 10.0 ** (gain_db / 20.0)
    phi = np.deg2rad(phase_deg)
    i, q = iq.real, iq.imag
    return (g * i) + 1j * (q * np.cos(phi) + i * np.sin(phi))


def apply_cfo(iq: np.ndarray, cfo_hz: float, fs: float) -> np.ndarray:
    return iq * np.exp(2j * np.pi * cfo_hz * np.arange(len(iq)) / fs)


def apply_phase_noise(iq: np.ndarray, std_rad: float, rng: np.random.Generator) -> np.ndarray:
    phase = np.cumsum(rng.standard_normal(len(iq)) * std_rad)
    return iq * np.exp(1j * phase)


def apply_edge_rolloff(iq: np.ndarray, frac: float, atten_db: float) -> np.ndarray:
    """Attenuate the outer ``frac`` of the (fftshifted) band by up to atten_db,
    emulating the receive filter roll-off visible in real captures."""
    n = len(iq)
    spec = np.fft.fftshift(np.fft.fft(iq))
    edge = max(int(n * frac), 1)
    ramp_db = np.linspace(-atten_db, 0.0, edge)
    gain = np.ones(n)
    gain[:edge] = 10.0 ** (ramp_db / 20.0)
    gain[-edge:] = 10.0 ** (ramp_db[::-1] / 20.0)
    return np.fft.ifft(np.fft.ifftshift(spec * gain))


def apply_impairments(
    iq: np.ndarray,
    params: ImpairmentParams,
    fs: float,
    rng: np.random.Generator,
) -> np.ndarray:
    out = iq
    if params.cfo_hz:
        out = apply_cfo(out, params.cfo_hz, fs)
    if params.phase_noise_std > 0:
        out = apply_phase_noise(out, params.phase_noise_std, rng)
    if params.iq_gain_imbalance_db or params.iq_phase_imbalance_deg:
        out = apply_iq_imbalance(out, params.iq_gain_imbalance_db, params.iq_phase_imbalance_deg)
    if params.dc_offset_db is not None:
        out = apply_dc_offset(out, params.dc_offset_db)
    if params.edge_rolloff_frac > 0:
        out = apply_edge_rolloff(out, params.edge_rolloff_frac, params.edge_rolloff_db)
    return out
