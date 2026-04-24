import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

/**
 * Register @fastify/swagger + @fastify/swagger-ui.
 *
 * OpenAPI spec is generated directly from Fastify route schemas.
 * Available in all environments. In production, access is gated by
 * the ENABLE_API_DOCS env var (default: true).
 */
export async function registerSwagger(fastify: FastifyInstance): Promise<void> {
  await fastify.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "AIBYAI API",
        version: "1.0.0",
        description:
          "Multimodal Multi-Agent Deliberative Intelligence Platform — 4+ AI agents debate, critique, and synthesize answers through structured deliberation.",
        contact: {
          name: "AIBYAI",
          url: "https://github.com/Yash-Awasthi/aibyai",
        },
        license: {
          name: "ISC",
          url: "https://github.com/Yash-Awasthi/aibyai/blob/main/LICENSE",
        },
      },
      servers: [
        { url: "/", description: "Current server" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT token from /api/auth/login",
          },
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "Authorization",
            description: "Personal Access Token (format: Bearer aib_<token>)",
          },
        },
      },
      tags: [
        // Core
        { name: "Health", description: "System health & readiness probes" },
        { name: "Auth", description: "Authentication, OAuth2, SSO & registration" },
        { name: "Admin", description: "Administration, RBAC & user management" },
        // AI / Deliberation
        { name: "Ask", description: "Query submission & AI responses" },
        { name: "Council", description: "Multi-agent deliberation orchestration" },
        { name: "Deliberations", description: "Deliberation history & consensus explainability" },
        { name: "Research", description: "Deep multi-step research jobs" },
        // Knowledge & Retrieval
        { name: "Knowledge Bases", description: "RAG knowledge base management" },
        { name: "Document Sets", description: "Scoped document collections" },
        { name: "Standard Answers", description: "Pre-computed FAQ responses" },
        { name: "Connectors", description: "Data source connectors & sync" },
        { name: "Uploads", description: "File upload & processing pipeline" },
        { name: "Repositories", description: "GitHub repository indexing" },
        // Content Generation
        { name: "Images", description: "Multi-provider AI image generation" },
        { name: "Voice", description: "TTS & STT multi-provider voice I/O" },
        { name: "TTS", description: "Text-to-speech synthesis" },
        { name: "Artifacts", description: "Generated artifact storage & streaming" },
        // Configuration & Tools
        { name: "Providers", description: "LLM provider management" },
        { name: "Custom Providers", description: "Custom/self-hosted LLM endpoints" },
        { name: "Workflows", description: "Visual workflow engine" },
        { name: "Prompts", description: "Prompt templates & versioning" },
        { name: "Prompt DNA", description: "Prompt analysis & optimization" },
        { name: "Personas", description: "Agent persona profiles" },
        { name: "Skills", description: "User-defined tools & extensions" },
        { name: "Marketplace", description: "Community plugin marketplace" },
        { name: "Templates", description: "Council composition templates" },
        // User Features
        { name: "History", description: "Conversation history" },
        { name: "Memory", description: "Memory backend & retrieval config" },
        { name: "Sharing", description: "Conversation sharing & collaboration" },
        { name: "Export", description: "Data export (JSON, CSV, PDF)" },
        { name: "Notifications", description: "In-app & email notifications" },
        // Sandbox & Execution
        { name: "Sandbox", description: "Isolated code execution environment" },
        // Enterprise & Security
        { name: "SCIM", description: "SCIM 2.0 user provisioning (RFC 7644)" },
        { name: "Tokens", description: "Personal Access Token management" },
        { name: "Rate Limits", description: "Tiered rate limit configuration" },
        { name: "Feature Flags", description: "Feature flag evaluation & management" },
        { name: "User Groups", description: "Group-based access control" },
        { name: "SSO", description: "SAML & OIDC single sign-on" },
        { name: "PII", description: "PII detection & redaction" },
        // Integrations
        { name: "Discord", description: "Discord bot integration" },
        { name: "Slack", description: "Slack bot integration" },
        // Observability
        { name: "Analytics", description: "Usage analytics & dashboards" },
        { name: "Traces", description: "Distributed tracing & debugging" },
        { name: "Metrics", description: "Prometheus metrics" },
        { name: "Costs", description: "LLM cost tracking & analysis" },
        { name: "Usage", description: "API usage statistics" },
        { name: "Queue", description: "BullMQ job management" },
        { name: "Provider Health", description: "LLM provider health probes" },
        // Widget
        { name: "Widget", description: "Embeddable chat widget bundle & configuration" },
        // Search
        { name: "Web Search", description: "Multi-provider web search (Tavily, Serper, Brave, Google PSE, SearXNG)" },
        // Projects
        { name: "Projects", description: "Project & workspace management" },
        { name: "Evaluation", description: "RAG evaluation & benchmarks" },
      ],
      security: [
        { bearerAuth: [] },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      filter: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
    uiHooks: {
      onRequest: (_request, _reply, next) => { next(); },
      preHandler: (_request, _reply, next) => { next(); },
    },
  });
}
