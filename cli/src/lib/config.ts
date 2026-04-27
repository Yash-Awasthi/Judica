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

type ConfigSchema = {
  serverUrl: string;
  token: string;
  defaultPersona: string;
  outputFormat: string;
};

let configInstance: Conf<ConfigSchema> | null = null;

export function getConfig(): Conf<ConfigSchema> {
  if (!configInstance) {
    configInstance = new Conf<ConfigSchema>({
      projectName: "judica",
      schema,
    });
  }
  return configInstance;
}
