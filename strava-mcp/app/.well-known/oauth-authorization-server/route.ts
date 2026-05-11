import { getIssuer } from "@/lib/oauth";

export const dynamic = "force-static";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "public, max-age=300",
};

export async function GET() {
  const ISSUER_URL = getIssuer();
  return Response.json(
    {
      issuer: ISSUER_URL,
      authorization_endpoint: `${ISSUER_URL}/oauth/authorize`,
      token_endpoint: `${ISSUER_URL}/oauth/token`,
      registration_endpoint: `${ISSUER_URL}/oauth/register`,
      scopes_supported: ["mcp"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: CORS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
