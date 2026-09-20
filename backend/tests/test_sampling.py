"""Aliasing criterion and sampling-demo tests."""

import math

import pytest

from app.core.sampling import analyze_aliasing, apparent_frequency, sampling_demo


@pytest.mark.parametrize("f0,fs,expected_apparent", [
    # below Nyquist: no alias, apparent frequency is the signal itself
    (30.0, 100.0, 30.0),
    (50.0, 100.0, 50.0),     # exactly Nyquist is still legal (no alias)
    # classic fold-over cases
    (70.0, 100.0, 30.0),     # fs - f0
    (130.0, 100.0, 30.0),
    (120.0, 100.0, 20.0),
    # higher-order folding
    (260.0, 100.0, 40.0),
    (330.0, 100.0, 30.0),
    (0.0, 100.0, 0.0),
])
def test_apparent_frequency_folding(f0, fs, expected_apparent):
    assert apparent_frequency(f0, fs) == pytest.approx(expected_apparent, abs=1e-9)


@pytest.mark.parametrize("f0,fs,aliased", [
    (40.0, 100.0, False),
    (50.0, 100.0, False),    # boundary f0 == fs/2: NOT aliasing
    (50.0001, 100.0, True),
    (70.0, 100.0, True),
    (200.0, 100.0, True),
])
def test_alias_decision(f0, fs, aliased):
    result = analyze_aliasing(f0, fs)
    assert result["aliased"] is aliased
    assert result["nyquist"] == fs / 2.0


def test_alias_result_fields():
    r = analyze_aliasing(70.0, 100.0)
    assert r == {
        "signal_freq": 70.0,
        "sample_rate": 100.0,
        "nyquist": 50.0,
        "aliased": True,
        "apparent_freq": pytest.approx(30.0),
        "ratio": 0.7,
    }


def test_alias_validation():
    with pytest.raises(ValueError, match="sample_rate"):
        analyze_aliasing(10.0, 0.0)
    with pytest.raises(ValueError, match="sample_rate"):
        analyze_aliasing(10.0, -5.0)
    with pytest.raises(ValueError, match="frequency"):
        analyze_aliasing(-1.0, 100.0)


def test_sampling_demo_below_nyquist_reconstructs_tone():
    # 40 Hz tone sampled at 100 Hz: sinc interpolation must recover it away
    # from the window edges.
    demo = sampling_demo(40.0, 100.0, duration=0.5, dense_points=3000)
    assert not demo["aliasing"]["aliased"]
    assert demo["duration"] == 0.5

    margin = 0.05  # ignore 5 samples near each edge
    rec_lookup = dict(zip(
        (round(t, 12) for t in demo["reconstructed_t"]),
        demo["reconstructed_y"]))

    inner_err_sq, count = 0.0, 0
    for t, original in zip(demo["dense_t"], demo["dense_y"]):
        if margin < t < demo["duration"] - margin:
            rec = rec_lookup.get(round(t, 12))
            if rec is not None:
                inner_err_sq += (original - rec) ** 2
                count += 1
    assert count > 100, "interior evaluation window is empty"
    rms = math.sqrt(inner_err_sq / count)
    assert rms < 0.02


def test_sampling_demo_above_nyquist_marks_aliased():
    demo = sampling_demo(70.0, 100.0)
    assert demo["aliasing"]["aliased"]
    assert demo["aliasing"]["apparent_freq"] == pytest.approx(30.0)
    # sampled values themselves are consistent with the apparent 30 Hz tone
    for t, y in zip(demo["sample_t"], demo["sample_y"]):
        expected = math.cos(2.0 * math.pi * 70.0 * t)
        assert y == pytest.approx(expected, abs=1e-9)


def test_sampling_demo_validation():
    with pytest.raises(ValueError):
        sampling_demo(10.0, 0.0)
    with pytest.raises(ValueError, match="dense_points"):
        sampling_demo(10.0, 100.0, dense_points=4)
