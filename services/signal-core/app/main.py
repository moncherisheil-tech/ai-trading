"""FastAPI entrypoint for Signal Core."""

from __future__ import annotations

from fastapi import FastAPI

from app.metrics import compute_microstructure
from app.schemas import MicrostructureRequest, MicrostructureResponse

app = FastAPI(title="Quantum Signal Core", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/microstructure", response_model=MicrostructureResponse)
def microstructure(body: MicrostructureRequest) -> MicrostructureResponse:
    return compute_microstructure(body)
