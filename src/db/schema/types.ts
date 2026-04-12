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
      return value.replace(/[\[\]]/g, "").split(",").map(Number);
    }
    return value as number[];
  },
});
