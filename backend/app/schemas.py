"""Pydantic request/response schemas."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator

from .quantum_channel import NoiseModel


class ExperimentConfig(BaseModel):
    n_qubits: int = Field(1000, ge=100, le=10_000, description="Transmitted qubits")
    eve_enabled: bool = False
    eve_probability: float = Field(1.0, ge=0.0, le=1.0)
    noise_model: NoiseModel = NoiseModel.NONE
    noise_probability: float = Field(0.0, ge=0.0, le=0.10)
    qber_threshold: float = Field(0.11, ge=0.0, le=0.5)
    test_fraction: float = Field(0.25, ge=0.05, le=0.9)
    min_test_sample: int = Field(20, ge=1, le=5000)
    seed: Optional[int] = Field(None, ge=0, le=2**32 - 1)
    postprocessing: bool = True
    demo_mode: bool = Field(True, description="Reveal individual bit values (educational)")

    @model_validator(mode="after")
    def _consistency(self):
        if self.noise_model == NoiseModel.NONE and self.noise_probability > 0:
            raise ValueError("noise_probability > 0 requires a noise_model other than 'none'")
        return self


class Decision(BaseModel):
    status: str
    label: str
    rationale: str


class Metrics(BaseModel):
    transmitted: int
    sifted: int
    discarded: int
    sift_ratio: float
    test_sample_size: int
    test_errors: int
    qber: Optional[float]
    qber_ci_low: float
    qber_ci_high: float
    qber_std_error: Optional[float]
    candidate_key_length: int
    candidate_true_errors: Optional[int]  # ground truth, demo mode only
    final_key_length: Optional[int]
    eve_interceptions: int


class Theory(BaseModel):
    expected_qber: float
    eve_component: float
    expected_sifted: float
    expected_test_sample: float
    expected_candidate: float
    note: str


class Positions(BaseModel):
    """Columnar per-position data. Bases: 0=Z, 1=X. -1 = not applicable.
    role: 0 discarded (basis mismatch), 1 test sample, 2 candidate key.
    error: 1/0 where known publicly (test sample) or in demo mode; -1 otherwise."""

    alice_bits: Optional[List[int]]
    alice_bases: List[int]
    eve_intercepted: List[int]
    eve_bases: List[int]
    eve_results: Optional[List[int]]
    bob_bases: List[int]
    bob_results: Optional[List[int]]
    role: List[int]
    error: List[int]


class ExperimentResult(BaseModel):
    experiment_id: str
    created_at: str
    config: ExperimentConfig
    secure_randomness: bool
    metrics: Metrics
    decision: Decision
    theory: Theory
    positions: Positions
    postprocessing: Optional[Dict[str, Any]]
    counts_by_class: List[Dict[str, Any]]
    circuit_classes: int
    simulator: Dict[str, Any]
    runtime_ms: float


class SweepVariable(str, Enum):
    EVE_PROBABILITY = "eve_probability"
    NOISE_PROBABILITY = "noise_probability"
    N_QUBITS = "n_qubits"
    TEST_FRACTION = "test_fraction"
    REPEAT = "repeat"


class SweepRequest(BaseModel):
    base: ExperimentConfig = ExperimentConfig()
    variable: SweepVariable
    values: List[float] = Field(..., min_length=1, max_length=25)
    trials: int = Field(5, ge=1, le=100)

    @model_validator(mode="after")
    def _check(self):
        if len(self.values) * self.trials > 1000:
            raise ValueError("values × trials must be ≤ 1000")
        limits = {
            SweepVariable.EVE_PROBABILITY: (0.0, 1.0),
            SweepVariable.NOISE_PROBABILITY: (0.0, 0.10),
            SweepVariable.N_QUBITS: (100, 10_000),
            SweepVariable.TEST_FRACTION: (0.05, 0.9),
            SweepVariable.REPEAT: (float("-inf"), float("inf")),
        }
        lo, hi = limits[self.variable]
        for v in self.values:
            if not lo <= v <= hi:
                raise ValueError(f"value {v} out of range [{lo}, {hi}] for {self.variable.value}")
        if self.variable == SweepVariable.NOISE_PROBABILITY and self.base.noise_model == NoiseModel.NONE:
            raise ValueError("Noise sweep requires base.noise_model other than 'none'")
        return self


class SweepJob(BaseModel):
    job_id: str
    status: str  # queued | running | done | error
    progress: float
    completed_runs: int
    total_runs: int
    request: SweepRequest
    points: List[Dict[str, Any]] = []
    error: Optional[str] = None
