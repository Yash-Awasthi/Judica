import { Dashboard } from "../components/Dashboard";
import { useNavigate } from "react-router-dom";

export function DashboardView() {
  const navigate = useNavigate();

  const handleSelectTemplate = (summon: string) => {
    navigate(`/chat?summon=${summon}`);
  };

  return <Dashboard onSelectTemplate={handleSelectTemplate} />;
}
