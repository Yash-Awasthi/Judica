import { randomUUID } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

export async function fastifyRequestId(request: FastifyRequest, reply: FastifyReply) {
  const id = (request.headers["x-request-id"] as string) || randomUUID();
  (request as unknown as { requestId: string }).requestId = id;
  reply.header("X-Request-ID", id);
}
