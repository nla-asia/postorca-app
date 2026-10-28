import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  output: "export",
  assetPrefix: ".",
  poweredByHeader: false,
  turbopack: { root: path.resolve(__dirname, "../..") },
};
export default config;
