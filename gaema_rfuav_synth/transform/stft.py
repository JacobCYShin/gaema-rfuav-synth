"""STFT pipeline replicating RFUAV's graphic/RawDataProcessor.py.

RFUAV reference (repo commit df72bea):
  scipy.signal.stft, window=hamming(stft_point), nperseg=stft_point,
  noverlap=default (nperseg//2), return_onesided=False, then fftshift and
  10*log10(|Zxx|). The paper's ablation found stft_point=256 optimal.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import stft as scipy_stft
from scipy.signal import windows


@dataclass
class STFTPreset:
    name: str = "rfuav_paper_best"
    stft_point: int = 256
    window: str = "hamming"  # hamming | hann
    overlap_ratio: float = 0.5
    colormap: str = "hot"
    normalization: str = "fixed_db"  # autoscale (RFUAV repo behaviour) | fixed_db
    dynamic_range_db: float = 70.0  # used when normalization == fixed_db


def _window(preset: STFTPreset) -> np.ndarray:
    if preset.window == "hamming":
        return windows.hamming(preset.stft_point)
    if preset.window == "hann":
        return windows.hann(preset.stft_point)
    raise ValueError(f"unknown window {preset.window!r}")


def compute_stft(iq: np.ndarray, fs: float, preset: STFTPreset):
    """Return (f, t, s_db): fftshifted two-sided dB spectrogram, f ascending."""
    noverlap = int(preset.stft_point * preset.overlap_ratio)
    f, t, zxx = scipy_stft(
        iq,
        fs,
        window=_window(preset),
        nperseg=preset.stft_point,
        noverlap=noverlap,
        return_onesided=False,
    )
    f = np.fft.fftshift(f)
    zxx = np.fft.fftshift(zxx, axes=0)
    s_db = 10.0 * np.log10(np.abs(zxx) + 1e-12)
    return f, t, s_db.astype(np.float32)


def normalize_db(s_db: np.ndarray, preset: STFTPreset) -> tuple[float, float]:
    """Return (vmin, vmax) for rendering. 'autoscale' mirrors RFUAV's
    per-frame matplotlib autoscale; 'fixed_db' anchors vmin near the noise
    floor's lower tail (1st percentile) so the background renders at the
    bottom of the colormap like the real ImageSet, with dynamic_range_db as a
    cap on the total range."""
    if preset.normalization == "autoscale":
        return float(s_db.min()), float(s_db.max())
    vmax = float(np.percentile(s_db, 99.9))
    vmin = float(np.percentile(s_db, 1.0))
    if vmax - vmin > preset.dynamic_range_db:
        vmin = vmax - preset.dynamic_range_db
    if vmax - vmin < 1e-6:
        vmax = vmin + 1e-6
    return vmin, vmax
