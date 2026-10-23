// Types mirror backend/app/schemas.py exactly.
export type NoiseModel = "none" | "bit_flip" | "phase_flip" | "depolarizing";

export interface ExperimentConfig {
  n_qubits: number;
  eve_enabled: boolean;
  eve_probability: number;
  noise_model: NoiseModel;
  noise_probability: number;
  qber_threshold: number;
  test_fraction: number;
  min_test_sample: number;
  seed: number | null;
  postprocessing: boolean;
  demo_mode: boolean;
}

export interface Metrics {
  transmitted: number;
  sifted: number;
  discarded: number;
  sift_ratio: number;
  test_sample_size: number;
  test_errors: number;
  qber: number | null;
  qber_ci_low: number;
  qber_ci_high: number;
  qber_std_error: number | null;
  candidate_key_length: number;
  candidate_true_errors: number | null;
  final_key_length: number | null;
  eve_interceptions: number;
}

export interface Positions {
  alice_bits: number[] | null;
  alice_bases: number[];
  eve_intercepted: number[];
  eve_bases: number[];
  eve_results: number[] | null;
  bob_bases: number[];
  bob_results: number[] | null;
  role: number[]; // 0 discarded, 1 test, 2 key
  error: number[]; // 1/0 known, -1 unknown
}

export interface PostProcessing {
  performed: boolean;
  reason?: string;
  input_length?: number;
  passes?: number;
  block_sizes?: number[];
  errors_corrected?: number;
  leaked_bits_ec?: number;
  leaked_bits_verify?: number;
  verification_passed?: boolean;
  residual_errors?: number;
  qber_upper_used?: number;
  eve_info_bound_bits?: number;
  pa_security_bits?: number;
  final_length?: number;
  keys_match?: boolean;
  final_key_fingerprint?: string | null;
  alice_final_key_hex?: string | null;
  bob_final_key_hex?: string | null;
}

export interface CountsClass {
  alice_bit: number;
  alice_basis: string;
  eve_intercepts: boolean;
  eve_basis: string | null;
  bob_basis: string;
  shots: number;
  counts: Record<string, number>;
}

export interface ExperimentResult {
  experiment_id: string;
  created_at: string;
  config: ExperimentConfig;
  secure_randomness: boolean;
  metrics: Metrics;
  decision: { status: "INSUFFICIENT_DATA" | "ABORT" | "LOW_DISTURBANCE"; label: string; rationale: string };
  theory: {
    expected_qber: number;
    eve_component: number;
    expected_sifted: number;
    expected_test_sample: number;
    expected_candidate: number;
    note: string;
  };
  positions: Positions;
  postprocessing: PostProcessing | null;
  counts_by_class: CountsClass[];
  circuit_classes: number;
  simulator: Record<string, unknown>;
  runtime_ms: number;
}

export type SweepVariable = "eve_probability" | "noise_probability" | "n_qubits" | "test_fraction" | "repeat";

export interface SweepTrial {
  trial: number;
  qber: number | null;
  errors: number;
  sample_size: number;
  sifted: number;
  candidate: number;
  decision: string;
  seed: number | null;
}

export interface SweepPoint {
  value: number;
  trials: SweepTrial[];
  mean_qber: number | null;
  std_qber: number | null;
  ci95_half: number | null;
  pooled_qber: number | null;
  theoretical_qber: number;
  mean_sifted: number;
  ci95_sifted: number;
  expected_sifted: number;
  mean_candidate: number;
  ci95_candidate: number;
  expected_candidate: number;
  abort_rate: number;
}

export interface SweepRequest {
  base: ExperimentConfig;
  variable: SweepVariable;
  values: number[];
  trials: number;
}

export interface SweepJob {
  job_id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  completed_runs: number;
  total_runs: number;
  request: SweepRequest;
  points: SweepPoint[];
  error: string | null;
}

export interface CircuitInfo {
  title: string;
  kind: string;
  basis: string;
  description: string;
  num_qubits: number;
  num_clbits: number;
  depth: number;
  gates: Record<string, number>;
  diagram: string;
  qasm_like: string[];
}

export interface Health {
  status: string;
  quantum_simulator: string;
  qiskit: string;
  qiskit_aer: string;
  persistence: string;
  self_test_ms: number;
}
