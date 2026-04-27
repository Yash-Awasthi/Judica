/**
 * MCP Tool Definitions — tools exposed by the judica MCP server.
 *
 * These allow external AI agents (Claude Desktop, Cursor, etc.) to:
 * - Search the knowledge base (hybrid, vector, keyword)
 * - Manage documents and knowledge bases
 * - Query the council (multi-model deliberation)
 * - Access conversation history
 */

import type { MCPToolDefinition } from "./models.js";

// ─── Search Tools ────────────────────────────────────────────────────────────

export const SEARCH_TOOL: MCPToolDefinition = {
  name: "judica_search",
  description:
    "Search the judica knowledge base using hybrid search (vector + keyword). " +
    "Returns relevant document chunks with source attribution.",
  parameters: [
    {
      name: "query",
      description: "The search query",
      type: "string",
      required: true,
    },
    {
      name: "kb_id",
      description: "Knowledge base ID to search within. Omit to search all.",
      type: "string",
      required: false,
    },
    {
      name: "limit",
      description: "Maximum number of results (default: 5, max: 20)",
      type: "number",
      required: false,
      default: 5,
    },
    {
      name: "search_type",
      description: "Search strategy to use",
      type: "string",
      required: false,
      default: "hybrid",
      enum: ["hybrid", "vector", "keyword", "hyde"],
    },
  ],
};

// ─── Knowledge Base Tools ────────────────────────────────────────────────────

export const LIST_KNOWLEDGE_BASES_TOOL: MCPToolDefinition = {
  name: "judica_list_knowledge_bases",
  description: "List all available knowledge bases with their document counts.",
  parameters: [],
};

export const GET_DOCUMENT_TOOL: MCPToolDefinition = {
  name: "judica_get_document",
  description: "Get the full content of a specific document from a knowledge base.",
  parameters: [
    {
      name: "kb_id",
      description: "Knowledge base ID",
      type: "string",
      required: true,
    },
    {
      name: "document_name",
      description: "Name/title of the document",
      type: "string",
      required: true,
    },
  ],
};

export const INGEST_DOCUMENT_TOOL: MCPToolDefinition = {
  name: "judica_ingest_document",
  description:
    "Add a new document to a knowledge base. Supports plain text content.",
  parameters: [
    {
      name: "kb_id",
      description: "Knowledge base ID to add the document to",
      type: "string",
      required: true,
    },
    {
      name: "title",
      description: "Document title",
      type: "string",
      required: true,
    },
    {
      name: "content",
      description: "Document content (plain text)",
      type: "string",
      required: true,
    },
    {
      name: "source_url",
      description: "Optional source URL for attribution",
      type: "string",
      required: false,
    },
  ],
};

// ─── Council / Chat Tools ────────────────────────────────────────────────────

export const ASK_COUNCIL_TOOL: MCPToolDefinition = {
  name: "judica_ask",
  description:
    "Ask a question to the judica council (multi-model deliberation). " +
    "Returns a synthesized answer from multiple AI models with source citations.",
  parameters: [
    {
      name: "question",
      description: "The question to ask",
      type: "string",
      required: true,
    },
    {
      name: "kb_id",
      description: "Knowledge base to ground the answer in (optional)",
      type: "string",
      required: false,
    },
    {
      name: "include_sources",
      description: "Whether to include source citations (default: true)",
      type: "boolean",
      required: false,
      default: true,
    },
  ],
};

// ─── History Tools ───────────────────────────────────────────────────────────

export const LIST_CONVERSATIONS_TOOL: MCPToolDefinition = {
  name: "judica_list_conversations",
  description: "List recent conversations with the judica council.",
  parameters: [
    {
      name: "limit",
      description: "Maximum number of conversations (default: 10)",
      type: "number",
      required: false,
      default: 10,
    },
  ],
};

export const GET_CONVERSATION_TOOL: MCPToolDefinition = {
  name: "judica_get_conversation",
  description: "Get the full message history of a specific conversation.",
  parameters: [
    {
      name: "conversation_id",
      description: "Conversation ID",
      type: "string",
      required: true,
    },
  ],
};

// ─── All Tools ───────────────────────────────────────────────────────────────

export const ALL_MCP_TOOLS: MCPToolDefinition[] = [
  SEARCH_TOOL,
  LIST_KNOWLEDGE_BASES_TOOL,
  GET_DOCUMENT_TOOL,
  INGEST_DOCUMENT_TOOL,
  ASK_COUNCIL_TOOL,
  LIST_CONVERSATIONS_TOOL,
  GET_CONVERSATION_TOOL,
];
