/**
 * EE Auth — SAML and OIDC stubs for Enterprise Edition.
 * These will be fully implemented in the SAML/OIDC auth PR.
 */

import { requireEE } from "../../config/edition.js";

export interface SAMLConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  callbackUrl: string;
}

export interface OIDCConfig {
  clientId: string;
  clientSecret: string;
  issuer: string;
  redirectUri: string;
  scopes: string[];
}

export function configureSAML(_config: SAMLConfig): void {
  requireEE("SAML Authentication");
  // Full implementation in feat/saml-oidc-auth
}

export function configureOIDC(_config: OIDCConfig): void {
  requireEE("OIDC Authentication");
  // Full implementation in feat/saml-oidc-auth
}
