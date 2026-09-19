import type { NextConfig } from "next";

if (!process.versions.bun) {
  throw new Error(
    "This application requires Bun. Use the repository's bun run commands."
  );
}

const nextConfig: NextConfig = {};

export default nextConfig;
