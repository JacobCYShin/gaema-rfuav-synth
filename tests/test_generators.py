import numpy as np
import pytest

from gaema_rfuav_synth.dataset.exporter import (
    SynthSpec,
    generate_clean,
    spec_from_dict,
    spec_to_dict,
    synthesize,
)
from gaema_rfuav_synth.signal.fhss_generator import FHSSParams, generate_fhss
from gaema_rfuav_synth.signal.interference_generator import (
    LoraParams,
    WifiParams,
    generate_lora,
    generate_mixed_interference,
    generate_wifi,
)
from gaema_rfuav_synth.signal.video_generator import VideoParams, generate_video

FS = 2e6
DUR = 0.05


def test_fhss_bursts_and_events():
    rng = np.random.default_rng(0)
    p = FHSSParams(fhsbw_mhz=0.1, fhsdt_ms=1.0, fhsdc_ms=5.0, fhspp_ms=20.0, hop_span_mhz=0.6)
    iq, events = generate_fhss(p, FS, DUR, rng)
    assert len(iq) == int(FS * DUR)
    assert len(events) == pytest.approx(DUR / 5e-3, abs=2)
    for ev in events:
        assert ev.kind == "fhss_burst"
        assert ev.bandwidth == pytest.approx(0.1e6, rel=0.01)
        assert -FS / 2 <= ev.f_low < ev.f_high <= FS / 2
    assert np.max(np.abs(iq)) > 0


def test_fhss_reproducible_by_seed():
    p = FHSSParams(fhsbw_mhz=0.1, fhsdt_ms=1.0, fhsdc_ms=5.0, fhspp_ms=20.0, hop_span_mhz=0.6)
    iq1, _ = generate_fhss(p, FS, DUR, np.random.default_rng(42))
    iq2, _ = generate_fhss(p, FS, DUR, np.random.default_rng(42))
    assert np.array_equal(iq1, iq2)


def test_fhss_dropout_reduces_bursts():
    p = FHSSParams(fhsbw_mhz=0.1, fhsdt_ms=0.5, fhsdc_ms=2.0, fhspp_ms=10.0, dropout_prob=0.9)
    _, events = generate_fhss(p, FS, DUR, np.random.default_rng(3))
    assert len(events) < DUR / 2e-3 * 0.6


def test_video_is_continuous_and_band_limited():
    rng = np.random.default_rng(1)
    p = VideoParams(vtsbw_mhz=0.3, center_offset_mhz=0.2)
    iq, events = generate_video(p, FS, DUR, rng)
    assert len(events) == 1 and events[0].kind == "video_signal"
    spec = np.abs(np.fft.fftshift(np.fft.fft(iq))) ** 2
    freqs = np.fft.fftshift(np.fft.fftfreq(len(iq), 1 / FS))
    in_band = (freqs > 0.05e6) & (freqs < 0.35e6)
    assert spec[in_band].mean() > 100 * spec[~in_band & (freqs < -0.1e6)].mean()


def test_wifi_lora_mixed():
    rng = np.random.default_rng(2)
    iq_w, ev_w = generate_wifi(WifiParams(bw_mhz=0.4), FS, DUR, rng)
    assert ev_w and all(e.kind == "wifi_burst" for e in ev_w)
    iq_l, ev_l = generate_lora(LoraParams(bw_mhz=0.1, chirp_ms=2.0, n_chirps=5), FS, DUR, rng)
    assert ev_l and all(e.kind == "lora_chirp" for e in ev_l)
    iq_m, ev_m = generate_mixed_interference(FS, DUR, rng, fs_margin_frac=0.1)
    assert len(ev_m) > 0 and np.max(np.abs(iq_m)) > 0


@pytest.mark.parametrize(
    "label",
    [
        "noise_only",
        "rfuav_fhss_like",
        "rfuav_video_like",
        "rfuav_fhss_video_like",
        "wifi_like",
        "lora_iot_like",
        "mixed_interference",
    ],
)
def test_all_classes_synthesize(label):
    # full-rate but short frame so drone-profile MHz bandwidths fit
    spec = SynthSpec(
        label=label,
        seed=7,
        snr_db=None if label == "noise_only" else 6.0,
        drone="DJI_MINI3" if label.startswith("rfuav_") else None,
        fs=100e6,
        duration_s=0.01,
    )
    iq, events = synthesize(spec)
    assert len(iq) == 1_000_000
    assert np.all(np.isfinite(iq))
    if label != "noise_only":
        assert len(events) > 0
    clean, _ = generate_clean(spec, np.random.default_rng(spec.seed))
    if label == "noise_only":
        assert np.max(np.abs(clean)) == 0


def test_spec_json_roundtrip_regenerates_identical_iq():
    """IQ storage is off by default: specs.json + seed must regenerate
    byte-identical IQ."""
    import json

    spec = SynthSpec(
        label="rfuav_fhss_video_like", seed=99, snr_db=-2.0, drone="FUTABA_T14SG",
        fs=100e6, duration_s=0.005, freq_shift_mhz=3.0, inject_interference=["lora_iot_like"],
    )
    iq1, ev1 = synthesize(spec)
    d = json.loads(json.dumps(spec_to_dict(spec)))  # through-JSON round trip
    iq2, ev2 = synthesize(spec_from_dict(d))
    assert np.array_equal(iq1, iq2)
    assert len(ev1) == len(ev2)
