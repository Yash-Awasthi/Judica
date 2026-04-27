import type { Route } from "./+types/api.auth.logout";
import { buildCookie } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": buildCookie("", true) } }
  );
}
