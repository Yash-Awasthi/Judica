import { spawn, ChildProcess } from "child_process";
import path from "path";
import readline from "readline";
import logger from "../logger.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_TEXT_LENGTH = 50_000; // 50K chars
const MAX_PENDING = 100;

class MLWorker {
  private process: ChildProcess | null = null;
  private isReady = false;
  private callbacks: ((data: { embeddings?: number[][]; error?: string; score?: number }) => void)[] = [];
  private readyPromise: Promise<void> | null = null;

  async init() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      const pythonPath = process.platform === "win32" 
        ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
        : "python3";

      const scriptPath = path.join(__dirname, "embeddings.py");
      
      logger.info({ pythonPath, scriptPath }, "Launching ML embedding worker");

      this.process = spawn(pythonPath, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"]
      });

      const rl = readline.createInterface({
        input: this.process.stdout!,
        terminal: false
      });

      rl.on("line", (line) => {
        if (line === "READY") {
          this.isReady = true;
          logger.info("ML embedding worker is READY");
          resolve();
          return;
        }

        try {
          const data = JSON.parse(line);
          const cb = this.callbacks.shift();
          if (cb) cb(data);
        } catch (err) {
          logger.error({ line, err }, "Failed to parse ML worker output");
        }
      });

      this.process.stderr!.on("data", (data) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("fatal")) {
          logger.error({ msg }, "ML worker stderr");
        } else {
          logger.debug({ msg }, "ML worker info");
        }
      });

      this.process.on("error", (err) => {
        logger.error({ err }, "ML worker process error");
        reject(err);
      });

      this.process.on("exit", (code) => {
        logger.warn({ code }, "ML worker process exited");
        this.isReady = false;
        this.process = null;
        this.readyPromise = null;
      });
    });

    return this.readyPromise;
  }

  async computeSimilarity(text1: string, text2: string): Promise<number> {
    if (process.env.NODE_ENV === "test") {
      const err = new Error("ML worker skipped in test mode") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }

    const t1 = text1.length > MAX_TEXT_LENGTH ? text1.slice(0, MAX_TEXT_LENGTH) : text1;
    const t2 = text2.length > MAX_TEXT_LENGTH ? text2.slice(0, MAX_TEXT_LENGTH) : text2;

    await this.init();

    if (!this.process || !this.process.stdin) {
      throw new Error("ML worker not available");
    }

    if (this.callbacks.length >= MAX_PENDING) {
      throw new Error("ML worker overloaded — too many pending requests");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.callbacks.shift(); // remove self
        reject(new Error("ML worker timeout"));
      }, 5000);

      this.callbacks.push((data) => {
        clearTimeout(timeout);
        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.score ?? 0);
        }
      });

      const payload = JSON.stringify({ action: "similarity", text1: t1, text2: t2 }) + "\n";
      this.process!.stdin!.write(payload);
    });
  }

  async shutdown() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isReady = false;
      this.readyPromise = null;
    }
  }
}

export const mlWorker = new MLWorker();
