import { Play } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Bar, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Alert, Card, Progress, Spinner, pct } from "../components/ui";
import { useSweep } from "../hooks/useApi";
import type { ExperimentConfig, ExperimentResult, NoiseModel, SweepJob, SweepVariable } from "../types";

const range = (a: number, b: number, s: number) => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-9; x += s) out.push(+x.toFixed(4));
  return out;
};
const pctTick = (v: number) => `${(v * 100).toFixed(0)}%`;
const AX = { fontSize: 11, fill: "#5b6f8f" };

interface Def {
  title: string;
  subtitle: string;
  variable: SweepVariable;
  values: number[];
  trials: number;
  override?: (c: ExperimentConfig) => Partial<ExperimentConfig>;
  render: (job: SweepJob, cfg: ExperimentConfig) => ReactNode;
  note?: ReactNode;
}

function SweepPanel({ def, config }: { def: Def; config: ExperimentConfig }) {
  const { job, error, start, running } = useSweep();
  const [trials, setTrials] = useState(def.trials);
  const base: ExperimentConfig = { ...config, postprocessing: false, demo_mode: false, ...(def.override?.(config) ?? {}) };
  const maxTrials = Math.max(1, Math.floor(1000 / def.values.length));

  return (
    <Card title={def.title} subtitle={def.subtitle}
      actions={
        <div className="flex items-center gap-2">
          <label className="text-xs text-navy-400">trials</label>
          <input type="number" className="input w-16 px-2 py-1 text-xs" min={1} max={Math.min(100, maxTrials)} value={trials}
            onChange={(e) => setTrials(Math.max(1, Math.min(Math.min(100, maxTrials), Math.round(+e.target.value))))} />
          <button className="btn-primary px-2.5 py-1 text-xs" disabled={running}
            onClick={() => start({ base, variable: def.variable, values: def.values, trials })}>
            {running ? <Spinner /> : <Play size={12} />} {running ? "Running" : "Run sweep"}
          </button>
        </div>
      }>
      {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
      {running && job && (
        <div className="mb-3 space-y-1">
          <Progress value={job.progress} />
          <div className="text-xs text-navy-400">{job.completed_runs}/{job.total_runs} Aer experiments</div>
        </div>
      )}
      {job && job.points.length > 0 ? (
        <>
          {def.render(job, job.request.base)}
          <p className="mt-2 text-[11px] text-navy-400">
            {job.request.base.n_qubits} qubits/run · {job.request.trials} trials/point · noise {job.request.base.noise_model}
            {job.request.base.noise_model !== "none" && ` ${pct(job.request.base.noise_probability, 1)}`} · Eve{" "}
            {job.request.base.eve_enabled ? pct(job.request.base.eve_probability, 0) : "off"} · error bars = 95% CI of the mean
            {job.request.base.seed != null && ` · seed ${job.request.base.seed}`}
          </p>
        </>
      ) : !running ? (
        <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-navy-400">
          No data yet — press “Run sweep” to execute {def.values.length * trials} real simulations.
        </div>
      ) : null}
      {def.note && <div className="mt-3 text-xs text-navy-400">{def.note}</div>}
    </Card>
  );
}

const qberRows = (job: SweepJob) =>
  job.points.map((p) => ({ x: p.value, observed: p.mean_qber, ci: p.ci95_half ?? 0, theory: p.theoretical_qber }));

export default function Analytics({ config, result }: { config: ExperimentConfig; result: ExperimentResult | null }) {
  const [noiseModel, setNoiseModel] = useState<NoiseModel>(config.noise_model === "none" ? "depolarizing" : config.noise_model);

  const defs: Def[] = [
    {
      title: "1 · QBER vs Eve interception probability",
      subtitle: "Ideal theory: QBER = p/4 (+ channel noise)",
      variable: "eve_probability", values: range(0, 1, 0.1), trials: 5,
      render: (job, cfg) => (
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={qberRows(job)} margin={{ right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" tickFormatter={pctTick} tick={AX} label={{ value: "Eve interception probability", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
            <YAxis tickFormatter={pctTick} tick={AX} />
            <Tooltip formatter={(v: number) => pct(v)} labelFormatter={(l) => `p = ${pct(+l, 0)}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={cfg.qber_threshold} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "threshold", fontSize: 10, fill: "#dc2626" }} />
            <Line dataKey="theory" name="Idealised expectation" stroke="#94a3b8" strokeDasharray="5 5" dot={false} />
            <Line dataKey="observed" name="Observed mean QBER" stroke="#0f766e" strokeWidth={2}>
              <ErrorBar dataKey="ci" stroke="#0f766e" width={4} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      ),
      note: "The 25% value at p = 100% is an idealised infinite-sample expectation for random-basis intercept-resend on a noiseless channel, not a guaranteed finite-experiment result.",
    },
    {
      title: "2 · QBER vs channel noise",
      subtitle: `Noise model: ${noiseModel} · theory ≈ p/2 (no Eve)`,
      variable: "noise_probability", values: range(0, 0.1, 0.01), trials: 5,
      override: () => ({ noise_model: noiseModel }),
      render: (job) => (
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={qberRows(job)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" tickFormatter={pctTick} tick={AX} label={{ value: "Channel noise probability", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
            <YAxis tickFormatter={pctTick} tick={AX} />
            <Tooltip formatter={(v: number) => pct(v)} labelFormatter={(l) => `p = ${pct(+l, 0)}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="theory" name="Idealised expectation" stroke="#94a3b8" strokeDasharray="5 5" dot={false} />
            <Line dataKey="observed" name="Observed mean QBER" stroke="#1d4ed8" strokeWidth={2}>
              <ErrorBar dataKey="ci" stroke="#1d4ed8" width={4} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      ),
    },
    {
      title: "3 · Sifted key length vs transmitted qubits",
      subtitle: "Expected sifted ≈ n/2 (random basis agreement)",
      variable: "n_qubits", values: [100, 500, 1000, 2000, 4000, 6000, 8000, 10000], trials: 3,
      render: (job) => (
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={job.points.map((p) => ({ x: p.value, sifted: p.mean_sifted, ci: p.ci95_sifted, expected: p.expected_sifted }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" type="number" tick={AX} domain={[0, 10000]} label={{ value: "Transmitted qubits", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
            <YAxis tick={AX} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="expected" name="Expected n/2" stroke="#94a3b8" strokeDasharray="5 5" dot={false} />
            <Line dataKey="sifted" name="Observed mean sifted" stroke="#0f766e" strokeWidth={2}>
              <ErrorBar dataKey="ci" stroke="#0f766e" width={4} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      ),
    },
    {
      title: "4 · Candidate key length vs test-sample percentage",
      subtitle: "Larger test samples tighten the QBER estimate but consume key bits",
      variable: "test_fraction", values: range(0.05, 0.9, 0.05), trials: 3,
      render: (job) => (
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={job.points.map((p) => ({ x: p.value, cand: p.mean_candidate, ci: p.ci95_candidate, expected: p.expected_candidate }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" tickFormatter={pctTick} tick={AX} label={{ value: "Test-sample fraction", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
            <YAxis tick={AX} />
            <Tooltip labelFormatter={(l) => `test = ${pct(+l, 0)}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="expected" name="Expected n/2·(1−f)" stroke="#94a3b8" strokeDasharray="5 5" dot={false} />
            <Line dataKey="cand" name="Observed candidate length" stroke="#0f766e" strokeWidth={2}>
              <ErrorBar dataKey="ci" stroke="#0f766e" width={4} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      ),
    },
    {
      title: "5 · Error count across repeated trials",
      subtitle: "Same configuration repeated — shows shot-to-shot statistical spread",
      variable: "repeat", values: [0], trials: 30,
      render: (job) => {
        const pt = job.points[0];
        const rows = pt.trials.map((t) => ({ trial: t.trial + 1, errors: t.errors, expected: pt.theoretical_qber * t.sample_size }));
        return (
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="trial" tick={AX} label={{ value: "Trial", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
              <YAxis tick={AX} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="errors" name="Observed test errors" fill="#2b3d5c" radius={[3, 3, 0, 0]} />
              <Line dataKey="expected" name="Expected (theory × sample)" stroke="#d97706" strokeDasharray="5 5" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        );
      },
      note: "Uses the current configuration (including Eve and noise settings).",
    },
    {
      title: "6 · Observed vs theoretical QBER",
      subtitle: "Each dot is one trial; points on the diagonal agree with idealised theory",
      variable: "eve_probability", values: range(0, 1, 0.125), trials: 8,
      render: (job) => {
        const dots = job.points.flatMap((p) => p.trials.filter((t) => t.qber != null).map((t) => ({ theory: p.theoretical_qber, observed: t.qber })));
        const max = Math.max(0.3, ...dots.map((d) => d.observed ?? 0));
        return (
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={dots}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="theory" type="number" domain={[0, max]} tickFormatter={pctTick} tick={AX} label={{ value: "Idealised expected QBER", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
              <YAxis dataKey="observed" type="number" domain={[0, max]} tickFormatter={pctTick} tick={AX} />
              <Tooltip formatter={(v: number) => pct(v)} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="#94a3b8" strokeDasharray="5 5" />
              <Scatter dataKey="observed" name="Trial" fill="#0f766e" fillOpacity={0.6} />
            </ComposedChart>
          </ResponsiveContainer>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <Alert kind="info">
        Every chart is generated by running real BB84 experiments on Qiskit Aer in a background job on the backend.
        Sweeps use the current Configuration page settings as the base (post-processing disabled for speed).
        {result && ` Latest single run: QBER ${pct(result.metrics.qber)} vs ideal ${pct(result.theory.expected_qber)}.`}
      </Alert>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-navy-400">Noise model for chart 2:</span>
        <select className="input w-48 py-1" value={noiseModel} onChange={(e) => setNoiseModel(e.target.value as NoiseModel)}>
          <option value="bit_flip">bit flip</option>
          <option value="phase_flip">phase flip</option>
          <option value="depolarizing">depolarizing</option>
        </select>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {defs.map((d) => <SweepPanel key={d.title} def={d} config={config} />)}
      </div>
    </div>
  );
}
