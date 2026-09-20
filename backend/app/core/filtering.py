"""Frequency-domain filtering.

A spectral mask is built from a pass-band specification, applied to the DFT
of the (windowed) signal, and inverted back to the time domain.

For real signals the mask is made conjugate symmetric so that the inverse
transform stays real: every bin k mirrors bin N-k.
"""

from __future__ import annotations

from .transform import dft_real, idft_to_real

FILTER_TYPES = ("lowpass", "highpass", "bandpass")


def _validate_band(filter_type: str, low_hz: float, high_hz: float, nyquist: float) -> None:
    if filter_type not in FILTER_TYPES:
        raise ValueError(
            f"unknown filter type {filter_type!r}; expected one of "
            f"{', '.join(FILTER_TYPES)}"
        )
    if low_hz < 0.0:
        raise ValueError(f"lower band edge must be >= 0, got {low_hz}")
    if high_hz > nyquist + 1e-9:
        raise ValueError(
            f"upper band edge {high_hz} Hz exceeds Nyquist {nyquist} Hz"
        )
    if high_hz <= low_hz:
        raise ValueError(
            f"upper band edge ({high_hz} Hz) must be strictly greater than "
            f"lower band edge ({low_hz} Hz)"
        )


def build_mask(
    n: int,
    sample_rate: float,
    filter_type: str,
    low_hz: float,
    high_hz: float,
) -> list[float]:
    """Real-valued 0/1 mask of length N, conjugate symmetric by construction."""
    nyquist = sample_rate / 2.0
    low_hz = float(low_hz)
    high_hz = float(high_hz)
    _validate_band(filter_type, low_hz, high_hz, nyquist)

    mask = [0.0] * n

    def in_pass(freq_hz: float) -> bool:
        if filter_type == "lowpass":
            return freq_hz <= high_hz
        if filter_type == "highpass":
            return freq_hz >= low_hz
        return low_hz <= freq_hz <= high_hz

    for k in range(n):
        # Folded frequency of bin k inside [0, fs/2].
        folded = min(k, n - k) * sample_rate / n
        if in_pass(folded):
            mask[k] = 1.0
    return mask


def apply_filter(
    samples: list[float],
    sample_rate: float,
    filter_type: str,
    low_hz: float,
    high_hz: float,
    n: int | None = None,
    window: list[float] | None = None,
) -> dict:
    """Filter a real signal in the frequency domain.

    Returns the original spectrum (before masking), masked spectrum, mask and
    real filtered time-domain sequence.  When zero-padded with ``n`` the
    inverse transform has length ``n``; the spectrum is computed over the
    same length so round-trip quantities stay consistent.
    """
    x = [float(v) for v in samples]
    if not x:
        raise ValueError("sample sequence must not be empty")
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    original_spectrum = dft_real(x, n)
    total_n = len(original_spectrum)

    if window is not None:
        if len(window) != len(x):
            raise ValueError("window length must match the unpadded signal length")
        windowed = [s * w for s, w in zip(x, window)]
        original_spectrum = dft_real(windowed, total_n)
        x = windowed  # energy checks refer to what actually entered the DFT

    mask = build_mask(total_n, sample_rate, filter_type, low_hz, high_hz)
    masked = [z * m for z, m in zip(original_spectrum, mask)]
    filtered = idft_to_real(masked)

    return {
        "n": total_n,
        "sample_rate": float(sample_rate),
        "original_spectrum": original_spectrum,
        "filtered_spectrum": masked,
        "mask": mask,
        "filtered_samples": filtered,
    }
