import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = path.resolve(appDir, "../openharness");

const steps = [
  ["Static P0 and secret audit", "npm", ["run", "check:p0"], appDir],
  ["Frontend build", "npm", ["run", "build"], appDir],
  ["Core format", "cargo", ["fmt", "--all", "--", "--check"], coreDir],
  ["Desktop Rust format", "cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"], appDir],
  ["Core runtime check", "cargo", ["check", "-p", "openagent-http-runtime"], coreDir],
  ["Build release Bridge sidecar", "cargo", ["build", "-p", "openagent-http-runtime", "--release"], coreDir],
  ["Desktop Rust check", "cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"], appDir],
  ["Core runtime tests", "cargo", ["test", "-p", "openagent-http-runtime", "--", "--test-threads=2"], coreDir],
  ["Desktop Rust tests", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib"], appDir],
  ["Session isolation smoke", "npm", ["run", "smoke:session-lifecycle"], appDir],
  ["Provider recovery smoke", "npm", ["run", "smoke:provider-recovery"], appDir],
];

for (const [label, command, args, cwd] of steps) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write("\nP0 CI acceptance passed.\n");
