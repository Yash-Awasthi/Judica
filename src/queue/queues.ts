import { Queue } from "bullmq";
import connection from "./connection.js";

export const ingestionQueue = new Queue("ingestion", { connection });
export const researchQueue = new Queue("research", { connection });
export const repoQueue = new Queue("repo-ingestion", { connection });
export const compactionQueue = new Queue("compaction", { connection });
