/**
 * Demo URL / video configuration.
 * Provides a demo endpoint and metadata for project showcase.
 */

export interface DemoConfig {
  url: string;
  videoUrl?: string;
  description: string;
  features: string[];
  lastUpdated: string;
}

/**
 * Default demo configuration for the aibyai project.
 * Populate the DEMO_URL environment variable to enable.
 */
export function getDemoConfig(): DemoConfig {
  return {
    url: process.env.DEMO_URL || "https://aibyai.example.com",
    videoUrl: process.env.DEMO_VIDEO_URL || undefined,
    description: "AI Council - Multi-agent deliberation platform with streaming verdicts",
    features: [
      "Multi-provider LLM support (OpenAI, Anthropic, Gemini, Groq, Ollama)",
      "Real-time streaming deliberation with archetype-based agents",
      "Knowledge base with vector search (pgvector + hierarchical chunking)",
      "Workflow editor with DAG-based execution engine",
      "Background agents with checkpoint/resume",
      "Marketplace for sharing prompts, workflows, and agents",
    ],
    lastUpdated: new Date().toISOString().split("T")[0],
  };
}

/**
 * Format demo metadata for README or API response.
 */
export function formatDemoSection(config: DemoConfig): string {
  // Escape markdown special characters in URLs to prevent injection
  // Fix CodeQL alert #66: Escape all markdown special chars, not just brackets/parens
  const escMd = (s: string) => s.replace(/[[\]()\\`*_{}#|!~>+-]/g, "\\$&");
  let output = `## Demo\n\n`;
  output += `**Live:** [${escMd(config.url)}](${escMd(config.url)})\n\n`;
  if (config.videoUrl) {
    output += `**Video walkthrough:** [Watch demo](${escMd(config.videoUrl)})\n\n`;
  }
  output += `${config.description}\n\n### Features\n\n`;
  output += config.features.map((f) => `- ${f}`).join("\n");
  return output;
}
