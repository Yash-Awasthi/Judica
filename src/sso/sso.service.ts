/**
 * SSO Service — SAML/OIDC provider management and authentication flow.
 *
 * Modeled after Onyx's enterprise SSO subsystem:
 * - Provider CRUD with encrypted config storage
 * - JIT (Just-In-Time) user provisioning on first SSO login
 * - Domain-based SSO enforcement
 * - User ↔ IdP linking
 *
 * NOTE: Actual SAML XML parsing and OIDC token exchange require
 * runtime libraries (e.g., saml2-js, openid-client). This service
 * provides the orchestration layer — protocol-specific handlers
 * are injected or added when the libraries are available.
 */

import { db } from "../lib/drizzle.js";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ssoProviders, ssoSessions, ssoUserLinks } from "../db/schema/sso.js";
import { users } from "../db/schema/users.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import logger from "../lib/logger.js";
import type {
  SSOProvider,
  SSOProviderType,
  SSOProviderStatus,
  SAMLConfig,
  OIDCConfig,
  SAMLAttributeMapping,
  OIDCClaimMapping,
  SSOAuthResult,
} from "./models.js";

// ─── Provider CRUD ───────────────────────────────────────────────────────────

export async function createSSOProvider(input: {
  name: string;
  type: SSOProviderType;
  samlConfig?: SAMLConfig;
  oidcConfig?: OIDCConfig;
  attributeMapping: SAMLAttributeMapping | OIDCClaimMapping;
  autoProvision?: boolean;
  defaultRole?: string;
  allowedDomains?: string[];
  enforceSSO?: boolean;
}): Promise<{ id: string }> {
  const id = randomUUID();

  // Encrypt sensitive config fields before storage
  const encryptedSamlConfig = input.samlConfig
    ? encrypt(JSON.stringify(input.samlConfig))
    : null;
  const encryptedOidcConfig = input.oidcConfig
    ? encrypt(JSON.stringify(input.oidcConfig))
    : null;

  await db.insert(ssoProviders).values({
    id,
    name: input.name,
    type: input.type,
    status: "pending_setup",
    samlConfig: encryptedSamlConfig,
    oidcConfig: encryptedOidcConfig,
    attributeMapping: input.attributeMapping,
    autoProvision: input.autoProvision ?? true,
    defaultRole: input.defaultRole ?? "member",
    allowedDomains: input.allowedDomains ?? [],
    enforceSSO: input.enforceSSO ?? false,
  });

  logger.info({ id, name: input.name, type: input.type }, "SSO provider created");
  return { id };
}

export async function getSSOProvider(id: string): Promise<SSOProvider | null> {
  const [row] = await db.select().from(ssoProviders).where(eq(ssoProviders.id, id)).limit(1);
  if (!row) return null;
  return decryptProviderRow(row);
}

export async function listSSOProviders(): Promise<SSOProvider[]> {
  const rows = await db.select().from(ssoProviders);
  return rows.map(decryptProviderRow);
}

export async function updateSSOProvider(
  id: string,
  updates: Partial<{
    name: string;
    status: SSOProviderStatus;
    samlConfig: SAMLConfig;
    oidcConfig: OIDCConfig;
    attributeMapping: SAMLAttributeMapping | OIDCClaimMapping;
    autoProvision: boolean;
    defaultRole: string;
    allowedDomains: string[];
    enforceSSO: boolean;
  }>,
): Promise<void> {
  const setValues: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.status !== undefined) setValues.status = updates.status;
  if (updates.samlConfig !== undefined)
    setValues.samlConfig = encrypt(JSON.stringify(updates.samlConfig));
  if (updates.oidcConfig !== undefined)
    setValues.oidcConfig = encrypt(JSON.stringify(updates.oidcConfig));
  if (updates.attributeMapping !== undefined) setValues.attributeMapping = updates.attributeMapping;
  if (updates.autoProvision !== undefined) setValues.autoProvision = updates.autoProvision;
  if (updates.defaultRole !== undefined) setValues.defaultRole = updates.defaultRole;
  if (updates.allowedDomains !== undefined) setValues.allowedDomains = updates.allowedDomains;
  if (updates.enforceSSO !== undefined) setValues.enforceSSO = updates.enforceSSO;

  await db.update(ssoProviders).set(setValues).where(eq(ssoProviders.id, id));
  logger.info({ id }, "SSO provider updated");
}

export async function deleteSSOProvider(id: string): Promise<void> {
  await db.delete(ssoProviders).where(eq(ssoProviders.id, id));
  logger.info({ id }, "SSO provider deleted");
}

// ─── SSO Auth Flow ───────────────────────────────────────────────────────────

/**
 * Find the SSO provider that should handle authentication for a given email domain.
 * Returns null if no provider matches or enforces SSO for that domain.
 */
export async function findProviderForDomain(email: string): Promise<SSOProvider | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const providers = await db
    .select()
    .from(ssoProviders)
    .where(eq(ssoProviders.status, "active"));

  for (const row of providers) {
    const domains = (row.allowedDomains as string[]) || [];
    if (domains.length === 0 || domains.includes(domain)) {
      return decryptProviderRow(row);
    }
  }
  return null;
}

/**
 * Check if SSO is enforced for a given email domain.
 * When true, password-based login should be blocked.
 */
export async function isSSOEnforced(email: string): Promise<boolean> {
  const provider = await findProviderForDomain(email);
  return provider?.enforceSSO ?? false;
}

/**
 * Process SSO callback — authenticate or JIT-provision user.
 * Called after SAML assertion validation or OIDC token exchange.
 */
export async function processSSOCallback(input: {
  providerId: string;
  externalSubjectId: string;
  email: string;
  displayName?: string;
  rawAttributes: Record<string, unknown>;
}): Promise<SSOAuthResult> {
  const provider = await getSSOProvider(input.providerId);
  if (!provider) throw new Error(`SSO provider ${input.providerId} not found`);
  if (provider.status !== "active") throw new Error(`SSO provider ${input.providerId} is not active`);

  // Validate domain
  const domain = input.email.split("@")[1]?.toLowerCase();
  const allowedDomains = provider.allowedDomains;
  if (allowedDomains.length > 0 && domain && !allowedDomains.includes(domain)) {
    throw new Error(`Email domain '${domain}' is not allowed for SSO provider '${provider.name}'`);
  }

  // Check if user link exists
  const [existingLink] = await db
    .select()
    .from(ssoUserLinks)
    .where(
      and(
        eq(ssoUserLinks.providerId, input.providerId),
        eq(ssoUserLinks.externalSubjectId, input.externalSubjectId),
      ),
    )
    .limit(1);

  let userId: number;
  let username: string;
  let role: string;
  let isNewUser = false;

  if (existingLink) {
    // Existing linked user
    const [user] = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, existingLink.userId))
      .limit(1);

    if (!user) throw new Error(`Linked user ${existingLink.userId} not found`);
    userId = user.id;
    username = user.username;
    role = user.role;
  } else {
    // Try to find by email
    const [existingUser] = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (existingUser) {
      // Link existing user
      userId = existingUser.id;
      username = existingUser.username;
      role = existingUser.role;

      await db.insert(ssoUserLinks).values({
        id: randomUUID(),
        userId,
        providerId: input.providerId,
        externalSubjectId: input.externalSubjectId,
        externalEmail: input.email,
      });
    } else if (provider.autoProvision) {
      // JIT provision new user
      const displayName = input.displayName || input.email.split("@")[0];
      const [newUser] = await db
        .insert(users)
        .values({
          email: input.email,
          username: displayName,
          authMethod: provider.type === "saml" ? "password" : "password", // TODO: add sso authMethod
          role: provider.defaultRole,
        })
        .returning({ id: users.id, username: users.username, role: users.role });

      userId = newUser.id;
      username = newUser.username;
      role = newUser.role;
      isNewUser = true;

      // Link the new user
      await db.insert(ssoUserLinks).values({
        id: randomUUID(),
        userId,
        providerId: input.providerId,
        externalSubjectId: input.externalSubjectId,
        externalEmail: input.email,
      });

      logger.info({ userId, email: input.email, providerId: input.providerId }, "JIT provisioned new SSO user");
    } else {
      throw new Error(`User not found and auto-provisioning is disabled for provider '${provider.name}'`);
    }
  }

  // Create SSO session record
  await db.insert(ssoSessions).values({
    id: randomUUID(),
    userId,
    providerId: input.providerId,
    externalSessionId: (input.rawAttributes.sessionIndex as string) || null,
    externalSubjectId: input.externalSubjectId,
    rawAttributes: input.rawAttributes,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
  });

  return {
    isNewUser,
    userId,
    username,
    email: input.email,
    role,
    providerId: input.providerId,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decryptProviderRow(row: typeof ssoProviders.$inferSelect): SSOProvider {
  let samlConfig: SAMLConfig | undefined;
  let oidcConfig: OIDCConfig | undefined;

  try {
    if (row.samlConfig) {
      samlConfig = JSON.parse(decrypt(row.samlConfig as string));
    }
  } catch {
    logger.warn({ id: row.id }, "Failed to decrypt SAML config");
  }

  try {
    if (row.oidcConfig) {
      oidcConfig = JSON.parse(decrypt(row.oidcConfig as string));
    }
  } catch {
    logger.warn({ id: row.id }, "Failed to decrypt OIDC config");
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type as SSOProvider["type"],
    status: row.status as SSOProvider["status"],
    samlConfig,
    oidcConfig,
    attributeMapping: row.attributeMapping as SSOProvider["attributeMapping"],
    autoProvision: row.autoProvision,
    defaultRole: row.defaultRole,
    allowedDomains: (row.allowedDomains as string[]) || [],
    enforceSSO: row.enforceSSO,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
