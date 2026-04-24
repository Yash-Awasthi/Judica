/**
 * SSO Routes — SAML/OIDC provider management and auth endpoints.
 *
 * Admin routes (provider CRUD):
 *   POST   /api/sso/providers       — Create SSO provider
 *   GET    /api/sso/providers       — List all SSO providers
 *   GET    /api/sso/providers/:id   — Get provider details
 *   PATCH  /api/sso/providers/:id   — Update provider
 *   DELETE /api/sso/providers/:id   — Delete provider
 *
 * Auth flow routes:
 *   GET    /api/sso/check-domain    — Check if SSO is enforced for email domain
 *   POST   /api/sso/callback/saml   — SAML ACS callback (stub)
 *   GET    /api/sso/callback/oidc   — OIDC callback (stub)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin, fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createSSOProvider,
  getSSOProvider,
  listSSOProviders,
  updateSSOProvider,
  deleteSSOProvider,
  findProviderForDomain,
  isSSOEnforced,
  processSSOCallback,
} from "./sso.service.js";
import type { SSOProviderType, SAMLConfig, OIDCConfig, SAMLAttributeMapping, OIDCClaimMapping } from "./models.js";

const ssoPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── Admin: Provider CRUD ────────────────────────────────────────────────

  fastify.post("/providers", { preHandler: [fastifyRequireAdmin] }, async (request, _reply) => {
    const body = request.body as {
      name: string;
      type: SSOProviderType;
      samlConfig?: SAMLConfig;
      oidcConfig?: OIDCConfig;
      attributeMapping: SAMLAttributeMapping | OIDCClaimMapping;
      autoProvision?: boolean;
      defaultRole?: string;
      allowedDomains?: string[];
      enforceSSO?: boolean;
    };

    if (!body.name || !body.type) {
      throw new AppError(400, "name and type are required");
    }
    if (body.type !== "saml" && body.type !== "oidc") {
      throw new AppError(400, "type must be 'saml' or 'oidc'");
    }
    if (body.type === "saml" && !body.samlConfig) {
      throw new AppError(400, "samlConfig required for SAML providers");
    }
    if (body.type === "oidc" && !body.oidcConfig) {
      throw new AppError(400, "oidcConfig required for OIDC providers");
    }

    const result = await createSSOProvider(body);
    return { success: true, id: result.id };
  });

  fastify.get("/providers", { preHandler: [fastifyRequireAdmin] }, async (_request, _reply) => {
    const providers = await listSSOProviders();
    // Strip sensitive config from list view
    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      autoProvision: p.autoProvision,
      defaultRole: p.defaultRole,
      allowedDomains: p.allowedDomains,
      enforceSSO: p.enforceSSO,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  });

  fastify.get("/providers/:id", { preHandler: [fastifyRequireAdmin] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const provider = await getSSOProvider(id);
    if (!provider) throw new AppError(404, "SSO provider not found");
    return provider;
  });

  fastify.patch("/providers/:id", { preHandler: [fastifyRequireAdmin] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const existing = await getSSOProvider(id);
    if (!existing) throw new AppError(404, "SSO provider not found");

    await updateSSOProvider(id, body);
    return { success: true };
  });

  fastify.delete("/providers/:id", { preHandler: [fastifyRequireAdmin] }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const existing = await getSSOProvider(id);
    if (!existing) throw new AppError(404, "SSO provider not found");

    await deleteSSOProvider(id);
    return { success: true };
  });

  // ─── Auth Flow Endpoints ─────────────────────────────────────────────────

  /**
   * Check if SSO is enforced for an email domain.
   * The login UI calls this to redirect users to SSO instead of showing password form.
   */
  fastify.get("/check-domain", async (request, _reply) => {
    const { email } = request.query as { email?: string };
    if (!email) throw new AppError(400, "email query parameter required");

    const enforced = await isSSOEnforced(email);
    const provider = enforced ? await findProviderForDomain(email) : null;

    return {
      ssoEnforced: enforced,
      providerId: provider?.id ?? null,
      providerName: provider?.name ?? null,
      providerType: provider?.type ?? null,
    };
  });

  /**
   * SAML ACS (Assertion Consumer Service) callback.
   * In production, this would parse the SAMLResponse, validate signatures,
   * extract assertions, and call processSSOCallback.
   *
   * Stub: returns 501 until a SAML library is integrated.
   */
  fastify.post("/callback/saml", async (request, reply) => {
    const { SAMLResponse, RelayState } = request.body as {
      SAMLResponse?: string;
      RelayState?: string;
    };

    if (!SAMLResponse) {
      throw new AppError(400, "SAMLResponse required");
    }

    // TODO: Integrate saml2-js or passport-saml to:
    // 1. Parse and validate SAMLResponse XML
    // 2. Verify signature against IdP certificate
    // 3. Extract NameID, attributes, SessionIndex
    // 4. Call processSSOCallback()
    // 5. Issue JWT tokens and redirect

    reply.code(501).send({
      error: "SAML callback not yet implemented",
      message: "Install a SAML library (saml2-js, @node-saml/node-saml) and implement assertion parsing",
    });
  });

  /**
   * OIDC callback — handles the authorization code exchange.
   *
   * Stub: returns 501 until an OIDC library is integrated.
   */
  fastify.get("/callback/oidc", async (request, reply) => {
    const { code, state, error: oidcError } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oidcError) {
      throw new AppError(400, `OIDC error: ${oidcError}`);
    }

    if (!code) {
      throw new AppError(400, "Authorization code required");
    }

    // TODO: Integrate openid-client to:
    // 1. Exchange authorization code for tokens
    // 2. Validate ID token (signature, issuer, audience, expiry)
    // 3. Fetch userinfo if needed
    // 4. Call processSSOCallback()
    // 5. Issue JWT tokens and redirect

    reply.code(501).send({
      error: "OIDC callback not yet implemented",
      message: "Install openid-client and implement token exchange",
    });
  });

  /**
   * Initiate SSO login — redirects to the IdP.
   *
   * Stub: returns the redirect URL for the frontend to handle.
   */
  fastify.get("/initiate/:providerId", async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const provider = await getSSOProvider(providerId);

    if (!provider) throw new AppError(404, "SSO provider not found");
    if (provider.status !== "active") throw new AppError(400, "SSO provider is not active");

    if (provider.type === "saml" && provider.samlConfig) {
      // For SAML: redirect to IdP SSO URL with AuthnRequest
      // TODO: Generate SAML AuthnRequest XML
      return {
        redirectUrl: provider.samlConfig.ssoUrl,
        type: "saml",
        message: "SAML AuthnRequest generation not yet implemented — redirect URL provided for reference",
      };
    }

    if (provider.type === "oidc" && provider.oidcConfig) {
      // For OIDC: redirect to authorization endpoint
      const params = new URLSearchParams({
        client_id: provider.oidcConfig.clientId,
        response_type: provider.oidcConfig.responseType,
        scope: provider.oidcConfig.scopes.join(" "),
        redirect_uri: `${request.protocol}://${request.hostname}/api/sso/callback/oidc`,
        state: providerId, // TODO: use CSRF-safe state parameter
      });

      const redirectUrl = `${provider.oidcConfig.authorizationUrl}?${params.toString()}`;
      reply.redirect(redirectUrl);
      return;
    }

    throw new AppError(400, "Provider configuration incomplete");
  });
};

export default ssoPlugin;
