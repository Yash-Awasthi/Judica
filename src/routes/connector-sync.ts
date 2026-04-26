/**
 * Connector Sync Routes — trigger, monitor, and schedule Load/Poll/Slim syncs.
 *
 * All routes are nested under /api/connectors/:connectorId/sync.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createSyncJob,
  executeSyncJob,
  getSyncJobs,
  getSyncJobById,
  cancelSyncJob,
  createSyncSchedule,
  getSyncSchedules,
  updateSyncSchedule,
  deleteSyncSchedule,
  SyncMode,
  SyncJobStatus,
} from "../services/connectorSync.service.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "connector-sync" });

const VALID_SYNC_MODES = Object.values(SyncMode);

export const connectorSyncPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── POST /api/connectors/:connectorId/sync — trigger a sync ──────────────

  fastify.post("/:connectorId/sync", {
    schema: {
      summary: "Trigger a connector sync (load, poll, or slim)",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId"],
        properties: {
          connectorId: { type: "string" },
        },
      },
      body: {
        type: "object",
        required: ["mode"],
        properties: {
          mode: { type: "string", enum: ["load", "poll", "slim"] },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            jobId: { type: "string" },
            status: { type: "string" },
            documentsProcessed: { type: "number" },
            documentsDeleted: { type: "number" },
          },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const { connectorId } = request.params as { connectorId: string };
    const { mode } = request.body as { mode: string };

    if (!VALID_SYNC_MODES.includes(mode as SyncMode)) {
      throw new AppError(400, `Invalid sync mode: ${mode}. Must be one of: ${VALID_SYNC_MODES.join(", ")}`);
    }

    log.info({ connectorId, mode }, "Sync triggered");

    const { id: jobId } = await createSyncJob(connectorId, request.userId!, mode as SyncMode);

    // Execute synchronously for now; will be moved to BullMQ in worker specialization PR
    const result = await executeSyncJob(jobId);

    reply.status(201);
    return {
      jobId,
      status: result.status,
      documentsProcessed: result.documentsProcessed,
      documentsDeleted: result.documentsDeleted,
    };
  });

  // ─── GET /api/connectors/:connectorId/sync/jobs — list sync jobs ──────────

  fastify.get("/:connectorId/sync/jobs", {
    schema: {
      summary: "List sync jobs for a connector",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId"],
        properties: {
          connectorId: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number" },
          offset: { type: "number" },
          status: { type: "string" },
          syncMode: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            jobs: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { connectorId } = request.params as { connectorId: string };
    const query = request.query as {
      limit?: string;
      offset?: string;
      status?: string;
      syncMode?: string;
    };

    const jobs = await getSyncJobs(connectorId, request.userId!, {
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
      status: query.status as SyncJobStatus | undefined,
      syncMode: query.syncMode as SyncMode | undefined,
    });

    return { jobs };
  });

  // ─── GET /api/connectors/:connectorId/sync/jobs/:jobId — get job status ───

  fastify.get("/:connectorId/sync/jobs/:jobId", {
    schema: {
      summary: "Get sync job details",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId", "jobId"],
        properties: {
          connectorId: { type: "string" },
          jobId: { type: "string" },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { jobId } = request.params as { connectorId: string; jobId: string };
    const job = await getSyncJobById(jobId, request.userId!);
    if (!job) throw new AppError(404, "Sync job not found");
    return job;
  });

  // ─── DELETE /api/connectors/:connectorId/sync/jobs/:jobId — cancel job ────

  fastify.delete("/:connectorId/sync/jobs/:jobId", {
    schema: {
      summary: "Cancel a running sync job",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId", "jobId"],
        properties: {
          connectorId: { type: "string" },
          jobId: { type: "string" },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { jobId } = request.params as { connectorId: string; jobId: string };
    const result = await cancelSyncJob(jobId, request.userId!);

    if (!result) throw new AppError(404, "Sync job not found");
    if ("error" in result) throw new AppError(400, result.error ?? "");

    return result;
  });

  // ─── POST /api/connectors/:connectorId/sync/schedules — create schedule ───

  fastify.post("/:connectorId/sync/schedules", {
    schema: {
      summary: "Create a sync schedule",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId"],
        properties: {
          connectorId: { type: "string" },
        },
      },
      body: {
        type: "object",
        required: ["syncMode", "cronExpression"],
        properties: {
          syncMode: { type: "string", enum: ["load", "poll", "slim"] },
          cronExpression: { type: "string" },
          enabled: { type: "boolean" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const { connectorId } = request.params as { connectorId: string };
    const body = request.body as {
      syncMode: string;
      cronExpression: string;
      enabled?: boolean;
    };

    if (!VALID_SYNC_MODES.includes(body.syncMode as SyncMode)) {
      throw new AppError(400, `Invalid sync mode: ${body.syncMode}`);
    }

    if (!body.cronExpression || body.cronExpression.trim().length === 0) {
      throw new AppError(400, "cronExpression is required");
    }

    const result = await createSyncSchedule({
      connectorId,
      userId: request.userId!,
      syncMode: body.syncMode as SyncMode,
      cronExpression: body.cronExpression,
      enabled: body.enabled,
    });

    reply.status(201);
    return result;
  });

  // ─── GET /api/connectors/:connectorId/sync/schedules — list schedules ─────

  fastify.get("/:connectorId/sync/schedules", {
    schema: {
      summary: "List sync schedules for a connector",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId"],
        properties: {
          connectorId: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            schedules: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { connectorId } = request.params as { connectorId: string };
    const schedules = await getSyncSchedules(connectorId, request.userId!);
    return { schedules };
  });

  // ─── PUT /api/connectors/:connectorId/sync/schedules/:scheduleId — update ─

  fastify.put("/:connectorId/sync/schedules/:scheduleId", {
    schema: {
      summary: "Update a sync schedule",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId", "scheduleId"],
        properties: {
          connectorId: { type: "string" },
          scheduleId: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          syncMode: { type: "string", enum: ["load", "poll", "slim"] },
          cronExpression: { type: "string" },
          enabled: { type: "boolean" },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { scheduleId } = request.params as { connectorId: string; scheduleId: string };
    const body = request.body as {
      syncMode?: string;
      cronExpression?: string;
      enabled?: boolean;
    };

    if (body.syncMode && !VALID_SYNC_MODES.includes(body.syncMode as SyncMode)) {
      throw new AppError(400, `Invalid sync mode: ${body.syncMode}`);
    }

    const result = await updateSyncSchedule(scheduleId, request.userId!, {
      syncMode: body.syncMode as SyncMode | undefined,
      cronExpression: body.cronExpression,
      enabled: body.enabled,
    });

    if (!result) throw new AppError(404, "Schedule not found");
    return result;
  });

  // ─── DELETE /api/connectors/:connectorId/sync/schedules/:scheduleId ────────

  fastify.delete("/:connectorId/sync/schedules/:scheduleId", {
    schema: {
      summary: "Delete a sync schedule",
      tags: ["Connector Sync"],
      params: {
        type: "object",
        required: ["connectorId", "scheduleId"],
        properties: {
          connectorId: { type: "string" },
          scheduleId: { type: "string" },
        },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { scheduleId } = request.params as { connectorId: string; scheduleId: string };
    const result = await deleteSyncSchedule(scheduleId, request.userId!);
    if (!result) throw new AppError(404, "Schedule not found");
    return result;
  });
};

export default connectorSyncPlugin;
