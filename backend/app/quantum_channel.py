"""Quantum channel noise models for the BB84 simulator.

Channel noise is modelled as a single-qubit quantum error (a CPTP map) that is
appended *inside* each transmission circuit, immediately before Bob's
measurement. It is executed by Qiskit Aer as part of the actual circuit, so
it is never a post-hoc modification of measured bits.

Channel noise is conceptually distinct from Eve: Eve is an explicit
measure/re-prepare sub-circuit (see ``bb84.py``); noise is an environmental
Pauli/depolarizing channel.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from qiskit_aer.noise import QuantumError, depolarizing_error, pauli_error


class NoiseModel(str, Enum):
    NONE = "none"
    BIT_FLIP = "bit_flip"
    PHASE_FLIP = "phase_flip"
    DEPOLARIZING = "depolarizing"


def build_channel_error(model: NoiseModel, p: float) -> Optional[QuantumError]:
    """Return the Aer QuantumError representing the channel, or None if ideal.

    * bit_flip:      rho -> (1-p) rho + p X rho X
    * phase_flip:    rho -> (1-p) rho + p Z rho Z
    * depolarizing:  rho -> (1-p) rho + p I/2   (Aer convention; equivalent to
                     X, Y, Z each applied with probability p/4)
    """
    if model == NoiseModel.NONE or p <= 0:
        return None
    if model == NoiseModel.BIT_FLIP:
        return pauli_error([("X", p), ("I", 1 - p)])
    if model == NoiseModel.PHASE_FLIP:
        return pauli_error([("Z", p), ("I", 1 - p)])
    if model == NoiseModel.DEPOLARIZING:
        return depolarizing_error(p, 1)
    raise ValueError(f"Unknown noise model: {model}")


def channel_flip_probability(model: NoiseModel, p: float, basis: str) -> float:
    """Ideal probability that the channel flips the bit observed in `basis`.

    Used only for the *theoretical* comparison curves, never for simulation.
    """
    if model == NoiseModel.NONE or p <= 0:
        return 0.0
    if model == NoiseModel.BIT_FLIP:
        return p if basis == "Z" else 0.0  # X leaves |+>,|-> invariant
    if model == NoiseModel.PHASE_FLIP:
        return p if basis == "X" else 0.0  # Z leaves |0>,|1> invariant
    if model == NoiseModel.DEPOLARIZING:
        return p / 2  # two of the three non-identity Paulis flip either basis
    raise ValueError(model)
