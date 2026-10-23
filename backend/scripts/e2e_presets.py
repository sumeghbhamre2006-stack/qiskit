"""End-to-end check: every UI preset through the Vite proxy (as the browser does)."""
import json, time, urllib.request

BASE = "http://127.0.0.1:5173"
DEFAULT = dict(n_qubits=4000, eve_enabled=False, eve_probability=1.0, noise_model="none", noise_probability=0,
               qber_threshold=0.11, test_fraction=0.25, min_test_sample=20, seed=None, postprocessing=True, demo_mode=True)
PRESETS = {
    "Ideal, no Eve": dict(),
    "Noisy, no Eve": dict(noise_model="depolarizing", noise_probability=0.03),
    "Full intercept-resend": dict(eve_enabled=True, eve_probability=1),
    "Partial intercept-resend": dict(eve_enabled=True, eve_probability=0.3),
    "Noise + Eve": dict(eve_enabled=True, eve_probability=0.4, noise_model="bit_flip", noise_probability=0.04),
}

def req(path, body=None):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r) as f:
        raw = f.read().decode()
        return json.loads(raw) if f.headers.get_content_type() == "application/json" else raw

print(req("/api/health"))
for name, p in PRESETS.items():
    r = req("/api/experiment/run", {**DEFAULT, **p})
    m = r["metrics"]
    csv = req(f"/api/experiment/{r['experiment_id']}/export?format=csv")
    md = req(f"/api/experiment/{r['experiment_id']}/export?format=md")
    assert len(csv.strip().splitlines()) == m["transmitted"] + 1 and r["experiment_id"] in md
    print(f"{name:26s} sifted={m['sifted']} test={m['test_sample_size']} QBER={m['qber']:.4f} "
          f"(theory {r['theory']['expected_qber']:.4f}) cand={m['candidate_key_length']} final={m['final_key_length']} "
          f"-> {r['decision']['status']} [{r['runtime_ms']:.0f} ms]")

job = req("/api/experiment/sweep", {"base": {**DEFAULT, "n_qubits": 1000, "postprocessing": False},
                                    "variable": "eve_probability", "values": [0, 0.5, 1], "trials": 5})
while job["status"] in ("queued", "running"):
    time.sleep(0.3); job = req(f"/api/sweep/{job['job_id']}")
print("sweep", job["status"], [(p["value"], round(p["mean_qber"], 4), round(p["ci95_half"], 4), p["theoretical_qber"]) for p in job["points"]])
print("circuits", len(req("/api/circuits")))
