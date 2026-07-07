import numpy as np
import pytest

from gaema_rfuav_synth.signal.noise import band_limited_noise, complex_awgn
from gaema_rfuav_synth.signal.snr import add_awgn_at_snr, measure_power, snr_db, snr_sweep


def test_awgn_power():
    rng = np.random.default_rng(0)
    x = complex_awgn(200_000, power=2.5, rng=rng)
    assert measure_power(x) == pytest.approx(2.5, rel=0.02)


def test_add_awgn_hits_target_snr():
    rng = np.random.default_rng(1)
    sig = band_limited_noise(200_000, 0.2, 0.0, rng)
    for target in (-20.0, -6.0, 0.0, 10.0, 20.0):
        noisy, noise = add_awgn_at_snr(sig, target, rng)
        assert snr_db(sig, noise) == pytest.approx(target, abs=0.3)
        assert np.allclose(noisy - noise, sig)


def test_snr_sweep_grid():
    grid = snr_sweep()
    assert grid[0] == -20.0 and grid[-1] == 20.0 and len(grid) == 21
    assert np.allclose(np.diff(grid), 2.0)
