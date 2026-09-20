"""Window functions.

All windows are length-N sequences used to taper a signal block before its
DFT.  ``build_window`` is the single entry point; Kaiser windows need an
extra ``beta`` parameter and raise if it is missing.
"""

from __future__ import annotations

import math
from functools import lru_cache

from .transform import fft, magnitude_phase

# Canonical textbook figures used to label the catalogue table.  "Main-lobe
# width" is the null-to-null width expressed in DFT bins; "peak sidelobe" is
# the highest sidelobe level relative to the main lobe, in dB (always a
# negative number).
WINDOW_CATALOG: dict[str, dict[str, object]] = {
    "rectangular": {
        "label": "矩形窗",
        "main_lobe_bins": 2.0,
        "peak_sidelobe_db": -13.3,
    },
    "hann": {
        "label": "汉宁窗",
        "main_lobe_bins": 4.0,
        "peak_sidelobe_db": -31.5,
    },
    "hamming": {
        "label": "汉明窗",
        "main_lobe_bins": 4.0,
        "peak_sidelobe_db": -42.7,
    },
    "blackman": {
        "label": "布莱克曼窗",
        "main_lobe_bins": 6.0,
        "peak_sidelobe_db": -58.1,
    },
    "kaiser": {
        "label": "凯泽窗 (Kaiser)",
        # beta-dependent; measured dynamically
        "main_lobe_bins": None,
        "peak_sidelobe_db": None,
    },
}


def _i0(x: float) -> float:
    """Zero-th order modified Bessel function of the first kind (series)."""
    result = 1.0
    term = 1.0
    half_x = x / 2.0
    for k in range(1, 60):
        term *= (half_x / k) ** 2
        result += term
        if term < 1e-18 * result:
            break
    return result


def rectangular(n: int) -> list[float]:
    return [1.0] * n


def hann(n: int) -> list[float]:
    if n <= 1:
        return [1.0] * n
    return [0.5 - 0.5 * math.cos(2.0 * math.pi * i / (n - 1)) for i in range(n)]


def hamming(n: int) -> list[float]:
    if n <= 1:
        return [1.0] * n
    return [0.54 - 0.46 * math.cos(2.0 * math.pi * i / (n - 1)) for i in range(n)]


def blackman(n: int) -> list[float]:
    if n <= 1:
        return [1.0] * n
    return [
        0.42 - 0.5 * math.cos(2.0 * math.pi * i / (n - 1))
        + 0.08 * math.cos(4.0 * math.pi * i / (n - 1))
        for i in range(n)
    ]


def kaiser(n: int, beta: float) -> list[float]:
    if n <= 1:
        return [1.0] * n
    denominator = _i0(beta)
    out = []
    for i in range(n):
        ratio = 2.0 * i / (n - 1) - 1.0
        arg = beta * math.sqrt(max(0.0, 1.0 - ratio * ratio))
        out.append(_i0(arg) / denominator)
    return out


def build_window(name: str, n: int, beta: float | None = None) -> list[float]:
    """Return a length-``n`` window sequence for the requested ``name``."""
    if n < 1:
        raise ValueError("window length must be at least 1")

    key = (name or "").strip().lower()
    if key == "rectangular":
        return rectangular(n)
    if key == "hann":
        return hann(n)
    if key == "hamming":
        return hamming(n)
    if key == "blackman":
        return blackman(n)
    if key == "kaiser":
        if beta is None:
            raise ValueError("kaiser window requires a beta parameter")
        if not math.isfinite(beta) or beta < 0:
            raise ValueError("kaiser beta must be a finite number >= 0")
        return kaiser(n, float(beta))
    raise ValueError(
        f"unknown window {name!r}; expected one of "
        f"{', '.join(WINDOW_CATALOG)}"
    )


def apply_window(samples: list[float], window: list[float]) -> list[float]:
    if len(samples) != len(window):
        raise ValueError("sample and window lengths must match")
    return [s * w for s, w in zip(samples, window)]


# ---------------------------------------------------------------------------
# Numeric measurement of window metrics (used for Kaiser and for tests)
# ---------------------------------------------------------------------------

def measure_window_metrics(
    name: str,
    n: int = 1024,
    beta: float | None = None,
    fft_size: int = 16384,
) -> dict[str, float]:
    """Measured null-to-null main-lobe width (bins) and peak sidelobe (dB).

    Thin cached wrapper around the actual computation; dragging the Kaiser β
    slider triggers this repeatedly, so each β is measured only once.
    """
    return _measure_cached(name, n, None if beta is None else round(beta, 2), fft_size)


@lru_cache(maxsize=256)
def _measure_cached(name: str, n: int, beta: float | None, fft_size: int) -> dict[str, float]:
    return _measure_impl(name, n, beta, fft_size)


def _measure_impl(name: str, n: int, beta: float | None, fft_size: int) -> dict[str, float]:
    win = build_window(name, n, beta)
    padded = win + [0.0] * (fft_size - n)
    spectrum = fft(padded)
    magnitudes, _ = magnitude_phase(spectrum)

    peak = magnitudes[0]
    db = [20.0 * math.log10(max(m / peak, 1e-12)) for m in magnitudes]

    # First null walking to the right of DC.
    first_null = None
    for k in range(1, fft_size // 2):
        if db[k] <= -80.0 or magnitudes[k] < magnitudes[k + 1] and db[k] < -40.0:
            first_null = k
            break
    if first_null is None:
        # Some windows (very small beta) never fully null; detect the local
        # minimum separating the main lobe from the first sidelobe.
        for k in range(1, fft_size // 4):
            if magnitudes[k] <= magnitudes[k - 1] and magnitudes[k] < magnitudes[k + 1] and db[k] < -12.0:
                first_null = k
                break
    if first_null is None:
        first_null = fft_size // n  # last-resort: 2-bin width
    main_lobe_bins = 2.0 * first_null * n / fft_size

    # Peak sidelobe: maximum level strictly beyond the first null.
    sidelobe_peak = max(db[first_null: fft_size // 2])

    return {
        "main_lobe_bins": main_lobe_bins,
        "peak_sidelobe_db": sidelobe_peak,
    }


def window_info(name: str, n: int = 1024, beta: float | None = None) -> dict:
    """Catalogue metadata, measuring Kaiser numerically from its beta."""
    key = (name or "").strip().lower()
    if key not in WINDOW_CATALOG:
        raise ValueError(f"unknown window {name!r}")
    entry = WINDOW_CATALOG[key]
    info: dict[str, object] = {
        "name": key,
        "label": entry["label"],
    }
    if key == "kaiser":
        measured = measure_window_metrics(key, n=n, beta=beta if beta is not None else 8.6)
        info["main_lobe_bins"] = round(measured["main_lobe_bins"], 2)
        info["peak_sidelobe_db"] = round(measured["peak_sidelobe_db"], 1)
        info["beta"] = beta if beta is not None else 8.6
    else:
        info["main_lobe_bins"] = entry["main_lobe_bins"]
        info["peak_sidelobe_db"] = entry["peak_sidelobe_db"]
    return info
