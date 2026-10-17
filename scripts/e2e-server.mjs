import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
// Override .env.local for both build and runtime: E2E never uses a remote bill service.
const env = {
  ...process.env,
  NEXT_PUBLIC_SHARED_BILLS_ENABLED: "false",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
};
let child;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child?.kill(signal));
}
function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [nextCli, ...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) reject(new Error(`Next.js stopped: ${signal ?? code}`));
      else resolve();
    });
  });
}
try {
  await run(["build"]);
  await run(["start", "--hostname", "127.0.0.1", "--port", "3100"]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
