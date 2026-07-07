"""End-to-end synthetic sample generation and export.

Pipeline per sample (IQ-first, never image-drawn):
  clean IQ (class generators) -> channel (freq shift / fading, events updated)
  -> AWGN at target SNR -> receiver impairments -> STFT -> PNG + NPY
  -> YOLO labels + metadata/feature rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..labeling.bbox import write_yolo_labels
from ..labeling.taxonomy import class_id
from ..rfuav.feature_extractor import extract_features
from ..rfuav.paper_params import DRONE_PROFILES, REAL_INFORMED_OVERRIDES, DroneProfile
from ..signal.channel import amplitude_fading, frequency_shift
from ..signal.events import SignalEvent
from ..signal.fhss_generator import FHSSParams, generate_fhss
from ..signal.impairments import ImpairmentParams, apply_impairments
from ..signal.interference_generator import (
    LoraParams,
    WifiParams,
    generate_lora,
    generate_mixed_interference,
    generate_wifi,
)
from ..signal.noise import complex_awgn
from ..signal.snr import add_awgn_at_snr, measure_power
from ..signal.video_generator import VideoParams, generate_video
from ..transform.spectrogram import render_png, save_npy
from ..transform.stft import STFTPreset, compute_stft, normalize_db
from .metadata import FeatureParams, SampleMeta


@dataclass
class SynthSpec:
    """Everything needed to (re)generate one synthetic sample."""

    label: str
    seed: int
    snr_db: float | None = 10.0  # None only for noise_only
    drone: str | None = None  # DroneProfile key for rfuav_* classes
    fs: float = 100e6
    duration_s: float = 0.1
    # FHSBW (paper Table 4) is interpreted as the total hopping span: the real
    # FUTABA T14SG images show ~3-4 MHz bursts hopping across ~32 MHz (=FHSBW),
    # and DJI MINI3 bursts stay inside ~3.5 MHz (=FHSBW). Per-burst bandwidth:
    #   burst_bw = max(FHSBW / burst_bw_divisor, min(FHSBW, burst_bw_floor_mhz))
    burst_bw_floor_mhz: float = 1.5
    burst_bw_divisor: float = 8.0
    freq_shift_mhz: float = 0.0
    fading_depth_db: float = 0.0
    timing_jitter_ms: float = 0.0
    dropout_prob: float = 0.0
    inject_interference: list[str] = field(default_factory=list)  # wifi_like/lora_iot_like/mixed
    interference_power: float = 0.5  # relative to main signal power
    impairments: ImpairmentParams = field(default_factory=ImpairmentParams)
    save_iq: bool = False
    notes: str = ""


def spec_to_dict(spec: SynthSpec) -> dict:
    from dataclasses import asdict

    return asdict(spec)


def spec_from_dict(d: dict) -> SynthSpec:
    """Rebuild a SynthSpec from its dict form (specs.json). Together with the
    seed this regenerates byte-identical IQ - IQ files need not be stored."""
    d = dict(d)
    imp = d.pop("impairments", None)
    spec = SynthSpec(**d)
    if imp is not None:
        spec.impairments = ImpairmentParams(**imp)
    return spec


def _profile(spec: SynthSpec) -> DroneProfile:
    if spec.drone is None:
        raise ValueError(f"class {spec.label} requires a drone profile")
    return DRONE_PROFILES[spec.drone]


def _gen_fhss(spec: SynthSpec, rng: np.random.Generator):
    p = _profile(spec)
    ov = REAL_INFORMED_OVERRIDES.get(spec.drone or "", {})
    burst_bw = max(p.fhsbw_mhz / spec.burst_bw_divisor, min(p.fhsbw_mhz, spec.burst_bw_floor_mhz))
    fhsdc = ov.get("fhsdc_ms", p.fhsdc_ms)
    params = FHSSParams(
        fhsbw_mhz=burst_bw,
        fhsdt_ms=ov.get("fhsdt_ms", p.fhsdt_ms),
        fhsdc_ms=fhsdc,
        fhspp_ms=p.fhspp_ms or (fhsdc * 8),
        hop_span_mhz=ov.get("hop_span_mhz", p.fhsbw_mhz),
        timing_jitter_ms=spec.timing_jitter_ms,
        dropout_prob=spec.dropout_prob,
    )
    return generate_fhss(params, spec.fs, spec.duration_s, rng)


def _gen_video(spec: SynthSpec, rng: np.random.Generator, offset_mhz: float | None = None):
    p = _profile(spec)
    vtsbw = p.vtsbw_mhz or 10.0
    if offset_mhz is None:
        lim = (spec.fs / 1e6) * 0.5 - vtsbw
        offset_mhz = float(rng.uniform(-lim, lim)) * 0.5
    return generate_video(
        VideoParams(vtsbw_mhz=vtsbw, center_offset_mhz=offset_mhz), spec.fs, spec.duration_s, rng
    )


def generate_clean(spec: SynthSpec, rng: np.random.Generator):
    """Dispatch by class label -> (clean_iq, events)."""
    n = int(round(spec.fs * spec.duration_s))
    if spec.label == "noise_only":
        return np.zeros(n, dtype=np.complex128), []
    if spec.label == "rfuav_fhss_like":
        return _gen_fhss(spec, rng)
    if spec.label == "rfuav_video_like":
        return _gen_video(spec, rng)
    if spec.label == "rfuav_fhss_video_like":
        iq1, ev1 = _gen_fhss(spec, rng)
        p = _profile(spec)
        # place the video link clear of the FHSS hop span
        span = p.fhsbw_mhz
        vtsbw = p.vtsbw_mhz or 10.0
        side = 1.0 if rng.random() < 0.5 else -1.0
        offset = side * (span / 2 + vtsbw / 2 + float(rng.uniform(2.0, 10.0)))
        iq2, ev2 = _gen_video(spec, rng, offset_mhz=offset)
        return iq1 + iq2, ev1 + ev2
    if spec.label == "wifi_like":
        lim = (spec.fs / 1e6) * 0.35
        params = WifiParams(center_offset_mhz=float(rng.uniform(-lim, lim)))
        return generate_wifi(params, spec.fs, spec.duration_s, rng)
    if spec.label == "lora_iot_like":
        lim = (spec.fs / 1e6) * 0.35
        params = LoraParams(
            center_offset_mhz=float(rng.uniform(-lim, lim)),
            bw_mhz=float(rng.uniform(0.125, 0.5)),
            n_chirps=int(rng.integers(6, 20)),
            up=bool(rng.random() < 0.5),
        )
        return generate_lora(params, spec.fs, spec.duration_s, rng)
    if spec.label == "mixed_interference":
        return generate_mixed_interference(spec.fs, spec.duration_s, rng)
    raise ValueError(f"unknown class label {spec.label!r}")


def synthesize(spec: SynthSpec) -> tuple[np.ndarray, list[SignalEvent]]:
    """Generate the final IQ frame (signal + channel + noise + impairments)."""
    rng = np.random.default_rng(spec.seed)
    iq, events = generate_clean(spec, rng)

    for kind in spec.inject_interference:
        p_main = measure_power(iq) or 1.0
        if kind == "wifi_like":
            # injected ambient Wi-Fi is sparse (a few packets per 0.1 s frame),
            # matching the occasional blobs seen in real ImageSet frames
            x, ev = generate_wifi(
                WifiParams(
                    center_offset_mhz=float(rng.uniform(-30, 30)),
                    packet_ms_range=(0.3, 1.5),
                    mean_interarrival_ms=float(rng.uniform(10.0, 30.0)),
                ),
                spec.fs, spec.duration_s, rng,
            )
        elif kind == "lora_iot_like":
            x, ev = generate_lora(
                LoraParams(center_offset_mhz=float(rng.uniform(-30, 30))),
                spec.fs, spec.duration_s, rng,
            )
        elif kind == "mixed_interference":
            x, ev = generate_mixed_interference(spec.fs, spec.duration_s, rng)
        else:
            raise ValueError(f"unknown interference kind {kind!r}")
        p_x = measure_power(x)
        if p_x > 0:
            x *= np.sqrt(spec.interference_power * p_main / p_x)
        iq = iq + x
        events += ev

    if spec.freq_shift_mhz:
        iq = frequency_shift(iq, spec.freq_shift_mhz * 1e6, spec.fs)
        events = [ev.shifted(spec.freq_shift_mhz * 1e6) for ev in events]
    if spec.fading_depth_db > 0:
        iq = amplitude_fading(iq, spec.fs, depth_db=spec.fading_depth_db, rng=rng)

    if spec.label == "noise_only" or spec.snr_db is None:
        iq = iq + complex_awgn(len(iq), 1.0, rng)
    else:
        iq, _ = add_awgn_at_snr(iq, spec.snr_db, rng)

    iq = apply_impairments(iq, spec.impairments, spec.fs, rng)
    return iq, events


def spec_to_meta(spec: SynthSpec, sample_id: str, filename: str) -> SampleMeta:
    prof = DRONE_PROFILES.get(spec.drone) if spec.drone else None
    is_rfuav = spec.label.startswith("rfuav_")
    has_fhss = spec.label in ("rfuav_fhss_like", "rfuav_fhss_video_like")
    has_video = spec.label in ("rfuav_video_like", "rfuav_fhss_video_like")
    has_interf = (
        spec.label in ("wifi_like", "lora_iot_like", "mixed_interference")
        or bool(spec.inject_interference)
    )
    return SampleMeta(
        sample_id=sample_id,
        filename=filename,
        label=spec.label,
        class_id=class_id(spec.label),
        center_freq_mhz=(prof.mf_ghz * 1000 if prof else None),
        sample_rate=spec.fs,
        duration_ms=spec.duration_s * 1000,
        snr_db=spec.snr_db,
        fhsbw_mhz=prof.fhsbw_mhz if (prof and has_fhss) else None,
        fhsdt_ms=prof.fhsdt_ms if (prof and has_fhss) else None,
        fhsdc_ms=prof.fhsdc_ms if (prof and has_fhss) else None,
        fhspp_ms=prof.fhspp_ms if (prof and has_fhss) else None,
        vtsbw_mhz=(prof.vtsbw_mhz if prof else None) if has_video else None,
        has_fhss=has_fhss,
        has_video=has_video,
        has_interference=has_interf,
        source="synthetic",
        random_seed=spec.seed,
        notes=(f"drone={spec.drone}; " if spec.drone else "")
        + (f"shift={spec.freq_shift_mhz}MHz; " if spec.freq_shift_mhz else "")
        + (f"inject={'+'.join(spec.inject_interference)}; " if spec.inject_interference else "")
        + spec.notes,
    )


def export_sample(
    spec: SynthSpec,
    sample_id: str,
    out_dir: Path,
    preset: STFTPreset,
    npy_size: tuple[int, int] = (640, 640),
    png_size: tuple[int, int] = (730, 855),
) -> tuple[SampleMeta, FeatureParams]:
    """Generate + write one sample. Returns its metadata and feature rows."""
    out_dir = Path(out_dir)
    for sub in ("images", "npy", "labels_yolo", "iq"):
        (out_dir / sub).mkdir(parents=True, exist_ok=True)

    iq, events = synthesize(spec)
    f, t, s_db = compute_stft(iq, spec.fs, preset)

    png_path = out_dir / "images" / f"{sample_id}.png"
    render_png(s_db, str(png_path), preset, size=png_size)
    arr = save_npy(s_db, str(out_dir / "npy" / f"{sample_id}.npy"), size=npy_size)
    write_yolo_labels(events, spec.duration_s, spec.fs, str(out_dir / "labels_yolo" / f"{sample_id}.txt"))
    if spec.save_iq:
        inter = np.empty(2 * len(iq), dtype=np.float32)
        inter[0::2], inter[1::2] = iq.real, iq.imag  # RFUAV-compatible interleaved float32
        inter.tofile(out_dir / "iq" / f"{sample_id}.iq")

    meta = spec_to_meta(spec, sample_id, png_path.name)

    vmin, vmax = normalize_db(arr, preset)
    intensity = np.clip((arr - vmin) / max(vmax - vmin, 1e-9), 0, 1)[::-1]  # row 0 = +f
    feats = extract_features(intensity, spec.duration_s * 1000, spec.fs / 1e6)
    fp = FeatureParams(
        sample_id=sample_id,
        source="synthetic",
        label=spec.label,
        estimated_bandwidth_mhz=feats["estimated_bandwidth_mhz"],
        estimated_burst_duration_ms=feats["estimated_burst_duration_ms"],
        estimated_hopping_interval_ms=feats["estimated_hopping_interval_ms"],
        estimated_hopping_period_ms=feats["estimated_hopping_period_ms"],
        estimated_snr_db=feats["estimated_snr_db"],
        estimated_video_bandwidth_mhz=feats["estimated_video_bandwidth_mhz"],
        signal_type=spec.label,
        notes="estimates from normalized dB array; snr is an intensity-ratio proxy",
    )
    return meta, fp
