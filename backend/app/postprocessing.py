"""Educational classical post-processing: error correction + privacy amplification.

!!! EDUCATIONAL SIMULATION — NOT A COMPOSABLY SECURE KEY !!!

1. Error correction: the Cascade protocol (multi-pass BINARY with
   backtracking). In each pass the candidate key is shuffled by
   a public random permutation, split into blocks, block parities are compared
   publicly and every mismatched block is corrected by a binary search
   (one parity bit disclosed per bisection step); each correction re-opens the
   affected blocks of earlier passes. Every disclosed parity bit (counted
   conservatively, including re-checks) is counted in `leaked_bits`.
2. Verification: Alice and Bob compare a 32-bit universal hash (random binary
   matrix) of their corrected keys; 32 bits are counted as leaked.
3. Privacy amplification: Toeplitz-matrix universal hashing (a 2-universal
   family) compresses the corrected key to

     l = floor( n * (1 - h(Q_upper)) - leak_EC - leak_verify - 2*log2(1/eps_PA) )

   where Q_upper is the upper 95% Wilson bound on the observed QBER and
   h is binary entropy. This mirrors the *shape* of asymptotic BB84 key-rate
   formulas (Shor–Preskill style) but omits rigorous finite-key corrections
   (e.g. phase-error estimation, smooth min-entropy bounds), so the result is
   illustrative only.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from typing import List

import numpy as np

from .security_analysis import binary_entropy

VERIFY_BITS = 32
EPS_PA = 1e-6


@dataclass
class PostProcessingResult:
    performed: bool
    reason: str = ""
    input_length: int = 0
    passes: int = 0
    block_sizes: List[int] = field(default_factory=list)
    errors_corrected: int = 0
    leaked_bits_ec: int = 0
    leaked_bits_verify: int = 0
    verification_passed: bool = False
    residual_errors: int = 0  # known only to the simulator (ground truth)
    qber_upper_used: float = 0.0
    eve_info_bound_bits: float = 0.0
    pa_security_bits: float = 0.0
    final_length: int = 0
    keys_match: bool = False
    final_key_fingerprint: str | None = None
    alice_final_key_hex: str | None = None
    bob_final_key_hex: str | None = None


def _parity(a: np.ndarray) -> int:
    return int(np.sum(a) & 1)


def _binary_search(alice: np.ndarray, bob: np.ndarray, idx: np.ndarray) -> tuple[int, int]:
    """Locate one error in block `idx` (odd parity mismatch). Returns (pos, leaked)."""
    leaked = 0
    lo, hi = 0, len(idx)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        leaked += 1
        if _parity(alice[idx[lo:mid]]) != _parity(bob[idx[lo:mid]]):
            hi = mid
        else:
            lo = mid
    return int(idx[lo]), leaked


def cascade_like_reconcile(alice: np.ndarray, bob: np.ndarray, qber_est: float, rand,
                           min_passes: int = 4, max_passes: int = 16, quiet_passes: int = 2):
    """Cascade reconciliation (Brassard–Salvail 1993) with adaptive pass count.

    Each pass shuffles with a public permutation, splits into blocks and
    corrects odd-parity blocks by BINARY search. Whenever a bit is flipped,
    the blocks containing it in all *earlier* passes change parity and are
    re-examined (the Cascade backtracking step). Runs >= `min_passes` and stops
    after `quiet_passes` consecutive passes with no mismatch. Block size starts
    at ceil(0.73/Q) and doubles, capped at n/4. All disclosed parities count
    toward `leaked`.
    """
    bob = bob.copy()
    n = len(alice)
    q = max(qber_est, 0.01)
    k = max(4, int(math.ceil(0.73 / q)))
    cap = max(4, n // 4)
    leaked, corrected, sizes, quiet = 0, 0, [], 0
    pass_blocks: List[List[np.ndarray]] = []  # blocks of each pass
    pass_block_of: List[np.ndarray] = []  # position -> block index per pass

    def fix_block(pi: int, bi: int) -> int:
        """Correct one error in block bi of pass pi, then cascade. Returns flips."""
        nonlocal leaked
        flips = 0
        stack = [(pi, bi)]
        while stack:
            p_, b_ = stack.pop()
            blk = pass_blocks[p_][b_]
            leaked += 1
            if _parity(alice[blk]) == _parity(bob[blk]):
                continue
            pos, l = _binary_search(alice, bob, blk)
            leaked += l
            bob[pos] ^= 1
            flips += 1
            for other in range(len(pass_blocks)):
                if other != p_:
                    stack.append((other, int(pass_block_of[other][pos])))
        return flips

    for p in range(max_passes):
        k_eff = max(1, min(k, cap, n))
        sizes.append(k_eff)
        perm = rand.permutation(n)
        blocks = [perm[s : s + k_eff] for s in range(0, n, k_eff)]
        block_of = np.empty(n, dtype=np.int64)
        for bi, blk in enumerate(blocks):
            block_of[blk] = bi
        pass_blocks.append(blocks)
        pass_block_of.append(block_of)
        found = 0
        for bi in range(len(blocks)):
            found += fix_block(p, bi)
        corrected += found
        quiet = quiet + 1 if found == 0 else 0
        if p + 1 >= min_passes and quiet >= quiet_passes:
            break
        k *= 2
    return bob, leaked, corrected, sizes


def toeplitz_hash(key: np.ndarray, out_len: int, seed_bits: np.ndarray) -> np.ndarray:
    """y = T x mod 2 with T[i,j] = s[i - j + n - 1], computed as a convolution."""
    n = len(key)
    conv = np.convolve(seed_bits.astype(np.int64), key.astype(np.int64))
    return (conv[n - 1 : n - 1 + out_len] & 1).astype(np.int8)


def _bits_hex(bits: np.ndarray) -> str:
    return np.packbits(bits.astype(np.uint8)).tobytes().hex() if len(bits) else ""


def run_postprocessing(
    alice_key: np.ndarray,
    bob_key: np.ndarray,
    qber: float | None,
    qber_upper: float,
    rand,
    reveal_keys: bool,
) -> PostProcessingResult:
    n = len(alice_key)
    res = PostProcessingResult(performed=False, input_length=n)
    if qber is None or n == 0:
        res.reason = "No candidate key or no QBER estimate."
        return res

    bob_corr, leak_ec, corrected, sizes = cascade_like_reconcile(alice_key, bob_key, qber, rand)
    res.performed = True
    res.passes = len(sizes)
    res.block_sizes = sizes
    res.errors_corrected = corrected
    res.leaked_bits_ec = leak_ec
    res.residual_errors = int(np.sum(alice_key != bob_corr))

    # Verification via random binary-matrix hash (public matrix)
    M = np.stack([rand.bits(n) for _ in range(VERIFY_BITS)]) if n else np.zeros((VERIFY_BITS, 0))
    tag_a = (M.astype(np.int64) @ alice_key.astype(np.int64)) & 1
    tag_b = (M.astype(np.int64) @ bob_corr.astype(np.int64)) & 1
    res.leaked_bits_verify = VERIFY_BITS
    res.verification_passed = bool(np.array_equal(tag_a, tag_b))

    res.qber_upper_used = qber_upper
    res.eve_info_bound_bits = n * binary_entropy(min(qber_upper, 0.5))
    res.pa_security_bits = 2 * math.log2(1 / EPS_PA)
    raw_len = n - res.eve_info_bound_bits - leak_ec - VERIFY_BITS - res.pa_security_bits
    final_len = max(0, int(math.floor(raw_len)))

    if not res.verification_passed:
        res.reason = "Verification hash mismatch — keys discarded."
        res.final_length = 0
        return res
    if final_len == 0:
        res.reason = "Leakage and estimated Eve information exceed key length — no key extractable."
        return res

    seed_bits = rand.bits(n + final_len - 1)
    ka = toeplitz_hash(alice_key, final_len, seed_bits)
    kb = toeplitz_hash(bob_corr, final_len, seed_bits)
    res.final_length = final_len
    res.keys_match = bool(np.array_equal(ka, kb))
    res.final_key_fingerprint = hashlib.sha256(np.packbits(ka.astype(np.uint8)).tobytes()).hexdigest()[:16]
    res.reason = "Educational final key derived (not composably secure)."
    if reveal_keys:
        res.alice_final_key_hex = _bits_hex(ka)
        res.bob_final_key_hex = _bits_hex(kb)
    return res
