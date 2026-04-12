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
import { AnalyticsView } from "./views/AnalyticsView";
import { MarketplaceView } from "./views/MarketplaceView";
import { SkillsView } from "./views/SkillsView";
import { ReposView } from "./views/ReposView";
import { Settings } from "./components/Settings";
import { Link } from "react-router-dom";

function NotFoundView() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4">404</h1>
      <p className="text-[var(--text-muted)] mb-6">Page Not Found</p>
      <Link
        to="/"
        className="px-4 py-2 text-sm font-medium rounded-button bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] transition-colors"
      >
        Go Home
      </Link>
    </div>
  );
}

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
      { path: "analytics", element: <AnalyticsView /> },
      { path: "marketplace", element: <MarketplaceView /> },
      { path: "skills", element: <SkillsView /> },
      { path: "repos", element: <ReposView /> },
      { path: "settings", element: <Settings /> },
      { path: "*", element: <NotFoundView /> },
    ],
  },
]);
