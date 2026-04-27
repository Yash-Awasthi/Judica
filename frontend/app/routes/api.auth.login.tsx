import type { Route } from "./+types/api.auth.login";
import { signToken, buildCookie, getSecret } from "~/lib/auth.server";
import { randomUUID } from "node:crypto";

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return Response.json({ error: "Username and password are required" }, { status: 400 });
  }

  const secret = getSecret(context.cloudflare.env as { JWT_SECRET?: string });

  // Demo mode: accept any credentials, issue a signed token
  // In production, integrate with a real user database
  const user = {
    id: `demo-${username}`,
    username,
    email: `${username}@demo.aibyai.dev`,
    role: username === "admin" ? ("admin" as const) : ("member" as const),
  };

  const token = await signToken(user, secret);
  return Response.json(
    { token, username: user.username, role: user.role },
    { headers: { "Set-Cookie": buildCookie(token) } }
  );
}
