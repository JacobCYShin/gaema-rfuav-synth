import numpy as np
import pytest

from gaema_rfuav_synth.transform.spectrogram import pool_to_size
from gaema_rfuav_synth.transform.stft import STFTPreset, compute_stft, normalize_db

FS = 2e6


def test_stft_shape_and_axes():
    preset = STFTPreset(stft_point=256, overlap_ratio=0.5)
    iq = np.exp(2j * np.pi * 0.3e6 * np.arange(int(FS * 0.01)) / FS)
    f, t, s_db = compute_stft(iq, FS, preset)
    assert s_db.shape[0] == 256
    assert f[0] < 0 < f[-1]  # two-sided, fftshifted, ascending
    assert np.all(np.diff(f) > 0)
    assert s_db.dtype == np.float32


def test_tone_lands_on_correct_bin():
    preset = STFTPreset(stft_point=256)
    f0 = 0.25e6
    iq = np.exp(2j * np.pi * f0 * np.arange(int(FS * 0.01)) / FS)
    f, t, s_db = compute_stft(iq, FS, preset)
    peak_freq = f[np.argmax(s_db.mean(axis=1))]
    assert peak_freq == pytest.approx(f0, abs=FS / 256)


def test_normalize_fixed_db():
    preset = STFTPreset(normalization="fixed_db", dynamic_range_db=60)
    s = np.random.default_rng(0).uniform(-80, 0, size=(64, 64)).astype(np.float32)
    vmin, vmax = normalize_db(s, preset)
    assert vmax - vmin == pytest.approx(60)


def test_pool_preserves_peaks():
    s = np.full((100, 1000), -80.0, dtype=np.float32)
    s[50, 500] = 0.0  # single hot pixel must survive max-pooling
    out = pool_to_size(s, 50, 100)
    assert out.shape == (50, 100)
    assert out.max() > -40
