from pathlib import Path

import numpy as np
import pandas as pd

from gaema_rfuav_synth.dataset.exporter import SynthSpec, export_sample, spec_to_meta
from gaema_rfuav_synth.dataset.metadata import (
    FEATURE_COLUMNS,
    METADATA_COLUMNS,
    FeatureParams,
    SampleMeta,
    write_feature_csv,
    write_metadata_csv,
)
from gaema_rfuav_synth.rfuav.sample_loader import load_raw_iq
from gaema_rfuav_synth.transform.stft import STFTPreset


def test_metadata_columns(tmp_path):
    meta = SampleMeta(sample_id="s1", filename="s1.png", label="noise_only", class_id=0)
    df = write_metadata_csv([meta], tmp_path / "m.csv")
    assert list(df.columns) == METADATA_COLUMNS
    back = pd.read_csv(tmp_path / "m.csv")
    assert back.loc[0, "sample_id"] == "s1"


def test_feature_columns(tmp_path):
    fp = FeatureParams(sample_id="s1", source="synthetic", label="wifi_like")
    df = write_feature_csv([fp], tmp_path / "f.csv")
    assert list(df.columns) == FEATURE_COLUMNS


def test_spec_to_meta_fields():
    spec = SynthSpec(label="rfuav_fhss_video_like", seed=5, snr_db=-4.0, drone="DJI_MINI3")
    m = spec_to_meta(spec, "sX", "sX.png")
    assert m.has_fhss and m.has_video
    assert m.fhsbw_mhz == 3.5 and m.vtsbw_mhz == 10.0
    assert m.random_seed == 5 and m.snr_db == -4.0
    assert "drone=DJI_MINI3" in m.notes


def test_export_sample_end_to_end(tmp_path):
    spec = SynthSpec(
        label="rfuav_fhss_like", seed=11, snr_db=10.0, drone="DJI_MINI3",
        fs=100e6, duration_s=0.005, save_iq=True,
    )
    preset = STFTPreset(stft_point=256, colormap="hot", normalization="fixed_db")
    meta, fp = export_sample(spec, "t0", tmp_path, preset, npy_size=(128, 128), png_size=(128, 160))
    assert (tmp_path / "images" / "t0.png").exists()
    arr = np.load(tmp_path / "npy" / "t0.npy")
    assert arr.shape == (128, 128) and arr.dtype == np.float32
    labels = (tmp_path / "labels_yolo" / "t0.txt").read_text().strip().splitlines()
    assert len(labels) > 0
    # exported IQ round-trips through the RFUAV-format loader
    iq = load_raw_iq(tmp_path / "iq" / "t0.iq")
    assert len(iq) == int(100e6 * 0.005)
    assert fp.sample_id == "t0" and meta.class_id == 1
