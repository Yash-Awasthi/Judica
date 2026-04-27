import type { Route } from "./+types/api.auth.me";
import { verifyToken, getTokenFromRequest, getSecret } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const secret = getSecret(context.cloudflare.env as { JWT_SECRET?: string });
  const user = await verifyToken(token, secret);
  if (!user) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  return Response.json(user);
}
