import { db } from "../lib/drizzle.js";
import { projects } from "../db/schema/projects.js";
import { conversations } from "../db/schema/conversations.js";
import { eq, and, desc, sql, count } from "drizzle-orm";
import logger from "../lib/logger.js";

export interface Project {
  id: string;
  userId: number;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  defaultCouncilComposition?: Record<string, unknown>;
  defaultSystemPrompt?: string | null;
  createdAt: Date;
  updatedAt: Date;
  conversationCount?: number;
}

export interface CreateProjectInput {
  userId: number;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  defaultCouncilComposition?: Record<string, unknown>;
  defaultSystemPrompt?: string;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  // P30-03: Validate string field lengths to prevent storage exhaustion
  if (input.name && input.name.length > 200) throw new Error("Project name too long (max 200 chars)");
  if (input.description && input.description.length > 5000) throw new Error("Description too long (max 5000 chars)");
  if (input.color && input.color.length > 30) throw new Error("Color value too long (max 30 chars)");
  if (input.icon && input.icon.length > 50) throw new Error("Icon value too long (max 50 chars)");
  if (input.defaultSystemPrompt && input.defaultSystemPrompt.length > 20_000) throw new Error("System prompt too long (max 20000 chars)");

  try {
    const now = new Date();
    const [project] = await db
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        name: input.name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        defaultCouncilComposition: input.defaultCouncilComposition,
        defaultSystemPrompt: input.defaultSystemPrompt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return project as unknown as Project;
  } catch (err) {
    logger.error({ err, userId: input.userId, name: input.name }, "Failed to create project");
    throw err;
  }
}

export async function getProjects(userId: number): Promise<Project[]> {
  try {
    const result = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        name: projects.name,
        description: projects.description,
        color: projects.color,
        icon: projects.icon,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        conversationCount: count(conversations.id),
      })
      .from(projects)
      .leftJoin(conversations, eq(conversations.projectId, projects.id))
      .where(and(eq(projects.userId, userId), sql`${projects.deletedAt} IS NULL`))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));
    
    return result as unknown as Project[];
  } catch (err) {
    logger.error({ err, userId }, "Failed to get projects");
    throw err;
  }
}

export async function getProjectById(id: string, userId: number): Promise<Project | null> {
  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId), sql`${projects.deletedAt} IS NULL`))
      .limit(1);
    
    return project as unknown as Project || null;
  } catch (err) {
    logger.error({ err, id, userId }, "Failed to get project by id");
    throw err;
  }
}

export async function updateProject(id: string, userId: number, input: Partial<CreateProjectInput>): Promise<Project | null> {
  try {
    const [project] = await db
      .update(projects)
      .set({
        // P44-07: Explicitly whitelist updateable fields instead of spreading untrusted input
        name: input.name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        defaultCouncilComposition: input.defaultCouncilComposition,
        defaultSystemPrompt: input.defaultSystemPrompt,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    
    return project as unknown as Project || null;
  } catch (err) {
    logger.error({ err, id, userId }, "Failed to update project");
    throw err;
  }
}

export async function deleteProject(id: string, userId: number): Promise<boolean> {
  try {
    const [project] = await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    
    return !!project;
  } catch (err) {
    logger.error({ err, id, userId }, "Failed to delete project");
    throw err;
  }
}
