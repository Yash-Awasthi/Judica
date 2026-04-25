/**
 * MFA / TOTP service — RFC 6238 compliant two-factor authentication.
 *
 * Implements TOTP natively using Node's built-in crypto module so there is no
 * dependency on otplib or speakeasy. The algorithm follows RFC 6238 / RFC 4226:
 *  1. Derive HMAC-SHA1 of (counter = floor(time/30)) using the shared secret.
 *  2. Dynamic truncation → 6-digit OTP.
 *
 * Backup codes: 10 random 8-character hex codes, hashed with argon2id at rest.
 */
import crypto, { randomUUID } from "crypto";
import argon2 from "argon2";
import { db } from "../lib/drizzle.js";
import { mfaConfig } from "../db/schema/mfa.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/crypto.js";
import { AppError } from "../middleware/errorHandler.js";

const TOTP_STEP = 30; // seconds per time-step
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // allow ±1 step for clock skew

// ─── TOTP core ───────────────────────────────────────────────────────────────

/** Encode a Buffer as base32 (RFC 4648, no padding) */
function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decode a base32 string to Buffer */
function base32Decode(str: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = str.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character: " + char);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Compute HOTP for a given secret (base32) and counter value */
function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  // Write 64-bit big-endian counter (JS numbers are safe up to 2^53)
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Compute TOTP token for a given Unix timestamp (seconds) */
function totpAt(secret: string, timestampSecs: number): string {
  const counter = Math.floor(timestampSecs / TOTP_STEP);
  return hotp(secret, counter);
}

/** Verify TOTP token within ±TOTP_WINDOW time steps */
function verifyTotpToken(secret: string, token: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const expected = totpAt(secret, now + delta * TOTP_STEP);
    if (timingSafeEquals(token, expected)) return true;
  }
  return false;
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Backup codes ────────────────────────────────────────────────────────────

function generateRawBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );
}

async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(
    codes.map((c) =>
      argon2.hash(c, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 })
    )
  );
}

// ─── QR code URL ─────────────────────────────────────────────────────────────

function buildOtpAuthUrl(secret: string, username: string): string {
  const issuer = encodeURIComponent("AiByAi");
  const account = encodeURIComponent(username);
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;
}

/**
 * Build a data-URL for the QR code using Google Charts API (no server-side
 * dependency). In production you may swap this for a local qrcode library.
 */
function buildQrDataUrl(otpAuthUrl: string): string {
  const encoded = encodeURIComponent(otpAuthUrl);
  return `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encoded}&choe=UTF-8`;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function getConfig(userId: number) {
  const [row] = await db
    .select()
    .from(mfaConfig)
    .where(eq(mfaConfig.userId, userId))
    .limit(1);
  return row;
}

async function getUsername(userId: number): Promise<string> {
  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AppError(404, "User not found");
  return user.username;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateSecret(
  userId: number
): Promise<{ secret: string; qrCodeDataUrl: string; backupCodes: string[] }> {
  const username = await getUsername(userId);

  // 20 random bytes → 160 bits secret (standard TOTP key size)
  const rawSecret = base32Encode(crypto.randomBytes(20));
  const plainCodes = generateRawBackupCodes();
  const hashedCodes = await hashBackupCodes(plainCodes);

  const encryptedSecret = encrypt(rawSecret);

  const existing = await getConfig(userId);
  if (existing) {
    await db
      .update(mfaConfig)
      .set({
        secret: encryptedSecret,
        enabled: false,
        backupCodes: hashedCodes,
        verifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(mfaConfig.userId, userId));
  } else {
    await db.insert(mfaConfig).values({
      id: randomUUID(),
      userId,
      secret: encryptedSecret,
      enabled: false,
      backupCodes: hashedCodes,
    });
  }

  const otpAuthUrl = buildOtpAuthUrl(rawSecret, username);
  const qrCodeDataUrl = buildQrDataUrl(otpAuthUrl);

  return { secret: rawSecret, qrCodeDataUrl, backupCodes: plainCodes };
}

export async function verifyTOTP(userId: number, token: string): Promise<boolean> {
  const config = await getConfig(userId);
  if (!config || !config.enabled) return false;

  let plainSecret: string;
  try {
    plainSecret = decrypt(config.secret);
  } catch {
    throw new AppError(500, "Failed to decrypt MFA secret");
  }

  return verifyTotpToken(plainSecret, token);
}

export async function enableMFA(userId: number, verificationToken: string): Promise<void> {
  const config = await getConfig(userId);
  if (!config) throw new AppError(400, "MFA setup not started. Call /api/mfa/setup first.");
  if (config.enabled) throw new AppError(400, "MFA is already enabled");

  let plainSecret: string;
  try {
    plainSecret = decrypt(config.secret);
  } catch {
    throw new AppError(500, "Failed to decrypt MFA secret");
  }

  if (!verifyTotpToken(plainSecret, verificationToken)) {
    throw new AppError(400, "Invalid TOTP token");
  }

  await db
    .update(mfaConfig)
    .set({ enabled: true, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(mfaConfig.userId, userId));
}

export async function disableMFA(userId: number, password: string): Promise<void> {
  const config = await getConfig(userId);
  if (!config || !config.enabled) throw new AppError(400, "MFA is not enabled");

  // Verify password before disabling MFA
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.passwordHash) {
    throw new AppError(400, "Cannot verify identity — no password set");
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) throw new AppError(401, "Incorrect password");

  await db
    .update(mfaConfig)
    .set({ enabled: false, verifiedAt: null, updatedAt: new Date() })
    .where(eq(mfaConfig.userId, userId));
}

export async function verifyBackupCode(userId: number, code: string): Promise<boolean> {
  const config = await getConfig(userId);
  if (!config || !config.enabled) return false;

  const storedCodes = (config.backupCodes as string[]) ?? [];
  const upperCode = code.toUpperCase().trim();

  for (let i = 0; i < storedCodes.length; i++) {
    const isMatch = await argon2.verify(storedCodes[i], upperCode).catch(() => false);
    if (isMatch) {
      // Invalidate used code
      const remaining = [...storedCodes];
      remaining.splice(i, 1);
      await db
        .update(mfaConfig)
        .set({ backupCodes: remaining, updatedAt: new Date() })
        .where(eq(mfaConfig.userId, userId));
      return true;
    }
  }

  return false;
}

export async function isMFARequired(userId: number): Promise<boolean> {
  const config = await getConfig(userId);
  return config?.enabled === true;
}

export async function regenerateBackupCodes(userId: number): Promise<string[]> {
  const config = await getConfig(userId);
  if (!config || !config.enabled) throw new AppError(400, "MFA is not enabled");

  const plainCodes = generateRawBackupCodes();
  const hashedCodes = await hashBackupCodes(plainCodes);

  await db
    .update(mfaConfig)
    .set({ backupCodes: hashedCodes, updatedAt: new Date() })
    .where(eq(mfaConfig.userId, userId));

  return plainCodes;
}
