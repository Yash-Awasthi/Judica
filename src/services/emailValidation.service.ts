/**
 * Disposable Email Blocking Service
 *
 * Blocks registration from known disposable/temporary email providers.
 * Uses a built-in blocklist + optional external validation.
 */

import logger from "../lib/logger.js";

const log = logger.child({ service: "email-validation" });

// ─── Built-in Disposable Email Domains ────────────────────────────────────────
// Top ~200 most common disposable email domains
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "guerrillamail.com", "guerrillamailblock.com", "grr.la",
  "guerrillamail.info", "guerrillamail.net", "mailinator.com", "maildrop.cc",
  "tempmail.com", "temp-mail.org", "throwaway.email", "yopmail.com",
  "sharklasers.com", "guerrillamail.de", "dispostable.com", "mailnesia.com",
  "trashmail.com", "trashmail.me", "trashmail.net", "getnada.com",
  "mohmal.com", "tempail.com", "emailondeck.com", "33mail.com",
  "mailcatch.com", "mailexpire.com", "mailmoat.com", "mytemp.email",
  "spamgourmet.com", "tempmailaddress.com", "tempr.email", "discard.email",
  "fakeinbox.com", "filzmail.com", "harakirimail.com", "incognitomail.org",
  "mailnull.com", "nomail.xl.cx", "nospam.ze.tc", "spamfree24.org",
  "tempinbox.com", "trash-mail.com", "trashymail.com", "wegwerfmail.de",
  "wegwerfmail.net", "wh4f.org", "yopmail.fr", "yopmail.net",
  "jetable.org", "link2mail.net", "meltmail.com", "mintemail.com",
  "sneakemail.com", "spambox.us", "spamcero.com", "spamex.com",
  "temporaryemail.net", "temporaryforwarding.com", "thankyou2010.com",
  "binkmail.com", "bobmail.info", "chammy.info", "devnullmail.com",
  "dontreg.com", "e4ward.com", "emailigo.de", "emailtemporario.com.br",
  "ephemail.net", "etranquil.com", "etranquil.net", "etranquil.org",
  "gishpuppy.com", "go2vpn.net", "greensloth.com", "haltospam.com",
  "imails.info", "inboxclean.com", "inboxclean.org", "jobbikszyer.tk",
  "kasmail.com", "koszmail.pl", "kurzepost.de", "lawlita.com",
  "letthemeatspam.com", "lhsdv.com", "lifebyfood.com", "lookugly.com",
  "lr78.com", "maileater.com", "mailexpire.com", "mailforspam.com",
  "mailfreeonline.com", "mailguard.me", "mailin8r.com", "mailinator2.com",
  "mailincubator.com", "mailismagic.com", "mailmate.com", "mailme.ir",
  "mailme.lv", "mailmetrash.com", "mailnator.com", "mailsiphon.com",
  "mailzilla.com", "mbx.cc", "mega.zik.dj", "meinspamschutz.de",
  "meltmail.com", "messagebeamer.de", "mierdamail.com", "ministry-of-silly-walks.de",
  "mt2015.com", "myspaceinc.com", "myspaceinc.net", "myspaceinc.org",
  "myspacepimpedup.com", "mytrashmail.com", "neomailbox.com", "nepwk.com",
  "nervmich.net", "nervtansen.de", "netmails.com", "netmails.net",
  "neverbox.com", "no-spam.ws", "nobulk.com", "noclickemail.com",
  "nogmailspam.info", "nomail.xl.cx", "nomail2me.com", "nomorespamemails.com",
  "nospam.ze.tc", "nothingtoseehere.ca", "nowmymail.com", "nurfuerspam.de",
  "nus.edu.sg", "nwldx.com", "objectmail.com", "obobbo.com",
  "onewaymail.com", "oopi.org", "ordinaryamerican.net", "owlpic.com",
  "pookmail.com", "proxymail.eu", "putthisinyouremail.com", "qq.com",
  "quickinbox.com", "rcpt.at", "reallymymail.com", "recode.me",
  "regbypass.com", "regbypass.comsafe-mail.net", "rejectmail.com",
  "rhyta.com", "rklips.com", "rmqkr.net", "royal.net",
  "rtrtr.com", "s0ny.net", "safe-mail.net", "safersignup.de",
  "safetymail.info", "safetypost.de", "sandelf.de", "saynotospams.com",
  "scatmail.com", "schafmail.de", "selfdestructingmail.com", "sendspamhere.com",
  "shiftmail.com", "shitmail.me", "shortmail.net", "sibmail.com",
  "skeefmail.com", "slaskpost.se", "slipry.net", "slopsbox.com",
  "smashmail.de", "soodonims.com", "spam.la", "spam.su",
  "spamavert.com", "spambob.com", "spambob.net", "spambob.org",
  "spambog.com", "spambog.de", "spambog.ru", "spamcannon.com",
  "spamcannon.net", "spamcero.com", "spamcorptastic.com", "spamcowboy.com",
  "spamcowboy.net", "spamcowboy.org", "spamday.com", "spamfighter.cf",
  "spamfighter.ga", "spamfighter.gq", "spamfighter.ml", "spamfighter.tk",
  "spamfree.eu", "spamfree24.com", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net", "spamhereplease.com", "spamhole.com",
  "spamify.com", "spaml.com", "spaml.de", "spammotel.com",
  "spamobox.com", "spamoff.de", "spamslicer.com", "spamspot.com",
  "spamstack.net", "spamthis.co.uk", "spamtrap.ro", "spamtrail.com",
  "superrito.com", "suremail.info", "teleworm.us", "tempalias.com",
  "tempemailer.com", "tempemail.biz", "tempemail.co.za", "tempemail.com",
  "tempemail.net", "tempinbox.co.uk", "tempmail.eu", "tempmail.it",
  "tempmail2.com", "tempmaildemo.com", "tempmailer.com", "tempomail.fr",
  "temporarily.de", "temporarioemail.com.br", "temporaryemail.us",
  "temporaryforwarding.com", "temporaryinbox.com", "temporarymailaddress.com",
  "thankyou2010.com", "thisisnotmyrealemail.com", "throwawayemailaddress.com",
  "tittbit.in", "tradermail.info", "trash-amil.com", "trash2009.com",
  "trashemail.de", "trashmail.at", "trashmail.com", "trashmail.de",
  "trashmail.io", "trashmail.me", "trashmail.net", "trashmailer.com",
  "trashymail.com", "trashymail.net",
]);

// ─── Email Validation ─────────────────────────────────────────────────────────

export interface EmailValidationResult {
  valid: boolean;
  reason?: "disposable" | "invalid_format" | "blocked_domain";
  domain?: string;
}

/**
 * Validate email address — checks format and disposable domain blocklist.
 */
export function validateEmail(email: string): EmailValidationResult {
  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, reason: "invalid_format" };
  }

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) {
    return { valid: false, reason: "invalid_format" };
  }

  // Check disposable domain blocklist
  if (DISPOSABLE_DOMAINS.has(domain)) {
    log.info({ domain, email: email.split("@")[0].slice(0, 2) + "***" }, "Disposable email blocked");
    return { valid: false, reason: "disposable", domain };
  }

  // Check for subaddressing on disposable domains (e.g., user+tag@disposable.com)
  // Also check parent domain for subdomain-based evasion
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parentDomain = parts.slice(-2).join(".");
    if (DISPOSABLE_DOMAINS.has(parentDomain)) {
      log.info({ domain, parentDomain }, "Disposable subdomain blocked");
      return { valid: false, reason: "disposable", domain };
    }
  }

  return { valid: true, domain };
}

/**
 * Check if a domain is in the disposable list.
 */
export function isDisposableDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (DISPOSABLE_DOMAINS.has(lower)) return true;
  const parts = lower.split(".");
  if (parts.length > 2) {
    return DISPOSABLE_DOMAINS.has(parts.slice(-2).join("."));
  }
  return false;
}

/**
 * Get count of blocked domains (for admin stats).
 */
export function getBlockedDomainCount(): number {
  return DISPOSABLE_DOMAINS.size;
}
