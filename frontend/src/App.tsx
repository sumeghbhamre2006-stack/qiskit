import { Activity, BarChart3, Cpu, FileText, LayoutDashboard, Play, Settings2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Spinner } from "./components/ui";
import { useExperiment } from "./hooks/useApi";
import Analytics from "./pages/Analytics";
import CircuitInspector from "./pages/CircuitInspector";
import Configuration, { DEFAULT_CONFIG } from "./pages/Configuration";
import Explorer from "./pages/Explorer";
import Overview from "./pages/Overview";
import Reports from "./pages/Reports";
import { api } from "./services/api";
import type { ExperimentConfig } from "./types";

const PAGES = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "explorer", label: "Protocol Explorer", icon: Workflow },
  { id: "config", label: "Configuration", icon: Settings2 },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "circuits", label: "Circuit Inspector", icon: Cpu },
  { id: "reports", label: "Reports", icon: FileText },
] as const;
type PageId = (typeof PAGES)[number]["id"];

export default function App() {
  const [page, setPage] = useState<PageId>("config");
  const [config, setConfig] = useState<ExperimentConfig>(DEFAULT_CONFIG);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const exp = useExperiment();

  useEffect(() => {
    api.health().catch((e) => setHealthErr(e.message));
  }, []);

  const runNow = async (cfg = config) => {
    const r = await exp.run(cfg);
    if (r) setPage("overview");
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-900 text-teal-300">
            <Activity size={18} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">Q-Secure</div>
            <div className="text-[11px] text-navy-400">Quantum Key Distribution Lab</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {PAGES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                page === id ? "bg-navy-50 text-navy-900" : "text-navy-400 hover:bg-slate-50 hover:text-navy-800"
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{PAGES.find((p) => p.id === page)?.label}</h1>
            <p className="text-sm text-navy-400">
              {exp.result
                ? `Experiment ${exp.result.experiment_id} · ${exp.result.config.n_qubits} qubits · ${new Date(exp.result.created_at).toLocaleTimeString()}`
                : "BB84 with genuine Qiskit Aer circuits"}
            </p>
          </div>
          <button className="btn-primary" onClick={() => runNow()} disabled={exp.loading}>
            {exp.loading ? <Spinner /> : <Play size={16} />} {exp.loading ? "Running on Aer…" : "Run experiment"}
          </button>
        </header>

        <div className="space-y-3">
          {healthErr && <Alert kind="error">{healthErr}</Alert>}
          {exp.error && <Alert kind="error" onClose={exp.clearError}>Experiment failed: {exp.error}</Alert>}
        </div>

        <div className="mt-3">
          {page === "overview" && <Overview result={exp.result} onConfigure={() => setPage("config")} />}
          {page === "explorer" && <Explorer result={exp.result} />}
          {page === "config" && (
            <Configuration config={config} setConfig={setConfig} onRun={runNow} loading={exp.loading} />
          )}
          {page === "analytics" && <Analytics config={config} result={exp.result} />}
          {page === "circuits" && <CircuitInspector config={config} />}
          {page === "reports" && (
            <Reports result={exp.result} history={exp.history} onSelect={exp.setResult} />
          )}
        </div>
      </main>
    </div>
  );
}
