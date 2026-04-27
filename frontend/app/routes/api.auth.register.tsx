import type { Route } from "./+types/api.auth.register";
import { signToken, buildCookie, getSecret } from "~/lib/auth.server";

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
  if (username.length < 3) {
    return Response.json({ error: "Username must be at least 3 characters" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return Response.json({ error: "Username can only contain letters, numbers, underscores" }, { status: 400 });
  }
  if (password.length < 12) {
    return Response.json({ error: "Password must be at least 12 characters" }, { status: 400 });
  }
  if (!/[^a-zA-Z]/.test(password)) {
    return Response.json({ error: "Password must contain at least one non-alphabetic character" }, { status: 400 });
  }

  const secret = getSecret(context.cloudflare.env as { JWT_SECRET?: string });

  const user = {
    id: `user-${Date.now()}`,
    username,
    email: `${username}@demo.aibyai.dev`,
    role: "member" as const,
  };

  const token = await signToken(user, secret);
  return Response.json(
    { token, username: user.username, role: user.role },
    { status: 201, headers: { "Set-Cookie": buildCookie(token) } }
  );
}
