"""FastAPI application entry point."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import register_exception_handlers, router

app = FastAPI(
    title="傅里叶变换教学工具 API",
    description="Transform kernel, windows, filtering and aliasing analysis.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
register_exception_handlers(app)


@app.get("/")
def root() -> dict:
    return {"service": "fourier-lab", "docs": "/docs", "api": "/api/health"}
