/**
 * SSO / SAML / OIDC Models — modeled after Onyx's enterprise SSO subsystem.
 *
 * Supports:
 * - SAML 2.0 (Okta, Azure AD, OneLogin, etc.)
 * - OIDC (generic OpenID Connect providers)
 * - Provider-level configuration with metadata storage
 * - Auto-provisioning (JIT) and attribute mapping
 */

// ─── SSO Provider Type ───────────────────────────────────────────────────────

export enum SSOProviderType {
  SAML = "saml",
  OIDC = "oidc",
}

export enum SSOProviderStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  PENDING_SETUP = "pending_setup",
}

// ─── SAML Configuration ──────────────────────────────────────────────────────

export interface SAMLConfig {
  /** IdP Entity ID (e.g., https://idp.example.com/metadata). */
  entityId: string;
  /** IdP SSO URL — where auth requests are sent. */
  ssoUrl: string;
  /** IdP SLO URL — single logout endpoint (optional). */
  sloUrl?: string;
  /** IdP X.509 certificate for signature validation (PEM format). */
  certificate: string;
  /** SP Entity ID — our service provider identifier. */
  spEntityId: string;
  /** SP ACS URL — Assertion Consumer Service callback. */
  acsUrl: string;
  /** NameID format (e.g., email, persistent, transient). */
  nameIdFormat: "email" | "persistent" | "transient" | "unspecified";
  /** Whether to sign auth requests. */
  signRequests: boolean;
  /** Signature algorithm. */
  signatureAlgorithm: "sha256" | "sha512";
}

export interface SAMLAttributeMapping {
  /** SAML attribute name → user field mapping. */
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  role?: string;
  groups?: string;
}

// ─── OIDC Configuration ──────────────────────────────────────────────────────

export interface OIDCConfig {
  /** OIDC Discovery URL (e.g., https://accounts.google.com/.well-known/openid-configuration). */
  discoveryUrl?: string;
  /** Authorization endpoint (if no discovery). */
  authorizationUrl: string;
  /** Token endpoint. */
  tokenUrl: string;
  /** UserInfo endpoint. */
  userInfoUrl: string;
  /** JWKS URI for token validation. */
  jwksUri: string;
  /** Client ID. */
  clientId: string;
  /** Client Secret (encrypted at rest). */
  clientSecret: string;
  /** Scopes to request. */
  scopes: string[];
  /** Response type (default: "code"). */
  responseType: "code" | "id_token" | "code id_token";
}

export interface OIDCClaimMapping {
  /** OIDC claim → user field mapping. */
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  role?: string;
  groups?: string;
}

// ─── Unified SSO Provider ────────────────────────────────────────────────────

export interface SSOProvider {
  id: string;
  /** Human-readable name (e.g., "Corporate Okta"). */
  name: string;
  type: SSOProviderType;
  status: SSOProviderStatus;
  /** SAML config — present when type = saml. */
  samlConfig?: SAMLConfig;
  /** OIDC config — present when type = oidc. */
  oidcConfig?: OIDCConfig;
  /** Attribute/claim mapping. */
  attributeMapping: SAMLAttributeMapping | OIDCClaimMapping;
  /** Auto-provision users on first SSO login (JIT provisioning). */
  autoProvision: boolean;
  /** Default role for JIT-provisioned users. */
  defaultRole: string;
  /** Allowed email domains (empty = all allowed). */
  allowedDomains: string[];
  /** Whether to enforce SSO-only login (disable password auth for matched domains). */
  enforceSSO: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── SSO Session ─────────────────────────────────────────────────────────────

export interface SSOSession {
  id: string;
  userId: number;
  providerId: string;
  /** External IdP session ID / SAML SessionIndex. */
  externalSessionId?: string;
  /** IdP-issued subject identifier. */
  externalSubjectId: string;
  /** Raw attributes/claims from the IdP (for debugging). */
  rawAttributes: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

// ─── SSO Auth Result ─────────────────────────────────────────────────────────

export interface SSOAuthResult {
  /** Whether user was newly created (JIT provisioned). */
  isNewUser: boolean;
  userId: number;
  username: string;
  email: string;
  role: string;
  /** The SSO provider that authenticated the user. */
  providerId: string;
}

// ─── Default Configs ─────────────────────────────────────────────────────────

export const DEFAULT_SAML_ATTRIBUTE_MAPPING: SAMLAttributeMapping = {
  email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  firstName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  lastName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
  displayName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  groups: "http://schemas.xmlsoap.org/claims/Group",
};

export const DEFAULT_OIDC_CLAIM_MAPPING: OIDCClaimMapping = {
  email: "email",
  firstName: "given_name",
  lastName: "family_name",
  displayName: "name",
  groups: "groups",
};

export const DEFAULT_OIDC_SCOPES = ["openid", "email", "profile"];
