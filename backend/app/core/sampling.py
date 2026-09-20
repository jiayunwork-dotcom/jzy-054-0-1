"""Sampling theorem and aliasing analysis.

Aliasing criterion (real signals, Nyquist-Shannon):
    a tone of frequency f0 sampled at fs is reconstructed uniquely only while
    f0 <= fs/2.  Above that it "folds" into the base band and appears at the
    apparent frequency

        f_app = |((f0 + fs/2) mod fs) - fs/2|

    which always lies in [0, fs/2].
"""

from __future__ import annotations

import math


def apparent_frequency(signal_freq: float, sample_rate: float) -> float:
    """Folded (aliased) frequency of ``signal_freq`` under ``sample_rate``."""
    return abs((signal_freq + sample_rate / 2.0) % sample_rate - sample_rate / 2.0)


def analyze_aliasing(signal_freq: float, sample_rate: float) -> dict:
    """Decide whether sampling ``signal_freq`` at ``sample_rate`` aliases."""
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if signal_freq < 0:
        raise ValueError("signal frequency must be non-negative")

    nyquist = sample_rate / 2.0
    aliased = signal_freq > nyquist
    f_app = apparent_frequency(signal_freq, sample_rate)
    return {
        "signal_freq": float(signal_freq),
        "sample_rate": float(sample_rate),
        "nyquist": nyquist,
        "aliased": aliased,
        "apparent_freq": f_app,
        "ratio": signal_freq / sample_rate,
    }


# ---------------------------------------------------------------------------
# Sampling demo: dense "original" curve, samples, sinc reconstruction
# ---------------------------------------------------------------------------

def _cosine(times: list[float], freq: float, phase: float, amplitude: float) -> list[float]:
    return [amplitude * math.cos(2.0 * math.pi * freq * t + phase) for t in times]


def sampling_demo(
    signal_freq: float,
    sample_rate: float,
    amplitude: float = 1.0,
    phase: float = 0.0,
    duration: float | None = None,
    dense_points: int = 2048,
) -> dict:
    """Build the three traces of the sampling-theorem demonstration.

    * dense original cosine over the full window,
    * samples taken at 1/sample_rate on the interior window,
    * band-limited reconstruction: sinc interpolation of those samples,
      evaluated on the interior window so edge ringing stays out of view.
    """
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if signal_freq < 0:
        raise ValueError("signal frequency must be non-negative")
    if duration is None:
        # ~6 signal periods, but at least ~12 sample periods so that sinc
        # interpolation has a comfortably populated interior window.
        duration = max(6.0 / signal_freq if signal_freq > 0 else 1.0,
                       12.0 / sample_rate)
    duration = max(float(duration), 12.0 / sample_rate)
    if dense_points < 32:
        raise ValueError("dense_points must be at least 32")

    # Interior sampling window: keep one sample interval of margin on each
    # side so sinc kernels have data on both sides of every evaluation point.
    t_start = 1.0 / sample_rate
    t_end = duration - 1.0 / sample_rate
    if t_end <= t_start:
        t_start, t_end = 0.0, duration

    sample_times: list[float] = []
    k = 0
    while True:
        t = k / sample_rate
        if t > t_end + 1e-12:
            break
        if t >= t_start - 1e-12:
            sample_times.append(t)
        k += 1
    sample_values = _cosine(sample_times, signal_freq, phase, amplitude)

    dense_times = [i * duration / (dense_points - 1) for i in range(dense_points)]
    dense_values = _cosine(dense_times, signal_freq, phase, amplitude)

    # Sinc (Whittaker-Shannon) interpolation, only inside the sampled window.
    rec_times: list[float] = []
    rec_values: list[float] = []
    for t in dense_times:
        if t < t_start - 1e-12 or t > t_end + 1e-12:
            continue
        total = 0.0
        for ts, vs in zip(sample_times, sample_values):
            u = math.pi * sample_rate * (t - ts)
            if abs(u) < 1e-12:
                total += vs
            else:
                total += vs * math.sin(u) / u
        rec_times.append(t)
        rec_values.append(total)

    alias = analyze_aliasing(signal_freq, sample_rate)
    return {
        "signal_freq": float(signal_freq),
        "sample_rate": float(sample_rate),
        "amplitude": float(amplitude),
        "phase": float(phase),
        "duration": float(duration),
        "dense_t": dense_times,
        "dense_y": dense_values,
        "sample_t": sample_times,
        "sample_y": sample_values,
        "reconstructed_t": rec_times,
        "reconstructed_y": rec_values,
        "aliasing": alias,
    }
