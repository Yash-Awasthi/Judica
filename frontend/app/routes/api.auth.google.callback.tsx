import type { Route } from "./+types/api.auth.google.callback";
import { signToken, buildCookie, getSecret, verifyOAuthState } from "~/lib/auth.server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OAUTH_CALLBACK_BASE_URL?: string;
    JWT_SECRET?: string;
    FRONTEND_URL?: string;
  };

  const origin = new URL(request.url).origin;
  const frontendUrl = env.FRONTEND_URL || origin;
  const callbackBase = env.OAUTH_CALLBACK_BASE_URL || origin;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (!code || !returnedState) {
    return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
  }

  // Verify the signed state (stateless — no cookie dependency)
  const secret = getSecret(env);
  const stateValid = await verifyOAuthState(returnedState, secret);
  if (!stateValid) {
    return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${callbackBase}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("[google-callback] token exchange failed:", await tokenRes.text());
      return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Fetch user info
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
    }
    const profile = (await userRes.json()) as GoogleUserInfo;

    if (!profile.email || profile.email_verified !== true) {
      return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
    }

    const user = {
      id: `google-${profile.sub}`,
      username: profile.name || profile.email.split("@")[0],
      email: profile.email,
      role: "member" as const,
    };

    const token = await signToken(user, secret);

    const headers = new Headers();
    headers.set("Location", frontendUrl + "/chat");
    headers.append("Set-Cookie", buildCookie(token));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error("[google-callback] error:", err);
    return Response.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
  }
}
