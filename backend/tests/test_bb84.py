"""Scientific validation tests for Q-Secure.

Statistical assertions use tolerances of >= 4 standard deviations so they are
not brittle against finite-sample fluctuations.
"""
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.bb84 import ProtocolRandom, build_transmission_circuit, get_simulator, run_quantum_transmission
from app.experiment_runner import export_csv, export_markdown, run_experiment, start_sweep
from app.main import app
from app.postprocessing import toeplitz_hash
from app.quantum_channel import NoiseModel
from app.schemas import ExperimentConfig, SweepRequest
from app.security_analysis import estimate_qber, security_decision, sift, theoretical_qber, wilson_interval

client = TestClient(app)


def cfg(**kw):
    base = dict(n_qubits=2000, postprocessing=False, demo_mode=True)
    base.update(kw)
    return ExperimentConfig(**base)


def sifted_qber(r):
    p = r.positions
    a, b = np.array(p.alice_bits), np.array(p.bob_results)
    m = np.array(p.alice_bases) == np.array(p.bob_bases)
    return float(np.mean(a[m] != b[m])), int(m.sum())


# 1 & 2 ------------------------------------------------------------------
def test_ideal_no_eve_zero_errors_and_recovers_bits():
    r = run_experiment(cfg(n_qubits=5000, seed=1))
    assert r.metrics.test_errors == 0
    assert r.metrics.qber == 0
    q, _ = sifted_qber(r)
    assert q == 0.0  # Bob recovers every matched-basis bit
    assert r.decision.status == "LOW_DISTURBANCE"


def test_secure_randomness_ideal_also_zero_errors():
    r = run_experiment(cfg(n_qubits=1000))
    assert r.secure_randomness and r.metrics.test_errors == 0


# 3 -----------------------------------------------------------------------
def test_about_half_bases_match():
    r = run_experiment(cfg(n_qubits=10000, seed=3))
    sd = math.sqrt(0.25 / 10000)
    assert abs(r.metrics.sift_ratio - 0.5) < 5 * sd


# 4 -----------------------------------------------------------------------
def test_full_intercept_resend_gives_about_25pct():
    r = run_experiment(cfg(n_qubits=10000, seed=4, eve_enabled=True, eve_probability=1.0))
    q, m = sifted_qber(r)
    sd = math.sqrt(0.25 * 0.75 / m)
    assert abs(q - 0.25) < 5 * sd
    assert r.decision.status == "ABORT"


# 5 -----------------------------------------------------------------------
@pytest.mark.parametrize("model", [NoiseModel.BIT_FLIP, NoiseModel.PHASE_FLIP, NoiseModel.DEPOLARIZING])
def test_noise_increases_errors(model):
    means = []
    for p in (0.0, 0.05, 0.10):
        qs = [sifted_qber(run_experiment(cfg(n_qubits=4000, seed=10 + t, noise_model=model, noise_probability=p)))[0]
              for t in range(3)]
        means.append(np.mean(qs))
    assert means[0] == 0.0
    assert means[0] < means[1] < means[2]
    # agrees with ideal theory within generous tolerance
    assert abs(means[2] - theoretical_qber(0, model, 0.10)) < 0.02


# 6 -----------------------------------------------------------------------
def test_eve_probability_trend():
    qs = []
    for p in (0.0, 0.25, 0.5, 1.0):
        qs.append(sifted_qber(run_experiment(cfg(n_qubits=8000, seed=20, eve_enabled=True, eve_probability=p)))[0])
    assert qs[0] == 0.0
    assert qs == sorted(qs)
    for p, q in zip((0.0, 0.25, 0.5, 1.0), qs):
        assert abs(q - p / 4) < 0.03


# 7 -----------------------------------------------------------------------
def test_test_bits_excluded_from_candidate_key():
    r = run_experiment(cfg(seed=7, test_fraction=0.3))
    role = np.array(r.positions.role)
    match = np.array(r.positions.alice_bases) == np.array(r.positions.bob_bases)
    assert set(np.flatnonzero(role == 1)).isdisjoint(np.flatnonzero(role == 2))
    assert (role[~match] == 0).all() and (role[match] > 0).all()
    assert r.metrics.candidate_key_length == r.metrics.sifted - r.metrics.test_sample_size
    assert r.metrics.test_sample_size == round(r.metrics.sifted * 0.3)


# 8 -----------------------------------------------------------------------
def test_mismatched_positions_excluded_from_qber():
    # Construct data where every mismatched position is an "error" and every
    # matched position agrees: QBER must be exactly 0.
    n = 1000
    rng = np.random.default_rng(0)
    ab, bb = rng.integers(0, 2, n), rng.integers(0, 2, n)
    abits = rng.integers(0, 2, n)
    bbits = np.where(ab == bb, abits, 1 - abits)
    s = sift(ab, bb)
    est = estimate_qber(s.matched_idx, abits, bbits, 0.5, ProtocolRandom(1).choice)
    assert est.qber == 0.0 and est.sample_size > 0
    assert np.all(ab[est.test_idx] == bb[est.test_idx])


# 9 -----------------------------------------------------------------------
def test_empty_sample_handled():
    est = estimate_qber(np.array([], dtype=int), np.array([]), np.array([]), 0.5, ProtocolRandom(0).choice)
    assert est.sample_size == 0 and est.qber is None
    status, _ = security_decision(est, 0.11, 20)
    assert status == "INSUFFICIENT_DATA"
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_insufficient_data_decision():
    r = run_experiment(cfg(n_qubits=100, seed=1, test_fraction=0.05, min_test_sample=50))
    assert r.decision.status == "INSUFFICIENT_DATA"


@pytest.mark.parametrize(
    "body",
    [
        {"n_qubits": 50},
        {"n_qubits": 20000},
        {"eve_probability": 1.5},
        {"noise_probability": 0.2, "noise_model": "bit_flip"},
        {"noise_probability": 0.05, "noise_model": "none"},
        {"test_fraction": 0.0},
        {"noise_model": "bogus"},
        {"seed": -1},
    ],
)
def test_invalid_inputs_rejected(body):
    assert client.post("/api/experiment/run", json=body).status_code == 422


def test_unknown_experiment_404():
    assert client.get("/api/experiment/nope").status_code == 404
    assert client.get("/api/sweep/nope").status_code == 404


# 10 ----------------------------------------------------------------------
def test_seed_reproducibility():
    c = cfg(seed=12345, eve_enabled=True, eve_probability=0.1, noise_model="depolarizing", noise_probability=0.02,
            postprocessing=True)
    a, b = run_experiment(c), run_experiment(c)
    assert a.positions == b.positions
    assert a.metrics == b.metrics
    assert a.postprocessing["final_key_fingerprint"] == b.postprocessing["final_key_fingerprint"]
    c2 = run_experiment(cfg(seed=54321))
    assert c2.positions.alice_bits != a.positions.alice_bits


# 11 ----------------------------------------------------------------------
def test_noise_is_applied_inside_circuit_execution():
    qc = build_transmission_circuit(0, 0, False, 0, 0, NoiseModel.BIT_FLIP, 0.1)
    names = [ci.operation.name for ci in qc.data]
    assert "quantum_channel" in names
    counts = get_simulator().run(qc, shots=20000, seed_simulator=1).result().get_counts()
    ones = sum(v for k, v in counts.items() if k.split(" ")[0] == "1")
    assert abs(ones / 20000 - 0.1) < 0.01
    # bit-flip leaves X-basis states invariant
    qcx = build_transmission_circuit(0, 1, False, 0, 1, NoiseModel.BIT_FLIP, 0.1)
    cx = get_simulator().run(qcx, shots=5000, seed_simulator=1).result().get_counts()
    assert all(k.split(" ")[0] == "0" for k in cx)
    # noiseless circuit has no channel instruction
    assert "quantum_channel" not in [ci.operation.name for ci in build_transmission_circuit(0, 0, False, 0, 0).data]


def test_eve_circuit_is_genuine_measure_resend():
    qc = build_transmission_circuit(0, 1, True, 0, 1)  # |+>, Eve in Z, Bob in X
    names = [ci.operation.name for ci in qc.data]
    assert names.count("measure") == 2 and "reset" in names and "if_else" in names
    counts = get_simulator().run(qc, shots=20000, seed_simulator=2).result().get_counts()
    bob1 = sum(v for k, v in counts.items() if k.split(" ")[0] == "1") / 20000
    assert abs(bob1 - 0.5) < 0.02  # wrong-basis Eve randomises Bob's X outcome


# 12 ----------------------------------------------------------------------
def test_metrics_consistent_with_positions_and_api():
    resp = client.post("/api/experiment/run", json={"n_qubits": 1500, "seed": 9, "eve_enabled": True,
                                                     "eve_probability": 0.3, "postprocessing": True})
    assert resp.status_code == 200
    r = resp.json()
    p, m = r["positions"], r["metrics"]
    role = np.array(p["role"])
    err = np.array(p["error"])
    assert m["sifted"] == int((role > 0).sum())
    assert m["test_sample_size"] == int((role == 1).sum())
    assert m["candidate_key_length"] == int((role == 2).sum())
    assert m["test_errors"] == int(err[role == 1].sum())
    assert m["qber"] == pytest.approx(m["test_errors"] / m["test_sample_size"])
    assert m["eve_interceptions"] == sum(p["eve_intercepted"])
    # stored copy identical; exports correspond to it
    g = client.get(f"/api/experiment/{r['experiment_id']}").json()
    assert g["metrics"] == m
    csv_text = client.get(f"/api/experiment/{r['experiment_id']}/export?format=csv").text
    assert len(csv_text.strip().splitlines()) == 1501
    md = client.get(f"/api/experiment/{r['experiment_id']}/export?format=md").text
    assert r["experiment_id"] in md and str(m["sifted"]) in md


def test_hidden_mode_does_not_expose_bits():
    r = run_experiment(cfg(seed=1, demo_mode=False, postprocessing=True))
    assert r.positions.alice_bits is None and r.positions.bob_results is None
    assert r.postprocessing.get("alice_final_key_hex") is None
    assert "hidden" in export_csv(r)


def test_postprocessing_yields_matching_shorter_key():
    r = run_experiment(cfg(n_qubits=4000, seed=5, noise_model="depolarizing", noise_probability=0.04,
                           postprocessing=True))
    pp = r.postprocessing
    assert pp["performed"] and pp["verification_passed"] and pp["keys_match"]
    assert 0 < pp["final_length"] < r.metrics.candidate_key_length
    assert pp["residual_errors"] == 0
    assert pp["alice_final_key_hex"] == pp["bob_final_key_hex"]


def test_postprocessing_skipped_on_abort():
    r = run_experiment(cfg(seed=4, eve_enabled=True, eve_probability=1.0, postprocessing=True))
    assert r.decision.status == "ABORT" and r.metrics.final_key_length == 0
    assert not r.postprocessing["performed"]


def test_toeplitz_matches_explicit_matrix():
    rng = np.random.default_rng(0)
    n, l = 37, 11
    x, s = rng.integers(0, 2, n), rng.integers(0, 2, n + l - 1)
    T = np.array([[s[i - j + n - 1] for j in range(n)] for i in range(l)])
    assert np.array_equal(toeplitz_hash(x, l, s), (T @ x) % 2)


def test_sweep_job_runs():
    req = SweepRequest(base=ExperimentConfig(n_qubits=500, seed=1), variable="eve_probability",
                       values=[0.0, 1.0], trials=3)
    job = start_sweep(req, background=False)
    assert job.status == "done" and len(job.points) == 2
    assert job.points[0]["mean_qber"] == 0.0
    assert job.points[1]["mean_qber"] > 0.15


def test_health_and_circuits():
    h = client.get("/api/health").json()
    assert h["quantum_simulator"] == "ok"
    cs = client.get("/api/circuits").json()
    kinds = {c["kind"] for c in cs}
    assert {"preparation", "measurement", "eve"} <= kinds
    assert all(c["depth"] >= 0 and c["diagram"] for c in cs)
