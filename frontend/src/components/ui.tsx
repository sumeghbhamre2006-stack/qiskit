import { AlertTriangle, CheckCircle2, HelpCircle, Info, ShieldAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ExperimentResult } from "../types";

export const pct = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
export const BASIS = ["Z", "X"];

export function Card({ title, subtitle, children, actions, className = "" }: {
  title?: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-navy-800">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-navy-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Metric({ label, value, hint, icon, accent = "text-navy-900" }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="text-teal-700">{icon}</span>
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-navy-400">{hint}</div>}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: ExperimentResult["decision"]["status"]; label: string }) {
  const style = {
    ABORT: "bg-red-50 text-red-800 border-red-200",
    INSUFFICIENT_DATA: "bg-amber-50 text-amber-800 border-amber-200",
    LOW_DISTURBANCE: "bg-teal-50 text-teal-800 border-teal-200",
  }[status];
  const Icon = { ABORT: ShieldAlert, INSUFFICIENT_DATA: HelpCircle, LOW_DISTURBANCE: CheckCircle2 }[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold ${style}`}>
      <Icon size={16} /> {label}
    </span>
  );
}

export function Alert({ kind = "info", children, onClose }: { kind?: "info" | "warn" | "error"; children: ReactNode; onClose?: () => void }) {
  const s = {
    info: "bg-sky-50 border-sky-200 text-sky-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    error: "bg-red-50 border-red-200 text-red-900",
  }[kind];
  const Icon = kind === "info" ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${s}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} aria-label="Dismiss"><X size={14} /></button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card flex min-h-[220px] items-center justify-center p-8 text-center text-sm text-navy-400">{children}</div>;
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full bg-teal-600 transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
