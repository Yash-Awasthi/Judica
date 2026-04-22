import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { AuthProvider } from "~/context/AuthContext";
import { ThemeProvider } from "~/context/ThemeContext";
import { Toaster } from "~/components/ui/sonner";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export function meta() {
  return [
    { title: "aibyai - AI Deliberation Platform" },
    {
      name: "description",
      content:
        "Multi-agent AI deliberation platform for teams. Orchestrate AI conversations, workflows, and knowledge.",
    },
    { property: "og:title", content: "aibyai - AI Deliberation Platform" },
    {
      property: "og:description",
      content:
        "Multi-agent AI deliberation platform for teams. Orchestrate AI conversations, workflows, and knowledge.",
    },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: "aibyai - AI Deliberation Platform" },
    {
      name: "twitter:description",
      content:
        "Multi-agent AI deliberation platform for teams.",
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster position="bottom-right" />
          </AuthProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (error && error instanceof Error) {
    details = error.message;
    stack = import.meta.env.DEV ? error.stack : undefined;
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-background text-foreground">
      <h1 className="text-4xl font-bold mb-2">{message}</h1>
      <p className="text-muted-foreground mb-4">{details}</p>
      {stack && (
        <pre className="w-full max-w-2xl p-4 overflow-x-auto rounded-lg bg-muted text-sm">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
