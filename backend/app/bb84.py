"""Core BB84 quantum layer: randomness, Qiskit circuits and Aer execution.

Execution strategy (batched by circuit equivalence class)
--------------------------------------------------------
Every transmitted qubit is an independent single-qubit experiment whose
circuit is fully determined by the tuple

    (alice_bit, alice_basis, eve_intercepts, eve_basis, bob_basis)

There are at most 2*2*2*2*2 = 32 (in practice 24) distinct circuits. Rather
than building and executing 10,000 separate circuits (slow: per-circuit
transpile/dispatch overhead dominates), we group positions by their circuit
class, run each class ONCE on Aer with ``shots = group size`` and
``memory=True``, and assign the i-th shot's outcome to the i-th position in
the group. Each shot is a statistically independent execution of the exact
same circuit, so this is physically equivalent to per-qubit execution while
being ~100-1000x faster. Trade-off: we lose the ability to give each qubit a
*different* noise realisation of the circuit structure itself (not needed
here, since the channel is identical for every qubit).

Eve's intercept-resend is a genuine mid-circuit sub-circuit: she measures in
her basis into a classical bit, the qubit is reset, and a fresh qubit is
re-prepared conditioned (``if_test``) on her measured outcome.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister
from qiskit_aer import AerSimulator

from .quantum_channel import NoiseModel, build_channel_error

Z, X = 0, 1  # basis encoding: 0 -> Z (computational), 1 -> X (Hadamard)
BASIS_NAMES = ("Z", "X")


# --------------------------------------------------------------------------
# Randomness
# --------------------------------------------------------------------------
class ProtocolRandom:
    """Source of protocol randomness.

    Default: cryptographically secure (``secrets``). If a seed is supplied the
    experiment becomes reproducible using NumPy's PCG64 generator — this is
    explicitly NOT secure and is intended for demonstrations/tests only.
    """

    def __init__(self, seed: Optional[int] = None):
        self.seed = seed
        self._rng = np.random.default_rng(seed) if seed is not None else None

    @property
    def secure(self) -> bool:
        return self._rng is None

    def bits(self, n: int) -> np.ndarray:
        if self._rng is not None:
            return self._rng.integers(0, 2, size=n, dtype=np.int8)
        raw = np.frombuffer(secrets.token_bytes((n + 7) // 8), dtype=np.uint8)
        return np.unpackbits(raw)[:n].astype(np.int8)

    def bernoulli(self, n: int, p: float) -> np.ndarray:
        if p <= 0:
            return np.zeros(n, dtype=bool)
        if p >= 1:
            return np.ones(n, dtype=bool)
        if self._rng is not None:
            return self._rng.random(n) < p
        # 53-bit secure uniforms
        sr = secrets.SystemRandom()
        return np.fromiter((sr.random() < p for _ in range(n)), dtype=bool, count=n)

    def permutation(self, n: int) -> np.ndarray:
        if self._rng is not None:
            return self._rng.permutation(n)
        sr = secrets.SystemRandom()
        perm = list(range(n))
        sr.shuffle(perm)
        return np.array(perm, dtype=np.int64)

    def choice(self, n: int, k: int) -> np.ndarray:
        """k distinct indices from range(n), sorted."""
        return np.sort(self.permutation(n)[:k])

    def sim_seed(self) -> Optional[int]:
        if self._rng is None:
            return None
        return int(self._rng.integers(0, 2**31 - 1))


# --------------------------------------------------------------------------
# Circuit construction
# --------------------------------------------------------------------------
def prepare_state(qc: QuantumCircuit, q, bit: int, basis: int) -> None:
    """Alice's encoding: Z: 0->|0>, 1->|1>;  X: 0->|+>, 1->|->."""
    if bit:
        qc.x(q)
    if basis == X:
        qc.h(q)


def measure_in_basis(qc: QuantumCircuit, q, c, basis: int) -> None:
    """Z: measure directly.  X: H then computational-basis measurement."""
    if basis == X:
        qc.h(q)
    qc.measure(q, c)


def build_transmission_circuit(
    alice_bit: int,
    alice_basis: int,
    eve_intercepts: bool,
    eve_basis: int,
    bob_basis: int,
    noise_model: NoiseModel = NoiseModel.NONE,
    noise_p: float = 0.0,
) -> QuantumCircuit:
    q = QuantumRegister(1, "q")
    c_eve = ClassicalRegister(1, "eve")
    c_bob = ClassicalRegister(1, "bob")
    qc = QuantumCircuit(q, c_eve, c_bob, name="bb84_transmission")

    # Stage A - Alice prepares
    prepare_state(qc, q[0], alice_bit, alice_basis)
    qc.barrier(label="Alice→")

    # Stage C - Eve intercept-resend (genuine measure + re-prepare)
    if eve_intercepts:
        measure_in_basis(qc, q[0], c_eve[0], eve_basis)
        qc.reset(q[0])
        with qc.if_test((c_eve[0], 1)):
            qc.x(q[0])
        if eve_basis == X:
            qc.h(q[0])
        qc.barrier(label="Eve→")

    # Stage B - quantum channel noise (executed by Aer as a CPTP instruction)
    err = build_channel_error(noise_model, noise_p)
    if err is not None:
        qc.append(err.to_instruction(), [q[0]])
        qc.barrier(label="Channel→")

    # Stage D - Bob measures
    measure_in_basis(qc, q[0], c_bob[0], bob_basis)
    return qc


# --------------------------------------------------------------------------
# Batched execution
# --------------------------------------------------------------------------
@dataclass
class QuantumRunResult:
    alice_bits: np.ndarray
    alice_bases: np.ndarray
    eve_intercepted: np.ndarray  # bool
    eve_bases: np.ndarray  # -1 where not intercepted
    eve_results: np.ndarray  # -1 where not intercepted
    bob_bases: np.ndarray
    bob_results: np.ndarray
    circuit_classes: int
    counts_by_class: List[dict]
    sim_seeds: List[Optional[int]]


_SIMULATOR: Optional[AerSimulator] = None


def get_simulator() -> AerSimulator:
    global _SIMULATOR
    if _SIMULATOR is None:
        _SIMULATOR = AerSimulator()
    return _SIMULATOR


def run_quantum_transmission(
    n: int,
    rand: ProtocolRandom,
    eve_enabled: bool,
    eve_probability: float,
    noise_model: NoiseModel,
    noise_p: float,
) -> QuantumRunResult:
    alice_bits = rand.bits(n)
    alice_bases = rand.bits(n)
    bob_bases = rand.bits(n)
    if eve_enabled:
        eve_int = rand.bernoulli(n, eve_probability)
        eve_bases_raw = rand.bits(n)
    else:
        eve_int = np.zeros(n, dtype=bool)
        eve_bases_raw = np.zeros(n, dtype=np.int8)
    eve_bases = np.where(eve_int, eve_bases_raw, -1).astype(np.int8)

    # Group positions by circuit class
    groups: Dict[Tuple[int, int, bool, int, int], List[int]] = {}
    for i in range(n):
        key = (
            int(alice_bits[i]),
            int(alice_bases[i]),
            bool(eve_int[i]),
            int(eve_bases_raw[i]) if eve_int[i] else 0,
            int(bob_bases[i]),
        )
        groups.setdefault(key, []).append(i)

    keys = sorted(groups.keys())
    circuits = [build_transmission_circuit(*k, noise_model, noise_p) for k in keys]
    sim = get_simulator()

    eve_results = np.full(n, -1, dtype=np.int8)
    bob_results = np.full(n, -1, dtype=np.int8)
    counts_by_class: List[dict] = []
    seeds: List[Optional[int]] = []

    for key, qc in zip(keys, circuits):
        idx = groups[key]
        seed = rand.sim_seed()
        seeds.append(seed)
        opts = {"shots": len(idx), "memory": True}
        if seed is not None:
            opts["seed_simulator"] = seed
        result = sim.run(qc, **opts).result()
        memory = result.get_memory(qc)  # e.g. "1 0" -> "bob eve"
        counts = result.get_counts(qc)
        for pos, m in zip(idx, memory):
            bob_bit, eve_bit = m.split(" ")
            bob_results[pos] = int(bob_bit)
            if key[2]:
                eve_results[pos] = int(eve_bit)
        counts_by_class.append(
            {
                "alice_bit": key[0],
                "alice_basis": BASIS_NAMES[key[1]],
                "eve_intercepts": key[2],
                "eve_basis": BASIS_NAMES[key[3]] if key[2] else None,
                "bob_basis": BASIS_NAMES[key[4]],
                "shots": len(idx),
                "counts": dict(counts),  # keys formatted "bob eve"
            }
        )

    return QuantumRunResult(
        alice_bits=alice_bits,
        alice_bases=alice_bases,
        eve_intercepted=eve_int,
        eve_bases=eve_bases,
        eve_results=eve_results,
        bob_bases=bob_bases,
        bob_results=bob_results,
        circuit_classes=len(keys),
        counts_by_class=counts_by_class,
        sim_seeds=seeds,
    )
