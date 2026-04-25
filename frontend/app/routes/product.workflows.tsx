import type { Route } from "./+types/product.workflows";
import { ProductPage } from "~/components/product-page";
import {
  GitBranch,
  LayoutGrid,
  Waves,
  ShieldCheck,
  DollarSign,
  HeartPulse,
} from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Visual Workflow Builder | AIBYAI" },
    {
      name: "description",
      content:
        "Build complex AI automations with a drag-and-drop DAG editor. 12 node types, wave-based parallel execution, and human-in-the-loop gates.",
    },
  ];
}

export default function ProductWorkflows() {
  return (
    <ProductPage
      badge="Core Feature"
      title="Visual Workflow"
      titleHighlight="Builder"
      subtitle="Build complex AI automations with a drag-and-drop DAG editor. 12 node types, wave-based parallel execution, and human-in-the-loop gates."
      features={[
        {
          icon: GitBranch,
          title: "DAG Editor",
          description:
            "Drag-and-drop directed acyclic graph editor supporting up to 500 nodes and 2000 edges. Visual programming for complex AI pipelines.",
        },
        {
          icon: LayoutGrid,
          title: "12 Node Types",
          description:
            "Conditional branching, loops, LLM calls, code execution, human gates, and more. Everything you need to build sophisticated automations.",
        },
        {
          icon: Waves,
          title: "Wave Execution",
          description:
            "Topological sort groups nodes into parallel batches. Independent branches execute simultaneously for maximum throughput.",
        },
        {
          icon: ShieldCheck,
          title: "Human Gates",
          description:
            "Approval workflow nodes with 5-minute timeout and Redis-persisted state. Keep humans in the loop for critical decisions.",
        },
        {
          icon: DollarSign,
          title: "Budget Enforcement",
          description:
            "Set cost limits per workflow run. Execution stops gracefully when budgets are reached, preventing runaway spending.",
        },
        {
          icon: HeartPulse,
          title: "Self-Healing",
          description:
            "Automatic retry with exponential backoff and intelligent error recovery. Workflows recover from transient failures without intervention.",
        },
      ]}
      howItWorks={[
        {
          step: "1",
          title: "Design",
          description:
            "Drag and drop nodes onto the canvas. Connect them to define your execution flow.",
        },
        {
          step: "2",
          title: "Configure",
          description:
            "Set models, parameters, and approval gates for each node. Define budgets and timeout policies.",
        },
        {
          step: "3",
          title: "Execute",
          description:
            "Run your workflow with real-time streaming. Watch execution progress through each wave in the DAG.",
        },
      ]}
    />
  );
}
