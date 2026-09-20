"""Tests for the transform kernel: round-trip, Parseval, symmetry, tones."""

import cmath
import math

import pytest

from app.core import transform as T


def test_radix2_matches_direct_dft():
    # Pure-Python radix-2 FFT must agree with the definition it implements.
    x = [0.3, -1.2, 2.0, 0.7, -0.4, 1.1, -0.9, 0.2]
    fast = T.fft_radix2(x)
    direct = T.dft_direct(x)
    for a, b in zip(fast, direct):
        assert abs(a - b) < 1e-10


def test_roundtrip_power_of_two_sizes():
    # Forward then inverse must reconstruct the original sequence.
    for n in T.ALLOWED_FFT_SIZES:
        x = [math.sin(0.37 * i) + 0.5 * math.cos(0.11 * i + 1.0) for i in range(n)]
        spectrum = T.fft(x)
        recovered = T.ifft(spectrum)
        assert len(recovered) == n
        for orig, z in zip(x, recovered):
            assert abs(orig - z) < 1e-9


def test_roundtrip_arbitrary_length_uses_direct_dft():
    x = [1.0, -2.0, 3.0, 0.5, -1.5]  # length 5, not a power of two
    recovered = T.ifft(T.fft(x))
    for orig, z in zip(x, recovered):
        assert abs(orig - z) < 1e-10


def test_roundtrip_dft_real_helper_with_zero_padding():
    x = [0.1 * i - 1.0 for i in range(100)]
    spectrum = T.dft_real(x, 256)
    assert len(spectrum) == 256
    recovered = T.idft_to_real(spectrum)
    # first 100 samples come back, padding zeros follow
    for i, orig in enumerate(x):
        assert abs(recovered[i] - orig) < 1e-9
    assert all(abs(v) < 1e-9 for v in recovered[100:])


def test_parseval_at_all_sizes():
    # sum|x|^2 == (1/N) sum|X|^2
    for n in (64, 128, 256):
        x = [math.cos(0.2 * i) + 0.3 * math.sin(0.05 * i + 0.4) for i in range(n)]
        spectrum = T.fft(x)
        time_e, freq_e = T.parseval_energies(x, spectrum)
        assert time_e == pytest.approx(freq_e, rel=1e-10, abs=1e-8)


def test_conjugate_symmetry_real_signal():
    # X[k] == conj(X[N-k]) for every bin of a real signal.
    for n in (64, 128, 256):
        x = [math.exp(-i / 40.0) * math.cos(0.13 * i) - 0.2 for i in range(n)]
        x = T.dft_real(x, n)
        for k in range(1, n):
            assert abs(x[k] - x[n - k].conjugate()) < 1e-9
        # DC and Nyquist bins are real.
        assert abs(x[0].imag) < 1e-9
        assert abs(x[n // 2].imag) < 1e-9


def test_pure_tone_hits_only_matching_bin():
    # A tone whose period divides N lands entirely on one bin pair.
    n = 256
    k0 = 7
    fs = 1000.0
    f0 = k0 * fs / n
    x = [math.sin(2.0 * math.pi * f0 / fs * i) for i in range(n)]
    mags, phases = T.magnitude_phase(T.dft_real(x, n))

    peak = n / 2.0  # unnormalized DFT amplitude of a unit sine
    assert mags[k0] == pytest.approx(peak, rel=1e-9)
    assert mags[n - k0] == pytest.approx(peak, rel=1e-9)
    for k, m in enumerate(mags):
        if k not in (k0, n - k0):
            assert m < 1e-9


def test_pure_cosine_bin_pair():
    n = 128
    k0 = 5
    x = [math.cos(2.0 * math.pi * k0 * i / n) for i in range(n)]
    mags, _ = T.magnitude_phase(T.dft_real(x, n))
    assert mags[k0] == pytest.approx(n / 2.0, rel=1e-9)
    assert mags[n - k0] == pytest.approx(n / 2.0, rel=1e-9)
    assert max(m for k, m in enumerate(mags) if k not in (k0, n - k0)) < 1e-9


def test_dc_bin_is_real_and_carries_mean():
    n = 64
    x = [3.0] * n
    spectrum = T.dft_real(x, n)
    assert abs(spectrum[0].real - 3.0 * n) < 1e-9
    assert abs(spectrum[0].imag) < 1e-12


def test_zero_signal_spectrum_is_everywhere_zero():
    # Legal degenerate case: all zeros -> zero spectrum, zero phase, no error.
    for n in (64, 256):
        x = [0.0] * n
        mags, phases = T.magnitude_phase(T.dft_real(x, n))
        assert all(m == 0.0 for m in mags)
        assert all(p == 0.0 for p in phases)
        te, fe = T.parseval_energies(x, T.dft_real(x, n))
        assert te == 0.0 and fe == 0.0


def test_frequencies_axis():
    assert T.frequencies(8, 800.0) == [0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0]


def test_dft_real_rejects_padding_shorter_than_signal():
    with pytest.raises(ValueError, match="shorter"):
        T.dft_real([1.0] * 300, 256)


def test_dft_real_rejects_empty_signal():
    with pytest.raises(ValueError, match="empty"):
        T.dft_real([])


def test_single_point_and_two_point():
    assert T.ifft(T.fft([0.7])) == [0.7 + 0j]
    recovered = T.ifft(T.fft([1.0, -1.0]))
    assert abs(recovered[0] - 1.0) < 1e-12 and abs(recovered[1] + 1.0) < 1e-12
