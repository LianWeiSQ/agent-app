#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = path.resolve(appRoot, "../openharness");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const bridgeToken = "performance-ui-smoke-token";
const attachmentSentinel = "PERFORMANCE_PRIVATE_ATTACHMENT_SENTINEL";

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

function createLargeWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), "performance fixture\n");
  for (let index = 0; index < 5_200; index += 1) {
    const directory = path.join(workspace, "src", `group-${Math.floor(index / 100)}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `fixture-${index}.rs`), `pub const FIXTURE_${index}: usize = ${index};\n`);
  }
  fs.writeFileSync(path.join(workspace, "large-diff.txt"), "baseline\n");
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "performance@example.invalid"],
    ["config", "user.name", "Performance Smoke"],
    ["add", "."],
    ["commit", "-q", "-m", "baseline"],
  ]) {
    const result = spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  }
  fs.appendFileSync(
    path.join(workspace, "large-diff.txt"),
    Array.from({ length: 5_500 }, (_, index) => `changed line ${index}`).join("\n") + "\n",
  );
}

function startProvider(port) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "performance-model", object: "model" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "performance-response", output_text: "ok", usage: { input_tokens: 2, output_tokens: 1 } }));
    });
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
        OPENAI_API_KEY: "performance-local-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        OPENAI_MODEL: "performance-model",
        OPENAGENT_MODEL: "performance-model",
        OPENAI_WIRE_API: "responses",
        OPENAGENT_PROVIDER_STREAM: "0",
        OPENAGENT_BRIDGE_MAX_STEPS: "1",
      },
    },
  );
}

async function seedLargeSession(port, workspace) {
  const created = await bridgeJson(port, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ cwd: workspace, title: "Performance baseline" }),
  });
  const sessionId = created.session_id;
  assert.ok(sessionId, "session id missing");
  for (let index = 0; index < 100; index += 1) {
    const turn = await bridgeJson(port, `/api/sessions/${sessionId}/turns`, {
      method: "POST",
      body: JSON.stringify({ input: `short performance message ${index}`, stream: false, permission: "FULL" }),
    });
    assert.equal(turn.status, "completed", `turn ${index} did not complete`);
  }
  const attachmentTurn = await bridgeJson(port, `/api/sessions/${sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({
      input: "attachment projection fixture",
      stream: false,
      permission: "FULL",
      attachments: [{
        kind: "file",
        name: "large-fixture.txt",
        size_bytes: 1_200_000,
        original_content_bytes: 1_200_000,
        included_content_bytes: attachmentSentinel.length,
        content: attachmentSentinel,
        truncated: true,
      }],
    }),
  });
  assert.equal(attachmentTurn.status, "completed");
  return sessionId;
}

async function openPerformance(page) {
  if (!(await page.locator(".settings-shell").isVisible().catch(() => false))) {
    await page.locator(".settings-profile-button").click();
  }
  await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".settings-nav button").filter({ hasText: "性能与稳定性" }).click();
  await page.getByRole("heading", { name: "性能与稳定性", exact: true, level: 2 }).waitFor({ state: "visible" });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-performance-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  const tokenPath = path.join(tempRoot, "bridge-token");
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.writeFileSync(tokenPath, `${bridgeToken}\n`, { mode: 0o600 });
  createLargeWorkspace(workspace);
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
    const sessionId = await seedLargeSession(runtimePort, workspace);
    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appRoot });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);

    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(({ bridgeUrl, token, project, activeSession }) => {
      localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
      localStorage.setItem("openagent.desktop.token", token);
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "performance", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
      localStorage.setItem("openagent.desktop.activeSessions", JSON.stringify({ [project]: activeSession }));
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace, activeSession: sessionId });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openPerformance(page);
    await page.getByRole("button", { name: "运行基线", exact: true }).click();
    await page.locator(".performance-summary").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator(".performance-profile").nth(4).waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await page.locator(".performance-profile").count(), 5);
    await page.getByText("大仓库扫描", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("长会话投影", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("大 Diff 汇总", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("多任务投影", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("大附件投影", { exact: true }).waitFor({ state: "visible" });
    assert.match((await page.locator(".performance-summary").textContent()) || "", /4 \/ 5/);
    assert.equal((await page.locator("body").textContent())?.includes(attachmentSentinel), false);
    await page.screenshot({ path: "/tmp/openagent-performance-ui-smoke.png", fullPage: true });

    const probe = await bridgeJson(runtimePort, `/api/performance?session_id=${encodeURIComponent(sessionId)}`);
    assert.equal(probe.latest.profile_count, 5);
    assert.equal(probe.latest.full_scale_count, 4);
    assert.equal(JSON.stringify(probe).includes(attachmentSentinel), false);
    const persistedPath = path.join(sessionRoot, ".openagent-runtime", "performance", `${sessionId}.json`);
    assert.equal(fs.existsSync(persistedPath), true);
    assert.equal(fs.readFileSync(persistedPath, "utf8").includes(attachmentSentinel), false);

    await stopChild(runtime);
    runtime = startRuntime(runtimePort, providerPort, workspace, sessionRoot, tokenPath, vitePort);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openPerformance(page);
    await page.locator(".performance-summary").waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.locator(".performance-profile").count(), 5);
    console.log("performance UI smoke passed");
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
