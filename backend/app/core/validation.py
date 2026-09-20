"""Shared input validation for the API layer."""

from __future__ import annotations

from .transform import ALLOWED_FFT_SIZES


class ValidationError(ValueError):
    """Raised for bad client input; mapped to HTTP 400 with a clear reason."""


def validate_sample_rate(sample_rate: float) -> float:
    sr = float(sample_rate)
    if not _finite(sr) or sr <= 0:
        raise ValidationError(f"sample_rate must be a positive number, got {sample_rate!r}")
    return sr


def validate_fft_size(n: int) -> int:
    n = int(n)
    if n not in ALLOWED_FFT_SIZES:
        raise ValidationError(
            f"DFT size N={n} is not allowed; choose one of "
            f"{', '.join(map(str, ALLOWED_FFT_SIZES))}"
        )
    return n


def validate_samples(samples: list[float]) -> list[float]:
    if not isinstance(samples, list) or not samples:
        raise ValidationError("samples must be a non-empty array of numbers")
    try:
        values = [float(v) for v in samples]
    except (TypeError, ValueError):
        raise ValidationError("samples must contain only numbers")
    if not all(_finite(v) for v in values):
        raise ValidationError("samples must all be finite numbers")
    return values


def validate_padding(n_signal: int, n_padded: int | None) -> int:
    if n_padded is None:
        return n_signal
    n_padded = int(n_padded)
    if n_padded not in ALLOWED_FFT_SIZES:
        raise ValidationError(
            f"zero-padded length {n_padded} is not allowed; choose one of "
            f"{', '.join(map(str, ALLOWED_FFT_SIZES))}"
        )
    if n_padded < n_signal:
        raise ValidationError(
            f"zero-padded length ({n_padded}) cannot be shorter than the "
            f"signal ({n_signal} samples); padding only extends a signal"
        )
    return n_padded


def validate_frequency(value: float, name: str) -> float:
    v = float(value)
    if not _finite(v) or v < 0:
        raise ValidationError(f"{name} must be a non-negative finite number, got {value!r}")
    return v


def _finite(v: float) -> bool:
    return v == v and v not in (float("inf"), float("-inf"))
