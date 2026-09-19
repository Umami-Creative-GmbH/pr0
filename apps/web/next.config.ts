import path from "node:path";

import type { NextConfig } from "next";

if (!process.versions.bun) {
  throw new Error(
    "This application requires Bun. Use the repository's bun run commands."
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  logging: { incomingRequests: false },
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
};

export default nextConfig;
