# health-mcp

Personal MCP servers that connect your **Strava** (and optionally **Oura Ring**) data to Claude. Self-hosted on your own Vercel account — no shared backend, no third-party intermediary, your data stays yours.

Once deployed, you can chat with Claude on your iPhone, Mac, or web and Claude can see and discuss your workouts, sleep, recovery, etc. in detail. Think: *"What was my longest ride this year?"*, *"How did my heart rate look on yesterday's run?"*, *"Compare my last three weeks of training volume."*

---

## The easy way: let Claude Code deploy it for you

You need:

- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed
- A free [Vercel](https://vercel.com) account
- A [Strava](https://strava.com) account
- About 10 minutes

Then:

```bash
git clone https://github.com/boriscardano/health-mcp.git
cd health-mcp
claude
```

Inside Claude Code, just say:

> Deploy this for me.

Claude Code will read [`CLAUDE.md`](./CLAUDE.md) — a step-by-step runbook — and walk you through registering a Strava API app, deploying to Vercel, completing the one-time OAuth handshake, and adding the server to your Claude account. You answer a handful of questions; Claude Code drives the rest.

When it's done, open Claude on any device, point it at your new MCP server, and ask it about your workouts.

---

## What you get

### `strava-mcp/` — Strava integration (most users want this)

12 tools wrapping the Strava REST API:

- Athlete profile, stats, configured HR/power zones
- Recent activities, paginated activities, full activity detail
- Lap breakdown, in-activity zone time, time-series streams (HR, power, altitude, cadence, etc.)
- Starred segments and segment efforts
- Saved routes

### `oura-mcp/` — Oura Ring integration (optional)

18 tools wrapping the Oura v2 REST API:

- Daily sleep score + detailed per-night stages, HR, HRV, breathing rate
- Readiness, activity, workouts, sessions
- SpO2, stress, resilience, cardiovascular age, VO2 max
- Tags / lifestyle notes
- Time-series heart rate

Skip this if you don't have an Oura Ring. The Claude Code runbook sets up Strava first and then asks if you want Oura.

---

## How it works (technical)

Each subdirectory is a self-contained Next.js 15 app deployed as its own Vercel project. Each app implements:

- An **OAuth 2.1 authorization server** (Dynamic Client Registration, PKCE-S256, JWT auth codes / access / refresh tokens) — required so `claude.ai`'s MCP client can connect.
- The **MCP transport** at `/api/mcp` via [`mcp-handler`](https://github.com/vercel/mcp-handler), gated by `withMcpAuth`.
- Strava-only: a one-time `/strava/connect` flow that completes Strava's OAuth and surfaces the refresh token via Vercel logs.

Each deployment is **single-user** — one Strava (or Oura) account per Vercel project. There is no shared infrastructure between your deployment and anyone else's. The admin password you generate during setup is the only thing standing between random people on the internet and your data.

---

## The manual way

If you'd rather drive everything yourself instead of letting Claude Code do it, [`CLAUDE.md`](./CLAUDE.md) is the same runbook in human-readable form. Every step is a shell command or a browser click.

---

## Security notes

- Each fork is **independently deployed**. Your refresh tokens, JWT secret, and admin password live only as Vercel environment variables on your project. They are never logged in plaintext (except the one-time refresh-token print on `/strava/callback`, which is visible only to operators with `vercel logs` access).
- The OAuth redirect-URI allowlist is **hardcoded** to `https://claude.ai/...` and `https://claude.com/...`. Do not modify it unless you know exactly what you're doing — it's a security boundary.
- The admin-password gate on `/oauth/authorize` and `/strava/connect` is the CSRF defense (Origin / Sec-Fetch checks were too brittle in claude.ai's cross-tab popup flow). Pick a strong password.

If you find a security issue, please email the maintainer privately rather than opening a public issue.

---

## License

MIT — see [`LICENSE`](./LICENSE).
