import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const virtualAdapter = /wsl|hyper-v|vethernet|docker|vmware|virtualbox|loopback|tunnel/i;

function privateNetworkScore(address) {
  if (address.startsWith("192.168.")) return 3;
  if (address.startsWith("10.")) return 2;
  const match = /^172\.(\d+)\./.exec(address);
  return match && Number(match[1]) >= 16 && Number(match[1]) <= 31 ? 1 : 0;
}

function findMobileHost() {
  if (process.env.MOBILE_HOST) return process.env.MOBILE_HOST;

  return Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => address.family === "IPv4" && !address.internal)
        .map((address) => ({
          address: address.address,
          score: privateNetworkScore(address.address) + (virtualAdapter.test(name) ? -10 : 10),
        })),
    )
    .sort((a, b) => b.score - a.score)[0]?.address;
}

function readOption(args, longName, shortName, fallback) {
  const inline = args.find((arg) => arg.startsWith(`${longName}=`));
  if (inline) return inline.slice(longName.length + 1);
  const index = args.findIndex((arg) => arg === longName || arg === shortName);
  return index >= 0 ? args[index + 1] : fallback;
}

const forwardedArgs = process.argv.slice(2);
const port = readOption(forwardedArgs, "--port", "-p", process.env.PORT ?? "3000");
const mobileHost = findMobileHost();
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextCli, "dev", ...forwardedArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

let mobilePrinted = false;
let recentOutput = "";

function forwardOutput(stream, destination) {
  stream.on("data", (chunk) => {
    destination.write(chunk);
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-500);
    if (!mobilePrinted && mobileHost && recentOutput.includes("Network:")) {
      mobilePrinted = true;
      process.stdout.write(`- Mobile:       http://${mobileHost}:${port}\n`);
    }
  });
}

forwardOutput(child.stdout, process.stdout);
forwardOutput(child.stderr, process.stderr);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
