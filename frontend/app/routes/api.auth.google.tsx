import type { Route } from "./+types/api.auth.google";
import { createOAuthState, getSecret } from "~/lib/auth.server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as {
    GOOGLE_CLIENT_ID?: string;
    OAUTH_CALLBACK_BASE_URL?: string;
    JWT_SECRET?: string;
  };

  if (!env.GOOGLE_CLIENT_ID) {
    return Response.redirect(new URL("/login?error=google_not_configured", request.url));
  }

  const callbackBase = env.OAUTH_CALLBACK_BASE_URL || new URL(request.url).origin;
  const redirectUri = `${callbackBase}/api/auth/google/callback`;

  // Stateless signed state — no cookie needed, works across domains
  const secret = getSecret(env);
  const state = await createOAuthState(secret);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  const googleUrl = `${GOOGLE_AUTH_URL}?${params}`;
  console.log("[google-oauth] redirect_uri:", redirectUri);

  return new Response(null, {
    status: 302,
    headers: { Location: googleUrl },
  });
}
