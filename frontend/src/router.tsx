import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./layouts/RootLayout";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { MetricsView } from "./views/MetricsView";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <DashboardView /> },
      { path: "chat", element: <ChatView /> },
      { path: "chat/:conversationId", element: <ChatView /> },
      { path: "metrics", element: <MetricsView /> },
    ],
  },
]);
