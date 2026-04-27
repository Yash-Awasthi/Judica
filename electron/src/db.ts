import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";

let db: Database.Database;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "molecule.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New deliberation',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','opinion','verdict','system')),
      member TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      round INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compactions (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      covers_through INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
  `);

  return db;
}

// ── Threads ──────────────────────────────────────────────────────────────────

export function createThread(id: string, title?: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
    .run(id, title ?? "New deliberation", now, now);
}

export function updateThreadTitle(id: string, title: string): void {
  getDb()
    .prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`)
    .run(title, Date.now(), id);
}

export function listThreads(): Thread[] {
  return getDb()
    .prepare(
      `SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC LIMIT 100`
    )
    .all() as Thread[];
}

export function deleteThread(id: string): void {
  getDb().prepare(`DELETE FROM threads WHERE id = ?`).run(id);
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function insertMessage(msg: InsertMessage): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO messages (id, thread_id, role, member, content, summary, round, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      msg.id,
      msg.threadId,
      msg.role,
      msg.member ?? null,
      msg.content,
      msg.summary ?? null,
      msg.round,
      now
    );
  getDb()
    .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
    .run(now, msg.threadId);
}

export function getThreadMessages(threadId: string): Message[] {
  return getDb()
    .prepare(
      `SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC`
    )
    .all(threadId) as Message[];
}

export function getCompaction(threadId: string): Compaction | undefined {
  return getDb()
    .prepare(`SELECT * FROM compactions WHERE thread_id = ?`)
    .get(threadId) as Compaction | undefined;
}

export function upsertCompaction(
  threadId: string,
  summary: string,
  coversThroughMessageTimestamp: number
): void {
  getDb()
    .prepare(
      `INSERT INTO compactions (thread_id, summary, covers_through, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         summary = excluded.summary,
         covers_through = excluded.covers_through,
         updated_at = excluded.updated_at`
    )
    .run(threadId, summary, coversThroughMessageTimestamp, Date.now());
}

// ── Memory ───────────────────────────────────────────────────────────────────

export function getMemory(): string {
  const row = getDb()
    .prepare(`SELECT value FROM memory WHERE key = 'user_context'`)
    .get() as { value: string } | undefined;
  return row?.value ?? "";
}

export function setMemory(value: string): void {
  getDb()
    .prepare(
      `INSERT INTO memory (key, value, updated_at) VALUES ('user_context', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(value, Date.now());
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Thread {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "opinion" | "verdict" | "system";
  member: string | null;
  content: string;
  summary: string | null;
  round: number;
  created_at: number;
}

export interface Compaction {
  thread_id: string;
  summary: string;
  covers_through: number;
  updated_at: number;
}

export interface InsertMessage {
  id: string;
  threadId: string;
  role: "user" | "opinion" | "verdict" | "system";
  member?: string;
  content: string;
  summary?: string;
  round: number;
}
