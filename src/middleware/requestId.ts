import { randomUUID } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

// P1-28: Validate request ID format — accept alphanumeric strings with hyphens
const REQUEST_ID_RE = /^[a-z0-9-]{1,64}$/i;

export async function fastifyRequestId(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers["x-request-id"] as string | undefined;
  // P1-28: Only trust header value if it matches a safe format
  const id = (header && REQUEST_ID_RE.test(header)) ? header : randomUUID();
  (request as unknown as { requestId: string }).requestId = id;
  reply.header("X-Request-ID", id);
}
