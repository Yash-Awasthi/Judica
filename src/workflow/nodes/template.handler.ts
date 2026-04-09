import type { NodeHandler } from "../types.js";

export const templateHandler: NodeHandler = async (ctx) => {
  const template = (ctx.nodeData.template as string) || "";

  // Merge nodeData variables and inputs for substitution
  const vars: Record<string, unknown> = { ...ctx.inputs };

  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });

  return { text };
};
