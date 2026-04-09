import { Dashboard } from "../components/Dashboard";
import { useNavigate } from "react-router-dom";

export function DashboardView() {
  const navigate = useNavigate();

  return <Dashboard onStartChat={(templateId) => {
    const summon = templateId || "default";
    navigate(`/chat?summon=${summon}`);
  }} />;
}
