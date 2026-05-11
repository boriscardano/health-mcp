import { exchangeAuthCode, signState, STATE_COOKIE } from "@/lib/strava";
import { getIssuer, timingSafeEqual } from "@/lib/oauth";

export const runtime = "nodejs";

const NO_STORE: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};

const CLEAR_STATE_COOKIE = `${STATE_COOKIE}=; Path=/strava; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function page(body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strava connected — strava-mcp</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;color:#222}
h1{font-size:22px;margin:0 0 8px}
p{line-height:1.5;color:#555}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.04)}
pre,code{font-family:ui-monospace,monospace;font-size:13px}
pre{background:#0e0e0e;color:#e9e9e9;padding:14px;border-radius:8px;overflow-x:auto}
.warn{background:#fff8d8;border:1px solid #f0d56b;padding:12px;border-radius:8px;margin:14px 0;color:#553}
.ok{background:#e9f8ef;border:1px solid #6cc89a;padding:12px;border-radius:8px;margin:14px 0;color:#0a4}
.err{background:#fee;border:1px solid #f99;padding:12px;border-radius:8px;color:#900}
</style></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "set-cookie": CLEAR_STATE_COOKIE, ...NO_STORE },
  });
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const stateFromStrava = url.searchParams.get("state") ?? "";
  const cookieHeader = req.headers.get("cookie");
  const stateCookie = parseCookie(cookieHeader, STATE_COOKIE) ?? "";

  if (error) {
    return page(`<div class="card"><h1>Strava authorization failed</h1><div class="err">authorization denied</div></div>`, 400);
  }
  if (!code) {
    return page(`<div class="card"><h1>Missing code</h1><div class="err">No code in callback URL.</div></div>`, 400);
  }
  if (!stateFromStrava || !stateCookie) {
    return page(
      `<div class="card"><h1>State missing</h1><div class="err">CSRF state cookie missing. Restart at <code>/strava/connect</code>.</div></div>`,
      400,
    );
  }
  const expectedSigned = signState(stateFromStrava);
  if (!timingSafeEqual(stateCookie, expectedSigned)) {
    return page(
      `<div class="card"><h1>State mismatch</h1><div class="err">CSRF check failed. Restart at <code>/strava/connect</code>.</div></div>`,
      400,
    );
  }

  let result;
  try {
    result = await exchangeAuthCode(code);
  } catch {
    return page(`<div class="card"><h1>Token exchange failed</h1><div class="err">Failed to exchange code with Strava.</div></div>`, 500);
  }

  // The refresh token is sensitive. Print it ONLY to the server's stdout (visible
  // via `vercel logs`); never render it in HTML, where browser extensions, screen
  // recorders, or accidental screenshares could capture it.
  console.log("[strava] STRAVA_REFRESH_TOKEN =", result.refresh_token);

  return page(
    `<div class="card">
      <h1>✅ Strava connected</h1>
      <div class="ok">Refresh token written to server stdout. View it with:</div>
      <pre>vercel logs ${getIssuer()} | grep STRAVA_REFRESH_TOKEN</pre>
      <p>Then save it as the <code>STRAVA_REFRESH_TOKEN</code> env var on Vercel and redeploy:</p>
      <pre>printf '&lt;token&gt;' | vercel env add STRAVA_REFRESH_TOKEN production
vercel deploy --prod</pre>
      <div class="warn">If you don't see the token in the log within ~30 s, rerun <code>/strava/connect</code>.</div>
    </div>`,
  );
}
