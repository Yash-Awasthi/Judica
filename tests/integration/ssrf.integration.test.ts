import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "http";
import { validateSafeUrl } from "../../src/lib/ssrf.js";

/**
 * P6-01: Integration test for validateSafeUrl with a real HTTP server.
 * Verifies that private IPs are actually blocked (not just mocked).
 */
describe("SSRF — validateSafeUrl integration (real DNS)", () => {
  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        serverPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("blocks requests to 127.0.0.1 (loopback)", async () => {
    await expect(
      validateSafeUrl(`http://127.0.0.1:${serverPort}/secret`)
    ).rejects.toThrow();
  });

  it("blocks requests to 10.x.x.x (private)", async () => {
    await expect(
      validateSafeUrl("http://10.0.0.1/secret")
    ).rejects.toThrow();
  });

  it("blocks requests to 192.168.x.x (private)", async () => {
    await expect(
      validateSafeUrl("http://192.168.1.1/admin")
    ).rejects.toThrow();
  });

  it("blocks requests to 169.254.169.254 (AWS metadata)", async () => {
    await expect(
      validateSafeUrl("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow();
  });

  it("blocks requests to metadata.google.internal", async () => {
    await expect(
      validateSafeUrl("http://metadata.google.internal/computeMetadata/v1/")
    ).rejects.toThrow();
  });

  it("blocks file:// protocol", async () => {
    await expect(
      validateSafeUrl("file:///etc/passwd")
    ).rejects.toThrow();
  });

  it("blocks localhost hostname", async () => {
    await expect(
      validateSafeUrl(`http://localhost:${serverPort}/`)
    ).rejects.toThrow();
  });

  it("allows a real public URL (example.com)", async () => {
    // example.com resolves to a public IP, so it should pass validation
    const result = await validateSafeUrl("https://example.com/");
    expect(result).toBe("https://example.com/");
  });
});
