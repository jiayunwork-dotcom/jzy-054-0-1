"""Frequency-domain filter tests."""

import math

import pytest

from app.core.filtering import apply_filter, build_mask
from app.core import transform as T


def _tone(freq, n, fs, amp=1.0, phase=0.0):
    return [amp * math.cos(2.0 * math.pi * freq * i / fs + phase) for i in range(n)]


def _band_energy(spectrum, fs, n, low_hz, high_hz):
    """Energy (1/N sum |X|^2) carried by bins folded into [low, high]."""
    total = 0.0
    for k, z in enumerate(spectrum):
        f = min(k, n - k) * fs / n
        if low_hz <= f <= high_hz:
            total += (z.real * z.real + z.imag * z.imag) / n
    return total


def test_mask_is_conjugate_symmetric():
    n = 256
    for kind, lo, hi in (("lowpass", 0, 100), ("highpass", 100, 500), ("bandpass", 80, 200)):
        mask = build_mask(n, 1000.0, kind, lo, hi)
        for k in range(1, n):
            assert mask[k] == mask[n - k]


def test_lowpass_removes_high_frequency_energy():
    fs, n = 1000.0, 512
    f_low, f_high = 26 * fs / n, 180 * fs / n   # 50.78 / 351.56 Hz: exact bins
    x = [a + b for a, b in zip(_tone(f_low, n, fs), _tone(f_high, n, fs))]
    result = apply_filter(x, fs, "lowpass", 0.0, 150.0)
    out_spec = result["filtered_spectrum"]

    # Energy above the cutoff is essentially gone.
    high_energy = _band_energy(out_spec, fs, n, 160.0, fs / 2)
    assert high_energy < 1e-8

    # ... while the surviving 50 Hz tone keeps its energy.
    low_energy = _band_energy(out_spec, fs, n, 0.0, 150.0)
    expected = n / 2.0  # one unit-amplitude cosine tone, Parseval
    assert low_energy == pytest.approx(expected, rel=1e-6)


def test_highpass_removes_low_frequency_energy():
    fs, n = 1000.0, 512
    f_low, f_high = 20 * fs / n, 205 * fs / n   # 39.06 / 400.39 Hz: exact bins
    x = [a + b for a, b in zip(_tone(f_low, n, fs), _tone(f_high, n, fs))]
    result = apply_filter(x, fs, "highpass", 200.0, fs / 2)
    out_spec = result["filtered_spectrum"]

    assert _band_energy(out_spec, fs, n, 0.0, 190.0) < 1e-8
    high = _band_energy(out_spec, fs, n, 210.0, fs / 2)
    assert high == pytest.approx(n / 2.0, rel=1e-6)


def test_bandpass_keeps_only_middle_band():
    fs, n = 1000.0, 512
    tones = [_tone(15 * fs / n, n, fs),      # 29.3 Hz
             _tone(102 * fs / n, n, fs),     # 199.2 Hz
             _tone(230 * fs / n, n, fs)]     # 449.2 Hz
    x = [a + b + c for a, b, c in zip(*tones)]
    result = apply_filter(x, fs, "bandpass", 120.0, 300.0)
    out_spec = result["filtered_spectrum"]

    assert _band_energy(out_spec, fs, n, 0.0, 110.0) < 1e-8
    assert _band_energy(out_spec, fs, n, 310.0, fs / 2) < 1e-8
    middle = _band_energy(out_spec, fs, n, 120.0, 300.0)
    assert middle == pytest.approx(n / 2.0, rel=1e-6)


def test_filtered_signal_roundtrips_back_to_real_time_domain():
    fs, n = 1000.0, 512
    x = [a + b for a, b in zip(_tone(100.0, n, fs), _tone(400.0, n, fs))]
    result = apply_filter(x, fs, "lowpass", 0.0, 200.0)
    filtered = result["filtered_samples"]
    assert len(filtered) == n
    # The filtered real signal is dominated by the 100 Hz tone.
    spec = T.dft_real(filtered, n)
    mags, _ = T.magnitude_phase(spec)
    k100 = 100 * n // int(fs)
    assert mags[k100] > n * 0.4
    k400 = 400 * n // int(fs)
    assert mags[k400] < 1e-6


def test_filter_zero_signal_stays_zero():
    result = apply_filter([0.0] * 128, 500.0, "lowpass", 0.0, 100.0)
    assert all(abs(v) < 1e-12 for v in result["filtered_samples"])


def test_band_edges_validated():
    x = [0.0] * 128
    # upper edge above Nyquist
    with pytest.raises(ValueError, match="Nyquist"):
        apply_filter(x, 500.0, "lowpass", 0.0, 300.0)
    # upper <= lower
    with pytest.raises(ValueError, match="upper band edge"):
        apply_filter(x, 500.0, "bandpass", 200.0, 100.0)
    with pytest.raises(ValueError, match="upper band edge"):
        apply_filter(x, 500.0, "bandpass", 100.0, 100.0)
    # negative lower edge
    with pytest.raises(ValueError, match="lower band edge"):
        apply_filter(x, 500.0, "highpass", -5.0, 200.0)
    # unknown filter type
    with pytest.raises(ValueError, match="unknown filter"):
        apply_filter(x, 500.0, "notch", 0.0, 100.0)


def test_non_positive_sample_rate_rejected():
    with pytest.raises(ValueError, match="sample_rate"):
        apply_filter([1.0] * 64, 0.0, "lowpass", 0.0, 10.0)
