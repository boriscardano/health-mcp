# CLAUDE.md — deployment runbook

You are Claude Code, helping someone deploy their own private copy of `health-mcp` so they can connect Strava (and optionally Oura) to Claude. This file is your runbook. Follow it step by step.

The user is the **operator** of their own Vercel project. You drive the shell commands; they answer questions and click browser links you give them. Their data never leaves their own Vercel deployment.

## Ground rules

- **Do not assume the user has anything installed.** Check first.
- **Never invent secrets, URLs, IDs, or paths.** If you don't have a value, read it from disk or ask.
- **Print the `ADMIN_PASSWORD` exactly once** to the user, and tell them to save it. Do not print it again in later steps.
- **Do not print `JWT_SECRET`, `STRAVA_CLIENT_SECRET`, or `STRAVA_REFRESH_TOKEN`** to the user. These flow from generation/Vercel-logs straight into `vercel env add`.
- **Confirm before each destructive command** (`vercel env rm`, `vercel deploy --prod`, etc.) when it might overwrite the user's prior config.
- **Stop and ask** if any step errors. Do not retry blindly.

## Architecture (so you know what you're doing)

This repo has two MCP servers in subdirectories. They deploy as **separate Vercel projects**:

| Directory | What it does | Default? |
| --- | --- | --- |
| `strava-mcp/` | OAuth 2.1 + Strava REST API wrapper, 12 tools | **Yes — set this up first** |
| `oura-mcp/`   | OAuth 2.1 + Oura v2 REST API wrapper, 18 tools | Optional, ask after Strava works |

Each server:
- Is **single-user**: one Strava (or Oura) account per deployment.
- Implements an OAuth 2.1 authorization server (DCR + PKCE-S256, HS256 JWTs) so `claude.ai`'s MCP client connects natively.
- Auto-derives its issuer URL from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, so the operator does NOT need to set `OAUTH_ISSUER_URL` unless they're using a custom domain.

## Step 0 — Confirm intent

Before any commands, say something like:

> "I'll walk you through deploying your own private Strava MCP server to Vercel. The whole thing takes about 10 minutes. We'll:
>
> 1. Check / install prerequisites
> 2. Register a Strava API app (you'll do this in a browser)
> 3. Deploy to your Vercel account
> 4. Do a one-time Strava OAuth handshake
> 5. Add the server to Claude
>
> Ready to start?"

Wait for an affirmative answer.

## Step 1 — Check prerequisites

Run these in parallel:

```bash
vercel --version
vercel whoami
openssl version
```

- **`vercel --version` errors** → tell the user to install: `npm i -g vercel` (or `brew install vercel-cli`). Wait for them to confirm.
- **`vercel whoami` errors** → tell the user to run `vercel login` themselves (it opens a browser). Wait for confirmation.
- **`openssl` missing** (unlikely on Mac/Linux) → fall back to `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` for Steps 2.

Tell the user which Vercel scope `vercel whoami` returned so they know where their project will end up.

## Step 2 — Generate secrets

```bash
JWT_SECRET=$(openssl rand -hex 48)
ADMIN_PASSWORD=$(openssl rand -hex 16)
echo "ADMIN_PASSWORD: $ADMIN_PASSWORD"
```

Show the `ADMIN_PASSWORD` value to the user (the only secret you print). Tell them:

> "**Save this password somewhere safe** — a password manager is ideal. You'll need it to:
>
> 1. Authorize Strava at the one-time connect page (Step 8 below)
> 2. Authorize Claude when adding the MCP server (Step 12 below)
>
> If you lose it, you can rotate it later, but it's easier to just save it now."

Keep both `JWT_SECRET` and `ADMIN_PASSWORD` in working memory for use later in this session. Do NOT echo `JWT_SECRET` to the user.

## Step 3 — Strava API app registration

Tell the user:

> "Open https://www.strava.com/settings/api in your browser. If you haven't created an API app yet:
>
> - Click 'Create & Manage Your App' (or similar)
> - **Application Name**: anything (e.g. `Personal MCP`)
> - **Category**: 'Data Importer'
> - **Website**: anything (e.g. `https://example.com`)
> - **Authorization Callback Domain**: enter `localhost` for now — we'll change it after the Vercel URL exists
>
> Accept the Strava API agreement. Then tell me when the app is created."

After they confirm, ask for:
- **Client ID** — a 6-ish-digit number shown on the page
- **Client Secret** — a 40-char hex string, also on the page (Strava sometimes hides it behind a 'Show' button)

Store both as `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` in working memory. Do NOT echo them.

## Step 4 — Link the strava-mcp project to Vercel

```bash
cd strava-mcp
vercel link
```

This is interactive — the user will pick:
- Scope (their personal account or a team)
- Project name (suggest `health-mcp-strava`, but let them pick)

Stream the output so they can answer. When done, verify:

```bash
cat .vercel/project.json
```

You should see `projectId` and `orgId`. If not, something went wrong — re-run `vercel link`.

## Step 5 — Set environment variables

Set the four required env vars on `production`. Use `printf` (not `echo`) so no trailing newline is appended:

```bash
printf "%s" "$JWT_SECRET" | vercel env add JWT_SECRET production
printf "%s" "$ADMIN_PASSWORD" | vercel env add ADMIN_PASSWORD production
printf "%s" "<the Client ID the user gave you>" | vercel env add STRAVA_CLIENT_ID production
printf "%s" "<the Client Secret the user gave you>" | vercel env add STRAVA_CLIENT_SECRET production
```

You do **not** need to set `OAUTH_ISSUER_URL` — `lib/oauth.ts` auto-derives it from Vercel's built-in `VERCEL_PROJECT_PRODUCTION_URL`. Skip it.

If any `vercel env add` errors with "already exists", run `vercel env rm <NAME> production -y` and retry. Confirm with the user before each `rm`.

## Step 6 — First deploy

```bash
vercel deploy --prod
```

Wait for the deploy to finish (30–60s typically). The command prints the production URL on the last line, like:

```
https://health-mcp-strava-abc123.vercel.app
```

**Capture this URL**. Set `DEPLOY_URL` and `DEPLOY_HOST` in working memory:

```bash
DEPLOY_URL="https://health-mcp-strava-abc123.vercel.app"   # use the actual URL
DEPLOY_HOST="health-mcp-strava-abc123.vercel.app"          # without https://
```

Smoke-test it:

```bash
curl -sI "$DEPLOY_URL/.well-known/oauth-authorization-server" | head -1
```

Expect `HTTP/2 200`. If you get a 500 or build error, check `vercel logs $DEPLOY_URL` for the missing env var or syntax error.

## Step 7 — Update Strava callback domain

The deployment now exists, so Strava needs to know about it. Tell the user:

> "Go back to https://www.strava.com/settings/api and edit your app. Change **Authorization Callback Domain** from `localhost` to:
>
> `$DEPLOY_HOST`
>
> (Paste exactly — no `https://`, no path, no trailing slash.) Click Update, then tell me when you've done it."

Wait for explicit confirmation. The Strava OAuth flow will silently reject the callback if this is wrong.

## Step 8 — Do the one-time Strava OAuth handshake

Tell the user:

> "Open this URL in your browser:
>
> $DEPLOY_URL/strava/connect
>
> Type the admin password I gave you in Step 2. Click 'Continue to Strava', then click 'Authorize' on Strava's page. You should land on a green success page that says `✅ Strava connected`. Tell me when you see it."

Wait for confirmation. If they get a state-mismatch error, they navigated weirdly — have them retry `/strava/connect`. If they get a token-exchange error, the Strava client_id/secret in Vercel env vars is wrong; re-check Step 5.

## Step 9 — Extract the refresh token from Vercel logs

The success page wrote the refresh token to stdout. Fetch the most recent logs:

```bash
vercel logs "$DEPLOY_URL" 2>&1 | grep "STRAVA_REFRESH_TOKEN" | tail -3
```

You'll see a line like:

```
[strava] STRAVA_REFRESH_TOKEN = abc123def456...
```

Extract the token (everything after `= ` and before any whitespace/newline). Store as `REFRESH_TOKEN` in working memory. Do NOT show it to the user.

If `grep` returns nothing:
- Make sure you waited until *after* the user saw the success page in Step 8
- Try `vercel logs` without piping to grep, look for the line manually
- If still nothing, the OAuth flow likely didn't reach the callback — have the user redo Step 8

## Step 10 — Set the refresh token and redeploy

```bash
printf "%s" "$REFRESH_TOKEN" | vercel env add STRAVA_REFRESH_TOKEN production
vercel deploy --prod
```

The deploy URL should match the previous one (Vercel reuses the production hostname).

## Step 11 — Verify the MCP endpoint

```bash
curl -sI "$DEPLOY_URL/api/mcp" | head -3
```

Expect **`HTTP/2 401`** with a `WWW-Authenticate` header pointing at the resource metadata. That's correct — it means the MCP layer is alive and demanding auth.

If you get `500`, check `vercel logs` for missing env vars.

## Step 12 — Connect to Claude

Tell the user:

> "Your MCP server is live at:
>
> `$DEPLOY_URL/api/mcp`
>
> To connect it to **claude.ai**:
>
> 1. Open https://claude.ai/settings/connectors in a desktop browser (mobile won't let you add, but once added it works everywhere)
> 2. Click **Add custom connector**
> 3. Name: `Strava` (or whatever you want)
> 4. URL: `$DEPLOY_URL/api/mcp`
> 5. Click Connect
> 6. You'll be redirected to a small `Approve access` page. Type the admin password from Step 2.
> 7. You'll be redirected back to Claude with the integration enabled.
>
> Then try asking Claude: *'What's my most recent activity on Strava?'*"

If they prefer Claude Code over the web UI, they can add the MCP locally:

```bash
claude mcp add --transport http strava $DEPLOY_URL/api/mcp
```

(The first invocation will pop a browser window for OAuth.)

## Step 13 (optional) — Oura Ring

Ask: *"Do you also want to set up the Oura Ring server? It needs an Oura Ring and a Personal Access Token from https://cloud.ouraring.com/personal-access-tokens. Skip if you don't have one."*

If yes, repeat the flow for `oura-mcp/`, but **shorter**:

1. `cd ../oura-mcp && vercel link` — pick a different project name (e.g. `health-mcp-oura`)
2. Generate fresh `JWT_SECRET` and `ADMIN_PASSWORD` (cleanest), OR reuse the Strava ones (lazier). Tell the user which you're doing.
3. Set env vars: `JWT_SECRET`, `ADMIN_PASSWORD`, `OURA_ACCESS_TOKEN` (the PAT the user gives you).
4. `vercel deploy --prod`
5. Skip the connect-flow steps (Oura uses a static PAT, no OAuth handshake).
6. Verify with `curl -sI <oura-deploy-url>/api/mcp` → expect 401.
7. Tell the user the Oura MCP URL and have them add it as a second connector in Claude.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `vercel deploy` fails: `JWT_SECRET env var is not set` | Step 5 missed | Re-run Step 5, redeploy |
| `/strava/callback` shows "State mismatch" | User opened it directly, or cookie expired (10 min TTL) | Have them restart at `/strava/connect` |
| `/strava/callback` shows "Token exchange failed" | Wrong `STRAVA_CLIENT_ID` or `STRAVA_CLIENT_SECRET` | Re-check Step 5, fix the env var, redeploy |
| `vercel logs` shows no `STRAVA_REFRESH_TOKEN` line | OAuth didn't complete, or logs queried for wrong URL | Confirm success page was shown; use exact `$DEPLOY_URL` |
| Claude says "Failed to connect" | `/.well-known/oauth-authorization-server` not returning 200, or `OAUTH_ISSUER_URL` mismatched | `curl` the well-known endpoint; check `vercel logs` |
| MCP tools call but return 401 | Access token expired and refresh failed | Check `vercel logs` for Strava 401s; the refresh token may have been rotated — re-do Step 8 |
| User added a custom domain after deploy | `OAUTH_ISSUER_URL` still auto-derives to `*.vercel.app` | `vercel env add OAUTH_ISSUER_URL production` with the custom domain, redeploy |

## What NOT to do

- **Do not commit env values to git.** Everything goes through `vercel env add`. `.gitignore` already excludes `.env*`.
- **Do not log the JWT_SECRET, STRAVA_CLIENT_SECRET, or STRAVA_REFRESH_TOKEN.** They flow through env-var commands or working-memory variables, never to stdout/the user/git.
- **Do not modify the redirect-URI allowlist** in `lib/oauth.ts` (`EXACT_REDIRECT_URIS`). It's a security boundary — `claude.ai` and `claude.com` are the only legitimate MCP-client callbacks.
- **Do not skip the admin-password gate.** Without it, anyone on the internet can authorize their own client against the user's server and pull their data.
- **Do not bypass `vercel env add` by writing a local `.env.production` file.** Vercel only reads from the dashboard / CLI-set env vars on deploy.

## When the deployment is working

Suggest a few first prompts to try:

- "What was my longest ride this year?"
- "Show me my heart-rate distribution on yesterday's workout."
- "How does my running volume compare week-over-week for the last month?"
- "Find segments I've starred in the Alps."

And mention housekeeping:

- **Rotate `ADMIN_PASSWORD`**: `vercel env rm ADMIN_PASSWORD production -y && printf "%s" "<new>" | vercel env add ADMIN_PASSWORD production && vercel deploy --prod`. Then re-authorize Claude.
- **Rotate Strava refresh token**: re-run `/strava/connect` flow, extract from `vercel logs`, `vercel env rm STRAVA_REFRESH_TOKEN production -y && printf "%s" "<new>" | vercel env add STRAVA_REFRESH_TOKEN production && vercel deploy --prod`.
- **Pause the deployment**: `vercel project rm <name>` removes it entirely. Or in the dashboard, you can pause without deleting.
