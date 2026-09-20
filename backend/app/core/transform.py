"""Discrete Fourier transform core.

Pure-Python implementation with no third-party dependencies so that the
arithmetic can be inspected and tested independently of the web layer.

Convention (numpy/mathematics standard):
    forward:  X[k]   = sum_n x[n] * exp(-j*2*pi*k*n/N)
    inverse:  x[n]   = (1/N) * sum_k X[k] * exp(+j*2*pi*k*n/N)

Parseval under this convention:
    sum_n |x[n]|^2 = (1/N) * sum_k |X[k]|^2
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

TWO_PI = 2.0 * math.pi

# DFT lengths selectable in the UI.
ALLOWED_FFT_SIZES: tuple[int, ...] = (64, 128, 256, 512, 1024)


# ---------------------------------------------------------------------------
# FFT implementations
# ---------------------------------------------------------------------------

def _is_power_of_two(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def _bit_reverse_permutation(a: list[complex]) -> None:
    n = len(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]


def fft_radix2(x: Sequence[complex | float], sign: int = -1) -> list[complex]:
    """Iterative radix-2 Cooley-Tukey FFT.  Length must be a power of two."""
    a = [complex(v) for v in x]
    n = len(a)
    if n == 1:
        return a
    if not _is_power_of_two(n):
        raise ValueError("fft_radix2 requires a power-of-two length")

    _bit_reverse_permutation(a)

    length = 2
    while length <= n:
        half = length >> 1
        root_angle = TWO_PI / length
        twiddle = complex(math.cos(root_angle), sign * math.sin(root_angle))
        for start in range(0, n, length):
            w = 1 + 0j
            for j in range(half):
                u = a[start + j]
                t = w * a[start + j + half]
                a[start + j] = u + t
                a[start + j + half] = u - t
                w *= twiddle
        length <<= 1
    return a


def dft_direct(x: Sequence[complex | float], sign: int = -1) -> list[complex]:
    """Brute-force O(N^2) DFT, used as fallback / cross-check."""
    n = len(x)
    out: list[complex] = [0j] * n
    for k in range(n):
        total = 0j
        for t, value in enumerate(x):
            angle = sign * TWO_PI * k * t / n
            total += complex(value) * complex(math.cos(angle), math.sin(angle))
        out[k] = total
    return out


def fft(x: Sequence[complex | float]) -> list[complex]:
    """Forward DFT: radix-2 when possible, direct definition otherwise."""
    values = list(x)
    if not values:
        return []
    if _is_power_of_two(len(values)):
        return fft_radix2(values)
    return dft_direct(values)


def ifft(spectrum: Sequence[complex]) -> list[complex]:
    """Inverse DFT via the conjugate trick on the forward transform."""
    n = len(spectrum)
    if n == 0:
        return []
    conjugated = [z.conjugate() for z in spectrum]
    transformed = fft(conjugated)
    return [z.conjugate() / n for z in transformed]


# ---------------------------------------------------------------------------
# High-level real-signal helpers
# ---------------------------------------------------------------------------

def dft_real(samples: Iterable[float], n: int | None = None) -> list[complex]:
    """DFT of a real sequence, zero-padding (never truncating) to length ``n``."""
    x = [float(v) for v in samples]
    if not x:
        raise ValueError("sample sequence must not be empty")
    size = len(x) if n is None else int(n)
    if size < len(x):
        raise ValueError(
            f"transform length ({size}) is shorter than the signal "
            f"({len(x)} samples); zero-padding can only extend a signal"
        )
    x.extend([0.0] * (size - len(x)))
    return fft(x)


def idft_to_real(spectrum: Iterable[complex]) -> list[float]:
    """Inverse DFT, returning the real part (imaginary residual dropped)."""
    time_domain = ifft(list(spectrum))
    return [z.real for z in time_domain]


def magnitude_phase(spectrum: Sequence[complex]) -> tuple[list[float], list[float]]:
    """Magnitude and phase (radians).

    Phase is pinned to 0 for bins whose magnitude is at the numerical noise
    floor, so an all-zero signal yields an all-zero phase spectrum instead of
    arbitrary floating-point junk.
    """
    magnitudes = [abs(z) for z in spectrum]
    peak = max(magnitudes, default=0.0)
    noise_floor = max(peak * 1e-10, 1e-15)
    phases = [
        0.0 if mag <= noise_floor else math.atan2(z.imag, z.real)
        for z, mag in zip(spectrum, magnitudes)
    ]
    return magnitudes, phases


def frequencies(n: int, sample_rate: float) -> list[float]:
    """Bin centre frequencies, including the wrap-around Nyquist bin at fs/2."""
    return [k * sample_rate / n for k in range(n)]


def parseval_energies(samples: Sequence[float], spectrum: Sequence[complex]) -> tuple[float, float]:
    """Return (time-domain energy, frequency-domain energy).

    time energy  = sum_n |x[n]|^2
    freq energy  = (1/N) sum_k |X[k]|^2
    """
    time_energy = sum(v * v for v in samples)
    n = len(spectrum)
    freq_energy = sum((z.real * z.real + z.imag * z.imag) for z in spectrum) / n
    return time_energy, freq_energy


def summarize(samples: Sequence[float], spectrum: Sequence[complex], sample_rate: float) -> dict:
    """Pack a spectrum plus derived quantities for the API layer."""
    magnitudes, phases = magnitude_phase(spectrum)
    n = len(spectrum)
    time_energy, freq_energy = parseval_energies(samples, spectrum)
    return {
        "n": n,
        "sample_rate": float(sample_rate),
        "frequencies": frequencies(n, sample_rate),
        "real": [z.real for z in spectrum],
        "imag": [z.imag for z in spectrum],
        "magnitude": magnitudes,
        "phase": phases,
        "power": [m * m for m in magnitudes],
        "time_energy": time_energy,
        "freq_energy": freq_energy,
    }
