import json
from pathlib import Path

import pytest
import yaml

from gaema_rfuav_synth.config import load_stft_preset
from gaema_rfuav_synth.rfuav.paper_params import DRONE_PROFILES


REPO_ROOT = Path(__file__).resolve().parent.parent
PROFILE_PATH = (
    REPO_ROOT
    / "apps"
    / "drone-rf-sim"
    / "public"
    / "assets"
    / "spectro"
    / "profile_DJI_MINI3.json"
)


def test_web_signal_profile_is_a_validated_parameter_projection():
    profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    fitted = yaml.safe_load(
        (REPO_ROOT / "configs" / "fitted_params.yaml").read_text(encoding="utf-8")
    )["DJI_MINI3"]
    validation = yaml.safe_load(
        (REPO_ROOT / "configs" / "validation_config.yaml").read_text(encoding="utf-8")
    )
    synthetic = yaml.safe_load(
        (REPO_ROOT / "configs" / "synthetic_config.yaml").read_text(encoding="utf-8")
    )
    paper = DRONE_PROFILES["DJI_MINI3"]

    assert profile["center_freq_hz"] == pytest.approx(paper.mf_ghz * 1e9)
    assert profile["span_hz"] == pytest.approx(
        synthetic["frame"]["presets"]["rfuav_full"]["fs"]
    )
    assert profile["fhss"]["bw_hz"] == pytest.approx(fitted["burst_bw_mhz"] * 1e6)
    assert profile["fhss"]["burst_s"] == pytest.approx(fitted["fhsdt_ms"] * 1e-3)
    assert profile["fhss"]["dwell_s"] == pytest.approx(fitted["fhsdc_ms"] * 1e-3)
    assert profile["fhss"]["hop_span_hz"] == pytest.approx(
        fitted["hop_span_mhz"] * 1e6
    )
    assert len(profile["fhss"]["hops"]) > 10
    assert profile["video"]["bw_hz"] == pytest.approx(fitted["vtsbw_mhz"] * 1e6)
    assert profile["video"]["tdd_period_s"] == pytest.approx(
        fitted["video_slot_ms"] * 1e-3
    )
    assert profile["video"]["duty"] == pytest.approx(fitted["video_duty"])
    assert [profile["db_min"], profile["db_max"]] == validation["analysis"][
        "hist_range_db"
    ]
    assert profile["colormap"] == load_stft_preset().colormap
    assert len(profile["colormap_lut"]) == 256
    assert all(len(color) == 6 for color in profile["colormap_lut"])
