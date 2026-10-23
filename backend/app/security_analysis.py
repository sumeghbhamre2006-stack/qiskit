"""Sifting, QBER estimation, statistical uncertainty and security decisions."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple

import numpy as np

from .quantum_channel import NoiseModel, channel_flip_probability

Z_95 = 1.959963984540054


def binary_entropy(p: float) -> float:
    if p <= 0 or p >= 1:
        return 0.0
    return -p * math.log2(p) - (1 - p) * math.log2(1 - p)


def wilson_interval(errors: int, n: int, z: float = Z_95) -> Tuple[float, float]:
    """95% Wilson score interval for a binomial proportion. (0,1) if n == 0."""
    if n <= 0:
        return 0.0, 1.0
    phat = errors / n
    denom = 1 + z * z / n
    centre = (phat + z * z / (2 * n)) / denom
    half = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


@dataclass
class SiftingResult:
    matched_idx: np.ndarray
    discarded_idx: np.ndarray


def sift(alice_bases: np.ndarray, bob_bases: np.ndarray) -> SiftingResult:
    """Public basis reconciliation: only basis labels are compared."""
    match = alice_bases == bob_bases
    return SiftingResult(np.flatnonzero(match), np.flatnonzero(~match))


@dataclass
class QBEREstimate:
    test_idx: np.ndarray  # absolute positions disclosed for testing
    key_idx: np.ndarray  # absolute positions kept as candidate key
    sample_size: int
    errors: int
    qber: float | None
    ci_low: float
    ci_high: float
    std_error: float | None


def estimate_qber(
    matched_idx: np.ndarray,
    alice_bits: np.ndarray,
    bob_bits: np.ndarray,
    test_fraction: float,
    chooser,
) -> QBEREstimate:
    """Disclose a random subset of *matched-basis* positions and compare bits.

    `chooser(n, k)` returns k distinct sorted indices into range(n).
    Test positions are removed from the candidate key.
    """
    m = len(matched_idx)
    k = int(round(m * test_fraction))
    k = min(max(k, 0), m)
    sel = chooser(m, k) if k > 0 else np.array([], dtype=np.int64)
    mask = np.zeros(m, dtype=bool)
    mask[sel] = True
    test_idx = matched_idx[mask]
    key_idx = matched_idx[~mask]
    errors = int(np.sum(alice_bits[test_idx] != bob_bits[test_idx])) if k else 0
    if k == 0:
        return QBEREstimate(test_idx, key_idx, 0, 0, None, 0.0, 1.0, None)
    q = errors / k
    lo, hi = wilson_interval(errors, k)
    return QBEREstimate(test_idx, key_idx, k, errors, q, lo, hi, math.sqrt(q * (1 - q) / k))


def security_decision(est: QBEREstimate, threshold: float, min_sample: int) -> Tuple[str, str]:
    if est.sample_size < min_sample or est.qber is None:
        return (
            "INSUFFICIENT_DATA",
            f"Only {est.sample_size} test bits were disclosed (minimum {min_sample}). "
            "The QBER estimate is too uncertain to make any decision.",
        )
    if est.qber > threshold:
        return (
            "ABORT",
            f"Estimated QBER {est.qber:.2%} exceeds the abort threshold {threshold:.2%}. "
            "The disturbance is too large to distil a key; the protocol is aborted. "
            "The disturbance may be caused by eavesdropping, channel noise, or both — "
            "QBER alone cannot tell them apart.",
        )
    return (
        "LOW_DISTURBANCE",
        f"Estimated QBER {est.qber:.2%} (95% CI {est.ci_low:.2%}–{est.ci_high:.2%}) is at or below "
        f"the threshold {threshold:.2%}. This is NOT proof that no eavesdropper is present: "
        "partial attacks can hide inside statistical fluctuations of a finite sample. "
        "Error correction and privacy amplification are still required.",
    )


STATUS_LABELS = {
    "INSUFFICIENT_DATA": "INSUFFICIENT DATA",
    "ABORT": "ABORT: EXCESSIVE DISTURBANCE",
    "LOW_DISTURBANCE": "LOW OBSERVED DISTURBANCE — FURTHER SECURITY PROCESSING REQUIRED",
}


def theoretical_qber(eve_probability: float, noise_model: NoiseModel, noise_p: float) -> float:
    """Idealised expected sifted-key QBER (infinite-sample limit).

    Eve (random-basis intercept-resend with probability q) causes an error with
    probability q/4 on matched-basis positions. The channel then flips the bit
    observed in basis b with probability e_b. Errors compose as XOR:
        E_b = a(1-e_b) + e_b(1-a),  a = q/4
    and the sifted key contains Z and X positions in equal proportion.
    """
    a = eve_probability / 4
    total = 0.0
    for b in ("Z", "X"):
        e = channel_flip_probability(noise_model, noise_p, b)
        total += a * (1 - e) + e * (1 - a)
    return total / 2
