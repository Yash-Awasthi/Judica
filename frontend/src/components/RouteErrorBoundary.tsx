import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Route error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex flex-col items-center justify-center h-full text-center px-4 py-20">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <h2 className="text-lg font-bold text-white/90 mb-2">This view encountered an error</h2>
          <p className="text-white/40 mb-6 max-w-sm text-sm">
            {this.state.error?.message || "Something went wrong loading this page."}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="px-5 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-white/70 text-sm"
            >
              Retry
            </button>
            <Link
              to="/"
              className="px-5 py-2 bg-[var(--accent-mint)] text-black rounded-xl hover:opacity-90 transition-all text-sm font-bold"
            >
              Go Home
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
