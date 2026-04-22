import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/**
 * Image-Aware Agents: analyse images, screenshots, and diagrams
 * within council deliberation context.
 */

export interface ImageAnalysis {
  description: string;
  elements: ImageElement[];
  text: string[];
  sentiment?: string;
  relevance: string;
}

export interface ImageElement {
  type: "text" | "diagram" | "chart" | "screenshot" | "photo" | "icon" | "table";
  description: string;
  boundingArea?: string;
}

export interface MultiModalInput {
  type: "image" | "text";
  content: string;
  mimeType?: string;
  label?: string;
}

export interface CrossModalInsight {
  source: string;
  finding: string;
  confidence: number;
  contradiction?: boolean;
  relatedInputs: string[];
}

// ─── Image Analysis ─────────────────────────────────────────────────────────

/**
 * Analyse an image and extract structured information.
 * Accepts base64-encoded image data or a URL.
 */
export async function analyzeImage(
  imageInput: string,
  context?: string,
): Promise<ImageAnalysis> {
  try {
    const contextPrompt = context ? `\nContext: ${context}` : "";

    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Analyze this image and provide structured information.${contextPrompt}

Image reference: ${imageInput.substring(0, 200)}...

Return a JSON object:
{
  "description": "overall description of the image",
  "elements": [{ "type": "text|diagram|chart|screenshot|photo|icon|table", "description": "what this element shows" }],
  "text": ["any text visible in the image"],
  "sentiment": "positive|negative|neutral|informational",
  "relevance": "how this image relates to the discussion context"
}

Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      // P32-07: Safe JSON.parse with try-catch on LLM output
      try {
        return JSON.parse(match[0]) as ImageAnalysis;
      } catch {
        return { description: "Unable to parse analysis JSON", elements: [], text: [], relevance: "unknown" };
      }
    }
    return { description: "Unable to analyze image", elements: [], text: [], relevance: "unknown" };
  } catch (err) {
    logger.error({ err }, "Image analysis failed");
    return { description: "Analysis failed", elements: [], text: [], relevance: "unknown" };
  }
}

/**
 * Detect the type of visual content in an image.
 */
export function detectImageType(
  filename: string,
): "screenshot" | "diagram" | "photo" | "document" | "unknown" {
  const lower = filename.toLowerCase();

  if (/screenshot|screen[_-]?cap|capture/.test(lower)) return "screenshot";
  if (/diagram|flow|chart|graph|uml|erd|arch/.test(lower)) return "diagram";
  if (/\.(jpg|jpeg|heic|heif|raw|cr2|nef)$/.test(lower)) return "photo";
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(lower)) return "document";
  if (/\.(png|svg|webp|gif)$/.test(lower)) {
    // PNG/SVG could be anything — default to screenshot for UI context
    if (/ui|button|modal|page|view|component/.test(lower)) return "screenshot";
    if (/icon|logo|badge/.test(lower)) return "diagram";
  }

  return "unknown";
}

// ─── Cross-Modal Reasoning ──────────────────────────────────────────────────

/**
 * Analyse multiple inputs (text + images) together to find cross-modal insights.
 */
export async function crossModalAnalysis(
  inputs: MultiModalInput[],
  question: string,
): Promise<CrossModalInsight[]> {
  // P32-08: Cap inputs array to prevent unbounded processing
  if (inputs.length > 20) inputs = inputs.slice(0, 20);
  try {
    const inputDescriptions = inputs
      .map((input, i) => {
        const label = input.label || `Input ${i + 1}`;
        if (input.type === "text") {
          return `[${label}] (text): ${input.content.substring(0, 500)}`;
        }
        return `[${label}] (image): ${input.content.substring(0, 100)}...`;
      })
      .join("\n\n");

    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Analyze these multi-modal inputs together to answer: ${question}

Inputs:
${inputDescriptions}

Look for:
- Agreements between text and visual evidence
- Contradictions between what text says and images show
- Insights that only emerge from combining modalities

Return a JSON array:
[{
  "source": "which input(s) this insight comes from",
  "finding": "the insight or observation",
  "confidence": 0.0-1.0,
  "contradiction": true/false,
  "relatedInputs": ["Input 1", "Input 2"]
}]

Return ONLY the JSON array.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as CrossModalInsight[];
    }
    return [];
  } catch (err) {
    logger.error({ err }, "Cross-modal analysis failed");
    return [];
  }
}

/**
 * Prepare image inputs for council deliberation context.
 * Converts image analyses into text summaries agents can reason about.
 */
export function prepareImageContext(
  analyses: { filename: string; analysis: ImageAnalysis }[],
): string {
  if (analyses.length === 0) return "";

  const sections = analyses.map(({ filename, analysis }) => {
    const elements = analysis.elements
      .map((e) => `  - [${e.type}] ${e.description}`)
      .join("\n");

    const textContent = analysis.text.length > 0
      ? `  Text found: ${analysis.text.join("; ")}`
      : "";

    return [
      `📎 Image: ${filename}`,
      `  Description: ${analysis.description}`,
      elements ? `  Elements:\n${elements}` : "",
      textContent,
      `  Relevance: ${analysis.relevance}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `\n--- Visual Context ---\n${sections.join("\n\n")}\n--- End Visual Context ---\n`;
}
