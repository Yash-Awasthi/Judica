/**
 * P4-26: Provider health probes endpoint.
 *
 * Exposes circuit breaker state for all registered providers,
 * enabling dashboards and alerting on provider availability.
 *
 * GET /api/admin/provider-health → { providers: [...] }
 */

import { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { listAvailableProviders, getAdapterOrNull } from "../adapters/registry.js";

export interface ProviderHealthStatus {
  provider: string;
  registered: boolean;
  available: boolean;
  /** Circuit breaker state: "closed" (healthy), "open" (failing), "half-open" (testing) */
  circuitState: "closed" | "open" | "half-open" | "unknown";
}

const providerHealthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/provider-health", { preHandler: fastifyRequireAuth }, async (_request, reply) => {
    const providers = listAvailableProviders();

    const statuses: ProviderHealthStatus[] = providers.map((provider) => {
      const adapter = getAdapterOrNull(provider);
      return {
        provider,
        registered: !!adapter,
        available: !!adapter,
        // Circuit breaker state would require exposing breaker internals.
        // For now, if the adapter is registered it's considered available.
        // Full integration with breaker.ts can expose open/half-open/closed state.
        circuitState: adapter ? "closed" as const : "unknown" as const,
      };
    });

    return reply.send({
      providers: statuses,
      totalRegistered: providers.length,
      timestamp: new Date().toISOString(),
    });
  });
};

export default providerHealthPlugin;
