import { isRedirectAllowed } from "@/lib/oauth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

function err(status: number, error: string, error_description?: string) {
  return Response.json({ error, error_description }, { status, headers: NO_STORE });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid_request", "JSON body required");
  }

  // Anonymous DCR is accepted because every issued client_id is gated downstream by
  // (a) admin password at /oauth/authorize and (b) exact-match redirect_uri allowlist.
  // A bare client_id alone grants nothing.

  const redirectUris = (body.redirect_uris as string[] | undefined) ?? [];
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return err(400, "invalid_redirect_uri", "redirect_uris is required");
  }
  for (const uri of redirectUris) {
    if (!isRedirectAllowed(uri)) {
      return err(400, "invalid_redirect_uri", `Redirect URI not allowed: ${uri}`);
    }
  }

  const clientId = `mcp_${randomBytes(16).toString("hex")}`;

  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp",
    },
    { status: 201, headers: NO_STORE },
  );
}
