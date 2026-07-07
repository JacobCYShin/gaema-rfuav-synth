"""Image-domain morphology feature estimation.

Works on any spectrogram intensity array in [0,1] (real RFUAV JPEG converted
to grayscale, or a normalized synthetic dB array), with known physical extents
(frame duration, frequency span). Estimates the RFUAV fingerprint quantities:
occupied bandwidth, burst duration, hopping interval / pattern period, video
bandwidth, and an intensity-ratio SNR proxy.

The SNR estimate on colormapped JPEGs is a *proxy* (colormap + JPEG are not
power-linear); it is stored as such in feature_params.notes.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage


@dataclass
class Region:
    t_center_ms: float
    t_width_ms: float
    f_center_mhz: float
    f_height_mhz: float
    mean_intensity: float


def _threshold(intensity: np.ndarray) -> float:
    bg = float(np.median(intensity))
    hi = float(np.percentile(intensity, 99.5))
    return bg + 0.45 * (hi - bg)


def find_regions(
    intensity: np.ndarray,
    duration_ms: float,
    span_mhz: float,
    min_area_px: int = 30,
) -> list[Region]:
    """Threshold + connected components. Row 0 = highest frequency."""
    thr = _threshold(intensity)
    mask = intensity > thr
    mask = ndimage.binary_opening(mask, structure=np.ones((2, 2)))
    mask = ndimage.binary_closing(mask, structure=np.ones((3, 3)))
    labels, n = ndimage.label(mask)
    h, w = intensity.shape
    regions: list[Region] = []
    for sl in ndimage.find_objects(labels):
        if sl is None:
            continue
        rr, cc = sl
        area = (rr.stop - rr.start) * (cc.stop - cc.start)
        if area < min_area_px:
            continue
        t0, t1 = cc.start / w * duration_ms, cc.stop / w * duration_ms
        # row 0 = +span/2
        f_hi = span_mhz / 2 - rr.start / h * span_mhz
        f_lo = span_mhz / 2 - rr.stop / h * span_mhz
        regions.append(
            Region(
                t_center_ms=(t0 + t1) / 2,
                t_width_ms=t1 - t0,
                f_center_mhz=(f_lo + f_hi) / 2,
                f_height_mhz=f_hi - f_lo,
                mean_intensity=float(intensity[rr, cc].mean()),
            )
        )
    return regions


def _estimate_pattern_period(
    bursts: list[Region], hop_interval_ms: float | None
) -> float | None:
    """Find the smallest lag at which the hop channel sequence repeats."""
    if hop_interval_ms is None or len(bursts) < 6:
        return None
    seq = [b.f_center_mhz for b in sorted(bursts, key=lambda b: b.t_center_ms)]
    tol = max(np.median([b.f_height_mhz for b in bursts]) * 0.5, 0.5)
    for lag in range(2, len(seq) // 2 + 1):
        pairs = list(zip(seq, seq[lag:]))
        ok = sum(abs(a - b) < tol for a, b in pairs)
        if pairs and ok / len(pairs) > 0.8:
            return lag * hop_interval_ms
    return None


def extract_features(
    intensity: np.ndarray,
    duration_ms: float,
    span_mhz: float,
    edge_trim_frac: float = 0.03,
) -> dict:
    """Return morphology estimates from one spectrogram frame."""
    h = intensity.shape[0]
    trim = int(h * edge_trim_frac)
    core = intensity[trim : h - trim] if trim else intensity
    span_core = span_mhz * core.shape[0] / h

    regions = find_regions(core, duration_ms, span_core)
    thr = _threshold(core)
    bg = float(np.mean(core[core <= thr])) if np.any(core <= thr) else float(np.median(core))

    # split regions: bursts (short) vs video-like (persistent, > 40% of frame)
    bursts = [r for r in regions if r.t_width_ms < 0.4 * duration_ms]
    videos = [r for r in regions if r.t_width_ms >= 0.4 * duration_ms]

    hop_interval = None
    if len(bursts) >= 3:
        centers = np.sort([b.t_center_ms for b in bursts])
        diffs = np.diff(centers)
        diffs = diffs[diffs > 0.05]
        if len(diffs):
            hop_interval = float(np.median(diffs))

    sig_int = float(np.mean([r.mean_intensity for r in regions])) if regions else None
    snr_proxy = (
        10.0 * np.log10(max(sig_int, 1e-6) / max(bg, 1e-6)) if sig_int is not None else None
    )

    return {
        "estimated_bandwidth_mhz": float(np.median([b.f_height_mhz for b in bursts])) if bursts else None,
        "estimated_burst_duration_ms": float(np.median([b.t_width_ms for b in bursts])) if bursts else None,
        "estimated_hopping_interval_ms": hop_interval,
        "estimated_hopping_period_ms": _estimate_pattern_period(bursts, hop_interval),
        "estimated_video_bandwidth_mhz": float(np.median([v.f_height_mhz for v in videos])) if videos else None,
        "estimated_snr_db": snr_proxy,
        "n_burst_regions": len(bursts),
        "n_video_regions": len(videos),
    }
