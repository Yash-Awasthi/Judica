/**
 * Connector API Routes — CRUD + trigger sync for data source connectors.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireRole } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createConnector,
  listConnectors,
  getConnector,
  deleteConnector,
  executeConnectorRun,
  getConnectorRuns,
} from "../services/connector.service.js";
import { DocumentSource, InputType, getRegisteredSources } from "../connectors/index.js";
import logger from "../lib/logger.js";
import { db } from "../lib/drizzle.js";
import { connectorInstances, connectorRuns } from "../db/schema/connectors.js";
import { desc, eq } from "drizzle-orm";
import { ingestionQueue } from "../queue/queues.js";

const log = logger.child({ route: "connectors" });

const connectorPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/connectors/sources — list available source types
  fastify.get("/sources", {
    schema: {
      summary: 'List available connector source types',
      tags: ['Connectors'],
      response: {
        200: {
          type: 'object',
          properties: {
            sources: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } } },
          },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async () => {
    return {
      sources: getRegisteredSources().map((s) => ({
        id: s,
        label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    };
  });

  // GET /api/connectors — list user's connectors
  fastify.get("/", {
    schema: {
      summary: "List user's data source connectors",
      tags: ['Connectors'],
      response: {
        200: {
          type: 'object',
          properties: {
            connectors: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const connectors = await listConnectors(request.userId!);
    return { connectors };
  });

  // POST /api/connectors — create a connector
  fastify.post("/", {
    schema: {
      summary: 'Create a new data source connector',
      tags: ['Connectors'],
      body: {
        type: 'object',
        required: ['source', 'name', 'settings', 'credentials'],
        properties: {
          source: { type: 'string', description: 'Connector source type (e.g. google_drive, slack)' },
          name: { type: 'string' },
          description: { type: 'string' },
          settings: { type: 'object', description: 'Source-specific settings' },
          inputType: { type: 'string', description: 'Input type (e.g. load_state, poll)' },
          credentials: { type: 'object', description: 'Source-specific credentials' },
          refreshIntervalMins: { type: 'number', description: 'Auto-sync interval in minutes' },
        },
      },
      response: {
        201: { type: 'object' },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const body = request.body as {
      source: string;
      name: string;
      description?: string;
      settings: Record<string, unknown>;
      inputType: string;
      credentials: Record<string, unknown>;
      refreshIntervalMins?: number;
    };

    if (!body.source || !body.name || !body.settings || !body.credentials) {
      throw new AppError(400, "source, name, settings, and credentials are required");
    }

    if (!Object.values(DocumentSource).includes(body.source as DocumentSource)) {
      throw new AppError(400, `Invalid source: ${body.source}`);
    }

    if (!Object.values(InputType).includes(body.inputType as InputType)) {
      throw new AppError(400, `Invalid inputType: ${body.inputType}`);
    }

    const result = await createConnector({
      userId: request.userId!,
      source: body.source as DocumentSource,
      name: body.name,
      description: body.description,
      settings: body.settings,
      inputType: body.inputType as InputType,
      credentials: body.credentials,
      refreshIntervalMins: body.refreshIntervalMins,
    });

    reply.status(201);
    return result;
  });

  // GET /api/connectors/:id — get connector details
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const connector = await getConnector(id);
    if (!connector) throw new AppError(404, "Connector not found");
    return connector;
  });

  // DELETE /api/connectors/:id — delete a connector
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const connector = await getConnector(id);
    if (!connector) throw new AppError(404, "Connector not found");
    await deleteConnector(id);
    return { deleted: true };
  });

  // POST /api/connectors/:id/sync — trigger a sync
  fastify.post("/:id/sync", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const connector = await getConnector(id);
    if (!connector) throw new AppError(404, "Connector not found");

    log.info({ connectorId: id }, "Manual sync triggered");

    // Execute synchronously for now; will be moved to BullMQ in worker specialization PR
    const { runId, result } = await executeConnectorRun(id);
    return {
      runId,
      docsProcessed: result.documents.length,
      docsFailed: result.failures.length,
    };
  });

  // GET /api/connectors/:id/runs — get run history
  fastify.get("/:id/runs", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const limit = (request.query as Record<string, string>).limit
      ? parseInt((request.query as Record<string, string>).limit, 10)
      : 10;
    const runs = await getConnectorRuns(id, limit);
    return { runs };
  });

  // GET /api/connectors/health — health summary for all connectors (admin only)
  fastify.get("/health", { preHandler: [fastifyRequireRole("admin")] }, async () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const instances = await db
      .select()
      .from(connectorInstances)
      .orderBy(desc(connectorInstances.createdAt));

    // For each connector, fetch the most recent run to get status/errorMessage
    const healthResults = await Promise.all(
      instances.map(async (connector) => {
        const [latestRun] = await db
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.connectorId, connector.id))
          .orderBy(desc(connectorRuns.startedAt))
          .limit(1);

        let health: "never_synced" | "healthy" | "stalled" | "error";
        const runStatus = latestRun?.status;
        const runErrorMessage = latestRun?.errorMessage;

        if (!connector.lastSyncAt) {
          health = "never_synced";
        } else if (runStatus === "running" && latestRun.startedAt < twoHoursAgo) {
          health = "stalled";
        } else if (runStatus === "failed") {
          health = "error";
        } else {
          health = "healthy";
        }

        return {
          id: connector.id,
          name: connector.name,
          source: connector.source,
          health,
          lastSyncAt: connector.lastSyncAt,
          status: runStatus ?? null,
          errorMessage: runErrorMessage ?? null,
        };
      })
    );

    return { connectors: healthResults };
  });

  // POST /api/connectors/:id/sync — push job to ingestionQueue (admin only)
  // Note: this replaces the per-user sync route above with an admin-only queue-based version
  fastify.post("/admin/:id/sync", { preHandler: [fastifyRequireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const connector = await getConnector(id);
    if (!connector) throw new AppError(404, "Connector not found");

    log.info({ connectorId: id }, "Admin: queuing immediate sync via ingestionQueue");

    const job = await ingestionQueue.add(
      "connector-sync",
      { connectorId: id, triggeredBy: "admin-manual" },
      { priority: 2 } // HIGH priority
    );

    reply.status(202);
    return { queued: true, jobId: job.id, connectorId: id };
  });
};

export default connectorPlugin;
