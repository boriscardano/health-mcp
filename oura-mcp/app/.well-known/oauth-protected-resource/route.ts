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
      resource: ISSUER_URL,
      authorization_servers: [ISSUER_URL],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
      resource_documentation: `${ISSUER_URL}/`,
    },
    { headers: CORS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
