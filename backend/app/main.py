"""Q-Secure FastAPI application."""
from __future__ import annotations

import logging
import time

import qiskit
import qiskit_aer
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response

from .bb84 import ProtocolRandom, run_quantum_transmission
from .experiment_runner import (
    JOBS,
    STORE,
    circuit_catalog,
    export_csv,
    export_markdown,
    run_experiment,
    start_sweep,
)
from .quantum_channel import NoiseModel
from .schemas import ExperimentConfig, ExperimentResult, SweepJob, SweepRequest

# Never log key material: we only log experiment ids and sizes.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("qsecure")

app = FastAPI(title="Q-Secure BB84 API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    t0 = time.perf_counter()
    try:
        r = run_quantum_transmission(100, ProtocolRandom(0), False, 0.0, NoiseModel.NONE, 0.0)
        m = r.alice_bases == r.bob_bases
        ok = bool((r.alice_bits[m] == r.bob_results[m]).all())
        sim_status = "ok" if ok else "degraded"
    except Exception as e:  # pragma: no cover
        sim_status = f"error: {type(e).__name__}"
    return {
        "status": "ok",
        "quantum_simulator": sim_status,
        "self_test": "100-qubit noiseless BB84, matched bases must agree",
        "self_test_ms": round((time.perf_counter() - t0) * 1000, 1),
        "qiskit": qiskit.__version__,
        "qiskit_aer": qiskit_aer.__version__,
        "persistence": "in-memory (last 50 experiments; cleared on restart)",
    }


@app.post("/api/experiment/run", response_model=ExperimentResult)
def run(cfg: ExperimentConfig):
    try:
        r = run_experiment(cfg)
    except Exception as e:
        log.exception("experiment failed")
        raise HTTPException(500, f"Simulation failed: {type(e).__name__}: {e}")
    log.info("experiment %s n=%d status=%s %.0fms", r.experiment_id, cfg.n_qubits, r.decision.status, r.runtime_ms)
    return r


@app.post("/api/experiment/sweep", response_model=SweepJob, status_code=202)
def sweep(req: SweepRequest):
    job = start_sweep(req)
    log.info("sweep %s started: %s × %d trials", job.job_id, req.variable.value, req.trials)
    return job


@app.get("/api/sweep/{job_id}", response_model=SweepJob)
def sweep_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Sweep job not found")
    return job


@app.get("/api/experiments")
def list_experiments():
    return [
        {
            "experiment_id": r.experiment_id,
            "created_at": r.created_at,
            "n_qubits": r.config.n_qubits,
            "qber": r.metrics.qber,
            "status": r.decision.status,
        }
        for r in reversed(STORE.list())
    ]


@app.get("/api/circuits")
def circuits(noise_model: NoiseModel = NoiseModel.NONE, noise_probability: float = Query(0.0, ge=0, le=0.1)):
    return circuit_catalog(noise_model, noise_probability)


def _get(eid: str) -> ExperimentResult:
    r = STORE.get(eid)
    if not r:
        raise HTTPException(404, "Experiment not found (in-memory store keeps the last 50; restarts clear it)")
    return r


@app.get("/api/experiment/{experiment_id}", response_model=ExperimentResult)
def get_experiment(experiment_id: str):
    return _get(experiment_id)


@app.get("/api/experiment/{experiment_id}/export")
def export(experiment_id: str, format: str = Query("csv", pattern="^(csv|md|json)$")):
    r = _get(experiment_id)
    if format == "csv":
        return Response(export_csv(r), media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=qsecure_{experiment_id}.csv"})
    if format == "md":
        return PlainTextResponse(export_markdown(r), media_type="text/markdown",
                                 headers={"Content-Disposition": f"attachment; filename=qsecure_{experiment_id}_report.md"})
    return Response(r.model_dump_json(indent=2), media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename=qsecure_{experiment_id}.json"})
