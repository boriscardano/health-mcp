import { createHash, timingSafeEqual as nodeTimingSafeEqual, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is not set`);
  return v;
}

const JWT_SECRET = new TextEncoder().encode(requireEnv("JWT_SECRET"));

// Lazy so Vercel can auto-inject VERCEL_PROJECT_PRODUCTION_URL when OAUTH_ISSUER_URL is unset.
export function getIssuer(): string {
  const explicit = process.env.OAUTH_ISSUER_URL;
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  throw new Error(
    "OAUTH_ISSUER_URL is not set, and VERCEL_PROJECT_PRODUCTION_URL is not available. " +
      "Set OAUTH_ISSUER_URL to your deployment URL (e.g. https://my-app.vercel.app).",
  );
}

const ALG = "HS256";
export const SCOPE = "mcp";

export const ACCESS_TTL_SECONDS = 3600;
const ACCESS_TTL = `${ACCESS_TTL_SECONDS}s`;
const REFRESH_TTL = "30d";
const CODE_TTL = "5m";

const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]+$/;

const EXACT_REDIRECT_URIS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export function timingSafeEqual(a: string, b: string): boolean {
  // Hash both sides to fixed-length digests so neither length nor content is timing-leaked.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return nodeTimingSafeEqual(ha, hb);
}

export type AccessClaims = JWTPayload & {
  type: "access";
  scope: typeof SCOPE;
  client_id: string;
};

type AuthCodeClaims = JWTPayload & {
  type: "code";
  client_id: string;
  redirect_uri: string;
  scope: typeof SCOPE;
  code_challenge: string;
  code_challenge_method: "S256";
  jti: string;
};

type RefreshClaims = JWTPayload & {
  type: "refresh";
  client_id: string;
  scope: typeof SCOPE;
  jti: string;
};

function randomJti(): string {
  return randomBytes(16).toString("hex");
}

async function sign(payload: JWTPayload, expiresIn: string): Promise<string> {
  const iss = getIssuer();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(iss)
    .setSubject("user")
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

async function verify<T extends JWTPayload = JWTPayload>(token: string): Promise<T> {
  const iss = getIssuer();
  const { payload } = await jwtVerify(token, JWT_SECRET, {
    issuer: iss,
    audience: iss,
    algorithms: [ALG],
    clockTolerance: 5,
  });
  return payload as T;
}

export async function issueAuthCode(args: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
}): Promise<{ jwt: string; jti: string }> {
  const jti = randomJti();
  const jwt = await sign({ ...args, scope: SCOPE, type: "code", jti }, CODE_TTL);
  return { jwt, jti };
}

export async function verifyAuthCode(token: string): Promise<AuthCodeClaims> {
  const claims = await verify<AuthCodeClaims>(token);
  if (claims.type !== "code") throw new Error("Not an auth code");
  return claims;
}

export async function issueAccessToken(args: { client_id: string }): Promise<string> {
  return sign({ ...args, scope: SCOPE, type: "access" }, ACCESS_TTL);
}

export async function issueRefreshToken(args: { client_id: string }): Promise<{ jwt: string; jti: string }> {
  const jti = randomJti();
  const jwt = await sign({ ...args, scope: SCOPE, type: "refresh", jti }, REFRESH_TTL);
  return { jwt, jti };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const claims = await verify<AccessClaims>(token);
  if (claims.type !== "access") throw new Error("Not an access token");
  return claims;
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  const claims = await verify<RefreshClaims>(token);
  if (claims.type !== "refresh") throw new Error("Not a refresh token");
  return claims;
}

export async function pkceVerify(verifier: string, challenge: string): Promise<boolean> {
  if (verifier.length < 43 || verifier.length > 128) return false;
  if (!PKCE_VERIFIER_RE.test(verifier)) return false;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const computed = Buffer.from(hash).toString("base64url");
  return timingSafeEqual(computed, challenge);
}

export function isRedirectAllowed(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;
    if (u.search || u.hash) return false;
    return EXACT_REDIRECT_URIS.has(u.toString());
  } catch {
    return false;
  }
}

export function isSameSiteOrigin(req: Request): boolean {
  // Reject only when the browser tells us the request is unambiguously cross-site,
  // OR when the Origin header is present and points elsewhere. Compare via URL.origin
  // so trailing-slash and casing differences don't cause false rejects.
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(getIssuer()).origin;
  } catch {
    return false;
  }
}
