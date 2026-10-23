import { Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { Card, Empty, StatusBadge, pct } from "../components/ui";
import { api } from "../services/api";
import type { ExperimentResult } from "../types";

export default function Reports({ result: r, history, onSelect }: {
  result: ExperimentResult | null; history: ExperimentResult[]; onSelect: (r: ExperimentResult) => void;
}) {
  if (!r) return <Empty>Run an experiment to generate a report.</Empty>;
  const c = r.config, m = r.metrics, t = r.theory;
  const rows: [string, string, string][] = [
    ["Sifted bits", `${m.sifted} (${pct(m.sift_ratio)})`, `${t.expected_sifted.toFixed(1)} (50%)`],
    ["Discarded", `${m.discarded}`, `${(m.transmitted - t.expected_sifted).toFixed(1)}`],
    ["Test sample", `${m.test_sample_size}`, `${t.expected_test_sample.toFixed(1)}`],
    ["Test errors", `${m.test_errors}`, `${(t.expected_qber * m.test_sample_size).toFixed(1)}`],
    ["QBER", `${pct(m.qber)} [${pct(m.qber_ci_low)}, ${pct(m.qber_ci_high)}]`, pct(t.expected_qber)],
    ["Candidate key", `${m.candidate_key_length}`, `${t.expected_candidate.toFixed(1)}`],
    ["Eve interceptions", `${m.eve_interceptions}`, `${(c.eve_enabled ? c.eve_probability * c.n_qubits : 0).toFixed(1)}`],
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title={`Experiment ${r.experiment_id}`} subtitle={`${new Date(r.created_at).toLocaleString()} · ${r.runtime_ms.toFixed(0)} ms · ${r.circuit_classes} circuit classes on ${String(r.simulator.backend)}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <a className="btn-secondary px-2.5 py-1 text-xs" href={api.exportUrl(r.experiment_id, "csv")}><FileSpreadsheet size={14} /> CSV</a>
              <a className="btn-secondary px-2.5 py-1 text-xs" href={api.exportUrl(r.experiment_id, "md")}><FileText size={14} /> Report</a>
              <a className="btn-secondary px-2.5 py-1 text-xs" href={api.exportUrl(r.experiment_id, "json")}><FileJson size={14} /> JSON</a>
            </div>
          }>
          <StatusBadge status={r.decision.status} label={r.decision.label} />
          <p className="mt-3 text-sm text-navy-600">{r.decision.rationale}</p>
          <h4 className="label mt-5 mb-2">Observed vs theoretical</h4>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-navy-400"><th className="py-1.5">Metric</th><th>Observed</th><th>Idealised expectation</th></tr></thead>
            <tbody>{rows.map(([a, b, d]) => <tr key={a} className="border-b border-slate-100"><td className="py-1.5">{a}</td><td className="font-mono">{b}</td><td className="font-mono text-navy-400">{d}</td></tr>)}</tbody>
          </table>
          <p className="mt-3 text-xs text-navy-400">Key length: candidate = sifted − test = {m.sifted} − {m.test_sample_size} = {m.candidate_key_length}
            {m.final_key_length != null && ` · final processed key = ${m.final_key_length}`}. {t.note}</p>
        </Card>

        <Card title="Measurement counts by circuit class" subtitle="Raw Aer counts; keys formatted as 'bob eve' classical bits">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b text-left text-navy-400"><th className="py-1.5">Alice bit</th><th>Alice basis</th><th>Eve</th><th>Bob basis</th><th>Shots</th><th>Counts</th></tr></thead>
              <tbody>
                {r.counts_by_class.map((cc, i) => (
                  <tr key={i} className="border-b border-slate-100 font-mono">
                    <td className="py-1">{c.demo_mode ? cc.alice_bit : "•"}</td><td>{cc.alice_basis}</td>
                    <td>{cc.eve_intercepts ? `yes (${cc.eve_basis})` : "no"}</td><td>{cc.bob_basis}</td><td>{cc.shots}</td>
                    <td>{c.demo_mode ? JSON.stringify(cc.counts) : "hidden"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Configuration">
          <dl className="space-y-1.5 text-sm">
            {[
              ["Qubits", c.n_qubits], ["Eve", c.eve_enabled ? pct(c.eve_probability, 0) : "off"],
              ["Noise model", c.noise_model], ["Noise p", pct(c.noise_probability, 1)],
              ["Threshold", pct(c.qber_threshold, 1)], ["Test fraction", pct(c.test_fraction, 0)],
              ["Min sample", c.min_test_sample], ["Seed", c.seed ?? "none (secure)"],
              ["Randomness", r.secure_randomness ? "secrets (CSPRNG)" : "seeded PCG64"],
              ["Post-processing", c.postprocessing ? "on" : "off"], ["Demo mode", c.demo_mode ? "on" : "off"],
              ["Qiskit / Aer", `${r.simulator.qiskit} / ${r.simulator.qiskit_aer}`],
            ].map(([k, v]) => <div key={String(k)} className="flex justify-between"><dt className="text-navy-400">{k}</dt><dd className="font-mono">{String(v)}</dd></div>)}
          </dl>
        </Card>
        <Card title="Session history" subtitle="Click to reload; exports stay available while the backend runs">
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.experiment_id}>
                <button onClick={() => onSelect(h)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs ${h.experiment_id === r.experiment_id ? "bg-navy-50" : "hover:bg-slate-50"}`}>
                  <span className="font-mono">{h.experiment_id}</span>
                  <span>{h.config.n_qubits}q · {pct(h.metrics.qber, 1)}</span>
                  <Download size={12} className="text-navy-400" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
