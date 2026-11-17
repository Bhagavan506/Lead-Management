import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lb_session";

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(
  userId: string,
  secret: string,
  expiresIn: string,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(secret));
}

/** Returns the user id, or null if the token is missing, tampered with, or expired. */
export async function verifySession(
  token: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Converts "8h" / "30m" / "7d" / "3600" into seconds, for the cookie max-age. */
export function durationToSeconds(value: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!m) throw new Error(`Invalid JWT_EXPIRES_IN: ${value}`);
  const n = Number(m[1]);
  return n * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "" | "s" | "m" | "h" | "d"];
}
