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
) -> np.ndarray:
    """Unit-power complex noise occupying ``bw_frac`` of the sample rate at
    ``f_center_frac`` (both as fractions of fs, f in [-0.5, 0.5)).

    Implemented as an FFT brick-wall mask with a raised-cosine edge so the
    spectrogram shows a realistic (not perfectly sharp) band edge.
    """
    rng = rng or np.random.default_rng()
    x = complex_awgn(n, 1.0, rng)
    spec = np.fft.fft(x)
    freqs = np.fft.fftfreq(n)
    # raised-cosine transition over 5% of the bandwidth on each side
    half_bw = bw_frac / 2.0
    trans = max(half_bw * 0.1, 1.0 / n)
    d = np.abs(((freqs - f_center_frac + 0.5) % 1.0) - 0.5)  # circular distance to center
    mask = np.clip((half_bw + trans - d) / trans, 0.0, 1.0)
    mask = 0.5 - 0.5 * np.cos(np.pi * mask)  # smooth 0->1
    y = np.fft.ifft(spec * mask)
    p = np.mean(np.abs(y) ** 2)
    if p > 0:
        y = y / np.sqrt(p)
    return y
