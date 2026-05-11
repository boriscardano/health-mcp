import { getIssuer, timingSafeEqual } from "@/lib/oauth";
import { STRAVA_AUTH_URL, STRAVA_DEFAULT_SCOPES, STATE_COOKIE, STATE_TTL_SECONDS, makeState } from "@/lib/strava";

export const runtime = "nodejs";

const NO_STORE: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function form(error?: string): Response {
  const errorBlock = error
    ? `<div style="background:#fee;border:1px solid #f99;padding:12px;border-radius:8px;margin:16px 0;color:#900">${escape(error)}</div>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Strava — strava-mcp</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#222}
h1{font-size:22px;margin:0 0 8px}
p{line-height:1.5;color:#555}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.04)}
input[type=password]{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px;font-family:ui-monospace,monospace;box-sizing:border-box}
button{margin-top:16px;width:100%;padding:12px;background:#fc4c02;color:#fff;border:0;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600}
button:hover{background:#d63f00}
.muted{color:#888;font-size:13px}
</style></head><body>
<div class="card">
  <h1>Connect your Strava account</h1>
  <p>One-time flow. After approval, the refresh token is written to the server's stdout (visible only via <code>vercel logs</code>) — never to the browser.</p>
  ${errorBlock}
  <form method="POST" action="/strava/connect">
    <label for="pwd" class="muted">Admin password</label>
    <input id="pwd" type="password" name="password" autocomplete="current-password" autofocus required>
    <button type="submit">Continue to Strava →</button>
  </form>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE } });
}

export async function GET() {
  return form();
}

export async function POST(req: Request) {
  // CSRF defense here is the admin password (line below); browser-level Origin/
  // Sec-Fetch-Site gates were too brittle for the cross-tab popup flows.
  const data = await req.formData();
  const pwd = String(data.get("password") ?? "");
  const adminPwd = process.env.ADMIN_PASSWORD;
  if (!adminPwd) return new Response("Server misconfigured", { status: 500, headers: NO_STORE });
  if (!timingSafeEqual(pwd, adminPwd)) return form("Wrong password.");

  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return new Response("Server misconfigured", { status: 500, headers: NO_STORE });

  const { value, signed } = makeState();
  const url = new URL(STRAVA_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${getIssuer()}/strava/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", STRAVA_DEFAULT_SCOPES);
  url.searchParams.set("state", value);

  const cookie = `${STATE_COOKIE}=${signed}; Path=/strava; Max-Age=${STATE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "set-cookie": cookie, ...NO_STORE },
  });
}
