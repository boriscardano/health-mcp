const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";
const TOKEN_REFRESH_SKEW_MS = 60_000;

let cachedAccess: { token: string; expiresAt: number } | null = null;

class StravaError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is not set`);
  return v;
}

async function refreshAccessToken(): Promise<string> {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");
  const refreshToken = requireEnv("STRAVA_REFRESH_TOKEN");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new StravaError(`Strava token refresh failed (${res.status})`, res.status, body);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_at: number;
    refresh_token: string;
  };

  cachedAccess = { token: data.access_token, expiresAt: data.expires_at * 1000 };

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    // Strava rotated the refresh token. Don't log the value (it ends up in
    // operator-readable Vercel logs); just flag that a rotation happened so an
    // operator knows to rerun /strava/connect if Strava calls start failing.
    console.warn("[strava] Strava issued a NEW refresh_token. Re-run /strava/connect to capture it.");
  }

  return data.access_token;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedAccess && cachedAccess.expiresAt - now > TOKEN_REFRESH_SKEW_MS) {
    return cachedAccess.token;
  }
  return refreshAccessToken();
}

async function stravaGet(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const auth = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });
  let res = await fetch(url, auth(await getAccessToken()));

  // Cached token may be server-side revoked; on 401 drop the cache and retry once.
  if (res.status === 401) {
    cachedAccess = null;
    res = await fetch(url, auth(await getAccessToken(true)));
  }

  if (!res.ok) {
    const body = await res.text();
    throw new StravaError(`Strava API ${res.status}: ${path}`, res.status, body);
  }
  return res.json();
}

type Maybe<T> = T | null | undefined;

export const strava = {
  athleteProfile: () => stravaGet("/athlete"),
  athleteStats: (id: number | string) => stravaGet(`/athletes/${id}/stats`),
  athleteZones: () => stravaGet("/athlete/zones"),

  recentActivities: (perPage: Maybe<number> = 30) =>
    stravaGet("/athlete/activities", { per_page: perPage ?? 30 }),

  activities: (params: {
    before?: Maybe<number>;
    after?: Maybe<number>;
    page?: Maybe<number>;
    per_page?: Maybe<number>;
  }) =>
    stravaGet("/athlete/activities", {
      before: params.before ?? undefined,
      after: params.after ?? undefined,
      page: params.page ?? undefined,
      per_page: params.per_page ?? undefined,
    }),

  activityDetails: (id: number | string) =>
    stravaGet(`/activities/${id}`, { include_all_efforts: true }),

  activityLaps: (id: number | string) => stravaGet(`/activities/${id}/laps`),

  activityZones: (id: number | string) => stravaGet(`/activities/${id}/zones`),

  activityStreams: (
    id: number | string,
    keys: string[] = ["time", "distance", "heartrate", "watts", "altitude", "velocity_smooth", "cadence"],
    keyByType = true,
  ) =>
    stravaGet(`/activities/${id}/streams`, {
      keys: keys.join(","),
      key_by_type: keyByType,
    }),

  segmentEffort: (id: number | string) => stravaGet(`/segment_efforts/${id}`),
  listSegmentEfforts: (segmentId: number | string, params: { start_date_local?: Maybe<string>; end_date_local?: Maybe<string>; per_page?: Maybe<number> }) =>
    stravaGet("/segment_efforts", {
      segment_id: segmentId,
      start_date_local: params.start_date_local ?? undefined,
      end_date_local: params.end_date_local ?? undefined,
      per_page: params.per_page ?? undefined,
    }),

  starredSegments: (params: { page?: Maybe<number>; per_page?: Maybe<number> } = {}) =>
    stravaGet("/segments/starred", {
      page: params.page ?? undefined,
      per_page: params.per_page ?? undefined,
    }),

  athleteRoutes: (athleteId: number | string, params: { page?: Maybe<number>; per_page?: Maybe<number> }) =>
    stravaGet(`/athletes/${athleteId}/routes`, {
      page: params.page ?? undefined,
      per_page: params.per_page ?? undefined,
    }),
};

export async function exchangeAuthCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: unknown;
}> {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new StravaError(`Strava code exchange failed (${res.status})`, res.status, body);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete: unknown;
  }>;
}

export const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
export const STRAVA_DEFAULT_SCOPES = "read,activity:read_all,profile:read_all";

import { createHmac, randomBytes } from "node:crypto";

export const STATE_COOKIE = "strava_state";
export const STATE_TTL_SECONDS = 600;

export function signState(value: string): string {
  return createHmac("sha256", requireEnv("JWT_SECRET")).update(value).digest("hex");
}

export function makeState(): { value: string; signed: string } {
  const value = randomBytes(24).toString("hex");
  return { value, signed: signState(value) };
}
