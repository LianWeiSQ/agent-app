#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = path.resolve(appRoot, "../openharness");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const bridgeToken = "storage-migration-ui-smoke-token";
const privateMarker = "PRIVATE_MIGRATION_CONTENT_MUST_NOT_LEAK";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
  const output = [];
  child.stdout?.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => output.push(chunk.toString()));
  child.outputText = () => output.join("").trim();
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitForHttp(url, headers = {}, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function bridgeJson(port, urlPath, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${bridgeToken}`);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${urlPath} ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function startProvider(port) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "storage-smoke-model", object: "model" }] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function startRuntime(port, providerPort, workspace, sessionRoot, tokenPath, vitePort) {
  return spawnLogged(
    "cargo",
    [
      "run", "-q", "-p", "openagent-http-runtime", "--", "--host", "127.0.0.1",
      "--port", String(port), "--workspace", workspace, "--session-root", sessionRoot,
      "--cors-origin", `http://127.0.0.1:${vitePort}`,
    ],
    {
      cwd: coreRoot,
      env: {
        ...process.env,
        OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath,
        OPENAI_API_KEY: "storage-smoke-local-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        OPENAI_MODEL: "storage-smoke-model",
        OPENAGENT_MODEL: "storage-smoke-model",
      },
    },
  );
}

function seedLegacyState(sessionRoot, workspace) {
  const sessionId = "session_storage_legacy_fixture";
  const sessionDir = path.join(sessionRoot, sessionId);
  const runtimeDir = path.join(sessionRoot, ".openagent-runtime");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const state = JSON.stringify({
    session_id: sessionId,
    workspace,
    status: "idle",
    updated_at_ms: 7,
    messages: [{ role: "user", content: privateMarker, metadata: {} }],
    todos: [],
    metadata: {},
  }, null, 2);
  const capabilities = JSON.stringify({ capabilities: {}, private_note: privateMarker, updated_at_ms: 0 });
  fs.writeFileSync(path.join(sessionDir, "state.latest.json"), state);
  fs.writeFileSync(path.join(runtimeDir, "capabilities.json"), capabilities);
  return { sessionId, sessionDir, state, capabilities };
}

async function openStorage(page) {
  if (!(await page.locator(".settings-shell").isVisible().catch(() => false))) {
    await page.locator(".settings-profile-button").click();
  }
  await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".settings-nav button").filter({ hasText: "存储与升级" }).click();
  await page.getByRole("heading", { name: "存储与升级", exact: true, level: 2 }).waitFor({ state: "visible" });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-storage-migration-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  const tokenPath = path.join(tempRoot, "bridge-token");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), "storage migration fixture\n");
  fs.writeFileSync(tokenPath, `${bridgeToken}\n`, { mode: 0o600 });
  const fixture = seedLegacyState(sessionRoot, workspace);
  const runtimePort = await freePort();
  const vitePort = await freePort();
  const providerPort = await freePort();
  let provider;
  let runtime;
  let vite;
  let browser;
  try {
    provider = await startProvider(providerPort);
    runtime = startRuntime(runtimePort, providerPort, workspace, sessionRoot, tokenPath, vitePort);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    const initial = await bridgeJson(runtimePort, "/api/storage");
    assert.equal(initial.readiness, "needs_migration");
    assert.equal(initial.planned_action_count, 3);
    assert.equal(JSON.stringify(initial).includes(privateMarker), false);

    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appRoot });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);
    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(({ bridgeUrl, token, project }) => {
      localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
      localStorage.setItem("openagent.desktop.token", token);
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "storage-fixture", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openStorage(page);
    await page.getByText("需要迁移", { exact: true }).waitFor({ state: "visible" });
    assert.equal((await page.locator("body").textContent())?.includes(privateMarker), false);
    await page.getByRole("button", { name: "安全迁移", exact: true }).click();
    await page.getByText("可以升级", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

    const sessionPath = path.join(fixture.sessionDir, "session.json");
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.sessionDir, "state.latest.json"), "utf8")).schema_version, "openagent.session_state.v1");
    assert.equal(JSON.parse(fs.readFileSync(sessionPath, "utf8")).schema_version, "openagent.session.v1");
    assert.equal(JSON.parse(fs.readFileSync(path.join(sessionRoot, ".openagent-runtime", "capabilities.json"), "utf8")).schema_version, "openagent.capabilities.v1");

    await stopChild(runtime);
    runtime = startRuntime(runtimePort, providerPort, workspace, sessionRoot, tokenPath, vitePort);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openStorage(page);
    await page.getByText("可以升级", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "回滚最近迁移", exact: true }).click();
    await page.getByText("需要迁移", { exact: true }).waitFor({ state: "visible" });
    assert.equal(fs.readFileSync(path.join(fixture.sessionDir, "state.latest.json"), "utf8"), fixture.state);
    assert.equal(fs.readFileSync(path.join(sessionRoot, ".openagent-runtime", "capabilities.json"), "utf8"), fixture.capabilities);
    assert.equal(fs.existsSync(sessionPath), false);

    await page.getByRole("button", { name: "安全迁移", exact: true }).click();
    await page.getByText("可以升级", { exact: true }).waitFor({ state: "visible" });
    await page.screenshot({ path: "/tmp/openagent-storage-migration-ui-smoke.png", fullPage: true });
    const finalStatus = await bridgeJson(runtimePort, "/api/storage");
    assert.equal(finalStatus.readiness, "ready");
    assert.equal(finalStatus.planned_action_count, 0);
    assert.equal(JSON.stringify(finalStatus).includes(privateMarker), false);
    console.log("storage migration UI smoke passed");
  } catch (error) {
    const details = [
      error instanceof Error ? error.stack || error.message : String(error),
      runtime?.outputText?.() ? `runtime:\n${runtime.outputText()}` : "",
      vite?.outputText?.() ? `vite:\n${vite.outputText()}` : "",
    ].filter(Boolean).join("\n\n");
    throw new Error(details);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopChild(vite);
    await stopChild(runtime);
    await new Promise((resolve) => provider?.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
