import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Card, Spinner } from "../components/ui";
import { api } from "../services/api";
import type { CircuitInfo, ExperimentConfig } from "../types";

export default function CircuitInspector({ config }: { config: ExperimentConfig }) {
  const [circuits, setCircuits] = useState<CircuitInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setErr(null);
    api.circuits(config.noise_model, config.noise_probability)
      .then(setCircuits).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [config.noise_model, config.noise_probability]);

  return (
    <div className="space-y-5">
      <Alert kind="info">
        Diagrams below are <b>actual Qiskit circuit objects</b> rendered by <code>QuantumCircuit.draw("text")</code> on the backend
        — the same builder functions used during simulation. The two full-transmission circuits include the configured channel
        noise ({config.noise_model}{config.noise_model !== "none" && `, p=${config.noise_probability}`}). Explanatory text is marked as such.
      </Alert>
      <div className="flex justify-end">
        <button className="btn-secondary" onClick={load} disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={14} />} Reload</button>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-5 xl:grid-cols-2">
        {circuits?.map((c) => (
          <Card key={c.title} title={c.title}
            subtitle={<span className="uppercase tracking-wide">{c.kind} · basis {c.basis}</span>}
            className={c.kind === "eve" || c.kind === "transmission" ? "xl:col-span-2" : ""}>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <Chip k="Qubits" v={c.num_qubits} /> <Chip k="Clbits" v={c.num_clbits} /> <Chip k="Depth" v={c.depth} />
              {Object.entries(c.gates).map(([g, n]) => <Chip key={g} k={g} v={n} />)}
            </div>
            <div className="label mb-1">Qiskit output</div>
            <pre className="overflow-x-auto rounded-lg bg-navy-900 p-4 font-mono text-[11px] leading-[1.25] text-slate-100">{c.diagram}</pre>
            <div className="mt-2 text-xs text-navy-400"><span className="font-medium">Explanation:</span> {c.description}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Chip({ k, v }: { k: string; v: number }) {
  return <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-navy-800">{k}: <b>{v}</b></span>;
}
