import { Queue } from "bullmq";
import connection from "./connection.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 5000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

// P4-17: Queue priority constants — lower number = higher priority.
// Deliberation/real-time tasks use PRIORITY_HIGH; background batch jobs use PRIORITY_LOW.
// BullMQ processes higher-priority jobs first when multiple are waiting.
export const QUEUE_PRIORITY = {
  CRITICAL: 1,   // User-facing deliberation, real-time synthesis
  HIGH: 2,       // Interactive research, user-triggered ingestion
  NORMAL: 5,     // Background ingestion, scheduled tasks
  LOW: 10,       // Memory compaction, cleanup, analytics
} as const;

export const ingestionQueue = new Queue("ingestion", { connection, defaultJobOptions });
export const researchQueue = new Queue("research", { connection, defaultJobOptions });
export const repoQueue = new Queue("repo-ingestion", { connection, defaultJobOptions });
export const compactionQueue = new Queue("compaction", { connection, defaultJobOptions });

/** Dead-letter queue — failed jobs land here after exhausting all retries. */
export const deadLetterQueue = new Queue("dead-letter", {
  connection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});
