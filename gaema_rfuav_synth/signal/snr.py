"""SNR measurement and AWGN-based SNR control.

Convention (matches RFUAV's benchmark methodology): SNR = 10*log10(P_signal / P_noise)
where P_signal is the mean power of the clean signal component over the frame
and P_noise the mean power of the added complex AWGN. RFUAV likewise creates
its graded-SNR benchmark by adding calibrated complex AWGN to clean captures.
"""
from __future__ import annotations

import numpy as np

from .noise import complex_awgn


def measure_power(x: np.ndarray) -> float:
    return float(np.mean(np.abs(x) ** 2))


def snr_db(signal: np.ndarray, noise: np.ndarray) -> float:
    return 10.0 * np.log10(measure_power(signal) / measure_power(noise))


def add_awgn_at_snr(
    signal: np.ndarray,
    target_snr_db: float,
    rng: np.random.Generator | None = None,
    signal_power: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (signal + noise, noise) such that P_sig/P_noise hits the target.

    ``signal_power`` may be passed explicitly (e.g. burst-band power) to use a
    different reference than the whole-frame mean.
    """
    rng = rng or np.random.default_rng()
    p_sig = measure_power(signal) if signal_power is None else signal_power
    if p_sig <= 0:
        raise ValueError("signal power must be positive to set an SNR")
    p_noise = p_sig / (10.0 ** (target_snr_db / 10.0))
    noise = complex_awgn(len(signal), p_noise, rng)
    return signal + noise, noise


def snr_sweep(start_db: float = -20.0, stop_db: float = 20.0, step_db: float = 2.0) -> list[float]:
    """RFUAV benchmark grid: -20..+20 dB in 2 dB steps by default."""
    n = int(round((stop_db - start_db) / step_db)) + 1
    return [start_db + i * step_db for i in range(n)]
