/**
 * Vespa application deployment utilities.
 *
 * Handles deploying or updating the Vespa application package via the
 * Vespa Deploy API (/application/v2/tenant/default/prepareandactivate).
 *
 * Usage:
 *   import { deployVespaApp, checkVespaReady } from "./deploy.js";
 *   const ready = await checkVespaReady("http://localhost:19071");
 *   if (ready) await deployVespaApp("http://localhost:19071");
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Deploy or update the Vespa application package.
 *
 * Reads the schema.sd file from the same directory and POSTs a minimal
 * application package (services.xml + schema) to the Vespa Deploy API.
 *
 * @param endpoint  Vespa config server endpoint, e.g. http://localhost:19071
 */
export async function deployVespaApp(endpoint: string): Promise<void> {
  const base = endpoint.replace(/\/$/, "");

  // Read the schema definition
  const schemaPath = join(__dirname, "schema.sd");
  let schemaContent: string;
  try {
    schemaContent = await readFile(schemaPath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read Vespa schema at ${schemaPath}: ${String(err)}`, { cause: err });
  }

  // Minimal services.xml — single-node, single-content cluster
  const servicesXml = `<?xml version="1.0" encoding="utf-8" ?>
<services version="1.0">
  <container id="default" version="1.0">
    <search />
    <document-api />
  </container>
  <content id="judica" version="1.0">
    <redundancy>1</redundancy>
    <documents>
      <document type="judica_doc" mode="index" />
    </documents>
    <nodes>
      <node hostalias="node1" distribution-key="0" />
    </nodes>
  </content>
</services>`;

  // Vespa Deploy API expects a ZIP archive containing the app package.
  // We build a minimal ZIP in-memory using the JSZip-compatible approach
  // or send a multipart/form-data. Here we use the prepareandactivate REST
  // endpoint which accepts a zip payload.
  const zipBuffer = await buildAppPackageZip(servicesXml, schemaContent);

  const url = `${base}/application/v2/tenant/default/prepareandactivate`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: Buffer.from(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength) as unknown as BodyInit,
    });
  } catch (err) {
    throw new Error(`Network error deploying Vespa app: ${String(err)}`, { cause: err });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vespa deploy failed (${res.status}): ${text}`);
  }

  const result = await res.json() as { log?: unknown; configChangeActions?: unknown };
  // Log is informational — deployment is considered successful if HTTP 200
  void result;
}

/**
 * Check whether the Vespa config server is ready to accept deployments.
 *
 * @param endpoint  Vespa config server endpoint, e.g. http://localhost:19071
 * @returns true if Vespa is up and ready
 */
export async function checkVespaReady(endpoint: string): Promise<boolean> {
  const base = endpoint.replace(/\/$/, "");
  const url = `${base}/state/v1/health`;

  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch {
    return false;
  }

  if (!res.ok) return false;

  try {
    const data = await res.json() as { status?: { code?: string } };
    return data?.status?.code === "up";
  } catch {
    return false;
  }
}

// ─── Internal: minimal ZIP builder ────────────────────────────────────────────
// Builds an in-memory ZIP without external dependencies using the ZIP spec.
// Supports only stored (uncompressed) entries — sufficient for text files.

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

async function buildAppPackageZip(
  servicesXml: string,
  schemaContent: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  const entries: ZipEntry[] = [
    { name: "services.xml", data: encoder.encode(servicesXml) },
    { name: "schemas/judica_doc.sd", data: encoder.encode(schemaContent) },
  ];

  return buildZip(entries);
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header
    const localHeader = new DataView(new ArrayBuffer(30 + nameBytes.length));
    let pos = 0;
    localHeader.setUint32(pos, 0x04034b50, true); pos += 4; // signature
    localHeader.setUint16(pos, 20, true); pos += 2;          // version needed
    localHeader.setUint16(pos, 0, true); pos += 2;           // flags
    localHeader.setUint16(pos, 0, true); pos += 2;           // compression (stored)
    localHeader.setUint16(pos, 0, true); pos += 2;           // mod time
    localHeader.setUint16(pos, 0, true); pos += 2;           // mod date
    localHeader.setUint32(pos, crc, true); pos += 4;         // crc-32
    localHeader.setUint32(pos, size, true); pos += 4;        // compressed size
    localHeader.setUint32(pos, size, true); pos += 4;        // uncompressed size
    localHeader.setUint16(pos, nameBytes.length, true); pos += 2; // name length
    localHeader.setUint16(pos, 0, true); pos += 2;           // extra length
    new Uint8Array(localHeader.buffer).set(nameBytes, 30);

    const localHeaderBytes = new Uint8Array(localHeader.buffer);
    parts.push(localHeaderBytes);
    parts.push(entry.data);

    // Central directory entry
    const cdEntry = new DataView(new ArrayBuffer(46 + nameBytes.length));
    let cp = 0;
    cdEntry.setUint32(cp, 0x02014b50, true); cp += 4; // signature
    cdEntry.setUint16(cp, 20, true); cp += 2;          // version made by
    cdEntry.setUint16(cp, 20, true); cp += 2;          // version needed
    cdEntry.setUint16(cp, 0, true); cp += 2;           // flags
    cdEntry.setUint16(cp, 0, true); cp += 2;           // compression
    cdEntry.setUint16(cp, 0, true); cp += 2;           // mod time
    cdEntry.setUint16(cp, 0, true); cp += 2;           // mod date
    cdEntry.setUint32(cp, crc, true); cp += 4;         // crc-32
    cdEntry.setUint32(cp, size, true); cp += 4;        // compressed size
    cdEntry.setUint32(cp, size, true); cp += 4;        // uncompressed size
    cdEntry.setUint16(cp, nameBytes.length, true); cp += 2; // name length
    cdEntry.setUint16(cp, 0, true); cp += 2;           // extra length
    cdEntry.setUint16(cp, 0, true); cp += 2;           // comment length
    cdEntry.setUint16(cp, 0, true); cp += 2;           // disk number start
    cdEntry.setUint16(cp, 0, true); cp += 2;           // internal attributes
    cdEntry.setUint32(cp, 0, true); cp += 4;           // external attributes
    cdEntry.setUint32(cp, offset, true); cp += 4;      // offset of local header
    new Uint8Array(cdEntry.buffer).set(nameBytes, 46);

    centralDir.push(new Uint8Array(cdEntry.buffer));
    offset += 30 + nameBytes.length + size;
  }

  // End of central directory record
  const cdSize = centralDir.reduce((acc, e) => acc + e.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);  // signature
  eocd.setUint16(4, 0, true);           // disk number
  eocd.setUint16(6, 0, true);           // start disk
  eocd.setUint16(8, entries.length, true);  // entries on disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, cdSize, true);     // central dir size
  eocd.setUint32(16, offset, true);     // central dir offset
  eocd.setUint16(20, 0, true);          // comment length

  const all = [...parts, ...centralDir, new Uint8Array(eocd.buffer)];
  const totalLen = all.reduce((acc, b) => acc + b.length, 0);
  const result = new Uint8Array(totalLen);
  let writePos = 0;
  for (const chunk of all) {
    result.set(chunk, writePos);
    writePos += chunk.length;
  }
  return result;
}

/** CRC-32 implementation (IEEE polynomial) */
function crc32(data: Uint8Array): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function makeCrcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    _crcTable[i] = c;
  }
  return _crcTable;
}
