# Q-Secure — Interactive Quantum Key Distribution Lab

Q-Secure simulates the **BB84 quantum key distribution protocol** step by step. Every qubit is prepared, sent, optionally intercepted, and measured by **real Qiskit circuits executed on Qiskit Aer**. The dashboard shows how Alice and Bob build a shared key, how Eve's intercept-resend attack disturbs quantum states, and how channel noise affects the QBER, the key length, and the security decision.

> **Educational simulation.** No key produced by this tool is cryptographically or composably secure. Read the [Security limitations](#security-limitations) section.

---

## BB84 theory

| Stage | What happens | Where it lives |
|---|---|---|
| A. Preparation | Alice draws random bits and random bases with `secrets`. Z basis: 0→\|0⟩, 1→\|1⟩. X basis: 0→\|+⟩, 1→\|−⟩ (gates: `X` if bit=1, then `H` if X basis) | `bb84.py` |
| B. Channel | An optional bit-flip, phase-flip or depolarizing channel is appended **inside the circuit** as an Aer `QuantumError` instruction | `quantum_channel.py` |
| C. Eve | With probability *p*, Eve picks a random basis, **measures** the qubit mid-circuit, **resets** it, then **re-prepares** a new qubit with `if_test` based on her result, and sends it on | `bb84.py` |
| D. Bob | Bob picks a random basis. Z: measures directly. X: applies `H`, then measures | `bb84.py` |
| E. Sifting | Alice and Bob publicly compare bases only (no bit values). Positions where the bases differ are thrown away | `security_analysis.py` |
| F. QBER | A random subset of the matched-basis positions is disclosed. QBER = errors / sample size, reported with a 95 % Wilson interval. The disclosed bits are removed from the key | `security_analysis.py` |
| G. Decision | `INSUFFICIENT DATA` / `ABORT: EXCESSIVE DISTURBANCE` / `LOW OBSERVED DISTURBANCE — FURTHER SECURITY PROCESSING REQUIRED` | `security_analysis.py` |
| H. Post-processing | Cascade error correction (with backtracking), a 32-bit verification hash, then Toeplitz privacy amplification | `postprocessing.py` |

### Measurement bases
Z-basis eigenstates are \|0⟩ and \|1⟩. X-basis eigenstates are \|±⟩ = (\|0⟩ ± \|1⟩)/√2. Measuring an X state in the Z basis (or the reverse) gives a uniformly random result. This is why Bob's mismatched-basis positions are discarded, and it is also why Eve gets caught.

### Channel noise (theoretical sifted-key QBER)
- **Bit flip** (X with probability *p*): flips Z-basis bits only, so QBER ≈ *p*/2
- **Phase flip** (Z with probability *p*): flips X-basis bits only, so QBER ≈ *p*/2
- **Depolarizing** (Aer convention, ρ → (1−p)ρ + p·I/2): QBER ≈ *p*/2

### Eve's intercept-resend attack
When Eve guesses the wrong basis (probability ½), her resent state gives Bob a random result (an error with probability ½). So every intercepted, sifted qubit has an error probability of ¼, and the ideal QBER is *p*/4. For a full attack (*p* = 1) that is **25 %**. This is an **idealised infinite-sample expectation**. A finite run will scatter around it, and noise moves it. When noise and Eve combine, the errors compose like XOR: E = a(1−e) + e(1−a) with a = p/4.

### Why QBER alone is not proof of security
A partial attack (for example *p* = 0.3, which gives 7.5 %) can stay under an 11 % threshold. A small test sample has wide confidence intervals. And noise and eavesdropping look the same in the QBER. The "Noise + eavesdropping" preset shows this: QBER ≈ 11.6 % sits right at the threshold, and some runs pass.

---

## Architecture

```
q-secure/
  backend/            FastAPI + Qiskit 1.4.2 + Aer 0.17.0
    app/
      bb84.py               randomness, circuit builders, batched Aer execution
      quantum_channel.py    noise channels + ideal flip probabilities
      security_analysis.py  sifting, QBER, Wilson CI, decisions, theory
      postprocessing.py     Cascade, verification hash, Toeplitz PA
      experiment_runner.py  orchestration, in-memory store, sweep jobs, exports, circuit catalog
      schemas.py            Pydantic request/response models + validation
      main.py               API routes, CORS
    tests/test_bb84.py      31 scientific/API tests
    scripts/e2e_presets.py  end-to-end check of all presets through the frontend proxy
  frontend/           React 18 + Vite + TypeScript + Tailwind + Recharts + lucide-react
    src/pages/              Overview, Explorer, Configuration, Analytics, CircuitInspector, Reports
    src/hooks/useApi.ts     experiment runner + sweep polling
    src/services/api.ts     typed API client with readable error messages
```

### Execution strategy: circuit per qubit vs. batched
The circuit for each qubit depends only on the tuple (Alice bit, Alice basis, Eve intercepts?, Eve basis, Bob basis). That gives **at most 24 distinct circuits**. Q-Secure groups positions by circuit class and runs each class **once** with `shots = group size` and `memory=True`. Shot *i* is then assigned to the *i*-th position in the group.

Each shot is an independent execution of the exact same circuit, so this is statistically identical to building one circuit per qubit. It is also roughly 100–1000× faster: 10,000 qubits take about 30–50 ms instead of tens of seconds of per-circuit overhead.

The trade-off is that every qubit in a class shares the same circuit structure. That is fine here, because the channel is identical for all qubits. Per-qubit circuits would only be needed for time-varying channels.

### Randomness and reproducibility
By default, all protocol randomness comes from `secrets` (a CSPRNG), and the Aer seeds are left random. If you supply a `seed`, a NumPy PCG64 generator drives the protocol choices **and** the per-class `seed_simulator` values. Identical seeds then give bit-identical experiments, but the run is explicitly marked as not secure.

### Persistence
Experiments live in a bounded **in-memory LRU store** (the last 50). `GET /api/experiment/{id}` and `/export` work for those 50 until the backend restarts. SQLite was not added because it is optional.

### Long-running work
Parameter sweeps run as **background jobs**. `POST /api/experiment/sweep` returns `202` with a `job_id`, and the UI polls `GET /api/sweep/{job_id}` and shows a progress bar. A single experiment finishes in under 100 ms even at 10,000 qubits, so it runs synchronously.

---

## Installation

Requirements: Python 3.11 or 3.12, and Node 18 or newer.

```bash
# Backend
cd q-secure/backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

## Running

```bash
# Terminal 1 — backend (http://127.0.0.1:8000, docs at /docs)
cd q-secure/backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — frontend (http://localhost:5173)
cd q-secure/frontend
npm run dev
```

In development, Vite proxies `/api` to `127.0.0.1:8000`. To point the frontend at a different backend, set `VITE_API_URL=http://host:port` and add that origin to the CORS list in `main.py`. Each half can run on its own: the backend works with curl or the Swagger UI, and the frontend shows an actionable "backend offline" error if it cannot reach the backend.

## Tests

```bash
cd q-secure/backend
.venv/bin/pytest -q                      # 31 tests
.venv/bin/python scripts/e2e_presets.py  # needs both servers running
```

The tests cover:
- ideal channel gives zero errors
- matched bases recover Alice's bits
- the basis match rate is about 50 %
- full intercept-resend gives about 25 % QBER
- the trend as noise increases (all 3 noise models)
- the trend as Eve's interception probability increases
- test bits are excluded from the key
- mismatched-basis positions are excluded from QBER
- empty samples and invalid inputs (422 errors)
- seed reproducibility
- noise is present in the executed circuit, and bit-flip leaves X-basis states unchanged
- Eve's circuit really contains measure, reset and `if_else`
- reported metrics match the per-position data, the stored copy and the exports
- hidden mode does not leak key material
- Cascade and privacy amplification produce identical keys
- the Toeplitz hash matches an explicit matrix product
- sweep jobs
- health and circuits endpoints

Statistical checks allow ≥ 4–5σ of slack, so normal random variation does not make them fail.

## API examples

```bash
curl localhost:8000/api/health

curl -X POST localhost:8000/api/experiment/run -H 'Content-Type: application/json' -d '{
  "n_qubits": 4000, "eve_enabled": true, "eve_probability": 1.0,
  "noise_model": "depolarizing", "noise_probability": 0.02,
  "qber_threshold": 0.11, "test_fraction": 0.25, "seed": 42,
  "postprocessing": true, "demo_mode": false }'

curl -X POST localhost:8000/api/experiment/sweep -H 'Content-Type: application/json' -d '{
  "base": {"n_qubits": 1000}, "variable": "eve_probability",
  "values": [0, 0.25, 0.5, 0.75, 1], "trials": 5 }'        # -> {"job_id": ...}
curl localhost:8000/api/sweep/<job_id>

curl localhost:8000/api/experiment/<id>
curl -OJ "localhost:8000/api/experiment/<id>/export?format=csv"   # also md, json
curl localhost:8000/api/circuits
```

Sweep `variable` can be `eve_probability`, `noise_probability`, `n_qubits`, `test_fraction`, or `repeat` (which repeats the same configuration). The limit is values × trials ≤ 1000.

## Example demo workflow
1. **Configuration** → preset *Ideal channel, no Eve* → *Load & run*. QBER is 0 %, and the status is LOW OBSERVED DISTURBANCE.
2. Preset *Full intercept-resend*. QBER is about 25 %, and the status is **ABORT**.
3. **Protocol Explorer** → filter `errors` → click a cell. The journey shows Eve picking the wrong basis.
4. Preset *Partial intercept-resend* with 100 qubits and a 5 % test sample. You get INSUFFICIENT DATA, or an attack that slips through. This shows why sample size matters.
5. **Analytics** → run sweeps 1 and 6. The observed QBER with its CI tracks the dashed theory line.
6. **Circuit Inspector**: the exact circuits the simulator executes.
7. **Reports**: download the CSV and the Markdown report.

## Security limitations
- The QBER is estimated from a finite sample. A Wilson interval is shown, but no rigorous finite-key bound is applied.
- The final key length ℓ = n − n·h(Q⁺) − leak_EC − leak_ver − 2·log₂(1/ε) follows the *shape* of asymptotic (Shor–Preskill-style) key-rate formulas. Q⁺ is the upper 95 % Wilson bound. It does **not** estimate phase errors separately, does not use smooth min-entropy, and does not use composable ε-accounting.
- The leakage count from Cascade is conservative (every re-checked parity is counted), but Cascade's parameters are not optimised.
- The basis choice is 50/50 (the original BB84). Only the intercept-resend attack is modelled, not collective or coherent attacks. Photon-number splitting, detector effects, and authentication of the classical channel are all out of scope.
- Seeded runs use a non-cryptographic PRNG.

## Limitations and future improvements
- Persistence is in-memory only. SQLite history would be a straightforward addition.
- Sweep jobs run in threads inside the API process. A production system would use a task queue.
- Possible additions: decoy-state BB84 and E91, finite-key analysis (Tomamichel et al.), LDPC reconciliation, an authenticated classical channel, time-varying channels, and execution on real IBM Quantum hardware via Qiskit Runtime.
