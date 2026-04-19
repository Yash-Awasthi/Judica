import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./layouts/RootLayout";
import { ViewSkeleton } from "./components/ViewSkeleton";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { Settings } from "./components/Settings";
import { Link } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Lazy-loaded views
const ChatView = lazy(() => import("./views/ChatView").then(m => ({ default: m.ChatView })));
const DashboardView = lazy(() => import("./views/DashboardView").then(m => ({ default: m.DashboardView })));
const MetricsView = lazy(() => import("./views/MetricsView").then(m => ({ default: m.MetricsView })));
const WorkflowsView = lazy(() => import("./views/WorkflowsView").then(m => ({ default: m.WorkflowsView })));
const WorkflowEditorView = lazy(() => import("./views/WorkflowEditorView").then(m => ({ default: m.WorkflowEditorView })));
const PromptIDEView = lazy(() => import("./views/PromptIDEView").then(m => ({ default: m.PromptIDEView })));
const MemorySettingsView = lazy(() => import("./views/MemorySettingsView").then(m => ({ default: m.MemorySettingsView })));
const DebateDashboardView = lazy(() => import("./views/DebateDashboardView").then(m => ({ default: m.DebateDashboardView })));
const AdminView = lazy(() => import("./views/AdminView").then(m => ({ default: m.AdminView })));
const AnalyticsView = lazy(() => import("./views/AnalyticsView").then(m => ({ default: m.AnalyticsView })));
const MarketplaceView = lazy(() => import("./views/MarketplaceView").then(m => ({ default: m.MarketplaceView })));
const SkillsView = lazy(() => import("./views/SkillsView").then(m => ({ default: m.SkillsView })));
const ReposView = lazy(() => import("./views/ReposView").then(m => ({ default: m.ReposView })));
const EvaluationView = lazy(() => import("./views/EvaluationView").then(m => ({ default: m.EvaluationView })));
const TrainingLabView = lazy(() => import("./views/TrainingLabView").then(m => ({ default: m.TrainingLabView })));
const ArchetypesView = lazy(() => import("./views/ArchetypesView").then(m => ({ default: m.ArchetypesView })));
const WorkspaceRolesView = lazy(() => import("./views/WorkspaceRolesView").then(m => ({ default: m.WorkspaceRolesView })));
const ProjectsView = lazy(() => import("./views/ProjectsView"));

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
      { 
        index: true, 
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <DashboardView />
            </Suspense>
          </RouteErrorBoundary>
        ) 
      },
      { 
        path: "chat", 
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ChatView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "projects",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ProjectsView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "debate",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <DebateDashboardView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "chat/:conversationId",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ChatView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "metrics",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <MetricsView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "workflows",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <WorkflowsView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "workflows/new",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <WorkflowEditorView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "workflows/:id",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <WorkflowEditorView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "prompts",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <PromptIDEView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "memory",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <MemorySettingsView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "admin",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ProtectedRoute requireAdmin>
                <AdminView />
              </ProtectedRoute>
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "analytics",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ProtectedRoute requireAdmin>
                <AnalyticsView />
              </ProtectedRoute>
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "marketplace",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <MarketplaceView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "skills",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <SkillsView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "repos",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ReposView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "benchmarks",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <EvaluationView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "training",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <TrainingLabView />
            </Suspense>
          </RouteErrorBoundary>
        ) 
      },
      {
        path: "workspace",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ProtectedRoute requireAdmin>
                <WorkspaceRolesView />
              </ProtectedRoute>
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      {
        path: "archetypes",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
              <ArchetypesView />
            </Suspense>
          </RouteErrorBoundary>
        )
      },
      { path: "settings", element: <Settings /> },
      { path: "*", element: <NotFoundView /> },
    ],
  },
]);
