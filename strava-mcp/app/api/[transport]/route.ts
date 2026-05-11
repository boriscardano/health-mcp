import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { strava } from "@/lib/strava";
import { SCOPE, verifyAccessToken } from "@/lib/oauth";

const idShape = {
  id: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .describe("Numeric Strava ID."),
};

const dateLocalOptional = z
  .string()
  .nullish()
  .describe("ISO 8601 local date/time, e.g. 2026-05-04T00:00:00Z. Omit or pass null for default.");

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool("get_athlete_profile", "Authenticated athlete's profile (id, name, weight, FTP if set, etc.).", {}, async () =>
      jsonResult(await strava.athleteProfile()),
    );

    server.tool(
      "get_athlete_stats",
      "Recent / YTD / all-time totals for the athlete (rides, runs, swims).",
      {
        athlete_id: z
          .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
          .describe("Athlete numeric ID. Get from get_athlete_profile."),
      },
      async ({ athlete_id }) => jsonResult(await strava.athleteStats(athlete_id)),
    );

    server.tool(
      "get_athlete_zones",
      "Configured heart-rate and power zones (Z1–Z5/Z7).",
      {},
      async () => jsonResult(await strava.athleteZones()),
    );

    server.tool(
      "get_recent_activities",
      "Most recent activities (default 30).",
      {
        per_page: z.number().int().min(1).max(200).nullish().describe("Default 30; max 200."),
      },
      async ({ per_page }) => jsonResult(await strava.recentActivities(per_page)),
    );

    server.tool(
      "list_activities",
      "Paginated list of activities, optionally filtered by epoch-second before/after.",
      {
        before: z.number().int().nullish().describe("Unix epoch seconds; activities before this time."),
        after: z.number().int().nullish().describe("Unix epoch seconds; activities after this time."),
        page: z.number().int().min(1).nullish(),
        per_page: z.number().int().min(1).max(200).nullish(),
      },
      async (params) => jsonResult(await strava.activities(params)),
    );

    server.tool(
      "get_activity_details",
      "Full activity detail: distance, time, elevation, power/HR averages, gear, segments.",
      idShape,
      async ({ id }) => jsonResult(await strava.activityDetails(id)),
    );

    server.tool(
      "get_activity_laps",
      "Lap breakdown for an activity.",
      idShape,
      async ({ id }) => jsonResult(await strava.activityLaps(id)),
    );

    server.tool(
      "get_activity_zones",
      "Time spent in each HR / power zone for an activity.",
      idShape,
      async ({ id }) => jsonResult(await strava.activityZones(id)),
    );

    server.tool(
      "get_activity_streams",
      "Time-series streams for an activity (HR, watts, altitude, etc.). Use selectively for long rides.",
      {
        id: idShape.id,
        keys: z
          .array(
            z.enum([
              "time",
              "distance",
              "latlng",
              "altitude",
              "velocity_smooth",
              "heartrate",
              "cadence",
              "watts",
              "temp",
              "moving",
              "grade_smooth",
            ]),
          )
          .nullish()
          .describe("Stream types to return; default: time, distance, heartrate, watts, altitude, velocity_smooth, cadence."),
      },
      async ({ id, keys }) =>
        jsonResult(await strava.activityStreams(id, keys ?? undefined, true)),
    );

    server.tool(
      "list_starred_segments",
      "Segments the athlete has starred (paginated).",
      {
        page: z.number().int().min(1).nullish(),
        per_page: z.number().int().min(1).max(200).nullish(),
      },
      async ({ page, per_page }) => jsonResult(await strava.starredSegments({ page, per_page })),
    );

    server.tool(
      "list_segment_efforts",
      "Athlete's efforts on a specific starred segment.",
      {
        segment_id: idShape.id,
        start_date_local: dateLocalOptional,
        end_date_local: dateLocalOptional,
        per_page: z.number().int().min(1).max(200).nullish(),
      },
      async (p) =>
        jsonResult(
          await strava.listSegmentEfforts(p.segment_id, {
            start_date_local: p.start_date_local,
            end_date_local: p.end_date_local,
            per_page: p.per_page,
          }),
        ),
    );

    server.tool(
      "list_athlete_routes",
      "Routes the athlete has saved.",
      {
        athlete_id: idShape.id,
        page: z.number().int().min(1).nullish(),
        per_page: z.number().int().min(1).max(200).nullish(),
      },
      async (p) =>
        jsonResult(
          await strava.athleteRoutes(p.athlete_id, { page: p.page, per_page: p.per_page }),
        ),
    );
  },
  {},
  { basePath: "/api" },
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  try {
    const claims = await verifyAccessToken(bearerToken);
    return {
      token: bearerToken,
      scopes: claims.scope ? claims.scope.split(" ") : [SCOPE],
      clientId: claims.client_id ?? "unknown",
      extra: { sub: claims.sub },
    };
  } catch {
    return undefined;
  }
};

const handler = withMcpAuth(mcpHandler, verifyToken, {
  required: true,
  requiredScopes: [SCOPE],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { handler as GET, handler as POST, handler as DELETE };
