"""End-to-end HTTP API tests via FastAPI's TestClient."""

import math

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# basics
# ---------------------------------------------------------------------------

def test_health_and_config():
    assert client.get("/api/health").json() == {"status": "ok"}
    cfg = client.get("/api/config").json()
    assert cfg["allowed_fft_sizes"] == [64, 128, 256, 512, 1024]
    names = [w["name"] for w in cfg["windows"]]
    assert names == ["rectangular", "hann", "hamming", "blackman", "kaiser"]


# ---------------------------------------------------------------------------
# /api/dft and /api/idft identity over HTTP
# ---------------------------------------------------------------------------

def test_dft_idft_roundtrip_over_http():
    n = 256
    samples = [math.sin(0.3 * i) + 0.5 * math.cos(0.07 * i) for i in range(n)]
    resp = client.post("/api/dft", json={"samples": samples, "sample_rate": 1000, "n": 256})
    assert resp.status_code == 200
    data = resp.json()
    assert data["n"] == 256
    assert len(data["magnitude"]) == 256 and len(data["phase"]) == 256

    back = client.post("/api/idft", json={"real": data["real"], "imag": data["imag"]})
    assert back.status_code == 200
    recovered = back.json()["samples"]
    for a, b in zip(samples, recovered):
        assert abs(a - b) < 1e-8


def test_parseval_report_over_http():
    n = 128
    samples = [math.cos(0.25 * i) for i in range(n)]
    data = client.post("/api/dft", json={"samples": samples, "sample_rate": 800, "n": 128}).json()
    assert data["time_energy"] == pytest.approx(data["freq_energy"], rel=1e-9)


def test_frequency_axis_uses_sample_rate():
    data = client.post("/api/dft", json={"samples": [0.0] * 8, "sample_rate": 800}).json()
    assert data["frequencies"] == [0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0]


def test_zero_signal_is_legal():
    resp = client.post("/api/dft", json={"samples": [0.0] * 64, "sample_rate": 500, "n": 64})
    assert resp.status_code == 200
    data = resp.json()
    assert all(m == 0.0 for m in data["magnitude"])
    assert all(p == 0.0 for p in data["phase"])


def test_zero_padding_refines_spectrum():
    samples = [math.sin(2.0 * math.pi * 10 * i / 64) for i in range(64)]
    short = client.post("/api/dft", json={"samples": samples, "sample_rate": 1000, "n": 64}).json()
    long = client.post("/api/dft", json={"samples": samples, "sample_rate": 1000, "n": 512}).json()
    assert len(long["magnitude"]) == 512
    assert len(short["magnitude"]) == 64
    # energy still consistent within each length's normalization
    assert long["freq_energy"] == pytest.approx(long["time_energy"], rel=1e-9)


def test_dft_with_each_window():
    samples = [math.sin(0.1 * i) for i in range(128)]
    for name in ("rectangular", "hann", "hamming", "blackman"):
        resp = client.post("/api/dft", json={
            "samples": samples, "sample_rate": 500, "n": 128, "window": name})
        assert resp.status_code == 200, name
    resp = client.post("/api/dft", json={
        "samples": samples, "sample_rate": 500, "n": 128,
        "window": "kaiser", "beta": 6.0})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# illegal input: every case must be 400 with an explanatory reason
# ---------------------------------------------------------------------------

def _expect_400(payload, path="/api/dft"):
    resp = client.post(path, json=payload)
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]


def test_illegal_fft_size():
    _expect_400({"samples": [1.0] * 64, "sample_rate": 1000, "n": 100})
    _expect_400({"samples": [1.0] * 64, "sample_rate": 1000, "n": 2048})


def test_illegal_sample_rate():
    _expect_400({"samples": [1.0] * 64, "sample_rate": 0})
    _expect_400({"samples": [1.0] * 64, "sample_rate": -10})


def test_unknown_window_name():
    _expect_400({"samples": [1.0] * 64, "sample_rate": 1000, "window": "tukey"})


def test_kaiser_without_beta():
    _expect_400({"samples": [1.0] * 64, "sample_rate": 1000, "window": "kaiser"})


def test_padding_shorter_than_signal():
    _expect_400({"samples": [1.0] * 300, "sample_rate": 1000, "n": 256})


def test_empty_samples():
    _expect_400({"samples": [], "sample_rate": 1000})


def test_filter_band_validation():
    base = {"samples": [0.01 * i for i in range(256)], "sample_rate": 500}
    _expect_400({**base, "filter_type": "lowpass", "low_hz": 0, "high_hz": 300}, "/api/filter")
    _expect_400({**base, "filter_type": "bandpass", "low_hz": 200, "high_hz": 100}, "/api/filter")
    _expect_400({**base, "filter_type": "bandpass", "low_hz": 100, "high_hz": 100}, "/api/filter")
    _expect_400({**base, "filter_type": "banana", "low_hz": 0, "high_hz": 100}, "/api/filter")


# ---------------------------------------------------------------------------
# windows / filter / alias endpoints
# ---------------------------------------------------------------------------

def test_window_endpoint_and_metrics():
    resp = client.post("/api/window", json={"n": 256, "window": "hann"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["window"]) == 256
    assert data["metrics"]["main_lobe_bins"] == 4.0

    resp = client.post("/api/window", json={"n": 256, "window": "kaiser", "beta": 9.0})
    assert resp.status_code == 200
    assert resp.json()["metrics"]["main_lobe_bins"] > 0


def test_windows_compare_endpoint():
    samples = [math.sin(0.15 * i) for i in range(256)]
    resp = client.post("/api/windows/compare", json={
        "samples": samples, "sample_rate": 1000, "n": 256,
        "windows": [{"name": "rectangular"}, {"name": "hann"},
                    {"name": "kaiser", "beta": 8.0}],
    })
    assert resp.status_code == 200
    curves = resp.json()["curves"]
    assert len(curves) == 3
    assert all(len(c["magnitude"]) == 256 for c in curves)


def test_filter_endpoint_lowpass():
    fs, n = 1000.0, 512
    samples = [math.cos(2 * math.pi * 50 * i / fs) + math.cos(2 * math.pi * 350 * i / fs)
               for i in range(n)]
    resp = client.post("/api/filter", json={
        "samples": samples, "sample_rate": fs,
        "filter_type": "lowpass", "low_hz": 0, "high_hz": 150, "n": 512})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["filtered_samples"]) == 512
    # high-frequency bins must be empty
    for k, m in enumerate(data["filtered_magnitude"]):
        f = min(k, n - k) * fs / n
        if f > 160:
            assert m < 1e-6


def test_alias_endpoint():
    ok = client.get("/api/alias", params={"signal_freq": 30, "sample_rate": 100}).json()
    assert ok["aliased"] is False
    bad = client.get("/api/alias", params={"signal_freq": 70, "sample_rate": 100}).json()
    assert bad["aliased"] is True
    assert bad["apparent_freq"] == pytest.approx(30.0)

    resp = client.get("/api/alias", params={"signal_freq": 10, "sample_rate": 0})
    assert resp.status_code == 400


def test_sampling_demo_endpoint():
    resp = client.post("/api/sampling-demo", json={"signal_freq": 70, "sample_rate": 100})
    assert resp.status_code == 200
    data = resp.json()
    assert data["aliasing"]["aliased"] is True
    assert len(data["dense_t"]) == len(data["dense_y"]) == 2048
    assert len(data["sample_t"]) == len(data["sample_y"])
