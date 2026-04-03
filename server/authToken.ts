import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const s =
    process.env.MUSICLIST_AUTH_SECRET?.trim() || process.env.EASY_GEMA_AUTH_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MUSICLIST_AUTH_SECRET muss in Produktion gesetzt sein (mind. 16 Zeichen)."
    );
  }
  return "musiclist-dev-auth-secret-min-16";
}

export function signUserToken(userId: string): string {
  const exp = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp }), "utf8").toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUserToken(token: string): { userId: string } | null {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig) return null;
  const expected = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  try {
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      return null;
    }
  } catch {
    return null;
  }
  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return { userId: payload.sub };
}
