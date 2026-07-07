"""Complex noise sources."""
from __future__ import annotations

import numpy as np


def complex_awgn(n: int, power: float = 1.0, rng: np.random.Generator | None = None) -> np.ndarray:
    """Circularly-symmetric complex Gaussian noise with the given mean power."""
    rng = rng or np.random.default_rng()
    scale = np.sqrt(power / 2.0)
    return scale * (rng.standard_normal(n) + 1j * rng.standard_normal(n))


def band_limited_noise(
    n: int,
    bw_frac: float,
    f_center_frac: float = 0.0,
    rng: np.random.Generator | None = None,
    shape: str = "flat",
) -> np.ndarray:
    """Unit-power complex noise occupying ``bw_frac`` of the sample rate at
    ``f_center_frac`` (both as fractions of fs, f in [-0.5, 0.5)).

    shape="flat": brick-wall PSD with a raised-cosine edge (OFDM/video-like).
    shape="gauss": Gaussian PSD whose -6 dB (power) width equals bw_frac -
    matches the rounded spectral skirts of real GFSK-style control bursts.
    """
    rng = rng or np.random.default_rng()
    x = complex_awgn(n, 1.0, rng)
    spec = np.fft.fft(x)
    freqs = np.fft.fftfreq(n)
    d = np.abs(((freqs - f_center_frac + 0.5) % 1.0) - 0.5)  # circular distance to center
    half_bw = bw_frac / 2.0
    if shape == "gauss":
        # amplitude mask sigma such that POWER drops 6 dB at +/- half_bw
        sigma = half_bw / np.sqrt(2.0 * np.log(10.0 ** 0.6))
        mask = np.exp(-0.5 * (d / max(sigma, 1.0 / n)) ** 2)
    else:
        # raised-cosine transition over 5% of the bandwidth on each side
        trans = max(half_bw * 0.1, 1.0 / n)
        mask = np.clip((half_bw + trans - d) / trans, 0.0, 1.0)
        mask = 0.5 - 0.5 * np.cos(np.pi * mask)  # smooth 0->1
    y = np.fft.ifft(spec * mask)
    p = np.mean(np.abs(y) ** 2)
    if p > 0:
        y = y / np.sqrt(p)
    return y
