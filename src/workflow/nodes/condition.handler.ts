import type { NodeHandler } from "../types.js";

export const conditionHandler: NodeHandler = async (ctx) => {
  const value = ctx.inputs.value ?? ctx.nodeData.value;
  const operator = (ctx.nodeData.operator as string) || "equals";
  const compareTo = ctx.nodeData.compare_to;

  let result: boolean;

  switch (operator) {
    case "equals":
      result = String(value) === String(compareTo);
      break;
    case "not_equals":
      result = String(value) !== String(compareTo);
      break;
    case "contains":
      result = String(value).includes(String(compareTo));
      break;
    case "gt":
      result = Number(value) > Number(compareTo);
      break;
    case "lt":
      result = Number(value) < Number(compareTo);
      break;
    case "is_empty":
      result = value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0);
      break;
    default:
      result = false;
  }

  return { branch: result ? "true" : "false" };
};
