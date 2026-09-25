import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Dev-only terminal logging. API routes log themselves without query strings (mock links carry a signature);
  // server function arguments include the connect form's access key ID; browser errors can quote presigned URLs.
  logging: {
    incomingRequests: { ignore: [/\/api\//] },
    serverFunctions: false,
    browserToTerminal: false,
  },
  // A dynamic fs.readdir makes the tracer copy the whole repo into the standalone server; keep source, tests and tooling out.
  // Globs are not anchored to the project root, so a bare "src/**" would also drop node_modules/regex/src (shiki needs it).
  outputFileTracingExcludes: {
    "/*": [
      ".claude/**",
      ".env*",
      "src/**/*.{ts,tsx,css}",
      "docs/**/*.md",
      "e2e/**",
      "tests/**/*.{ts,tsx}",
      "fixtures/bucket/**",
      "scripts/*.sh",
      "*.md",
      "Dockerfile",
      "docker-compose.yml",
      "Jenkinsfile",
      "package-lock.json",
      "tsconfig.json",
      "components.json",
      "*.config.{ts,mjs}",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
