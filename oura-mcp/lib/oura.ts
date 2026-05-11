const BASE = "https://api.ouraring.com/v2/usercollection";

class OuraError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
  }
}

async function ouraGet(path: string, params: Record<string, string | undefined> = {}): Promise<unknown> {
  const token = process.env.OURA_ACCESS_TOKEN;
  if (!token) throw new Error("OURA_ACCESS_TOKEN env var not set");

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new OuraError(`Oura API ${res.status}: ${path}`, res.status, body);
  }
  return res.json();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type Maybe = string | null | undefined;

function dateRange(start_date: Maybe, end_date: Maybe) {
  const start = start_date ?? todayISO();
  const end = end_date ?? start;
  return { start_date: start, end_date: end };
}

export const oura = {
  personalInfo: () => ouraGet("/personal_info"),
  dailySleep: (s: Maybe, e: Maybe) => ouraGet("/daily_sleep", dateRange(s, e)),
  sleep: (s: Maybe, e: Maybe) => ouraGet("/sleep", dateRange(s, e)),
  sleepTime: (s: Maybe, e: Maybe) => ouraGet("/sleep_time", dateRange(s, e)),
  readiness: (s: Maybe, e: Maybe) => ouraGet("/daily_readiness", dateRange(s, e)),
  activity: (s: Maybe, e: Maybe) => ouraGet("/daily_activity", dateRange(s, e)),
  workouts: (s: Maybe, e: Maybe) => ouraGet("/workout", dateRange(s, e)),
  sessions: (s: Maybe, e: Maybe) => ouraGet("/session", dateRange(s, e)),
  spo2: (s: Maybe, e: Maybe) => ouraGet("/daily_spo2", dateRange(s, e)),
  stress: (s: Maybe, e: Maybe) => ouraGet("/daily_stress", dateRange(s, e)),
  resilience: (s: Maybe, e: Maybe) => ouraGet("/daily_resilience", dateRange(s, e)),
  cardiovascularAge: (s: Maybe, e: Maybe) => ouraGet("/daily_cardiovascular_age", dateRange(s, e)),
  vo2Max: (s: Maybe, e: Maybe) => ouraGet("/vO2_max", dateRange(s, e)),
  restMode: (s: Maybe, e: Maybe) => ouraGet("/rest_mode_period", dateRange(s, e)),
  ringInfo: () => ouraGet("/ring_configuration"),
  tags: (s: Maybe, e: Maybe) => ouraGet("/tag", dateRange(s, e)),
  enhancedTags: (s: Maybe, e: Maybe) => ouraGet("/enhanced_tag", dateRange(s, e)),
  heartRate: (start_datetime: Maybe, end_datetime: Maybe) =>
    ouraGet("/heartrate", {
      start_datetime: start_datetime ?? undefined,
      end_datetime: end_datetime ?? undefined,
    }),
};
