import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import crypto, { randomUUID } from "crypto";
import { db } from "./drizzle.js";
import { refreshTokens } from "../db/schema/auth.js";
import redis from "./redis.js";
import { env } from "../config/env.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_TTL_DAYS = 7;
export const REFRESH_TOKEN_TTL_SECS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

export function generateAccessToken(userId: number, username: string, role: string): string {
  return jwt.sign({ userId, username, role }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: "aibyai",
    audience: env.NODE_ENV,
  });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function fingerprintHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function createRefreshToken(userId: number, ip?: string, userAgent?: string): Promise<string> {
  const rawToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECS * 1000);

  await db.insert(refreshTokens).values({
    id: randomUUID(),
    userId,
    tokenHash,
    ipHash: ip ? fingerprintHash(ip) : null,
    userAgentHash: userAgent ? fingerprintHash(userAgent) : null,
    expiresAt,
  });

  await redis.set(`refresh_family:${tokenHash}`, String(userId), { EX: REFRESH_TOKEN_TTL_SECS });

  return rawToken;
}

export async function issueTokenPair(
  userId: number,
  username: string,
  role: string,
  reply: FastifyReply,
  request?: FastifyRequest,
): Promise<{ token: string; username: string; role: string }> {
  const accessToken = generateAccessToken(userId, username, role);
  const refreshToken = await createRefreshToken(userId, request?.ip, request?.headers["user-agent"]);

  reply.setCookie("access_token", accessToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 15 * 60,
    path: "/",
  });

  reply.setCookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_SECS,
    path: "/api/auth",
  });

  return { token: accessToken, username, role };
}
