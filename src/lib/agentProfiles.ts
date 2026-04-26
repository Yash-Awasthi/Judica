/**
 * Agent YAML Config Profiles — Phase 2.14
 *
 * Export any council configuration as a single YAML file.
 * Import it anywhere. Share on the marketplace.
 * Reproducible, version-controllable agent setups.
 *
 * Inspired by:
 * - SWE-agent (MIT, Princeton, SWE-agent/SWE-agent) — YAML-defined agent configs
 *   that capture tool permissions, system prompts, and behavior settings
 *
 * YAML structure:
 * ```yaml
 * version: "1.0"
 * name: My Custom Council
 * description: ...
 * deliberation_mode: debate
 * master:
 *   id: ...
 *   systemPrompt: ...
 * members:
 *   - id: contrarian
 *     name: The Contrarian
 *     systemPrompt: ...
 *     model: gpt-4o
 * settings:
 *   verbosity: detailed
 *   specialisationDomain: coding
 * ```
 */

export interface CouncilMemberConfig {
  id:            string;
  name:          string;
  systemPrompt?: string;
  model?:        string;
  provider?:     string;
  role?:         string;
}

export interface CouncilProfile {
  version:            string;
  name:               string;
  description?:       string;
  deliberation_mode?: string;
  master?:            CouncilMemberConfig;
  members:            CouncilMemberConfig[];
  settings?:          Record<string, unknown>;
}

// ─── Minimal zero-dependency YAML serializer ─────────────────────────────────

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "~";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  const str = String(value);
  // Quote strings that contain special YAML characters or newlines
  if (/[\n:{}[\]|>#&*!,'"%@`]/.test(str) || str.includes("\n") || str.trim() !== str) {
    return JSON.stringify(str); // JSON string is valid YAML quoted scalar
  }
  return str;
}

function dumpValue(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "~";
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
    if (keys.length === 0) return "{}";
    return "\n" + keys.map(k => `${pad}${k}: ${dumpValue(obj[k], indent + 1)}`).join("\n");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "\n" + value.map(item => {
      const inner = dumpValue(item, indent + 1);
      return `${pad}- ${inner.startsWith("\n") ? inner.trimStart() : inner}`;
    }).join("\n");
  }
  return yamlScalar(value);
}

function dumpObject(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const val = dumpValue(v, 1);
      return val.startsWith("\n") ? `${k}:${val}` : `${k}: ${val}`;
    })
    .join("\n");
}

// ─── Minimal YAML parser ─────────────────────────────────────────────────────

function parseYAML(text: string): unknown {
  // Delegate to JSON if it looks like JSON (common for round-trip)
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  // Very basic YAML parser for our specific profile format
  const lines = text.split("\n");
  const root: Record<string, unknown> = {};
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: root, indent: -1 }];
  let currentList: unknown[] | null = null;
  let currentListKey = "";
  let currentListParent: Record<string, unknown> = root;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    if (content.startsWith("- ")) {
      // List item
      const val = parseScalar(content.slice(2));
      if (!currentList) {
        currentList = [];
        currentListParent[currentListKey] = currentList;
      }
      if (typeof val === "object" && val !== null) {
        currentList.push(val);
      } else {
        currentList.push(val);
      }
    } else if (content.includes(": ")) {
      const colonIdx = content.indexOf(": ");
      const key = content.slice(0, colonIdx).trim();
      const val = content.slice(colonIdx + 2).trim();
      currentList = null;
      currentListKey = key;
      currentListParent = root; // simplified — works for our flat profile structure

      // Pop stack to correct indent level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;
      if (val === "" || val === "|") {
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ obj: child, indent });
        currentListParent = child;
        currentListKey = key;
      } else {
        parent[key] = parseScalar(val);
        currentListParent = parent;
        currentListKey = key;
      }
    } else if (content.endsWith(":")) {
      const key = content.slice(0, -1).trim();
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ obj: child, indent });
      currentList = null;
      currentListKey = key;
      currentListParent = parent;
    }
  }

  return root;
}

function parseScalar(val: string): unknown {
  if (val === "~" || val === "null") return null;
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Serialize a council profile to YAML string. */
export function profileToYAML(profile: CouncilProfile): string {
  return dumpObject(profile as unknown as Record<string, unknown>);
}

/** Parse a YAML string into a CouncilProfile. */
export function yamlToProfile(yamlStr: string): { profile: CouncilProfile | null; error?: string } {
  try {
    const raw = parseYAML(yamlStr) as Record<string, unknown>;
    if (typeof raw !== "object" || !raw) {
      return { profile: null, error: "Invalid YAML: expected object" };
    }
    if (!raw.members || !Array.isArray(raw.members)) {
      return { profile: null, error: "Invalid profile: members array required" };
    }
    const profile: CouncilProfile = {
      version:           (raw.version as string) ?? "1.0",
      name:              (raw.name as string) ?? "Imported Council",
      description:       raw.description as string | undefined,
      deliberation_mode: raw.deliberation_mode as string | undefined,
      master:            raw.master as CouncilMemberConfig | undefined,
      members:           raw.members as CouncilMemberConfig[],
      settings:          raw.settings as Record<string, unknown> | undefined,
    };
    return { profile };
  } catch (err) {
    return { profile: null, error: `YAML parse error: ${(err as Error).message}` };
  }
}

/** Validate a council profile for required fields. */
export function validateProfile(profile: CouncilProfile): string[] {
  const errors: string[] = [];
  if (!profile.name?.trim()) errors.push("name is required");
  if (!Array.isArray(profile.members) || profile.members.length === 0) {
    errors.push("members array must have at least one entry");
  }
  for (const m of profile.members ?? []) {
    if (!m.id)   errors.push(`member missing id: ${JSON.stringify(m)}`);
    if (!m.name) errors.push(`member missing name (id=${m.id})`);
  }
  return errors;
}
