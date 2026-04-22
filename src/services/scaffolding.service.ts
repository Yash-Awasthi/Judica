import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/**
 * Full-stack Scaffolding Engine: generates project structures,
 * components, API endpoints, and database schemas from natural language.
 */

export type LayerType = "frontend" | "backend" | "database" | "config";

export interface ScaffoldFile {
  path: string;
  content: string;
  layer: LayerType;
  description: string;
}

export interface ScaffoldSchema {
  tables: SchemaTable[];
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  references?: { table: string; column: string };
}

export interface ScaffoldResult {
  projectName: string;
  description: string;
  files: ScaffoldFile[];
  schema: ScaffoldSchema;
  dependencies: { production: string[]; development: string[] };
  setupInstructions: string[];
}

// ─── Schema Generation ──────────────────────────────────────────────────────

/**
 * Generate database schema from a natural language description.
 */
export async function generateSchema(description: string): Promise<ScaffoldSchema> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Design a PostgreSQL database schema for this application:

${description}

Return a JSON object:
{
  "tables": [{
    "name": "table_name",
    "columns": [{
      "name": "column_name",
      "type": "text|integer|boolean|timestamp|uuid|jsonb|varchar(N)|serial",
      "nullable": false,
      "primaryKey": true,
      "references": { "table": "other_table", "column": "id" }
    }]
  }]
}

Include standard columns (id, createdAt, updatedAt). Use uuid for primary keys.
Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as ScaffoldSchema;
    }
    return { tables: [] };
  } catch (err) {
    logger.error({ err }, "Schema generation failed");
    return { tables: [] };
  }
}

/**
 * Format schema tables as a Drizzle ORM schema file.
 */
export function formatDrizzleSchema(schema: ScaffoldSchema): string {
  const typeMap: Record<string, string> = {
    text: "text",
    integer: "integer",
    boolean: "boolean",
    timestamp: 'timestamp("$COL", { mode: "date" })',
    uuid: "uuid",
    jsonb: "jsonb",
    serial: "serial",
  };

  const lines: string[] = [
    'import { pgTable, text, integer, boolean, timestamp, uuid, jsonb, serial } from "drizzle-orm/pg-core";',
    "",
  ];

  for (const table of schema.tables) {
    lines.push(`export const ${table.name} = pgTable("${table.name}", {`);
    for (const col of table.columns) {
      let typeFn = typeMap[col.type] || `text`;
      if (typeFn.includes("$COL")) {
        typeFn = typeFn.replace("$COL", col.name);
      } else {
        typeFn = `${typeFn}("${col.name}")`;
      }

      const modifiers: string[] = [];
      if (col.primaryKey) modifiers.push(".primaryKey()");
      if (!col.nullable) modifiers.push(".notNull()");
      if (col.type === "uuid" && col.primaryKey) modifiers.push('.default(sql`gen_random_uuid()`)');

      lines.push(`  ${col.name}: ${typeFn}${modifiers.join("")},`);
    }
    lines.push(`});`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── File Scaffolding ───────────────────────────────────────────────────────

/**
 * Generate project files from a natural language description.
 */
export async function generateFiles(
  description: string,
  schema: ScaffoldSchema,
  stack: string = "typescript + fastify + drizzle + react",
): Promise<ScaffoldFile[]> {
  try {
    const schemaContext = schema.tables.length > 0
      ? `\nDatabase tables: ${schema.tables.map((t) => t.name).join(", ")}`
      : "";

    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Generate the key files for this application using ${stack}:

${description}${schemaContext}

Return a JSON array of files:
[{
  "path": "src/routes/users.ts",
  "content": "// full file content here",
  "layer": "frontend|backend|database|config",
  "description": "what this file does"
}]

Generate only the most important files (max 10). Include:
- API route handlers (backend)
- React components for the main views (frontend)
- Config files (tsconfig, package.json basics)

Return ONLY the JSON array.`,
        },
      ],
      temperature: 0.2,
    });

    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as ScaffoldFile[];
    }
    return [];
  } catch (err) {
    logger.error({ err }, "File generation failed");
    return [];
  }
}

// ─── Full Scaffold Pipeline ─────────────────────────────────────────────────

/**
 * Full scaffolding pipeline: schema → files → instructions.
 */
export async function scaffoldProject(
  description: string,
  projectName: string,
  stack?: string,
): Promise<ScaffoldResult> {
  logger.info({ projectName, descLength: description.length }, "Starting project scaffolding");

  // Validate project name to prevent command injection in setup instructions
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectName)) {
    throw new Error("Invalid project name: must contain only letters, numbers, hyphens, and underscores (max 64 chars)");
  }

  // Step 1: Generate schema
  const schema = await generateSchema(description);

  // Step 2: Generate files (pass schema for context)
  const files = await generateFiles(description, schema, stack);

  // Add the Drizzle schema file if we have tables
  if (schema.tables.length > 0) {
    files.push({
      path: "src/db/schema.ts",
      content: formatDrizzleSchema(schema),
      layer: "database",
      description: "Drizzle ORM database schema",
    });
  }

  // Step 3: Infer dependencies from files
  const dependencies = inferDependencies(files);

  // Step 4: Generate setup instructions
  const setupInstructions = generateSetupInstructions(projectName, schema, dependencies);

  logger.info(
    { projectName, fileCount: files.length, tableCount: schema.tables.length },
    "Scaffolding complete",
  );

  return {
    projectName,
    description,
    files,
    schema,
    dependencies,
    setupInstructions,
  };
}

/**
 * Infer package dependencies from generated files.
 */
export function inferDependencies(
  files: ScaffoldFile[],
): { production: string[]; development: string[] } {
  const production = new Set<string>();
  const development = new Set<string>();

  const allContent = files.map((f) => f.content).join("\n");

  // Detect common imports
  const depPatterns: [RegExp, string, boolean][] = [
    [/from ["']fastify["']/, "fastify", false],
    [/from ["']react["']/, "react", false],
    [/from ["']drizzle-orm/, "drizzle-orm", false],
    [/from ["']@fastify\/cors["']/, "@fastify/cors", false],
    [/from ["']zod["']/, "zod", false],
    [/from ["']postgres["']/, "postgres", false],
    [/from ["']bcrypt["']/, "bcrypt", false],
    [/from ["']jsonwebtoken["']/, "jsonwebtoken", false],
    [/from ["']vitest["']/, "vitest", true],
    [/from ["']typescript["']/, "typescript", true],
    [/from ["']@types\//, "@types/node", true],
  ];

  for (const [pattern, dep, isDev] of depPatterns) {
    if (pattern.test(allContent)) {
      if (isDev) development.add(dep);
      else production.add(dep);
    }
  }

  // Always add TypeScript for TS projects
  development.add("typescript");

  return {
    production: [...production].sort(),
    development: [...development].sort(),
  };
}

/**
 * Generate setup instructions.
 */
function generateSetupInstructions(
  projectName: string,
  schema: ScaffoldSchema,
  deps: { production: string[]; development: string[] },
): string[] {
  // Double-check project name is safe for shell commands
  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');

  const steps: string[] = [
    `mkdir ${safeName} && cd ${safeName}`,
    `npm init -y`,
  ];

  if (deps.production.length > 0) {
    steps.push(`npm install ${deps.production.join(" ")}`);
  }
  if (deps.development.length > 0) {
    steps.push(`npm install -D ${deps.development.join(" ")}`);
  }

  if (schema.tables.length > 0) {
    steps.push(`# Set up PostgreSQL database`);
    steps.push(`createdb ${safeName}`);
    steps.push(`npx drizzle-kit generate`);
    steps.push(`npx drizzle-kit migrate`);
  }

  steps.push(`npx tsc --noEmit`);
  steps.push(`npm run dev`);

  return steps;
}
