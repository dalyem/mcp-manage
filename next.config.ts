import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon — keep it external so Next/webpack
  // doesn't try to bundle the .node binary.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
