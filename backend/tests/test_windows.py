"""Window generation and metric tests."""

import math

import pytest

from app.core import windows as W
from app.core import transform as T


def test_windows_have_correct_endpoints_and_shape():
    n = 128
    assert W.rectangular(n) == [1.0] * n

    for name in ("hann", "hamming", "blackman"):
        w = W.build_window(name, n)
        assert len(w) == n
        assert w[0] == pytest.approx(w[-1])
        assert max(w) == pytest.approx(1.0, abs=2e-3)

    hann = W.build_window("hann", n)
    assert hann[0] == pytest.approx(0.0, abs=1e-12)
    hamming = W.build_window("hamming", n)
    assert hamming[0] == pytest.approx(0.08, abs=1e-9)


def test_kaiser_beta_zero_is_rectangular():
    n = 256
    w = W.build_window("kaiser", n, beta=0.0)
    assert all(v == pytest.approx(1.0) for v in w)


def test_kaiser_requires_beta():
    with pytest.raises(ValueError, match="beta"):
        W.build_window("kaiser", 64)


def test_kaiser_beta_negative_rejected():
    with pytest.raises(ValueError, match="beta"):
        W.build_window("kaiser", 64, beta=-1.0)


def test_unknown_window_rejected():
    with pytest.raises(ValueError, match="unknown window"):
        W.build_window("gaussian", 64)


def test_degenerate_length_one_window_is_unity():
    for name in ("hann", "hamming", "blackman"):
        assert W.build_window(name, 1) == [1.0]
    assert W.build_window("kaiser", 1, beta=5.0) == [1.0]


def test_window_metrics_match_textbook_figures():
    # Measured null-to-null widths / sidelobe levels must match the catalogue.
    expected = {
        "rectangular": (2.0, -13.3),
        "hann": (4.0, -31.5),
        "hamming": (4.0, -42.7),
        "blackman": (6.0, -58.1),
    }
    for name, (width, sidelobe) in expected.items():
        m = W.measure_window_metrics(name, n=2048, fft_size=32768)
        assert m["main_lobe_bins"] == pytest.approx(width, abs=0.25), name
        assert m["peak_sidelobe_db"] == pytest.approx(sidelobe, abs=2.0), name


def test_kaiser_metrics_beta_trend():
    # More beta -> wider main lobe and deeper sidelobes.
    small = W.measure_window_metrics("kaiser", n=2048, beta=2.0, fft_size=32768)
    large = W.measure_window_metrics("kaiser", n=2048, beta=10.0, fft_size=32768)
    assert large["main_lobe_bins"] > small["main_lobe_bins"]
    assert large["peak_sidelobe_db"] < small["peak_sidelobe_db"]


def test_windowed_white_noise_roundtrips():
    # A window applied then DFT/IFFT still reconstructs the *windowed* signal.
    n = 128
    x = [math.sin(0.2 * i) for i in range(n)]
    win = W.build_window("hann", n)
    windowed = W.apply_window(x, win)
    recovered = T.idft_to_real(T.dft_real(windowed, n))
    for a, b in zip(windowed, recovered):
        assert abs(a - b) < 1e-9
