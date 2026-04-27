/**
 * CE/EE Edition Configuration.
 *
 * Modeled after Onyx's clean CE/EE split:
 * - Community Edition (CE): MIT-licensed core features
 * - Enterprise Edition (EE): SSO, SAML, audit logs, advanced RBAC, analytics
 *
 * EE features overlay on top of CE — the CE codebase is always the base.
 * EE is detected via JUDICA_EDITION env var or license key presence.
 */

export type Edition = "ce" | "ee";

/**
 * Detect the current edition.
 * EE is enabled when:
 *   1. JUDICA_EDITION=ee is set, OR
 *   2. A valid license key is present in JUDICA_LICENSE_KEY
 */
export function getEdition(): Edition {
  if (process.env.JUDICA_EDITION === "ee") return "ee";
  if (process.env.JUDICA_LICENSE_KEY) return "ee";
  return "ce";
}

export const IS_EE = getEdition() === "ee";

/**
 * Guard for EE-only features.
 * Throws if the current edition is CE.
 */
export function requireEE(featureName: string): void {
  if (!IS_EE) {
    throw new Error(
      `Feature '${featureName}' requires Enterprise Edition. ` +
      `Set JUDICA_EDITION=ee or provide a valid JUDICA_LICENSE_KEY.`,
    );
  }
}

/**
 * Conditional EE feature execution.
 * Returns null for CE, or the EE function result.
 */
export async function withEE<T>(
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!IS_EE) return null;
  return fn();
}

// ─── EE Feature Flags ─────────────────────────────────────────────────────────

export interface EEFeatureFlags {
  samlAuth: boolean;
  oidcAuth: boolean;
  auditLogs: boolean;
  advancedRbac: boolean;
  advancedAnalytics: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
  sla: boolean;
}

export function getEEFeatureFlags(): EEFeatureFlags {
  if (!IS_EE) {
    return {
      samlAuth: false,
      oidcAuth: false,
      auditLogs: false,
      advancedRbac: false,
      advancedAnalytics: false,
      customBranding: false,
      prioritySupport: false,
      sla: false,
    };
  }

  return {
    samlAuth: true,
    oidcAuth: true,
    auditLogs: true,
    advancedRbac: true,
    advancedAnalytics: true,
    customBranding: true,
    prioritySupport: true,
    sla: true,
  };
}
