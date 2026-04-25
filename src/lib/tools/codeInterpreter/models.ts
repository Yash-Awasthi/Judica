/**
 * Code Interpreter Models — types for the Python sandbox integration.
 *
 * Modeled after Onyx python-sandbox REST API.
 */

export interface CodeInterpreterConfig {
  /** Base URL of the python-sandbox service. */
  baseUrl: string;
  /** Request timeout in ms. */
  timeoutMs: number;
  /** Max output size in chars before truncation. */
  maxOutputSize: number;
  /** Pre-installed packages available in the sandbox. */
  availablePackages: string[];
}

export const DEFAULT_CODE_INTERPRETER_CONFIG: CodeInterpreterConfig = {
  baseUrl: "http://localhost:8888",
  timeoutMs: 60_000,
  maxOutputSize: 10_000,
  availablePackages: [
    "pandas", "numpy", "matplotlib", "seaborn", "scipy",
    "scikit-learn", "requests", "beautifulsoup4", "pillow",
    "sympy", "networkx", "statsmodels",
  ],
};

export interface ExecutionRequest {
  /** Python code to execute. */
  code: string;
  /** Optional stdin input. */
  stdin?: string;
  /** Execution timeout in seconds. */
  timeout?: number;
  /** Files to make available in the sandbox (name → base64 content). */
  files?: Record<string, string>;
}

export interface ExecutionResult {
  /** Whether execution succeeded. */
  success: boolean;
  /** stdout output. */
  stdout: string;
  /** stderr output. */
  stderr: string;
  /** Exit code. */
  exitCode: number;
  /** Execution time in ms. */
  executionTimeMs: number;
  /** Output files generated (name → base64 content). */
  outputFiles: Record<string, string>;
  /** Error message if execution failed. */
  error?: string;
}

export interface StreamChunk {
  type: "stdout" | "stderr" | "status" | "file" | "error" | "done";
  data: string;
  /** File name (only for type === "file"). */
  filename?: string;
}

export interface FileInfo {
  name: string;
  size: number;
  mimeType: string;
  /** SHA-256 hash for cache invalidation. */
  contentHash: string;
}
