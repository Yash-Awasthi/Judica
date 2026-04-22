import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/** Escape special Mermaid characters to prevent syntax breakage */
function sanitizeMermaid(text: string): string {
  return text.replace(/[()[\]{}<>#&;`]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Visual Output Generation: generates Mermaid diagrams,
 * data visualization descriptions, and structured visual content
 * from council deliberation results.
 */

export type DiagramType = "flowchart" | "sequence" | "classDiagram" | "stateDiagram" | "erDiagram" | "gantt" | "pie" | "mindmap";

export interface VisualOutput {
  type: "mermaid" | "chart" | "table";
  content: string;
  title: string;
  description: string;
}

export interface ChartSpec {
  chartType: "bar" | "line" | "pie" | "scatter" | "heatmap";
  title: string;
  data: { labels: string[]; datasets: { label: string; values: number[] }[] };
  description: string;
}

// ─── Mermaid Diagram Generation ─────────────────────────────────────────────

/**
 * Generate a Mermaid diagram from a natural language description.
 */
export async function generateMermaidDiagram(
  description: string,
  diagramType: DiagramType = "flowchart",
): Promise<VisualOutput> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Generate a Mermaid ${diagramType} diagram for:

${description}

Return a JSON object:
{
  "title": "diagram title",
  "content": "the mermaid code (no fences)",
  "description": "what the diagram shows"
}

Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { title: string; content: string; description: string };
      return { type: "mermaid", ...parsed };
    }
    return { type: "mermaid", content: "", title: "", description: "Failed to generate diagram" };
  } catch (err) {
    logger.error({ err, diagramType }, "Mermaid generation failed");
    return { type: "mermaid", content: "", title: "", description: "Generation failed" };
  }
}

/**
 * Auto-detect the best diagram type for a given description.
 */
export function detectDiagramType(description: string): DiagramType {
  const lower = description.toLowerCase();

  if (/\b(flow|process|pipeline|workflow|steps)\b/.test(lower)) return "flowchart";
  if (/\b(sequence|interaction|api call|request|response|message)\b/.test(lower)) return "sequence";
  if (/\b(class|inheritance|interface|abstract|extends)\b/.test(lower)) return "classDiagram";
  if (/\b(state|transition|status|lifecycle)\b/.test(lower)) return "stateDiagram";
  if (/\b(entity|relationship|table|schema|database|foreign key)\b/.test(lower)) return "erDiagram";
  if (/\b(timeline|schedule|gantt|milestone|sprint)\b/.test(lower)) return "gantt";
  if (/\b(percentage|distribution|proportion|breakdown)\b/.test(lower)) return "pie";
  if (/\b(concept|brainstorm|mind\s?map|idea|topic)\b/.test(lower)) return "mindmap";

  return "flowchart";
}

// ─── Chart Generation ───────────────────────────────────────────────────────

/**
 * Generate a chart specification from data and description.
 */
export async function generateChartSpec(
  data: string,
  description: string,
): Promise<ChartSpec | null> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Generate a chart for this data and description:

Description: ${description}
Data: ${data.substring(0, 3000)}

Return a JSON object:
{
  "chartType": "bar|line|pie|scatter|heatmap",
  "title": "chart title",
  "data": {
    "labels": ["label1", "label2"],
    "datasets": [{ "label": "series name", "values": [1, 2] }]
  },
  "description": "what the chart shows"
}

Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as ChartSpec;
    }
    return null;
  } catch (err) {
    logger.error({ err }, "Chart generation failed");
    return null;
  }
}

// ─── Deliberation Visualisation ─────────────────────────────────────────────

/**
 * Generate visual outputs from a deliberation result.
 * Produces relevant diagrams and charts based on the content.
 */
export async function visualizeDeliberation(
  topic: string,
  opinions: { agent: string; position: string; confidence: number }[],
): Promise<VisualOutput[]> {
  const outputs: VisualOutput[] = [];

  // P28-08: Cap opinions array to prevent unbounded output and sanitize topic for Mermaid
  const MAX_OPINIONS = 50;
  const safeOpinions = opinions.slice(0, MAX_OPINIONS);
  const safeTopic = topic.substring(0, 40).replace(/[()]/g, "");

  // 1. Generate a Mermaid mindmap of agent positions
  const mindmapContent = [
    "mindmap",
    `  root((${sanitizeMermaid(topic.substring(0, 40))}))`,
    ...opinions.map((o) => `    ${sanitizeMermaid(o.agent)}\n      ${sanitizeMermaid(o.position.substring(0, 50))}`),
  ].join("\n");

  outputs.push({
    type: "mermaid",
    content: mindmapContent,
    title: `Deliberation: ${topic}`,
    description: "Agent positions in the deliberation",
  });

  // 2. Generate a confidence comparison table
  // P28-09: NaN guard on confidence, use bounded safeOpinions
  const tableRows = safeOpinions
    .map((o) => {
      const conf = Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : 0;
      return `| ${o.agent} | ${o.position.substring(0, 60)} | ${(conf * 100).toFixed(0)}% |`;
    })
    .join("\n");

  const table = `| Agent | Position | Confidence |\n|-------|----------|------------|\n${tableRows}`;

  outputs.push({
    type: "table",
    content: table,
    title: "Agent Confidence Summary",
    description: "Confidence levels for each agent's position",
  });

  return outputs;
}

/**
 * Format visual outputs as markdown for embedding in responses.
 */
export function formatVisualOutputs(outputs: VisualOutput[]): string {
  const sections: string[] = [];

  for (const output of outputs) {
    sections.push(`### ${output.title}`);
    sections.push(``);
    sections.push(`*${output.description}*`);
    sections.push(``);

    if (output.type === "mermaid") {
      sections.push("```mermaid");
      sections.push(output.content);
      sections.push("```");
    } else if (output.type === "table") {
      sections.push(output.content);
    } else {
      sections.push(output.content);
    }

    sections.push(``);
  }

  return sections.join("\n");
}
