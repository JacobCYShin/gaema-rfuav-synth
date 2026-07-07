"""Raw-IQ-domain morphology feature estimation (V1, replaces the image proxy).

Operates on the dB STFT of complex IQ directly, so thresholds are physical
(dB above the per-frequency noise floor) instead of colormap-intensity
heuristics, and SNR follows the RFUAV definition
SNR = 10*log10((P_{S+N} - P_N) / P_N).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from ..transform.stft import STFTPreset, compute_stft


@dataclass
class IQRegion:
    t_start_ms: float
    t_end_ms: float
    f_low_mhz: float  # baseband, frame spans [-fs/2, fs/2)
    f_high_mhz: float
    peak_db_over_floor: float
    mean_db_over_floor: float

    @property
    def t_center_ms(self) -> float:
        return 0.5 * (self.t_start_ms + self.t_end_ms)

    @property
    def t_width_ms(self) -> float:
        return self.t_end_ms - self.t_start_ms

    @property
    def f_center_mhz(self) -> float:
        return 0.5 * (self.f_low_mhz + self.f_high_mhz)

    @property
    def f_height_mhz(self) -> float:
        return self.f_high_mhz - self.f_low_mhz


def detect_regions(
    iq: np.ndarray,
    fs: float,
    stft_point: int = 256,
    thresh_db: float = 5.0,
    min_area_cells: int = 12,
    edge_trim_frac: float = 0.03,
    smooth_cells: tuple[int, int] = (3, 25),
) -> tuple[list[IQRegion], np.ndarray, float]:
    """Threshold the SMOOTHED dB spectrogram at (noise floor + thresh_db).

    Single |STFT|^2 cells of noise have ~4.3 dB std, so cell-level
    thresholding cannot separate low-SNR bursts from speckle; averaging over
    smooth_cells (freq x time) shrinks the noise std ~sqrt(N) while coherent
    bursts keep their level. The per-frequency floor (median over time)
    absorbs the receiver's band-edge roll-off and DC spike.
    """
    preset = STFTPreset(stft_point=stft_point, window="hamming", overlap_ratio=0.5)
    f, t, s_db = compute_stft(iq, fs, preset)
    n_f, n_t = s_db.shape
    trim = int(n_f * edge_trim_frac)

    floor = np.median(s_db, axis=1, keepdims=True)  # per-frequency noise floor
    over = s_db - floor
    over_smooth = ndimage.uniform_filter(over, size=smooth_cells)
    mask = over_smooth > thresh_db
    if trim:
        mask[:trim] = False
        mask[-trim:] = False
    labels, n = ndimage.label(mask)

    dur_ms = len(iq) / fs * 1e3
    span_mhz = fs / 1e6
    regions: list[IQRegion] = []
    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        rr, cc = sl
        cells = int(np.sum(labels[sl] == idx))
        if cells < min_area_cells:
            continue
        vals = over[sl][labels[sl] == idx]
        # refine occupied bandwidth: -6 dB width of the time-averaged spectrum
        # around the region (the raw mask overestimates by leakage + closing)
        lo = max(rr.start - 4, 0)
        hi = min(rr.stop + 4, n_f)
        prof = over[lo:hi, cc.start : cc.stop].mean(axis=1)
        above = np.flatnonzero(prof >= prof.max() - 6.0)
        f_lo_bin = lo + int(above.min())
        f_hi_bin = lo + int(above.max()) + 1
        regions.append(
            IQRegion(
                t_start_ms=cc.start / n_t * dur_ms,
                t_end_ms=cc.stop / n_t * dur_ms,
                f_low_mhz=-span_mhz / 2 + f_lo_bin / n_f * span_mhz,
                f_high_mhz=-span_mhz / 2 + f_hi_bin / n_f * span_mhz,
                peak_db_over_floor=float(vals.max()),
                mean_db_over_floor=float(vals.mean()),
            )
        )
    return regions, s_db, float(np.median(floor))


def _hop_interval(bursts: list[IQRegion]) -> tuple[float | None, float | None]:
    if len(bursts) < 3:
        return None, None
    centers = np.sort([b.t_center_ms for b in bursts])
    diffs = np.diff(centers)
    diffs = diffs[diffs > 0.05]
    if not len(diffs):
        return None, None
    return float(np.median(diffs)), float(np.std(diffs))


def extract_iq_features(
    iq: np.ndarray,
    fs: float,
    stft_point: int = 256,
    thresh_db: float = 5.0,
    min_peak_db: float = 10.0,
) -> dict:
    """Morphology estimates from one raw IQ frame (real or synthetic).

    Detected regions split into two populations on real captures: marginal
    blobs peaking a few dB over the floor (noise/interference residue) and
    true bursts peaking well above it. Only regions with
    peak >= min_peak_db enter the burst statistics.
    """
    regions, s_db, floor_db = detect_regions(iq, fs, stft_point, thresh_db)
    dur_ms = len(iq) / fs * 1e3

    strong = [r for r in regions if r.peak_db_over_floor >= min_peak_db]
    bursts = [r for r in strong if r.t_width_ms < 0.4 * dur_ms]
    videos = [r for r in strong if r.t_width_ms >= 0.4 * dur_ms]
    hop_med, hop_std = _hop_interval(bursts)

    # RFUAV-style SNR: mean in-burst power vs noise floor (linear domain)
    snr = None
    if bursts:
        mean_over = float(np.median([b.mean_db_over_floor for b in bursts]))
        p_ratio = 10.0 ** (mean_over / 10.0)  # (S+N)/N
        snr = 10.0 * np.log10(max(p_ratio - 1.0, 1e-9))

    def med(vals):
        return float(np.median(vals)) if len(vals) else None

    def std(vals):
        return float(np.std(vals)) if len(vals) else None

    b_bw = [b.f_height_mhz for b in bursts]
    b_dur = [b.t_width_ms for b in bursts]
    centers = [b.f_center_mhz for b in bursts]
    return {
        "estimated_bandwidth_mhz": med(b_bw),
        "estimated_bandwidth_std_mhz": std(b_bw),
        "estimated_burst_duration_ms": med(b_dur),
        "estimated_burst_duration_std_ms": std(b_dur),
        "estimated_hopping_interval_ms": hop_med,
        "estimated_hopping_interval_std_ms": hop_std,
        "estimated_hop_span_mhz": (max(centers) - min(centers) + (med(b_bw) or 0.0)) if centers else None,
        "estimated_snr_db": snr,
        "estimated_video_bandwidth_mhz": med([v.f_height_mhz for v in videos]),
        "noise_floor_db": floor_db,
        "n_burst_regions": len(bursts),
        "n_video_regions": len(videos),
    }
