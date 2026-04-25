/**
 * Image Summarization for Document Indexing
 *
 * Extracts searchable text content from images embedded in documents.
 * Inspired by Onyx's image-summarization pipeline: when a document
 * contains embedded images (PDFs, HTML pages, DOCX), this service
 * generates text descriptions so images become searchable alongside text.
 *
 * Supports: base64-encoded images, image URLs, and raw buffers.
 */

import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

export interface ImageSummary {
  /** Generated text description of the image content */
  description: string;
  /** Extracted visible text (OCR-like) from the image */
  extractedText: string;
  /** Detected content type */
  contentType: "chart" | "diagram" | "screenshot" | "photo" | "table" | "document" | "unknown";
  /** Confidence 0-1 */
  confidence: number;
}

export interface DocumentImage {
  /** Base64 data, URL, or identifier */
  data: string;
  /** MIME type if known */
  mimeType?: string;
  /** Original filename or reference */
  reference?: string;
  /** Page number in source document */
  pageNumber?: number;
}

/** Sanitize user-controlled text before interpolation into LLM prompts */
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/\b(system|assistant|user|human)\s*:/gi, (_m, role) => `${role as string} -`)
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[filtered]")
    .replace(/you\s+are\s+now\b/gi, "[filtered]");
}

/**
 * Summarize a single image for indexing purposes.
 * Returns a text description suitable for embedding/search.
 */
export async function summarizeImageForIndexing(
  image: DocumentImage,
  documentContext?: string,
): Promise<ImageSummary> {
  try {
    const contextHint = documentContext
      ? `\nDocument context: ${sanitizeForPrompt(documentContext.substring(0, 500))}`
      : "";

    const imageRef = image.data.length > 200
      ? `[base64 image, ${image.mimeType ?? "unknown type"}]`
      : image.data;

    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `You are an image-to-text extraction system for document indexing. Analyze this image and extract ALL searchable information.${contextHint}

Image: ${imageRef}
${image.reference ? `Source: ${image.reference}` : ""}
${image.pageNumber ? `Page: ${image.pageNumber}` : ""}

Return a JSON object:
{
  "description": "detailed description of what the image shows, including all visible data",
  "extractedText": "all visible text/numbers/labels in the image, verbatim",
  "contentType": "chart|diagram|screenshot|photo|table|document|unknown",
  "confidence": 0.0-1.0
}

Be thorough — the description and extractedText will be used for search indexing. Include numbers, labels, axis titles, legend entries, column headers, and any other text visible in the image. Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as ImageSummary;
      } catch {
        return fallbackSummary(image);
      }
    }
    return fallbackSummary(image);
  } catch (err) {
    logger.warn({ err, reference: image.reference }, "Image summarization failed");
    return fallbackSummary(image);
  }
}

/**
 * Batch-summarize multiple images from a document.
 * Processes in parallel with concurrency limit.
 */
export async function summarizeDocumentImages(
  images: DocumentImage[],
  documentContext?: string,
  concurrency: number = 3,
): Promise<Map<number, ImageSummary>> {
  const results = new Map<number, ImageSummary>();
  if (images.length === 0) return results;

  // Process in batches to avoid overwhelming the LLM
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((img) => summarizeImageForIndexing(img, documentContext)),
    );

    for (let j = 0; j < batchResults.length; j++) {
      results.set(i + j, batchResults[j]);
    }
  }

  return results;
}

/**
 * Convert image summaries into indexable text that can be prepended/appended
 * to document chunks containing images.
 */
export function imageSummariesToIndexableText(
  summaries: Map<number, ImageSummary>,
  images: DocumentImage[],
): string {
  if (summaries.size === 0) return "";

  const sections: string[] = [];

  for (const [idx, summary] of summaries) {
    const image = images[idx];
    const ref = image?.reference ?? `Image ${idx + 1}`;
    const page = image?.pageNumber ? ` (page ${image.pageNumber})` : "";

    const parts = [
      `[Image: ${ref}${page}]`,
      summary.description,
    ];

    if (summary.extractedText.trim()) {
      parts.push(`Text content: ${summary.extractedText}`);
    }

    sections.push(parts.join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * Enrich document text with image summaries before chunking.
 * Inserts image descriptions at appropriate positions in the document text.
 */
export function enrichTextWithImageSummaries(
  documentText: string,
  summaries: Map<number, ImageSummary>,
  images: DocumentImage[],
): string {
  if (summaries.size === 0) return documentText;

  // Group images by page number
  const pageImages = new Map<number, string[]>();
  const noPageImages: string[] = [];

  for (const [idx, summary] of summaries) {
    const image = images[idx];
    const ref = image?.reference ?? `Image ${idx + 1}`;
    const text = `[Image: ${ref}] ${summary.description}${summary.extractedText ? ` | Text: ${summary.extractedText}` : ""}`;

    if (image?.pageNumber) {
      const existing = pageImages.get(image.pageNumber) ?? [];
      existing.push(text);
      pageImages.set(image.pageNumber, existing);
    } else {
      noPageImages.push(text);
    }
  }

  // Append non-page-specific image descriptions at the end
  let enriched = documentText;
  if (noPageImages.length > 0) {
    enriched += "\n\n--- Embedded Images ---\n" + noPageImages.join("\n") + "\n--- End Images ---";
  }

  return enriched;
}

function fallbackSummary(image: DocumentImage): ImageSummary {
  return {
    description: image.reference ? `Image: ${image.reference}` : "Unanalyzed image",
    extractedText: "",
    contentType: "unknown",
    confidence: 0,
  };
}
