import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { ExperimentConfig, ExperimentResult, SweepJob, SweepRequest } from "../types";

export function useExperiment() {
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const [history, setHistory] = useState<ExperimentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (cfg: ExperimentConfig) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.run(cfg);
      setResult(r);
      setHistory((h) => [r, ...h.filter((x) => x.experiment_id !== r.experiment_id)].slice(0, 20));
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, setResult, history, loading, error, run, clearError: () => setError(null) };
}

/** Starts a background sweep job on the backend and polls its progress. */
export function useSweep() {
  const [job, setJob] = useState<SweepJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const start = useCallback(async (req: SweepRequest) => {
    stop();
    setError(null);
    try {
      const j = await api.startSweep(req);
      setJob(j);
      timer.current = window.setInterval(async () => {
        try {
          const s = await api.sweepStatus(j.job_id);
          setJob(s);
          if (s.status === "done" || s.status === "error") {
            stop();
            if (s.error) setError(s.error);
          }
        } catch (e) {
          stop();
          setError((e as Error).message);
        }
      }, 400);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const running = job?.status === "queued" || job?.status === "running";
  return { job, error, start, running };
}
