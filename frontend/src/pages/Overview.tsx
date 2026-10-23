import { Binary, Filter, KeyRound, Radio, ShieldCheck, TestTube2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Card, Empty, Metric, StatusBadge, pct } from "../components/ui";
import type { ExperimentResult } from "../types";

export default function Overview({ result: r, onConfigure }: { result: ExperimentResult | null; onConfigure: () => void }) {
  if (!r) return <Empty><div>No experiment yet. <button className="text-teal-700 underline" onClick={onConfigure}>Configure</button> one or press “Run experiment”.</div></Empty>;
  const m = r.metrics;
  const pp = r.postprocessing;
  const funnel = [
    { name: "Transmitted", v: m.transmitted, c: "#16233b" },
    { name: "Sifted", v: m.sifted, c: "#2b3d5c" },
    { name: "Test sample", v: m.test_sample_size, c: "#d97706" },
    { name: "Candidate key", v: m.candidate_key_length, c: "#0f766e" },
    ...(m.final_key_length != null ? [{ name: "Final key", v: m.final_key_length, c: "#0d9488" }] : []),
  ];
  const overThr = m.qber != null && m.qber > r.config.qber_threshold;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Transmitted qubits" value={m.transmitted.toLocaleString()} icon={<Radio size={16} />}
          hint={r.config.eve_enabled ? `${m.eve_interceptions} intercepted by Eve` : "Eve disabled"} />
        <Metric label="Sifted bits" value={m.sifted.toLocaleString()} icon={<Filter size={16} />}
          hint={`${pct(m.sift_ratio, 1)} matched · ${m.discarded} discarded`} />
        <Metric label="Test sample" value={m.test_sample_size.toLocaleString()} icon={<TestTube2 size={16} />}
          hint={`${m.test_errors} errors observed`} />
        <Metric label="Estimated QBER" value={pct(m.qber)} icon={<Binary size={16} />}
          accent={overThr ? "text-red-700" : "text-navy-900"}
          hint={`95% CI ${pct(m.qber_ci_low, 1)}–${pct(m.qber_ci_high, 1)}`} />
        <Metric label="Candidate key" value={m.candidate_key_length.toLocaleString()} icon={<KeyRound size={16} />}
          hint="sifted − test sample" />
        <Metric label="Final processed key" icon={<ShieldCheck size={16} />}
          value={m.final_key_length == null ? "off" : m.final_key_length.toLocaleString()}
          hint={m.final_key_length == null ? "post-processing disabled" : pp?.performed ? "after EC + Toeplitz PA" : "not extracted"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Protocol status" className="lg:col-span-2">
          <StatusBadge status={r.decision.status} label={r.decision.label} />
          <p className="mt-3 text-sm leading-relaxed text-navy-600">{r.decision.rationale}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="label">Observed QBER</div>
              <div className="mt-1 font-mono text-lg">{pct(m.qber)}</div>
              <div className="text-xs text-navy-400">{m.test_errors}/{m.test_sample_size} test bits ± {pct(m.qber_std_error)} s.e.</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="label">Ideal expectation</div>
              <div className="mt-1 font-mono text-lg">{pct(r.theory.expected_qber)}</div>
              <div className="text-xs text-navy-400">infinite-sample limit (theory)</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="label">Abort threshold</div>
              <div className="mt-1 font-mono text-lg">{pct(r.config.qber_threshold)}</div>
              <div className="text-xs text-navy-400">educational, configurable</div>
            </div>
          </div>
          {m.test_sample_size < 100 && (
            <div className="mt-4"><Alert kind="warn">Small test sample ({m.test_sample_size} bits): the QBER estimate has wide uncertainty and may fail to reveal a partial attack.</Alert></div>
          )}
          {m.candidate_true_errors != null && (
            <p className="mt-3 text-xs text-navy-400">
              Demo-mode ground truth: the undisclosed candidate key contains {m.candidate_true_errors} errors
              ({pct(m.candidate_key_length ? m.candidate_true_errors / m.candidate_key_length : null)}) — Alice and Bob cannot see this.
            </p>
          )}
        </Card>

        <Card title="Key-length funnel" subtitle="All values from this experiment">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="v" name="bits" radius={[0, 4, 4, 0]}>{funnel.map((f) => <Cell key={f.name} fill={f.c} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {pp && (
        <Card title="Post-processing (educational)" subtitle="Cascade error correction → verification hash → Toeplitz privacy amplification">
          {pp.performed ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Cascade passes", `${pp.passes} (blocks ${pp.block_sizes?.join(", ")})`],
                ["Errors corrected", pp.errors_corrected],
                ["Residual errors (ground truth)", pp.residual_errors],
                ["Verification hash", pp.verification_passed ? "match" : "MISMATCH"],
                ["Leaked: EC parities", `${pp.leaked_bits_ec} bits`],
                ["Leaked: verification", `${pp.leaked_bits_verify} bits`],
                ["Eve info bound n·h(Q⁺)", `${pp.eve_info_bound_bits?.toFixed(1)} bits (Q⁺=${pct(pp.qber_upper_used)})`],
                ["PA margin 2·log₂(1/ε)", `${pp.pa_security_bits?.toFixed(1)} bits`],
                ["Final length", `${pp.final_length} bits`],
                ["Alice/Bob keys match", pp.keys_match ? "yes" : "no"],
                ["Key fingerprint", pp.final_key_fingerprint ?? "—"],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="text-xs text-navy-400">{k}</div><div className="font-mono text-sm">{String(v)}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-navy-600">{pp.reason}</p>}
          {pp.alice_final_key_hex && (
            <div className="mt-3 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs text-navy-600">
              <span className="label mr-2">Demo key (hex)</span>{pp.alice_final_key_hex.slice(0, 128)}{pp.alice_final_key_hex.length > 128 ? "…" : ""}
            </div>
          )}
          <p className="mt-3 text-xs text-navy-400">
            Length formula ℓ = n − n·h(Q⁺) − leak_EC − leak_ver − 2·log₂(1/ε) mirrors asymptotic BB84 key-rate formulas but omits rigorous
            finite-key analysis. This is not a composably secure key.
          </p>
        </Card>
      )}
    </div>
  );
}
