import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./layouts/RootLayout";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { MetricsView } from "./views/MetricsView";
import { WorkflowsView } from "./views/WorkflowsView";
import { WorkflowEditorView } from "./views/WorkflowEditorView";
import { PromptIDEView } from "./views/PromptIDEView";
import { MemorySettingsView } from "./views/MemorySettingsView";
import { DebateDashboardView } from "./views/DebateDashboardView";
import { AdminView } from "./views/AdminView";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <DashboardView /> },
      { path: "chat", element: <ChatView /> },
      { path: "debate", element: <DebateDashboardView /> },
      { path: "chat/:conversationId", element: <ChatView /> },
      { path: "metrics", element: <MetricsView /> },
      { path: "workflows", element: <WorkflowsView /> },
      { path: "workflows/new", element: <WorkflowEditorView /> },
      { path: "workflows/:id", element: <WorkflowEditorView /> },
      { path: "prompts", element: <PromptIDEView /> },
      { path: "memory", element: <MemorySettingsView /> },
      { path: "admin", element: <AdminView /> },
    ],
  },
]);
