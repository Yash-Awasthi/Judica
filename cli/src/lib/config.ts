/**
 * CLI Configuration — persistent config using conf.
 */

import Conf from "conf";

const schema = {
  serverUrl: {
    type: "string" as const,
    default: "http://localhost:3000",
  },
  token: {
    type: "string" as const,
    default: "",
  },
  defaultPersona: {
    type: "string" as const,
    default: "",
  },
  outputFormat: {
    type: "string" as const,
    enum: ["text", "json", "markdown"],
    default: "text",
  },
};

let configInstance: Conf | null = null;

export function getConfig(): Conf {
  if (!configInstance) {
    configInstance = new Conf({
      projectName: "aibyai",
      schema,
    });
  }
  return configInstance;
}
