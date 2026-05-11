import { issueAuthCode, isRedirectAllowed, timingSafeEqual } from "@/lib/oauth";

export const runtime = "nodejs";

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "pragma": "no-cache",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com; frame-ancestors 'none'; base-uri 'none'",
};

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function htmlForm(params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  error?: string;
}): Response {
  const errorBlock = params.error
    ? `<div style="background:#fee;border:1px solid #f99;padding:12px;border-radius:8px;margin:16px 0;color:#900">${escape(params.error)}</div>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve access — strava-mcp</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#222}
h1{font-size:22px;margin:0 0 8px}
p{line-height:1.5;color:#555}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.04)}
input[type=password]{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px;font-family:ui-monospace,monospace;box-sizing:border-box}
button{margin-top:16px;width:100%;padding:12px;background:#111;color:#fff;border:0;border-radius:8px;font-size:15px;cursor:pointer}
button:hover{background:#000}
.muted{color:#888;font-size:13px}
code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:12px}
</style>
</head><body>
<div class="card">
  <h1>Approve access</h1>
  <p>Client <code>${escape(params.client_id)}</code> is requesting <strong>mcp</strong> access. Redirect after approval: <code>${escape(params.redirect_uri)}</code></p>
  ${errorBlock}
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${escape(params.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escape(params.redirect_uri)}">
    <input type="hidden" name="state" value="${escape(params.state)}">
    <input type="hidden" name="code_challenge" value="${escape(params.code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${escape(params.code_challenge_method)}">
    <label for="pwd" class="muted">Admin password</label>
    <input id="pwd" type="password" name="password" autocomplete="current-password" autofocus required>
    <button type="submit">Approve</button>
  </form>
</div>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = {
    client_id: url.searchParams.get("client_id") ?? "",
    redirect_uri: url.searchParams.get("redirect_uri") ?? "",
    state: url.searchParams.get("state") ?? "",
    response_type: url.searchParams.get("response_type") ?? "",
    code_challenge: url.searchParams.get("code_challenge") ?? "",
    code_challenge_method: url.searchParams.get("code_challenge_method") ?? "",
  };

  if (p.response_type !== "code") return new Response("response_type must be 'code'", { status: 400 });
  if (p.code_challenge_method !== "S256" || !p.code_challenge) {
    return new Response("PKCE with S256 is required", { status: 400 });
  }
  if (!isRedirectAllowed(p.redirect_uri)) {
    return new Response("redirect_uri not allowed", { status: 400 });
  }

  return htmlForm(p);
}

export async function POST(req: Request) {
  // CSRF protection here is the admin password: an attacker would need to know it
  // to submit a successful form. Origin / Sec-Fetch-Site gates were too brittle in
  // some browser flows; the password gate is the real defense.
  const form = await req.formData();
  const p = {
    client_id: String(form.get("client_id") ?? ""),
    redirect_uri: String(form.get("redirect_uri") ?? ""),
    state: String(form.get("state") ?? ""),
    code_challenge: String(form.get("code_challenge") ?? ""),
    code_challenge_method: String(form.get("code_challenge_method") ?? ""),
    password: String(form.get("password") ?? ""),
  };

  if (!isRedirectAllowed(p.redirect_uri)) {
    return new Response("redirect_uri not allowed", { status: 400, headers: SECURITY_HEADERS });
  }
  if (p.code_challenge_method !== "S256" || !p.code_challenge) {
    return new Response("PKCE missing", { status: 400, headers: SECURITY_HEADERS });
  }

  const adminPwd = process.env.ADMIN_PASSWORD;
  if (!adminPwd) return new Response("Server misconfigured", { status: 500, headers: SECURITY_HEADERS });

  if (!timingSafeEqual(p.password, adminPwd)) {
    return htmlForm({ ...p, error: "Wrong password. Try again." });
  }

  const { jwt: code } = await issueAuthCode({
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    code_challenge_method: "S256",
  });

  const redirect = new URL(p.redirect_uri);
  redirect.searchParams.set("code", code);
  if (p.state) redirect.searchParams.set("state", p.state);
  return new Response(null, { status: 302, headers: { location: redirect.toString(), ...SECURITY_HEADERS } });
}
