import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "AIBYAI API",
      version: "1.0.0",
      description:
        "Multimodal Multi-Agent Deliberative Intelligence Platform — 4+ AI agents debate, critique, and synthesize answers through structured deliberation.",
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
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        HealthCheck: {
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            uptime: { type: "number", example: 3600 },
            env: { type: "string", example: "production" },
            checks: {
              type: "object",
              properties: {
                database: { type: "string", example: "ok" },
                redis: { type: "string", example: "ok" },
              },
            },
            providers: {
              type: "array",
              items: { type: "string" },
              example: ["openai", "anthropic", "gemini"],
            },
            version: { type: "string", example: "1.0.0" },
          },
        },
      },
    },
    tags: [
      { name: "Health", description: "System health checks" },
      { name: "Auth", description: "Authentication & OAuth2" },
      { name: "Council", description: "Multi-agent deliberation" },
      { name: "History", description: "Conversation history" },
      { name: "Knowledge Bases", description: "RAG knowledge base management" },
      { name: "Uploads", description: "File upload & processing" },
      { name: "Research", description: "Deep research jobs" },
      { name: "Repositories", description: "GitHub repository indexing" },
      { name: "Workflows", description: "Visual workflow engine" },
      { name: "Prompts", description: "Prompt templates & versioning" },
      { name: "Marketplace", description: "Community marketplace" },
      { name: "Skills", description: "User-defined Python tools" },
      { name: "Sandbox", description: "Code execution sandbox" },
      { name: "Personas", description: "Agent personas & Prompt DNA" },
      { name: "Analytics", description: "Usage analytics & traces" },
      { name: "Queue", description: "BullMQ job management" },
      { name: "Admin", description: "Administration & RBAC" },
      { name: "Sharing", description: "Conversation sharing" },
      { name: "Export", description: "Data export" },
      { name: "Providers", description: "LLM provider management" },
      { name: "Templates", description: "Council templates" },
      { name: "Memory", description: "Memory backend configuration" },
    ],
  },
  apis: ["./src/routes/*.ts", "./src/routes/*.js", "./dist/routes/*.js"],
};

export const swaggerSpec = swaggerJsdoc(options);
