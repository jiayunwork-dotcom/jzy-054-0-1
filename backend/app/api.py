"""HTTP API: thin layer that validates input and delegates to core modules."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from .core import transform, windows
from .core.filtering import apply_filter
from .core.sampling import analyze_aliasing, sampling_demo
from .core.validation import (
    ValidationError,
    validate_fft_size,
    validate_padding,
    validate_sample_rate,
    validate_samples,
)
from .schemas import (
    AliasRequest,
    DFTRequest,
    FilterRequest,
    IDFTRequest,
    SamplingDemoRequest,
    WindowRequest,
)

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/config")
def config() -> dict:
    return {
        "allowed_fft_sizes": list(transform.ALLOWED_FFT_SIZES),
        "windows": [windows.window_info(name) for name in windows.WINDOW_CATALOG],
        "filter_types": ["lowpass", "highpass", "bandpass"],
        "max_components": 8,
    }


@router.post("/dft")
def dft_endpoint(req: DFTRequest) -> dict:
    sample_rate = validate_sample_rate(req.sample_rate)
    samples = validate_samples(req.samples)

    n_total = len(samples)
    if req.n is not None:
        n_total = validate_fft_size(req.n)
        n_total = validate_padding(len(samples), n_total)
    elif transform._is_power_of_two(len(samples)):
        n_total = len(samples)
    else:
        n_total = len(samples)  # direct DFT handles arbitrary lengths

    win = None
    if req.window:
        win = windows.build_window(req.window, len(samples), req.beta)
        samples = windows.apply_window(samples, win)

    spectrum = transform.dft_real(samples, n_total)
    result = transform.summarize(samples, spectrum, sample_rate)
    result["window"] = req.window if req.window else "rectangular"
    if req.beta is not None:
        result["beta"] = req.beta
    return result


@router.post("/idft")
def idft_endpoint(req: IDFTRequest) -> dict:
    imag = req.imag or [0.0] * len(req.real)
    if len(imag) != len(req.real):
        raise ValidationError(
            f"real ({len(req.real)}) and imag ({len(imag)}) arrays must have equal length"
        )
    if not req.real:
        raise ValidationError("spectrum arrays must be non-empty")
    spectrum = [complex(r, i) for r, i in zip(req.real, imag)]
    time_domain = transform.ifft(spectrum)
    return {
        "n": len(time_domain),
        "real": [z.real for z in time_domain],
        "imag": [z.imag for z in time_domain],
        "samples": [z.real for z in time_domain],  # real-signal convenience
    }


@router.post("/window")
def window_endpoint(req: WindowRequest) -> dict:
    win = windows.build_window(req.window, req.n, req.beta)
    info = windows.window_info(req.window, beta=req.beta)
    return {
        "name": info["name"],
        "label": info["label"],
        "n": req.n,
        "window": win,
        "metrics": {
            "main_lobe_bins": info["main_lobe_bins"],
            "peak_sidelobe_db": info["peak_sidelobe_db"],
        },
    }


@router.post("/windows/compare")
def windows_compare_endpoint(body: dict) -> dict:
    """Spectra of a signal under several windows, for the overlay plot."""
    raw_samples = body.get("samples")
    sample_rate = validate_sample_rate(body.get("sample_rate"))
    samples = validate_samples(raw_samples)
    requested = body.get("windows") or [
        {"name": name} for name in windows.WINDOW_CATALOG if name != "kaiser"
    ] + [{"name": "kaiser", "beta": 8.6}]

    n_total = len(samples)
    n_req = body.get("n")
    if n_req is not None:
        n_total = validate_fft_size(n_req)
        n_total = validate_padding(len(samples), n_total)

    curves = []
    for item in requested:
        if isinstance(item, str):
            name, beta = item, None
        else:
            name = item.get("name")
            beta = item.get("beta")
        win = windows.build_window(name, len(samples), beta)
        windowed = windows.apply_window(samples, win)
        spectrum = transform.dft_real(windowed, n_total)
        summary = transform.summarize(windowed, spectrum, sample_rate)
        info = windows.window_info(name, beta=beta)
        curves.append({
            "name": info["name"],
            "label": info["label"],
            "metrics": {
                "main_lobe_bins": info["main_lobe_bins"],
                "peak_sidelobe_db": info["peak_sidelobe_db"],
            },
            "magnitude": summary["magnitude"],
            "power": summary["power"],
            "frequencies": summary["frequencies"],
        })
    return {"curves": curves}


@router.post("/filter")
def filter_endpoint(req: FilterRequest) -> dict:
    samples = validate_samples(req.samples)
    sample_rate = validate_sample_rate(req.sample_rate)

    n_total = None
    if req.n is not None:
        n_total = validate_fft_size(req.n)
        n_total = validate_padding(len(samples), n_total)

    win = None
    if req.window:
        win = windows.build_window(req.window, len(samples), req.beta)

    result = apply_filter(
        samples=samples,
        sample_rate=sample_rate,
        filter_type=req.filter_type,
        low_hz=req.low_hz,
        high_hz=req.high_hz,
        n=n_total,
        window=win,
    )
    orig_mag, orig_phase = transform.magnitude_phase(result["original_spectrum"])
    filt_mag, filt_phase = transform.magnitude_phase(result["filtered_spectrum"])
    return {
        "n": result["n"],
        "sample_rate": sample_rate,
        "frequencies": transform.frequencies(result["n"], sample_rate),
        "mask": result["mask"],
        "original_magnitude": orig_mag,
        "original_phase": orig_phase,
        "filtered_magnitude": filt_mag,
        "filtered_phase": filt_phase,
        "filtered_samples": result["filtered_samples"],
    }


@router.get("/alias")
def alias_endpoint(signal_freq: float, sample_rate: float) -> dict:
    return analyze_aliasing(signal_freq, sample_rate)


@router.post("/sampling-demo")
def sampling_demo_endpoint(req: SamplingDemoRequest) -> dict:
    return sampling_demo(
        signal_freq=req.signal_freq,
        sample_rate=req.sample_rate,
        amplitude=req.amplitude,
        phase=req.phase,
        duration=req.duration,
        dense_points=req.dense_points,
    )


# ---------------------------------------------------------------------------
# Error mapping: every rejected input gets an explicit reason
# ---------------------------------------------------------------------------

def _error_response(message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": message})


def register_exception_handlers(app) -> None:
    @app.exception_handler(ValidationError)
    async def _on_validation_error(_: Request, exc: ValidationError):
        return _error_response(str(exc))

    @app.exception_handler(ValueError)
    async def _on_value_error(_: Request, exc: ValueError):
        # Core math functions raise plain ValueError for bad window names etc.
        return _error_response(str(exc))

    @app.exception_handler(RequestValidationError)
    async def _on_request_validation_error(_: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"] if p != "body")
            parts.append(f"{loc or 'request'}: {err['msg']}")
        return _error_response("invalid request — " + "; ".join(parts))

    @app.exception_handler(PydanticValidationError)
    async def _on_pydantic_error(_: Request, exc: PydanticValidationError):
        return _error_response(str(exc))
