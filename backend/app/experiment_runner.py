"""Orchestrates complete BB84 experiments, in-memory storage, sweeps and exports."""
from __future__ import annotations

import csv
import io
import json
import math
import statistics
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Dict, Optional

import numpy as np
import qiskit
import qiskit_aer

from .bb84 import BASIS_NAMES, ProtocolRandom, build_transmission_circuit, run_quantum_transmission
from .postprocessing import run_postprocessing
from .quantum_channel import NoiseModel
from .schemas import (
    Decision,
    ExperimentConfig,
    ExperimentResult,
    Metrics,
    Positions,
    SweepJob,
    SweepRequest,
    SweepVariable,
    Theory,
)
from .security_analysis import (
    STATUS_LABELS,
    estimate_qber,
    security_decision,
    sift,
    theoretical_qber,
)

MAX_STORED = 50


class ExperimentStore:
    """Bounded in-memory LRU store (no disk persistence; restarts clear it)."""

    def __init__(self, cap: int = MAX_STORED):
        self.cap = cap
        self._d: "OrderedDict[str, ExperimentResult]" = OrderedDict()
        self._lock = threading.Lock()

    def put(self, r: ExperimentResult) -> None:
        with self._lock:
            self._d[r.experiment_id] = r
            self._d.move_to_end(r.experiment_id)
            while len(self._d) > self.cap:
                self._d.popitem(last=False)

    def get(self, eid: str) -> Optional[ExperimentResult]:
        with self._lock:
            return self._d.get(eid)

    def list(self):
        with self._lock:
            return list(self._d.values())


STORE = ExperimentStore()


def run_experiment(cfg: ExperimentConfig, store: bool = True) -> ExperimentResult:
    t0 = time.perf_counter()
    rand = ProtocolRandom(cfg.seed)
    q = run_quantum_transmission(
        cfg.n_qubits, rand, cfg.eve_enabled, cfg.eve_probability, cfg.noise_model, cfg.noise_probability
    )
    s = sift(q.alice_bases, q.bob_bases)
    est = estimate_qber(s.matched_idx, q.alice_bits, q.bob_results, cfg.test_fraction, rand.choice)
    status, rationale = security_decision(est, cfg.qber_threshold, cfg.min_test_sample)

    n = cfg.n_qubits
    role = np.zeros(n, dtype=np.int8)
    role[est.test_idx] = 1
    role[est.key_idx] = 2
    true_err = (q.alice_bits != q.bob_results).astype(np.int8)
    error = np.full(n, -1, dtype=np.int8)
    error[est.test_idx] = true_err[est.test_idx]
    if cfg.demo_mode:
        error[est.key_idx] = true_err[est.key_idx]

    pp_dict = None
    final_len = None
    if cfg.postprocessing:
        if status == "LOW_DISTURBANCE":
            pp = run_postprocessing(
                q.alice_bits[est.key_idx], q.bob_results[est.key_idx], est.qber, est.ci_high, rand, cfg.demo_mode
            )
            final_len = pp.final_length
            pp_dict = pp.__dict__
        else:
            pp_dict = {"performed": False, "reason": f"Skipped: protocol status is {STATUS_LABELS[status]}."}
            final_len = 0

    eff_eve = cfg.eve_probability if cfg.eve_enabled else 0.0
    nm, npb = cfg.noise_model, cfg.noise_probability
    theory = Theory(
        expected_qber=theoretical_qber(eff_eve, nm, npb),
        eve_component=eff_eve / 4,
        expected_sifted=n / 2,
        expected_test_sample=n / 2 * cfg.test_fraction,
        expected_candidate=n / 2 * (1 - cfg.test_fraction),
        note=(
            "Idealised infinite-sample expectation. Full random-basis intercept-resend gives 25% QBER "
            "only in the limit of many qubits on a noiseless channel; finite samples fluctuate."
        ),
    )
    metrics = Metrics(
        transmitted=n,
        sifted=len(s.matched_idx),
        discarded=len(s.discarded_idx),
        sift_ratio=len(s.matched_idx) / n,
        test_sample_size=est.sample_size,
        test_errors=est.errors,
        qber=est.qber,
        qber_ci_low=est.ci_low,
        qber_ci_high=est.ci_high,
        qber_std_error=est.std_error,
        candidate_key_length=len(est.key_idx),
        candidate_true_errors=int(true_err[est.key_idx].sum()) if cfg.demo_mode else None,
        final_key_length=final_len,
        eve_interceptions=int(q.eve_intercepted.sum()),
    )
    positions = Positions(
        alice_bits=q.alice_bits.tolist() if cfg.demo_mode else None,
        alice_bases=q.alice_bases.tolist(),
        eve_intercepted=q.eve_intercepted.astype(int).tolist(),
        eve_bases=q.eve_bases.tolist(),
        eve_results=q.eve_results.tolist() if cfg.demo_mode else None,
        bob_bases=q.bob_bases.tolist(),
        bob_results=q.bob_results.tolist() if cfg.demo_mode else None,
        role=role.tolist(),
        error=error.tolist(),
    )
    result = ExperimentResult(
        experiment_id=uuid.uuid4().hex[:12],
        created_at=datetime.now(timezone.utc).isoformat(),
        config=cfg,
        secure_randomness=rand.secure,
        metrics=metrics,
        decision=Decision(status=status, label=STATUS_LABELS[status], rationale=rationale),
        theory=theory,
        positions=positions,
        postprocessing=pp_dict,
        counts_by_class=q.counts_by_class,
        circuit_classes=q.circuit_classes,
        simulator={
            "backend": "AerSimulator",
            "qiskit": qiskit.__version__,
            "qiskit_aer": qiskit_aer.__version__,
            "execution": "batched by circuit class (shots = positions per class, memory=True)",
            "simulator_seeds": q.sim_seeds,
        },
        runtime_ms=(time.perf_counter() - t0) * 1000,
    )
    if store:
        STORE.put(result)
    return result


# --------------------------------------------------------------------------
# Sweeps (background jobs)
# --------------------------------------------------------------------------
JOBS: Dict[str, SweepJob] = {}
_JOBS_LOCK = threading.Lock()


def _mean_ci(xs):
    if not xs:
        return None, None, None
    m = statistics.fmean(xs)
    sd = statistics.stdev(xs) if len(xs) > 1 else 0.0
    half = 1.96 * sd / math.sqrt(len(xs)) if len(xs) > 1 else 0.0
    return m, sd, half


def execute_sweep(job: SweepJob) -> None:
    req = job.request
    job.status = "running"
    try:
        for vi, v in enumerate(req.values):
            trials = []
            for t in range(req.trials):
                upd = {"postprocessing": False, "demo_mode": False}
                if req.variable == SweepVariable.EVE_PROBABILITY:
                    upd.update(eve_enabled=True, eve_probability=v)
                elif req.variable == SweepVariable.NOISE_PROBABILITY:
                    upd["noise_probability"] = v
                elif req.variable == SweepVariable.N_QUBITS:
                    upd["n_qubits"] = int(v)
                elif req.variable == SweepVariable.TEST_FRACTION:
                    upd["test_fraction"] = v
                if req.base.seed is not None:
                    upd["seed"] = (req.base.seed + vi * 1009 + t * 7919) % (2**32)
                cfg = req.base.model_copy(update=upd)
                cfg = ExperimentConfig.model_validate(cfg.model_dump())
                r = run_experiment(cfg, store=False)
                m = r.metrics
                trials.append(
                    {
                        "trial": t,
                        "qber": m.qber,
                        "errors": m.test_errors,
                        "sample_size": m.test_sample_size,
                        "sifted": m.sifted,
                        "candidate": m.candidate_key_length,
                        "decision": r.decision.status,
                        "seed": cfg.seed,
                    }
                )
                job.completed_runs += 1
                job.progress = job.completed_runs / job.total_runs
            qbers = [x["qber"] for x in trials if x["qber"] is not None]
            mq, sdq, hq = _mean_ci(qbers)
            tot_err = sum(x["errors"] for x in trials)
            tot_n = sum(x["sample_size"] for x in trials)
            ms, _, hs = _mean_ci([x["sifted"] for x in trials])
            mc, _, hc = _mean_ci([x["candidate"] for x in trials])
            job.points.append(
                {
                    "value": v,
                    "trials": trials,
                    "mean_qber": mq,
                    "std_qber": sdq,
                    "ci95_half": hq,
                    "pooled_qber": tot_err / tot_n if tot_n else None,
                    "theoretical_qber": r.theory.expected_qber,
                    "mean_sifted": ms,
                    "ci95_sifted": hs,
                    "expected_sifted": r.theory.expected_sifted,
                    "mean_candidate": mc,
                    "ci95_candidate": hc,
                    "expected_candidate": r.theory.expected_candidate,
                    "abort_rate": sum(x["decision"] == "ABORT" for x in trials) / len(trials),
                }
            )
        job.status = "done"
    except Exception as e:  # surfaced to the UI
        job.status = "error"
        job.error = f"{type(e).__name__}: {e}"


def start_sweep(req: SweepRequest, background: bool = True) -> SweepJob:
    job = SweepJob(
        job_id=uuid.uuid4().hex[:12],
        status="queued",
        progress=0.0,
        completed_runs=0,
        total_runs=len(req.values) * req.trials,
        request=req,
    )
    with _JOBS_LOCK:
        JOBS[job.job_id] = job
        if len(JOBS) > 100:
            JOBS.pop(next(iter(JOBS)))
    if background:
        threading.Thread(target=execute_sweep, args=(job,), daemon=True).start()
    else:
        execute_sweep(job)
    return job


# --------------------------------------------------------------------------
# Circuit inspector
# --------------------------------------------------------------------------
def _describe(qc, title, basis, kind, description):
    ops = {k: int(v) for k, v in qc.count_ops().items()}
    return {
        "title": title,
        "kind": kind,
        "basis": basis,
        "description": description,
        "num_qubits": qc.num_qubits,
        "num_clbits": qc.num_clbits,
        "depth": qc.depth(),
        "gates": ops,
        "diagram": str(qc.draw("text", fold=110)),
        "qasm_like": [f"{ci.operation.name} q[{qc.find_bit(ci.qubits[0]).index}]" for ci in qc.data if ci.qubits],
    }


def circuit_catalog(noise_model: NoiseModel = NoiseModel.NONE, noise_p: float = 0.0):
    from qiskit import QuantumCircuit

    out = []
    for bit in (0, 1):
        qc = QuantumCircuit(1, name=f"prep_Z_{bit}")
        if bit:
            qc.x(0)
        out.append(_describe(qc, f"Z-basis preparation, bit {bit} → |{bit}⟩", "Z", "preparation",
                             "Alice encodes in the computational basis."))
    for bit in (0, 1):
        qc = QuantumCircuit(1, name=f"prep_X_{bit}")
        if bit:
            qc.x(0)
        qc.h(0)
        out.append(_describe(qc, f"X-basis preparation, bit {bit} → |{'+' if bit == 0 else '−'}⟩", "X",
                             "preparation", "Alice applies H after optional X to encode in the Hadamard basis."))
    qc = QuantumCircuit(1, 1, name="meas_Z")
    qc.measure(0, 0)
    out.append(_describe(qc, "Z-basis measurement", "Z", "measurement", "Direct computational-basis measurement."))
    qc = QuantumCircuit(1, 1, name="meas_X")
    qc.h(0)
    qc.measure(0, 0)
    out.append(_describe(qc, "X-basis measurement", "X", "measurement",
                         "H rotates |+⟩/|−⟩ to |0⟩/|1⟩ before computational-basis measurement."))
    full = build_transmission_circuit(1, 1, True, 0, 1, noise_model, noise_p)
    out.append(_describe(full, "Eve intercept-resend (Alice X/1 → Eve Z → Bob X)", "Eve: Z, Bob: X", "eve",
                         "Exact circuit executed by the simulator: Eve measures in Z, resets, conditionally "
                         "re-prepares from her outcome (if_test), then the channel and Bob's X measurement follow."))
    full2 = build_transmission_circuit(0, 0, False, 0, 0, noise_model, noise_p)
    out.append(_describe(full2, "Full transmission without Eve (Alice Z/0 → Bob Z)", "Z", "transmission",
                         "Exact circuit executed for an un-intercepted position."))
    return out


# --------------------------------------------------------------------------
# Exports
# --------------------------------------------------------------------------
ROLE = {0: "discarded", 1: "test", 2: "key"}


def export_csv(r: ExperimentResult) -> str:
    p = r.positions
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["position", "alice_bit", "alice_basis", "eve_intercepted", "eve_basis", "eve_result",
                "bob_basis", "bob_result", "bases_match", "role", "error"])
    for i in range(r.metrics.transmitted):
        w.writerow([
            i,
            p.alice_bits[i] if p.alice_bits else "hidden",
            BASIS_NAMES[p.alice_bases[i]],
            p.eve_intercepted[i],
            BASIS_NAMES[p.eve_bases[i]] if p.eve_bases[i] >= 0 else "",
            (p.eve_results[i] if p.eve_results[i] >= 0 else "") if p.eve_results else "hidden",
            BASIS_NAMES[p.bob_bases[i]],
            p.bob_results[i] if p.bob_results else "hidden",
            int(p.alice_bases[i] == p.bob_bases[i]),
            ROLE[p.role[i]],
            p.error[i] if p.error[i] >= 0 else "",
        ])
    return buf.getvalue()


def _pct(x):
    return "n/a" if x is None else f"{x:.4%}"


def export_markdown(r: ExperimentResult) -> str:
    c, m, t = r.config, r.metrics, r.theory
    pp = r.postprocessing or {}
    lines = [
        f"# Q-Secure BB84 Experiment Report — {r.experiment_id}",
        "",
        f"Generated: {r.created_at}  ",
        f"Simulator: {r.simulator['backend']} (Qiskit {r.simulator['qiskit']}, Aer {r.simulator['qiskit_aer']})  ",
        f"Randomness: {'cryptographically secure (secrets)' if r.secure_randomness else f'seeded PRNG, seed={c.seed}'}",
        "",
        "> Educational simulation. The output is not a composably secure cryptographic key.",
        "",
        "## Configuration",
        "| Parameter | Value |", "|---|---|",
        f"| Transmitted qubits | {c.n_qubits} |",
        f"| Eve enabled | {c.eve_enabled} |",
        f"| Eve interception probability | {c.eve_probability:.2%} |",
        f"| Noise model | {c.noise_model.value} |",
        f"| Noise probability | {c.noise_probability:.2%} |",
        f"| QBER abort threshold | {c.qber_threshold:.2%} |",
        f"| Test-sample fraction | {c.test_fraction:.2%} |",
        f"| Minimum test sample | {c.min_test_sample} |",
        f"| Seed | {c.seed if c.seed is not None else 'none'} |",
        "",
        "## Results",
        "| Metric | Observed | Theoretical expectation |", "|---|---|---|",
        f"| Sifted bits | {m.sifted} ({m.sift_ratio:.2%}) | {t.expected_sifted:.1f} (50%) |",
        f"| Discarded (basis mismatch) | {m.discarded} | {m.transmitted - t.expected_sifted:.1f} |",
        f"| Test sample | {m.test_sample_size} | {t.expected_test_sample:.1f} |",
        f"| Test errors | {m.test_errors} | {t.expected_qber * m.test_sample_size:.1f} |",
        f"| QBER | {_pct(m.qber)} (95% Wilson CI {_pct(m.qber_ci_low)}–{_pct(m.qber_ci_high)}) | {_pct(t.expected_qber)} |",
        f"| Candidate key | {m.candidate_key_length} | {t.expected_candidate:.1f} |",
        f"| Eve interceptions | {m.eve_interceptions} | {c.n_qubits * (c.eve_probability if c.eve_enabled else 0):.1f} |",
        "",
        "Key-length calculation: candidate = sifted − test sample = "
        f"{m.sifted} − {m.test_sample_size} = {m.candidate_key_length}.",
        "",
        "## Security decision",
        f"**{r.decision.label}**",
        "",
        r.decision.rationale,
        "",
        "## Post-processing",
    ]
    if pp.get("performed"):
        lines += [
            f"- Reconciliation: Cascade (with backtracking), {pp['passes']} passes, block sizes {pp['block_sizes']}",
            f"- Errors corrected: {pp['errors_corrected']}; residual errors (ground truth): {pp['residual_errors']}",
            f"- Leaked bits: EC {pp['leaked_bits_ec']}, verification {pp['leaked_bits_verify']}",
            f"- Eve information bound n·h(Q_upper): {pp['eve_info_bound_bits']:.1f} bits (Q_upper={pp['qber_upper_used']:.4f})",
            f"- PA security margin 2·log2(1/ε): {pp['pa_security_bits']:.1f} bits",
            f"- Final key length (Toeplitz hashing): {pp['final_length']}; keys match: {pp['keys_match']}",
            f"- Final key fingerprint (SHA-256 prefix): {pp['final_key_fingerprint']}",
        ]
    else:
        lines.append(f"- Not performed. {pp.get('reason', 'Disabled in configuration.')}")
    lines += [
        "",
        "## Measurement counts by circuit class",
        "| Alice bit | Alice basis | Eve | Eve basis | Bob basis | Shots | Counts ('bob eve') |",
        "|---|---|---|---|---|---|---|",
    ]
    for cc in r.counts_by_class:
        lines.append(
            f"| {cc['alice_bit']} | {cc['alice_basis']} | {cc['eve_intercepts']} | {cc['eve_basis'] or '-'} | "
            f"{cc['bob_basis']} | {cc['shots']} | {json.dumps(cc['counts'])} |"
        )
    lines += ["", f"Runtime: {r.runtime_ms:.1f} ms", ""]
    return "\n".join(lines)
