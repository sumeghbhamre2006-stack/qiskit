import { ArrowRight, ChevronLeft, ChevronRight, Eye, EyeOff, Radio, User, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, BASIS, Card, Empty } from "../components/ui";
import type { ExperimentResult } from "../types";

const PAGE = 48;
const STATE = (bit: number, basis: number) => (basis === 0 ? (bit ? "|1⟩" : "|0⟩") : bit ? "|−⟩" : "|+⟩");
type Filter = "all" | "sifted" | "test" | "errors" | "intercepted";

export default function Explorer({ result: r }: { result: ExperimentResult | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(0);
  const [reveal, setReveal] = useState(true);

  const idx = useMemo(() => {
    if (!r) return [];
    const p = r.positions;
    const all = p.role.map((_, i) => i);
    return all.filter((i) =>
      filter === "all" ? true
        : filter === "sifted" ? p.role[i] > 0
        : filter === "test" ? p.role[i] === 1
        : filter === "errors" ? p.error[i] === 1
        : p.eve_intercepted[i] === 1);
  }, [r, filter]);

  if (!r) return <Empty>Run an experiment to explore individual qubit journeys.</Empty>;
  const p = r.positions;
  const demo = p.alice_bits != null;
  const show = demo && reveal;
  const pages = Math.max(1, Math.ceil(idx.length / PAGE));
  const visible = idx.slice(page * PAGE, page * PAGE + PAGE);
  const bit = (arr: number[] | null, i: number) => (show && arr && arr[i] >= 0 ? String(arr[i]) : "•");
  const match = p.alice_bases[sel] === p.bob_bases[sel];
  const roleName = ["Discarded (basis mismatch)", "Test sample (publicly compared)", "Candidate key"][p.role[sel]];

  return (
    <div className="space-y-5">
      {/* Flow */}
      <Card title="Protocol flow" subtitle="Alice → quantum channel → Bob, with Eve as an optional interception layer">
        <div className="flex flex-wrap items-stretch justify-center gap-3 text-center text-sm">
          <Node icon={<User size={18} />} title="Alice" lines={["random bits + Z/X bases", "X, H state preparation"]} />
          <ArrowRight className="self-center text-navy-400" />
          {r.config.eve_enabled && (
            <>
              <Node icon={<UserX size={18} />} title="Eve" tone="red"
                lines={[`intercepts ${(r.config.eve_probability * 100).toFixed(0)}%`, `${r.metrics.eve_interceptions} qubits measured & resent`]} />
              <ArrowRight className="self-center text-navy-400" />
            </>
          )}
          <Node icon={<Radio size={18} />} title="Quantum channel"
            lines={[r.config.noise_model === "none" ? "noiseless" : r.config.noise_model.replace("_", "-"), `p = ${(r.config.noise_probability * 100).toFixed(1)}%`]} />
          <ArrowRight className="self-center text-navy-400" />
          <Node icon={<User size={18} />} title="Bob" lines={["random Z/X bases", "(H) + measure"]} />
          <ArrowRight className="self-center text-navy-400" />
          <Node title="Classical channel" lines={[`${r.metrics.sifted} sifted / ${r.metrics.discarded} discarded`, `${r.metrics.test_sample_size} tested, ${r.metrics.test_errors} errors`]} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Transmission positions" subtitle="Click a cell to inspect its journey"
          actions={demo ? (
            <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setReveal(!reveal)}>
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />} {reveal ? "Hide bits" : "Reveal bits"}
            </button>
          ) : undefined}>
          {!demo && <div className="mb-3"><Alert kind="info">Demo mode was off for this run: bit values are hidden; only bases, roles and publicly compared test results are shown.</Alert></div>}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(["all", "sifted", "test", "errors", "intercepted"] as Filter[]).map((f) => (
              <button key={f} onClick={() => { setFilter(f); setPage(0); }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${filter === f ? "bg-navy-900 text-white" : "bg-slate-100 text-navy-600 hover:bg-slate-200"}`}>
                {f}
              </button>
            ))}
            <span className="ml-auto self-center text-xs text-navy-400">{idx.length} positions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-center font-mono text-xs">
              <tbody>
                {[
                  ["#", (i: number) => i],
                  ["Alice bit", (i: number) => bit(p.alice_bits, i)],
                  ["Alice basis", (i: number) => BASIS[p.alice_bases[i]]],
                  ["Eve", (i: number) => (p.eve_intercepted[i] ? `${BASIS[p.eve_bases[i]]}${show ? ":" + bit(p.eve_results, i) : ""}` : "·")],
                  ["Bob basis", (i: number) => BASIS[p.bob_bases[i]]],
                  ["Bob result", (i: number) => bit(p.bob_results, i)],
                  ["Sift", (i: number) => (p.role[i] === 0 ? "✕" : p.role[i] === 1 ? "T" : "K")],
                  ["Error", (i: number) => (p.error[i] === 1 ? "!" : p.error[i] === 0 ? "✓" : "")],
                ].map(([label, fn]) => (
                  <tr key={label as string}>
                    <th className="sticky left-0 bg-white pr-2 text-left font-sans text-[11px] font-medium text-navy-400 whitespace-nowrap">{label as string}</th>
                    {visible.map((i) => {
                      const v = (fn as (i: number) => string | number)(i);
                      const bg = i === sel ? "bg-teal-100" : p.role[i] === 0 ? "bg-slate-50 text-slate-400" : p.role[i] === 1 ? "bg-amber-50" : "";
                      const err = label === "Error" && p.error[i] === 1 ? "text-red-600 font-bold" : "";
                      const eve = label === "Eve" && p.eve_intercepted[i] ? "text-red-700" : "";
                      return <td key={i} onClick={() => setSel(i)} className={`cursor-pointer border-b border-slate-100 px-1 py-1 ${bg} ${err} ${eve}`}>{v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-navy-400">
            <span>Legend: T = test sample (amber), K = candidate key, ✕ = discarded (grey), ! = error</span>
            <div className="flex items-center gap-2">
              <button className="btn-secondary px-2 py-1" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button>
              <span>{page + 1}/{pages}</span>
              <button className="btn-secondary px-2 py-1" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button>
            </div>
          </div>
        </Card>

        <Card title={`Journey of position #${sel}`} subtitle={roleName}>
          <div className="mb-3 flex gap-2">
            <input type="number" className="input" min={0} max={r.metrics.transmitted - 1} value={sel}
              onChange={(e) => setSel(Math.min(r.metrics.transmitted - 1, Math.max(0, Math.round(+e.target.value))))} />
          </div>
          <ol className="space-y-3 text-sm">
            <Step n={1} title="Alice prepares">
              Basis {BASIS[p.alice_bases[sel]]}, bit {bit(p.alice_bits, sel)}
              {show && <> → state <b>{STATE(p.alice_bits![sel], p.alice_bases[sel])}</b></>}
              <div className="text-xs text-navy-400">Gates: {p.alice_bits && show ? [p.alice_bits[sel] ? "X" : null, p.alice_bases[sel] ? "H" : null].filter(Boolean).join(", ") || "none" : "X if bit=1, H if X-basis"}</div>
            </Step>
            <Step n={2} title="Eve" tone={p.eve_intercepted[sel] ? "red" : undefined}>
              {p.eve_intercepted[sel] ? (
                <>Intercepted: measured in {BASIS[p.eve_bases[sel]]} → outcome {bit(p.eve_results, sel)}, reset and re-prepared
                  {show && p.eve_results && <> <b>{STATE(p.eve_results[sel], p.eve_bases[sel])}</b></>}.
                  {p.eve_bases[sel] !== p.alice_bases[sel] && <div className="text-xs text-red-700">Wrong basis — Alice's state was destroyed.</div>}</>
              ) : r.config.eve_enabled ? "Not intercepted — original state forwarded." : "Eve disabled."}
            </Step>
            <Step n={3} title="Channel">{r.config.noise_model === "none" ? "Noiseless" : `${r.config.noise_model} error with p = ${(r.config.noise_probability * 100).toFixed(1)}%`}</Step>
            <Step n={4} title="Bob measures">
              Basis {BASIS[p.bob_bases[sel]]} {p.bob_bases[sel] ? "(H then measure)" : "(direct measure)"} → result {bit(p.bob_results, sel)}
            </Step>
            <Step n={5} title="Basis reconciliation">
              Alice {BASIS[p.alice_bases[sel]]} vs Bob {BASIS[p.bob_bases[sel]]}: {match ? "match — kept" : "mismatch — discarded"}
            </Step>
            {match && (
              <Step n={6} title={p.role[sel] === 1 ? "Test sample" : "Candidate key"} tone={p.error[sel] === 1 ? "red" : undefined}>
                {p.error[sel] === 1 ? "Bits disagree (error)." : p.error[sel] === 0 ? "Bits agree." : "Not disclosed."}
                {p.role[sel] === 1 && " Disclosed publicly and removed from the key."}
              </Step>
            )}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function Node({ icon, title, lines, tone }: { icon?: React.ReactNode; title: string; lines: string[]; tone?: "red" }) {
  return (
    <div className={`min-w-[150px] rounded-xl border px-4 py-3 ${tone === "red" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
      <div className={`flex items-center justify-center gap-1.5 font-semibold ${tone === "red" ? "text-red-800" : "text-navy-800"}`}>{icon}{title}</div>
      {lines.map((l) => <div key={l} className="text-xs text-navy-400">{l}</div>)}
    </div>
  );
}

function Step({ n, title, children, tone }: { n: number; title: string; children: React.ReactNode; tone?: "red" }) {
  return (
    <li className="flex gap-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone === "red" ? "bg-red-100 text-red-800" : "bg-navy-50 text-navy-800"}`}>{n}</span>
      <div><div className="font-medium">{title}</div><div className="text-navy-600">{children}</div></div>
    </li>
  );
}
