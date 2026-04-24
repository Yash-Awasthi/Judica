/**
 * EE Barrel Export — Enterprise Edition feature modules.
 *
 * All EE features check for IS_EE at runtime and throw
 * if called from a Community Edition deployment.
 */

export { IS_EE, getEdition, requireEE, withEE, getEEFeatureFlags } from "../config/edition.js";
export type { Edition, EEFeatureFlags } from "../config/edition.js";
