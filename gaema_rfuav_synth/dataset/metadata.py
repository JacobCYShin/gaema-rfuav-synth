"""metadata.csv and feature_params.csv schemas and writers."""
from __future__ import annotations

from dataclasses import dataclass, asdict, field

import pandas as pd

METADATA_COLUMNS = [
    "sample_id", "filename", "label", "class_id", "center_freq_mhz", "sample_rate",
    "duration_ms", "snr_db", "fhsbw_mhz", "fhsdt_ms", "fhsdc_ms", "fhspp_ms",
    "vtsbw_mhz", "has_fhss", "has_video", "has_interference", "source",
    "source_dataset", "random_seed", "notes",
]

FEATURE_COLUMNS = [
    "sample_id", "source", "label", "estimated_bandwidth_mhz",
    "estimated_burst_duration_ms", "estimated_hopping_interval_ms",
    "estimated_hopping_period_ms", "estimated_snr_db",
    "estimated_video_bandwidth_mhz", "signal_type", "notes",
]


@dataclass
class SampleMeta:
    sample_id: str
    filename: str
    label: str
    class_id: int
    center_freq_mhz: float | None = None
    sample_rate: float = 100e6
    duration_ms: float = 100.0
    snr_db: float | None = None
    fhsbw_mhz: float | None = None
    fhsdt_ms: float | None = None
    fhsdc_ms: float | None = None
    fhspp_ms: float | None = None
    vtsbw_mhz: float | None = None
    has_fhss: bool = False
    has_video: bool = False
    has_interference: bool = False
    source: str = "synthetic"  # synthetic | real
    source_dataset: str = "gaema-rfuav-synth"
    random_seed: int | None = None
    notes: str = ""


@dataclass
class FeatureParams:
    sample_id: str
    source: str
    label: str
    estimated_bandwidth_mhz: float | None = None
    estimated_burst_duration_ms: float | None = None
    estimated_hopping_interval_ms: float | None = None
    estimated_hopping_period_ms: float | None = None
    estimated_snr_db: float | None = None
    estimated_video_bandwidth_mhz: float | None = None
    signal_type: str = ""
    notes: str = ""


def write_metadata_csv(rows: list[SampleMeta], path: str) -> pd.DataFrame:
    df = pd.DataFrame([asdict(r) for r in rows], columns=METADATA_COLUMNS)
    df.to_csv(path, index=False)
    return df


def write_feature_csv(rows: list[FeatureParams], path: str) -> pd.DataFrame:
    df = pd.DataFrame([asdict(r) for r in rows], columns=FEATURE_COLUMNS)
    df.to_csv(path, index=False)
    return df
