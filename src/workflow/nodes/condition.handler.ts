import type { NodeHandler } from "../types.js";

export const conditionHandler: NodeHandler = async (ctx) => {
  const value = ctx.inputs.value ?? ctx.nodeData.value;
  const operator = (ctx.nodeData.operator as string) || "equals";
  const compareTo = ctx.nodeData.compare_to;

  // Cap string lengths before comparison to prevent DoS
  const strValue = String(value ?? "").slice(0, 100_000);
  const strCompare = String(compareTo ?? "").slice(0, 100_000);

  let result: boolean;

  switch (operator) {
    case "equals":
      result = strValue === strCompare;
      break;
    case "not_equals":
      result = strValue !== strCompare;
      break;
    case "contains":
      result = strValue.includes(strCompare);
      break;
    case "gt": {
      // NaN guard on numeric comparisons
      const numVal = Number(value);
      const numCmp = Number(compareTo);
      result = Number.isFinite(numVal) && Number.isFinite(numCmp) ? numVal > numCmp : false;
      break;
    }
    case "lt": {
      const numVal = Number(value);
      const numCmp = Number(compareTo);
      result = Number.isFinite(numVal) && Number.isFinite(numCmp) ? numVal < numCmp : false;
      break;
    }
    case "is_empty":
      result = value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0);
      break;
    default:
      result = false;
  }

  return { branch: result ? "true" : "false" };
};
