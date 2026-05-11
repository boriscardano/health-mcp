import type { NextConfig } from "next";

const GLOBAL_HEADERS = [
  { key: "strict-transport-security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "x-content-type-options", value: "nosniff" },
  { key: "referrer-policy", value: "no-referrer" },
  { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: GLOBAL_HEADERS }];
  },
};

export default nextConfig;
