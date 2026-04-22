import { customType } from "drizzle-orm/pg-core";

export const vector = customType<{
  data: number[];
  driverParam: string;
  config: { dimensions?: number };
}>({
  dataType(config) {
    return config?.dimensions ? `vector(${config.dimensions})` : "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    if (typeof value === "string") {
      const nums = value.replace(/[[\]]/g, "").split(",").map(Number);
      if (nums.some(n => !Number.isFinite(n))) {
        throw new Error("Vector contains non-finite values");
      }
      return nums;
    }
    return value as number[];
  },
});
