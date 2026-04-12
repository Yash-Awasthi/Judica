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
