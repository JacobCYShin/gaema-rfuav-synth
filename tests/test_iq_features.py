"""Self-consistency tests: the raw-IQ feature extractor must recover the
known parameters of generated FHSS signals."""
import numpy as np
import pytest

from gaema_rfuav_synth.rfuav.background_extractor import BackgroundPool, extract_background
from gaema_rfuav_synth.rfuav.iq_feature_extractor import extract_iq_features
from gaema_rfuav_synth.signal.fhss_generator import FHSSParams, generate_fhss
from gaema_rfuav_synth.signal.noise import complex_awgn
from gaema_rfuav_synth.signal.snr import add_awgn_at_snr

FS = 100e6
DUR = 0.02


def _fhss_frame(rng, snr_db=15.0, **kw):
    p = FHSSParams(
        fhsbw_mhz=kw.pop("fhsbw_mhz", 3.0),
        fhsdt_ms=kw.pop("fhsdt_ms", 0.5),
        fhsdc_ms=kw.pop("fhsdc_ms", 2.0),
        fhspp_ms=kw.pop("fhspp_ms", 8.0),
        hop_span_mhz=kw.pop("hop_span_mhz", 30.0),
        **kw,
    )
    sig, events = generate_fhss(p, FS, DUR, rng)
    noisy, _ = add_awgn_at_snr(sig, snr_db, rng)
    return noisy, events


def test_extractor_recovers_known_params():
    rng = np.random.default_rng(0)
    iq, events = _fhss_frame(rng)
    feats = extract_iq_features(iq, FS)
    assert feats["n_burst_regions"] >= 5
    assert feats["estimated_bandwidth_mhz"] == pytest.approx(3.0, rel=0.25)
    assert feats["estimated_burst_duration_ms"] == pytest.approx(0.5, rel=0.30)
    assert feats["estimated_hopping_interval_ms"] == pytest.approx(2.0, rel=0.25)
    # observable span <= configured 30 MHz (only the channels in the pattern show up)
    assert 8.0 < feats["estimated_hop_span_mhz"] <= 32.0


def test_extractor_snr_reasonable():
    rng = np.random.default_rng(1)
    iq, _ = _fhss_frame(rng, snr_db=15.0)
    feats = extract_iq_features(iq, FS)
    # in-burst SNR is much higher than frame SNR (duty cycle + band concentration);
    # just require a sane positive value
    assert feats["estimated_snr_db"] is not None and feats["estimated_snr_db"] > 10


def test_extractor_none_on_noise():
    rng = np.random.default_rng(2)
    feats = extract_iq_features(complex_awgn(int(FS * DUR), 1.0, rng), FS)
    assert feats["n_burst_regions"] <= 2  # only spurious specks at most


def test_background_extractor_excludes_bursts():
    rng = np.random.default_rng(3)
    noise = complex_awgn(int(FS * DUR), 1.0, rng)
    sig, _ = generate_fhss(
        FHSSParams(fhsbw_mhz=3.0, fhsdt_ms=0.5, fhsdc_ms=2.0, fhspp_ms=8.0,
                   hop_span_mhz=30.0, burst_power=100.0),
        FS, DUR, rng,
    )
    iq = noise + sig
    pool, quiet_frac = extract_background(iq, FS, min_run_ms=0.2, max_total_s=0.01)
    p_pool = float(np.mean(np.abs(pool) ** 2))
    assert p_pool == pytest.approx(1.0, rel=0.2)  # bursts (power 100) excluded
    assert 0.3 < quiet_frac < 1.0


def test_background_pool_sampling_reproducible():
    rng = np.random.default_rng(4)
    pool = BackgroundPool(complex_awgn(100_000, 1.0, rng).astype(np.complex64))
    a = pool.sample(50_000, np.random.default_rng(7))
    b = pool.sample(50_000, np.random.default_rng(7))
    assert np.array_equal(a, b)
    assert len(pool.sample(200_000, rng)) == 200_000  # wraps around


def test_burst_irregularity_applied():
    rng = np.random.default_rng(5)
    p = FHSSParams(fhsbw_mhz=2.0, fhsdt_ms=0.5, fhsdc_ms=1.0, fhspp_ms=4.0,
                   hop_span_mhz=10.0, amp_jitter_db=3.0, duration_jitter_frac=0.3)
    _, events = generate_fhss(p, FS, DUR, rng)
    durs = np.array([ev.duration for ev in events])
    assert durs.std() / durs.mean() > 0.05  # durations actually vary
