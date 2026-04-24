/**
 * Connector API Routes — CRUD + trigger sync for data source connectors.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
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

const log = logger.child({ route: "connectors" });

const connectorPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/connectors/sources — list available source types
  fastify.get("/sources", { preHandler: fastifyRequireAuth }, async () => {
    return {
      sources: getRegisteredSources().map((s) => ({
        id: s,
        label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    };
  });

  // GET /api/connectors — list user's connectors
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const connectors = await listConnectors(request.userId!);
    return { connectors };
  });

  // POST /api/connectors — create a connector
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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
};

export default connectorPlugin;
