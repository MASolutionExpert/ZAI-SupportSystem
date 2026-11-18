import type { NextConfig } from "next";

/**
 * Production-oriented defaults:
 *  - standalone build artifacts (used by the Docker image)
 *  - strict security headers (pragmatic CSP compatible with Next.js runtime)
 *  - no x-powered-by fingerprint
 */
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  poweredByHeader: false,
  // Native/bundler-averse server packages: pdf-parse (pdfjs worker) and
  // mammoth must stay outside the server bundle (KB text extraction).
  serverExternalPackages: ["pdf-parse", "mammoth"],
  // Development-only: allow the sandbox/browser origin for HMR assets.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js injects inline scripts/styles for hydration and styling.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      {
        // Never cache API responses (they carry session-scoped data).
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
