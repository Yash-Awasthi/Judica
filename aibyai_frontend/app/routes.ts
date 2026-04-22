import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  layout("components/layout/AppLayout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("chat", "routes/chat.tsx"),
    route("chat/:conversationId", "routes/chat.tsx", { id: "chat-conversation" }),
    route("projects", "routes/projects.tsx"),
    route("workflows", "routes/workflows.tsx"),
    route("workflows/new", "routes/workflow-editor.tsx", { id: "workflow-new" }),
    route("workflows/:id", "routes/workflow-editor.tsx", { id: "workflow-edit" }),
    route("prompts", "routes/prompts.tsx"),
    route("knowledge-base", "routes/knowledge-base.tsx"),
    route("skills", "routes/skills.tsx"),
    route("repos", "routes/repos.tsx"),
    route("marketplace", "routes/marketplace.tsx"),
    route("analytics", "routes/analytics.tsx"),
    route("admin", "routes/admin.tsx"),
    route("archetypes", "routes/archetypes.tsx"),
    route("evaluation", "routes/evaluation.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig;
