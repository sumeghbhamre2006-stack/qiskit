import type { CircuitInfo, ExperimentConfig, ExperimentResult, Health, NoiseModel, SweepJob, SweepRequest } from "../types";

export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      "Cannot reach the Q-Secure backend. Start it with: cd backend && .venv/bin/uvicorn app.main:app --port 8000",
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((d: { loc?: string[]; msg: string }) => `${(d.loc ?? []).slice(1).join(".") || "request"}: ${d.msg}`)
          .join("; ");
      } else if (body.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/api/health"),
  run: (cfg: ExperimentConfig) =>
    request<ExperimentResult>("/api/experiment/run", { method: "POST", body: JSON.stringify(cfg) }),
  get: (id: string) => request<ExperimentResult>(`/api/experiment/${id}`),
  startSweep: (req: SweepRequest) =>
    request<SweepJob>("/api/experiment/sweep", { method: "POST", body: JSON.stringify(req) }),
  sweepStatus: (id: string) => request<SweepJob>(`/api/sweep/${id}`),
  circuits: (noise_model: NoiseModel, noise_probability: number) =>
    request<CircuitInfo[]>(`/api/circuits?noise_model=${noise_model}&noise_probability=${noise_probability}`),
  exportUrl: (id: string, format: "csv" | "md" | "json") => `${API_BASE}/api/experiment/${id}/export?format=${format}`,
};
