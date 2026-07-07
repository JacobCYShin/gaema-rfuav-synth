"""Channel effects: frequency shift and slow amplitude fading."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter1d


def frequency_shift(iq: np.ndarray, df_hz: float, fs: float) -> np.ndarray:
    """Multiply by a complex exponential -> vertical translation on the spectrogram."""
    n = len(iq)
    return iq * np.exp(2j * np.pi * df_hz * np.arange(n) / fs)


def amplitude_fading(
    iq: np.ndarray,
    fs: float,
    fade_rate_hz: float = 50.0,
    depth_db: float = 6.0,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Slow log-normal amplitude fading (flat over frequency).

    ``depth_db`` is the approximate peak-to-peak envelope variation.
    """
    rng = rng or np.random.default_rng()
    n = len(iq)
    n_ctrl = max(int(len(iq) / fs * fade_rate_hz) * 4, 8)
    ctrl = gaussian_filter1d(rng.standard_normal(n_ctrl), sigma=2.0)
    ctrl = ctrl / (np.max(np.abs(ctrl)) + 1e-12)
    env_db = ctrl * depth_db / 2.0
    env = 10.0 ** (np.interp(np.linspace(0, 1, n), np.linspace(0, 1, n_ctrl), env_db) / 20.0)
    return iq * env
