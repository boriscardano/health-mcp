import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { oura } from "@/lib/oura";
import { SCOPE, verifyAccessToken } from "@/lib/oauth";

const dateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .nullish()
  .describe("YYYY-MM-DD; defaults to today (or start_date for end). Omit or pass null to use the default.");

const datetimeOptional = z
  .string()
  .nullish()
  .describe("ISO 8601 datetime, e.g. 2026-05-04T00:00:00+00:00. Omit or pass null to use the default.");

const dateRangeShape = {
  start_date: dateOptional,
  end_date: dateOptional,
};

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      "get_personal_info",
      "Get Oura profile (age, weight, height, sex, email).",
      {},
      async () => jsonResult(await oura.personalInfo()),
    );

    server.tool(
      "get_daily_sleep",
      "Daily sleep score and contributors (efficiency, REM, deep, latency, timing) for a date range.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.dailySleep(start_date, end_date)),
    );

    server.tool(
      "get_sleep",
      "Detailed per-night sleep periods: stages, HR, HRV, breathing rate, restless periods.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.sleep(start_date, end_date)),
    );

    server.tool(
      "get_sleep_time",
      "Recommended bedtime window based on circadian patterns.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.sleepTime(start_date, end_date)),
    );

    server.tool(
      "get_readiness",
      "Daily readiness score with contributors (HRV balance, RHR, recovery index, body temp).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.readiness(start_date, end_date)),
    );

    server.tool(
      "get_activity",
      "Daily activity: steps, calories, active minutes, intensity breakdown.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.activity(start_date, end_date)),
    );

    server.tool(
      "get_workouts",
      "Workouts logged in Oura (auto-detected or manually added).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.workouts(start_date, end_date)),
    );

    server.tool(
      "get_sessions",
      "Meditation, breathing and relaxation sessions tracked in Oura.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.sessions(start_date, end_date)),
    );

    server.tool(
      "get_spo2",
      "Daily SpO2 (blood oxygen) average and breathing disturbance index.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.spo2(start_date, end_date)),
    );

    server.tool(
      "get_stress",
      "Daily stress vs recovery time breakdown and day summary (restored/normal/stressful).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.stress(start_date, end_date)),
    );

    server.tool(
      "get_resilience",
      "Daily resilience scores and contributors (sleep recovery, daytime recovery, stress).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.resilience(start_date, end_date)),
    );

    server.tool(
      "get_cardiovascular_age",
      "Daily vascular age estimate.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.cardiovascularAge(start_date, end_date)),
    );

    server.tool(
      "get_vo2_max",
      "VO2 max measurements (cardiorespiratory fitness).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.vo2Max(start_date, end_date)),
    );

    server.tool(
      "get_rest_mode",
      "Periods when Oura rest mode was enabled (recovery / illness).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.restMode(start_date, end_date)),
    );

    server.tool(
      "get_ring_info",
      "Hardware metadata for paired Oura ring(s).",
      {},
      async () => jsonResult(await oura.ringInfo()),
    );

    server.tool(
      "get_tags",
      "Manual tags / lifestyle notes (caffeine, alcohol, etc.).",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.tags(start_date, end_date)),
    );

    server.tool(
      "get_enhanced_tags",
      "Enhanced tags with timestamps and durations.",
      dateRangeShape,
      async ({ start_date, end_date }) =>
        jsonResult(await oura.enhancedTags(start_date, end_date)),
    );

    server.tool(
      "get_heart_rate",
      "Time-series heart rate readings with source (awake/rest/sleep/workout). Use ISO 8601 datetimes; window <= 24h recommended.",
      {
        start_datetime: datetimeOptional,
        end_datetime: datetimeOptional,
      },
      async ({ start_datetime, end_datetime }) =>
        jsonResult(await oura.heartRate(start_datetime, end_datetime)),
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
