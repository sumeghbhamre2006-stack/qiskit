import { Play, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Card, Spinner, pct } from "../components/ui";
import type { ExperimentConfig, NoiseModel } from "../types";

export const DEFAULT_CONFIG: ExperimentConfig = {
  n_qubits: 1000,
  eve_enabled: false,
  eve_probability: 1.0,
  noise_model: "none",
  noise_probability: 0,
  qber_threshold: 0.11,
  test_fraction: 0.25,
  min_test_sample: 20,
  seed: null,
  postprocessing: true,
  demo_mode: true,
};

export const PRESETS: { name: string; desc: string; cfg: Partial<ExperimentConfig> }[] = [
  { name: "Ideal channel, no Eve", desc: "Noiseless baseline — expect 0% QBER.",
    cfg: { eve_enabled: false, noise_model: "none", noise_probability: 0 } },
  { name: "Noisy channel, no Eve", desc: "3% depolarizing noise — expect ≈1.5% QBER.",
    cfg: { eve_enabled: false, noise_model: "depolarizing", noise_probability: 0.03 } },
  { name: "Full intercept-resend", desc: "Eve intercepts every qubit — ideal expectation 25% QBER.",
    cfg: { eve_enabled: true, eve_probability: 1, noise_model: "none", noise_probability: 0 } },
  { name: "Partial intercept-resend", desc: "Eve intercepts 30% — expect ≈7.5% QBER.",
    cfg: { eve_enabled: true, eve_probability: 0.3, noise_model: "none", noise_probability: 0 } },
  { name: "Noise + eavesdropping", desc: "Eve 40% plus 4% bit-flip noise — expect ≈11.6% QBER.",
    cfg: { eve_enabled: true, eve_probability: 0.4, noise_model: "bit_flip", noise_probability: 0.04 } },
];

export function validate(c: ExperimentConfig): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.n_qubits) || c.n_qubits < 100 || c.n_qubits > 10000) e.push("Qubits must be an integer in 100–10,000.");
  if (c.eve_probability < 0 || c.eve_probability > 1) e.push("Eve probability must be 0–100%.");
  if (c.noise_probability < 0 || c.noise_probability > 0.1) e.push("Noise probability must be 0–10%.");
  if (c.noise_model === "none" && c.noise_probability > 0) e.push("Select a noise model, or set noise probability to 0.");
  if (c.qber_threshold < 0 || c.qber_threshold > 0.5) e.push("Threshold must be 0–50%.");
  if (c.test_fraction < 0.05 || c.test_fraction > 0.9) e.push("Test sample must be 5–90%.");
  if (c.min_test_sample < 1 || c.min_test_sample > 5000) e.push("Minimum test sample must be 1–5000.");
  if (c.seed != null && (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 4294967295)) e.push("Seed must be an integer 0–4294967295.");
  return e;
}

function Row({ label, value, children, help }: { label: string; value?: ReactNode; children: ReactNode; help?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-navy-800">{label}</label>
        {value != null && <span className="font-mono text-sm tabular-nums text-teal-800">{value}</span>}
      </div>
      {children}
      {help && <p className="mt-1 text-xs text-navy-400">{help}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm font-medium text-navy-800">{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-teal-700" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export default function Configuration({ config: c, setConfig, onRun, loading }: {
  config: ExperimentConfig; setConfig: (c: ExperimentConfig) => void; onRun: (c: ExperimentConfig) => void; loading: boolean;
}) {
  const set = (p: Partial<ExperimentConfig>) => setConfig({ ...c, ...p });
  const errors = validate(c);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Presets" subtitle="Load a scenario, then run it. Expected values are idealised infinite-sample limits.">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {PRESETS.map((p) => (
              <div key={p.name} className="rounded-lg border border-slate-200 p-3 hover:border-teal-600">
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="mt-0.5 text-xs text-navy-400">{p.desc}</div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => set(p.cfg)}>Load</button>
                  <button className="btn-primary px-2 py-1 text-xs" disabled={loading}
                    onClick={() => { const n = { ...c, ...p.cfg }; setConfig(n); onRun(n); }}>
                    <Play size={12} /> Load & run
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-5 md:grid-cols-2">
          <Card title="Transmission">
            <div className="space-y-5">
              <Row label="Transmitted qubits" value={c.n_qubits.toLocaleString()} help="100–10,000. Executed on Qiskit Aer.">
                <input type="range" min={100} max={10000} step={100} value={c.n_qubits} className="w-full"
                  onChange={(e) => set({ n_qubits: +e.target.value })} />
                <input type="number" className="input mt-2" min={100} max={10000} value={c.n_qubits}
                  onChange={(e) => set({ n_qubits: Math.round(+e.target.value) })} />
              </Row>
              <Row label="Random seed (optional)" help="Blank = cryptographically secure randomness (secrets). A seed makes the run reproducible but not secure.">
                <input className="input font-mono" placeholder="secure random" value={c.seed ?? ""}
                  onChange={(e) => set({ seed: e.target.value.trim() === "" ? null : Number(e.target.value) })} />
              </Row>
            </div>
          </Card>

          <Card title="Eavesdropper (Eve)" subtitle="Random-basis intercept-resend attack">
            <div className="space-y-5">
              <Toggle label="Eve enabled" checked={c.eve_enabled} onChange={(v) => set({ eve_enabled: v })} />
              <Row label="Interception probability" value={pct(c.eve_probability, 0)}>
                <input type="range" min={0} max={1} step={0.01} value={c.eve_probability} disabled={!c.eve_enabled}
                  className="w-full disabled:opacity-40" onChange={(e) => set({ eve_probability: +e.target.value })} />
              </Row>
              <p className="text-xs text-navy-400">
                Ideal expected contribution to QBER: {pct((c.eve_enabled ? c.eve_probability : 0) / 4)} (= p/4).
              </p>
            </div>
          </Card>

          <Card title="Quantum channel noise" subtitle="Applied as a CPTP instruction inside each Aer circuit">
            <div className="space-y-5">
              <Row label="Noise model">
                <select className="input" value={c.noise_model}
                  onChange={(e) => { const m = e.target.value as NoiseModel; set({ noise_model: m, noise_probability: m === "none" ? 0 : c.noise_probability || 0.02 }); }}>
                  <option value="none">None (noiseless baseline)</option>
                  <option value="bit_flip">Bit flip (X error)</option>
                  <option value="phase_flip">Phase flip (Z error)</option>
                  <option value="depolarizing">Depolarizing</option>
                </select>
              </Row>
              <Row label="Noise probability p" value={pct(c.noise_probability, 1)}>
                <input type="range" min={0} max={0.1} step={0.005} value={c.noise_probability} disabled={c.noise_model === "none"}
                  className="w-full disabled:opacity-40" onChange={(e) => set({ noise_probability: +e.target.value })} />
              </Row>
            </div>
          </Card>

          <Card title="Security analysis">
            <div className="space-y-5">
              <Row label="QBER abort threshold" value={pct(c.qber_threshold, 1)} help="Educational threshold; 11% is the commonly cited asymptotic BB84 bound.">
                <input type="range" min={0} max={0.5} step={0.005} value={c.qber_threshold} className="w-full"
                  onChange={(e) => set({ qber_threshold: +e.target.value })} />
              </Row>
              <Row label="Test-sample fraction of sifted bits" value={pct(c.test_fraction, 0)}>
                <input type="range" min={0.05} max={0.9} step={0.05} value={c.test_fraction} className="w-full"
                  onChange={(e) => set({ test_fraction: +e.target.value })} />
              </Row>
              <Row label="Minimum test sample" help="Below this, the result is INSUFFICIENT DATA.">
                <input type="number" className="input" min={1} max={5000} value={c.min_test_sample}
                  onChange={(e) => set({ min_test_sample: Math.round(+e.target.value) })} />
              </Row>
              <Toggle label="Post-processing (EC + privacy amplification)" checked={c.postprocessing} onChange={(v) => set({ postprocessing: v })} />
              <Toggle label="Educational demo mode (reveal bit values)" checked={c.demo_mode} onChange={(v) => set({ demo_mode: v })} />
            </div>
          </Card>
        </div>
      </div>

      <div className="space-y-5">
        <Card title="Run summary">
          <dl className="space-y-2 text-sm">
            {[
              ["Qubits", c.n_qubits.toLocaleString()],
              ["Eve", c.eve_enabled ? `on, ${pct(c.eve_probability, 0)}` : "off"],
              ["Noise", c.noise_model === "none" ? "none" : `${c.noise_model}, ${pct(c.noise_probability, 1)}`],
              ["Threshold", pct(c.qber_threshold, 1)],
              ["Test sample", pct(c.test_fraction, 0)],
              ["Seed", c.seed ?? "secure random"],
              ["Expected sifted", `≈ ${(c.n_qubits / 2).toFixed(0)}`],
              ["Expected test bits", `≈ ${((c.n_qubits / 2) * c.test_fraction).toFixed(0)}`],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between"><dt className="text-navy-400">{k}</dt><dd className="font-mono">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 space-y-2">
            {errors.map((e) => <Alert key={e} kind="error">{e}</Alert>)}
            <button className="btn-primary w-full justify-center" disabled={loading || errors.length > 0} onClick={() => onRun(c)}>
              {loading ? <Spinner /> : <Play size={16} />} Run experiment
            </button>
            <button className="btn-secondary w-full justify-center" onClick={() => setConfig(DEFAULT_CONFIG)}>
              <RotateCcw size={14} /> Reset defaults
            </button>
          </div>
        </Card>
        <Alert kind="info">
          Bit-flip noise only disturbs Z-basis states and phase-flip only X-basis states, so each yields a sifted QBER of
          ≈ p/2. Depolarizing (Aer convention) also yields ≈ p/2.
        </Alert>
      </div>
    </div>
  );
}
