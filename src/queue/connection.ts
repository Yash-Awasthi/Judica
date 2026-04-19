import IORedisDefault from "ioredis";
const IORedis = IORedisDefault.default || IORedisDefault;

const connection = new (IORedis as unknown as new (...args: unknown[]) => InstanceType<typeof IORedisDefault>)(
  process.env.REDIS_URL || "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

export default connection;
