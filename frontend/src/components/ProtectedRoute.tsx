import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ViewSkeleton } from "./ViewSkeleton";

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, role, token } = useAuth();

  // If we have a user but no token yet, we might be refreshing
  if (user && !token) {
    return <ViewSkeleton />;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
