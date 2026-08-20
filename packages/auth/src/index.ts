import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export type AccessTokenPayload = {
  sub: string;
  sid: string;
};

export async function signAccessToken(
  secret: string,
  payload: AccessTokenPayload,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ sid: payload.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (!payload.sub || typeof payload.sid !== "string") {
    throw new Error("invalid_token");
  }
  return { sub: payload.sub, sid: payload.sid };
}

export const ACCESS_COOKIE = "schoolapp_access";

function cookieSecurityFlags(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function accessCookieHeader(token: string, maxAgeSeconds: number): string {
  return `${ACCESS_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax${cookieSecurityFlags()}; Max-Age=${maxAgeSeconds}`;
}

export function clearAccessCookieHeader(): string {
  return `${ACCESS_COOKIE}=; HttpOnly; Path=/; SameSite=Lax${cookieSecurityFlags()}; Max-Age=0`;
}
