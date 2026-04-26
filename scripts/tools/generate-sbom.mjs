#!/usr/bin/env node
/**
 * SBOM Generation — Phase 8.8
 *
 * Generates a Software Bill of Materials (SBOM) in CycloneDX JSON format
 * for the aibyai project. Lists all production dependencies with version,
 * license, and source URL.
 *
 * Output: sbom.json (CycloneDX 1.4 format)
 *
 * Usage:
 *   node scripts/tools/generate-sbom.mjs
 *   node scripts/tools/generate-sbom.mjs --output dist/sbom.json
 *
 * Ref: CycloneDX specification — https://cyclonedx.org/specification/overview/
 *      NTIA SBOM minimum elements — https://ntia.gov/sbom
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { execSync } from "child_process";
import { createHash } from "crypto";

const ROOT = resolve(process.cwd());
const outputPath = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : join(ROOT, "sbom.json");

// ─── Read package.json ────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const deps = {
  ...pkg.dependencies ?? {},
};

// ─── Resolve installed versions from node_modules ────────────────────────────

function resolveInstalledVersion(name) {
  const pkgJsonPath = join(ROOT, "node_modules", name, "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  try {
    const p = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    return { version: p.version, license: p.license ?? "UNKNOWN", homepage: p.homepage ?? null };
  } catch {
    return null;
  }
}

// ─── Build CycloneDX components ───────────────────────────────────────────────

const components = [];

for (const [name, specVersion] of Object.entries(deps)) {
  const installed = resolveInstalledVersion(name);
  const version = installed?.version ?? specVersion.replace(/[^0-9.]/g, "");
  const license = installed?.license ?? "UNKNOWN";
  const purl = `pkg:npm/${name}@${version}`;

  components.push({
    type: "library",
    "bom-ref": purl,
    name,
    version,
    purl,
    licenses: [{ license: { id: license } }],
    externalReferences: installed?.homepage
      ? [{ type: "website", url: installed.homepage }]
      : [],
  });
}

// ─── Get git metadata ─────────────────────────────────────────────────────────

let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["pipe", "pipe", "ignore"] })
    .toString().trim();
} catch { /* no git */ }

// ─── Build SBOM document ──────────────────────────────────────────────────────

const serialNumber = `urn:uuid:${createHash("sha256").update(pkg.name + pkg.version + Date.now()).digest("hex").slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")}`;

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.4",
  serialNumber,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "aibyai", name: "generate-sbom", version: "1.0.0" }],
    component: {
      type: "application",
      "bom-ref": `pkg:npm/${pkg.name}@${pkg.version}`,
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${pkg.name}@${pkg.version}`,
      properties: [
        { name: "git:commit", value: gitCommit },
        { name: "build:node", value: process.version },
      ],
    },
  },
  components,
  dependencies: [
    {
      ref: `pkg:npm/${pkg.name}@${pkg.version}`,
      dependsOn: components.map(c => c["bom-ref"]),
    },
  ],
};

writeFileSync(outputPath, JSON.stringify(sbom, null, 2), "utf-8");

console.log(`✓ SBOM generated: ${outputPath}`);
console.log(`  Components: ${components.length}`);
console.log(`  Format: CycloneDX 1.4`);
console.log(`  Serial: ${serialNumber}`);
