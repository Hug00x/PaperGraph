import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.56.1"],
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/compile": ["./node_modules/@node-latex-compiler/bin-win32-x64/**/*"],
  },
  outputFileTracingExcludes: {
    "/api/compile": ["./next.config.ts"],
  },
};

export default nextConfig;
