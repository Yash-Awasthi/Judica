/**
 * Agent YAML Profiles routes — Phase 2.14
 *
 * Export council configs as YAML files.
 * Import YAML to instantiate a council setup.
 * Shareable on the marketplace.
 *
 * Inspired by SWE-agent YAML agent configs.
 */

import { FastifyInstance } from "fastify";
import { profileToYAML, yamlToProfile, validateProfile, type CouncilProfile } from "../lib/agentProfiles.js";
import { db } from "../lib/drizzle.js";
import { council } from "../db/schema/council.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

const importSchema = z.object({
  yaml: z.string().min(1),
});

export async function agentProfilesPlugin(app: FastifyInstance) {
  // GET /agent-profiles/export — export current council as YAML
  app.get("/agent-profiles/export", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const members = await db
      .select()
      .from(council as any)
      .where(eq((council as any).userId, userId));

    const master = members.find((m: any) => m.role === "master" || m.isMaster);
    const regular = members.filter((m: any) => !(m.role === "master" || m.isMaster));

    const profile: CouncilProfile = {
      version:  "1.0",
      name:     "My Council",
      members:  regular.map((m: any) => ({
        id:           m.id,
        name:         m.name,
        systemPrompt: m.systemPrompt,
        model:        m.model,
        provider:     m.provider,
        role:         m.role,
      })),
      master: master ? {
        id:           master.id,
        name:         master.name,
        systemPrompt: master.systemPrompt,
        model:        master.model,
        provider:     master.provider,
      } : undefined,
    };

    const yamlStr = profileToYAML(profile);
    reply.header("Content-Type", "application/yaml");
    reply.header("Content-Disposition", "attachment; filename=council-profile.yaml");
    return reply.send(yamlStr);
  });

  // GET /agent-profiles/export/json — export as JSON (convenience)
  app.get("/agent-profiles/export/json", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const members = await db
      .select()
      .from(council as any)
      .where(eq((council as any).userId, userId));

    return { success: true, profile: members };
  });

  // POST /agent-profiles/validate — parse + validate a YAML profile without importing
  app.post("/agent-profiles/validate", async (req, reply) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "yaml field required" });

    const { profile, error } = yamlToProfile(parsed.data.yaml);
    if (error || !profile) {
      return reply.status(422).send({ valid: false, error });
    }

    const validationErrors = validateProfile(profile);
    return {
      valid:   validationErrors.length === 0,
      errors:  validationErrors,
      profile: validationErrors.length === 0 ? profile : null,
    };
  });

  // POST /agent-profiles/import — import a YAML profile (preview only, no DB write)
  // Returns the parsed profile for the client to confirm before applying
  app.post("/agent-profiles/import", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "yaml field required" });

    const { profile, error } = yamlToProfile(parsed.data.yaml);
    if (error || !profile) {
      return reply.status(422).send({ error });
    }

    const validationErrors = validateProfile(profile);
    if (validationErrors.length > 0) {
      return reply.status(422).send({ error: validationErrors.join("; ") });
    }

    // Return parsed profile for client confirmation — not yet applied
    return { success: true, profile, memberCount: profile.members.length };
  });
}
