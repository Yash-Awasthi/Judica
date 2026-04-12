import { Queue } from "bullmq";
import connection from "./connection.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 5000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const ingestionQueue = new Queue("ingestion", { connection, defaultJobOptions });
export const researchQueue = new Queue("research", { connection, defaultJobOptions });
export const repoQueue = new Queue("repo-ingestion", { connection, defaultJobOptions });
export const compactionQueue = new Queue("compaction", { connection, defaultJobOptions });
