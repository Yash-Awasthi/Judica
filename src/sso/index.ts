/**
 * SSO — barrel export.
 */

export {
  SSOProviderType,
  SSOProviderStatus,
  DEFAULT_SAML_ATTRIBUTE_MAPPING,
  DEFAULT_OIDC_CLAIM_MAPPING,
  DEFAULT_OIDC_SCOPES,
} from "./models.js";

export type {
  SSOProvider,
  SAMLConfig,
  OIDCConfig,
  SAMLAttributeMapping,
  OIDCClaimMapping,
  SSOSession,
  SSOAuthResult,
} from "./models.js";

export {
  createSSOProvider,
  getSSOProvider,
  listSSOProviders,
  updateSSOProvider,
  deleteSSOProvider,
  findProviderForDomain,
  isSSOEnforced,
  processSSOCallback,
} from "./sso.service.js";
