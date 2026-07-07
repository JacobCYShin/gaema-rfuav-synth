"""Extract signal-free background segments from real raw IQ.

Real captures spend most of their time between FHSS bursts; those gaps carry
the true receiver noise texture plus ambient interference. We find them with
a wideband moving-RMS envelope and keep contiguous quiet runs, which become
the background pool that synthetic signals are mixed onto.
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d


def quiet_mask(
    iq: np.ndarray,
    fs: float,
    win_us: float = 50.0,
    margin_db: float = 1.5,
) -> np.ndarray:
    """True where the wideband envelope is within margin_db of the quiet level.

    The quiet level is the 20th percentile of the moving mean power - robust
    because bursts occupy a small fraction of time.
    """
    win = max(int(fs * win_us * 1e-6), 8)
    p = uniform_filter1d(np.abs(iq).astype(np.float64) ** 2, win)
    quiet_level = np.percentile(p, 20.0)
    mask = p < quiet_level * 10.0 ** (margin_db / 10.0)
    # erode edges so burst ramps don't leak into the pool
    mask = uniform_filter1d(mask.astype(np.float32), win) > 0.999
    return mask


def extract_background(
    iq: np.ndarray,
    fs: float,
    min_run_ms: float = 0.5,
    max_total_s: float = 0.3,
    win_us: float = 50.0,
    margin_db: float = 1.5,
) -> tuple[np.ndarray, float]:
    """Return (concatenated quiet samples as complex64, quiet fraction)."""
    mask = quiet_mask(iq, fs, win_us, margin_db)
    min_run = int(min_run_ms * 1e-3 * fs)
    max_total = int(max_total_s * fs)

    edges = np.flatnonzero(np.diff(mask.astype(np.int8)))
    bounds = np.concatenate([[0], edges + 1, [len(mask)]])
    chunks: list[np.ndarray] = []
    total = 0
    for a, b in zip(bounds[:-1], bounds[1:]):
        if not mask[a] or (b - a) < min_run:
            continue
        take = min(b - a, max_total - total)
        chunks.append(iq[a : a + take].astype(np.complex64))
        total += take
        if total >= max_total:
            break
    if not chunks:
        raise ValueError("no quiet segments found; relax margin_db or min_run_ms")
    return np.concatenate(chunks), float(mask.mean())


class BackgroundPool:
    """Sampler over an extracted background pool (.npy of complex64).

    sample() returns a contiguous chunk (circular) with a random phase
    rotation; power is left untouched so the pool's real noise+interference
    level is preserved.
    """

    def __init__(self, samples: np.ndarray):
        if len(samples) < 1024:
            raise ValueError("background pool too small")
        self.samples = np.asarray(samples, dtype=np.complex64)

    @classmethod
    def load(cls, path: str) -> "BackgroundPool":
        return cls(np.load(path))

    def sample(self, n: int, rng: np.random.Generator) -> np.ndarray:
        pool = self.samples
        start = int(rng.integers(0, len(pool)))
        idx = (start + np.arange(n)) % len(pool)
        chunk = pool[idx].astype(np.complex128)
        chunk *= np.exp(1j * rng.uniform(0, 2 * np.pi))
        return chunk
