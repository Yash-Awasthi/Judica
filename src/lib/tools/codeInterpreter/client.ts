/**
 * Code Interpreter Client — communicates with the python-sandbox service.
 *
 * Modeled after Onyx tools/tool_implementations/python/code_interpreter_client.py.
 * Supports batch execution, SSE streaming, file upload/download.
 */

import logger from "../../logger.js";
import type {
  CodeInterpreterConfig,
  ExecutionRequest,
  ExecutionResult,
  StreamChunk,
  FileInfo,
} from "./models.js";
import { DEFAULT_CODE_INTERPRETER_CONFIG } from "./models.js";

export class CodeInterpreterClient {
  private config: CodeInterpreterConfig;

  constructor(config: Partial<CodeInterpreterConfig> = {}) {
    this.config = { ...DEFAULT_CODE_INTERPRETER_CONFIG, ...config };
  }

  // ─── Batch Execution ───────────────────────────────────────────────────

  /**
   * Execute Python code and return the complete result.
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: request.code,
          stdin: request.stdin,
          timeout: request.timeout ?? Math.floor(this.config.timeoutMs / 1000),
          files: request.files,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return {
          success: false,
          stdout: "",
          stderr: errorText,
          exitCode: -1,
          executionTimeMs: Date.now() - startTime,
          outputFiles: {},
          error: `Sandbox returned ${response.status}: ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        stdout?: string;
        stderr?: string;
        exit_code?: number;
        output_files?: Record<string, string>;
      };

      return {
        success: (result.exit_code ?? 0) === 0,
        stdout: truncateOutput(result.stdout ?? "", this.config.maxOutputSize),
        stderr: truncateOutput(result.stderr ?? "", this.config.maxOutputSize),
        exitCode: result.exit_code ?? 0,
        executionTimeMs: Date.now() - startTime,
        outputFiles: result.output_files ?? {},
      };
    } catch (err) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: -1,
        executionTimeMs: Date.now() - startTime,
        outputFiles: {},
        error: err instanceof Error ? err.message : "Execution failed",
      };
    }
  }

  // ─── Streaming Execution ───────────────────────────────────────────────

  /**
   * Execute Python code with SSE streaming of stdout/stderr.
   * Falls back to batch execution if streaming is not available.
   */
  async *executeStream(request: ExecutionRequest): AsyncGenerator<StreamChunk> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/execute/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          code: request.code,
          stdin: request.stdin,
          timeout: request.timeout ?? Math.floor(this.config.timeoutMs / 1000),
          files: request.files,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok || !response.body) {
        // Fallback to batch execution
        const result = await this.execute(request);
        if (result.stdout) yield { type: "stdout", data: result.stdout };
        if (result.stderr) yield { type: "stderr", data: result.stderr };
        yield { type: "done", data: String(result.exitCode) };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(line.slice(6)) as StreamChunk;
              yield chunk;
            } catch {
              // Skip malformed SSE data
            }
          }
        }
      }
    } catch (err) {
      yield {
        type: "error",
        data: err instanceof Error ? err.message : "Stream execution failed",
      };
    }
  }

  // ─── File Operations ───────────────────────────────────────────────────

  /**
   * Upload a file to the sandbox session.
   */
  async uploadFile(
    filename: string,
    content: Buffer | string,
    mimeType?: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const base64 = typeof content === "string" ? content : content.toString("base64");

      const response = await fetch(`${this.config.baseUrl}/v1/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          content: base64,
          mime_type: mimeType,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return { success: false, error: `Upload failed: ${response.status}` };
      }

      const result = (await response.json()) as { path?: string };
      return { success: true, path: result.path };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Upload failed",
      };
    }
  }

  /**
   * Download a file from the sandbox session.
   */
  async downloadFile(
    filename: string,
  ): Promise<{ success: boolean; content?: string; mimeType?: string; error?: string }> {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/v1/files/${encodeURIComponent(filename)}`,
        { signal: AbortSignal.timeout(30_000) },
      );

      if (!response.ok) {
        return { success: false, error: `Download failed: ${response.status}` };
      }

      const result = (await response.json()) as { content?: string; mime_type?: string };
      return {
        success: true,
        content: result.content,
        mimeType: result.mime_type,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Download failed",
      };
    }
  }

  // ─── Health Check ──────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateOutput(output: string, maxSize: number): string {
  if (output.length <= maxSize) return output;
  const half = Math.floor(maxSize / 2) - 50;
  return (
    output.slice(0, half) +
    `\n\n... [truncated ${output.length - maxSize} chars] ...\n\n` +
    output.slice(-half)
  );
}
