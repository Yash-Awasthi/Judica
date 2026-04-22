import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "~/context/AuthContext";

export default function HomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) {
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}
