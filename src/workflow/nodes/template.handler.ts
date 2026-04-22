import type { NodeHandler } from "../types.js";

/**
 * P10-122: Enhanced template engine with conditionals, loops, and filters.
 * Supports:
 *   {{variable}} — basic interpolation
 *   {{#if condition}}...{{/if}} — conditionals
 *   {{#each items}}...{{/each}} — loops ({{@index}}, {{@item}})
 *   {{variable|upper}} — filters (upper, lower, trim, json)
 *   \\{{ — escaped delimiters (P10-123)
 */

// P10-123: Filters for template values
const FILTERS: Record<string, (val: string) => string> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  trim: (v) => v.trim(),
  json: (v) => JSON.stringify(v),
  length: (v) => String(v.length),
};

// R2-09: Block dangerous keys to prevent prototype pollution via template variables
const TEMPLATE_FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__"]);

function resolveVariable(path: string, vars: Record<string, unknown>): unknown {
  const parts = path.split(".");
  let current: unknown = vars;
  for (const part of parts) {
    if (TEMPLATE_FORBIDDEN_KEYS.has(part)) return undefined;
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  // P10-123: Handle escaped delimiters — replace \\{{ with a placeholder
  const ESCAPE_PLACEHOLDER = "\x00LBRACE\x00";
  let text = template.replace(/\\\{\{/g, ESCAPE_PLACEHOLDER);

  // P10-122: Process {{#each items}}...{{/each}} blocks
  text = text.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const items = resolveVariable(key, vars);
    if (!Array.isArray(items)) return "";
    return items.map((item, index) => {
      const iterVars = { ...vars, "@item": item, "@index": index, item };
      return renderTemplate(body, iterVars);
    }).join("");
  });

  // P10-122: Process {{#if condition}}...{{else}}...{{/if}} blocks
  text = text.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_, key, truthy, falsy) => {
    const val = resolveVariable(key, vars);
    return val ? renderTemplate(truthy, vars) : renderTemplate(falsy || "", vars);
  });

  // P10-122: Process {{variable|filter}} interpolation
  text = text.replace(/\{\{(\w[\w.]*?)(?:\|(\w+))?\}\}/g, (match, key, filter) => {
    const val = resolveVariable(key, vars);
    if (val === undefined || val === null) return match;
    let strVal = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (filter && FILTERS[filter]) {
      strVal = FILTERS[filter](strVal);
    }
    return strVal;
  });

  // P10-123: Restore escaped delimiters
  text = text.replace(new RegExp(ESCAPE_PLACEHOLDER, "g"), "{{");

  return text;
}

// P10-124: Validate template syntax at definition time
export function validateTemplate(template: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for unclosed blocks
  const openEach = (template.match(/\{\{#each\s+\w+\}\}/g) || []).length;
  const closeEach = (template.match(/\{\{\/each\}\}/g) || []).length;
  if (openEach !== closeEach) {
    errors.push(`Unclosed {{#each}} blocks: ${openEach} opened, ${closeEach} closed`);
  }

  const openIf = (template.match(/\{\{#if\s+\w+\}\}/g) || []).length;
  const closeIf = (template.match(/\{\{\/if\}\}/g) || []).length;
  if (openIf !== closeIf) {
    errors.push(`Unclosed {{#if}} blocks: ${openIf} opened, ${closeIf} closed`);
  }

  // Check for invalid filter names
  const filterRefs = template.matchAll(/\{\{\w[\w.]*?\|(\w+)\}\}/g);
  for (const match of filterRefs) {
    if (!FILTERS[match[1]]) {
      errors.push(`Unknown filter "${match[1]}". Available: ${Object.keys(FILTERS).join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export const templateHandler: NodeHandler = async (ctx) => {
  const template = (ctx.nodeData.template as string) || "";

  // P10-124: Validate template before rendering
  const validation = validateTemplate(template);
  if (!validation.valid) {
    throw new Error(`Template validation failed: ${validation.errors.join("; ")}`);
  }

  // Merge nodeData variables and inputs for substitution
  const vars: Record<string, unknown> = { ...ctx.inputs };

  const text = renderTemplate(template, vars);

  return { text };
};
