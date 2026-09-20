"""Pydantic request models for the HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DFTRequest(BaseModel):
    samples: list[float] = Field(..., description="real-valued time-domain samples")
    sample_rate: float = Field(..., gt=0, description="sampling frequency in Hz")
    n: int | None = Field(None, description="zero-padded DFT size; must be in the allowed set")
    window: str | None = Field(None, description="window name (rectangular/hann/hamming/blackman/kaiser)")
    beta: float | None = Field(None, description="Kaiser beta, required only when window=kaiser")


class IDFTRequest(BaseModel):
    real: list[float]
    imag: list[float] = []


class WindowRequest(BaseModel):
    n: int = Field(..., ge=1, le=1_000_000)
    window: str
    beta: float | None = None


class FilterRequest(BaseModel):
    samples: list[float]
    sample_rate: float = Field(..., gt=0)
    filter_type: str = Field(..., description="lowpass | highpass | bandpass")
    low_hz: float = 0.0
    high_hz: float
    n: int | None = None
    window: str | None = None
    beta: float | None = None


class AliasRequest(BaseModel):
    signal_freq: float = Field(..., ge=0)
    sample_rate: float = Field(..., gt=0)


class SamplingDemoRequest(BaseModel):
    signal_freq: float = Field(..., ge=0)
    sample_rate: float = Field(..., gt=0)
    amplitude: float = 1.0
    phase: float = 0.0
    duration: float | None = None
    dense_points: int = 2048
