import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// Resolve from this package, for both src/ and compiled dist/ entry points.
loadEnv({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
