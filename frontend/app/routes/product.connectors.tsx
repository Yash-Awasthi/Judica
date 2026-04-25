import type { Route } from "./+types/product.connectors";
import { ProductPage } from "~/components/product-page";
import {
  Brain,
  Cloud,
  Gem,
  Server,
  Cpu,
  Database,
} from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "19 LLM Providers & Vector DBs | AIBYAI" },
    {
      name: "description",
      content:
        "Connect to any major AI provider. Circuit breaker protection and automatic failover keep your system running even when providers go down.",
    },
  ];
}

export default function ProductConnectors() {
  return (
    <ProductPage
      badge="Integrations"
      title="19 LLM Providers &"
      titleHighlight="Vector DBs"
      subtitle="Connect to any major AI provider. Circuit breaker protection and automatic failover keep your system running even when providers go down."
      features={[
        {
          icon: Brain,
          title: "OpenAI & Azure OpenAI",
          description:
            "Full support for GPT-4o, GPT-4 Turbo, and all OpenAI models. Azure OpenAI for enterprise deployments with regional compliance.",
        },
        {
          icon: Cloud,
          title: "Anthropic Claude",
          description:
            "Claude 3.5 Sonnet, Opus, and Haiku. Deep integration with Anthropic's safety-first models for thoughtful, nuanced reasoning.",
        },
        {
          icon: Gem,
          title: "Google Gemini",
          description:
            "Gemini Pro and Ultra models. Leverage Google's multimodal capabilities within your deliberation councils.",
        },
        {
          icon: Server,
          title: "Ollama (Local)",
          description:
            "Run models locally with Ollama. Full privacy, zero API costs, and offline capability for sensitive workloads.",
        },
        {
          icon: Cpu,
          title: "Groq & Cerebras",
          description:
            "Ultra-fast inference with specialized hardware. Groq's LPU and Cerebras wafer-scale chips for low-latency deliberation.",
        },
        {
          icon: Database,
          title: "Vector DBs",
          description:
            "pgvector, Pinecone, Weaviate, and Vespa. Choose the vector database that fits your scale and performance requirements.",
        },
      ]}
      howItWorks={[
        {
          step: "1",
          title: "Connect",
          description:
            "Add provider API keys through the settings panel. Test connections instantly.",
        },
        {
          step: "2",
          title: "Configure",
          description:
            "Set failover priorities and routing rules. Define which models handle which tasks.",
        },
        {
          step: "3",
          title: "Scale",
          description:
            "Automatic load balancing and circuit breakers keep your system running even when individual providers go down.",
        },
      ]}
    />
  );
}
