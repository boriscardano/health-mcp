import {
  ACCESS_TTL_SECONDS,
  SCOPE,
  issueAccessToken,
  issueRefreshToken,
  pkceVerify,
  verifyAuthCode,
  verifyRefreshToken,
} from "@/lib/oauth";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
type ErrorBody = { error: string; error_description?: string };
const errResp = (status: number, body: ErrorBody) => Response.json(body, { status, headers: NO_STORE });

function tokenResponse(access: string, refresh: string) {
  return Response.json(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: SCOPE,
    },
    { headers: NO_STORE },
  );
}

async function readForm(req: Request): Promise<URLSearchParams | null> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await req.text());
  }
  if (ct.includes("application/json")) {
    return new URLSearchParams((await req.json()) as Record<string, string>);
  }
  return null;
}

export async function POST(req: Request) {
  const form = await readForm(req);
  if (!form) return errResp(400, { error: "invalid_request", error_description: "Unsupported content-type" });

  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const clientId = form.get("client_id") ?? "";
    const codeVerifier = form.get("code_verifier");

    if (!code || !redirectUri || !codeVerifier) return errResp(400, { error: "invalid_request" });

    let claims;
    try {
      claims = await verifyAuthCode(code);
    } catch {
      return errResp(400, { error: "invalid_grant" });
    }
    if (claims.redirect_uri !== redirectUri) return errResp(400, { error: "invalid_grant" });
    if (clientId && claims.client_id !== clientId) return errResp(400, { error: "invalid_grant" });
    if (!(await pkceVerify(codeVerifier, claims.code_challenge))) return errResp(400, { error: "invalid_grant" });

    const access = await issueAccessToken({ client_id: claims.client_id });
    const { jwt: refresh } = await issueRefreshToken({ client_id: claims.client_id });
    return tokenResponse(access, refresh);
  }

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token");
    const clientId = form.get("client_id") ?? "";
    if (!refresh) return errResp(400, { error: "invalid_request" });

    let claims;
    try {
      claims = await verifyRefreshToken(refresh);
    } catch {
      return errResp(400, { error: "invalid_grant" });
    }
    if (clientId && claims.client_id !== clientId) return errResp(400, { error: "invalid_grant" });

    const access = await issueAccessToken({ client_id: claims.client_id });
    const { jwt: newRefresh } = await issueRefreshToken({ client_id: claims.client_id });
    return tokenResponse(access, newRefresh);
  }

  return errResp(400, { error: "unsupported_grant_type" });
}
