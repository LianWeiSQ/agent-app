import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = path.resolve(appDir, "../openharness");

function gitFiles(root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function readableTextFiles(root) {
  return gitFiles(root).filter((relative) => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > 1_000_000) return false;
    const sample = fs.readFileSync(file).subarray(0, 8_192);
    return !sample.includes(0);
  });
}

function lineFor(text, index) {
  return text.slice(0, index).split("\n").length;
}

function scanSecrets(root, label) {
  const findings = [];
  const privateKey = new RegExp(`BEGIN [A-Z ]*${"PRIVATE"} KEY`, "g");
  const secretKey = new RegExp(`(?:^|[^A-Za-z0-9])${"sk"}-[A-Za-z0-9_-]{24,}`, "gm");
  const githubToken = new RegExp(`(?:${"ghp"}_[A-Za-z0-9]{30,}|${"github_pat"}_[A-Za-z0-9_]{30,})`, "g");
  const awsKey = new RegExp(`${"AKIA"}[0-9A-Z]{16}`, "g");
  const patterns = [privateKey, secretKey, githubToken, awsKey];
  for (const relative of readableTextFiles(root)) {
    if (relative === "scripts/check-p0.mjs") continue;
    if (/\.env(?:\.|$)/.test(path.basename(relative)) && !/\.env\.(?:example|sample|template)$/.test(relative)) {
      findings.push(`${label}/${relative}: tracked private env file`);
      continue;
    }
    const text = fs.readFileSync(path.join(root, relative), "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) findings.push(`${label}/${relative}:${lineFor(text, match.index)}: possible secret`);
    }
  }
  return findings;
}

function inertButtons() {
  const file = path.join(appDir, "src/App.tsx");
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];
  function walk(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === "button") {
      const attributes = node.openingElement.attributes.properties.filter(ts.isJsxAttribute);
      const names = new Set(attributes.map((attribute) => attribute.name.getText(sourceFile)));
      const type = attributes.find((attribute) => attribute.name.getText(sourceFile) === "type");
      const typeText = type?.initializer?.getText(sourceFile) ?? "";
      if (!names.has("onClick") && !typeText.includes("submit")) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(`src/App.tsx:${position.line + 1}: button has no action`);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return findings;
}

function requireSource(relative, fragments) {
  const text = fs.readFileSync(path.join(appDir, relative), "utf8");
  for (const fragment of fragments) assert.ok(text.includes(fragment), `${relative} missing ${fragment}`);
  return text;
}

assert.ok(fs.existsSync(coreDir), `shared core checkout missing at ${coreDir}`);
const secrets = [...scanSecrets(appDir, "app"), ...scanSecrets(coreDir, "openharness")];
assert.deepEqual(secrets, [], `sensitive material found:\n${secrets.join("\n")}`);
assert.deepEqual(inertButtons(), [], "inert Desktop controls found");

const tauriConfig = JSON.parse(fs.readFileSync(path.join(appDir, "src-tauri/tauri.conf.json"), "utf8"));
const csp = tauriConfig.app?.security?.csp;
assert.equal(typeof csp, "string", "Tauri CSP must be enabled");
for (const directive of ["default-src", "object-src 'none'", "connect-src", "http://127.0.0.1:*"]) {
  assert.ok(csp.includes(directive), `Tauri CSP missing ${directive}`);
}
assert.ok(!csp.includes("default-src *"), "Tauri CSP must not allow every source");

const tauriSource = requireSource("src-tauri/src/lib.rs", [
  "OPENAGENT_BRIDGE_AUTH_TOKEN_FILE",
  "DESKTOP_BRIDGE_CORS_ORIGINS",
  "write_secret_file",
]);
assert.ok(!tauriSource.includes('.arg("--auth-token")'), "managed Bridge exposes token in argv");
for (const relative of gitFiles(appDir).filter((file) => file.startsWith("scripts/") && file.endsWith(".mjs"))) {
  if (relative === "scripts/check-p0.mjs") continue;
  assert.ok(!fs.readFileSync(path.join(appDir, relative), "utf8").includes("--auth-token"), `${relative} exposes token in argv`);
}

const appSource = requireSource("src/App.tsx", [
  "STORAGE_ACTIVE_SESSIONS",
  "sessionViewEpochRef",
  "turn/retrying",
  "turn/fallback",
  "/retry",
]);
for (const placeholder of [">搜索<", "适用于日常工作", 'case "browser"', 'case "hooks"', 'case "personalization"']) {
  assert.ok(!appSource.includes(placeholder), `Desktop still exposes placeholder ${placeholder}`);
}

const runtimeSource = fs.readFileSync(path.join(coreDir, "runtime/http/src/http_runtime.rs"), "utf8");
const routeSource = fs.readFileSync(path.join(coreDir, "runtime/http/src/bridge_routes.rs"), "utf8");
for (const fragment of ["DEFAULT_CORS_ORIGINS", "turn/retrying", "turn/fallback", "retry_turn_response"]) {
  assert.ok(`${runtimeSource}\n${routeSource}`.includes(fragment), `shared runtime missing ${fragment}`);
}
assert.ok(!runtimeSource.includes('cors_origin: "*".to_string()'), "runtime default CORS remains wildcard");

for (const artifact of [
  ".github/workflows/p0.yml",
  "scripts/smoke-session-lifecycle-ui.mjs",
  "scripts/smoke-provider-recovery-ui.mjs",
]) {
  assert.ok(fs.existsSync(path.join(appDir, artifact)), `P0 artifact missing: ${artifact}`);
}

process.stdout.write(`${JSON.stringify({ ok: true, secret_files_scanned: readableTextFiles(appDir).length + readableTextFiles(coreDir).length, inert_buttons: 0, csp: true }, null, 2)}\n`);
