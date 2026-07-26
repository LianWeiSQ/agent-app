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
const bridgeToken = "capability-ui-smoke-token";

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

async function waitForHttp(url, headers = {}, timeoutMs = 90_000) {
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
  return { response, payload };
}

function startRuntime(port, workspace, sessionRoot, tokenPath, vitePort) {
  return spawnLogged(
    "cargo",
    [
      "run", "-q", "-p", "openagent-http-runtime", "--", "--host", "127.0.0.1",
      "--port", String(port), "--workspace", workspace, "--session-root", sessionRoot,
      "--cors-origin", `http://127.0.0.1:${vitePort}`,
    ],
    {
      cwd: coreRoot,
      env: { ...process.env, OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath },
    },
  );
}

async function openCapabilities(page) {
  if (!(await page.locator(".settings-shell").isVisible().catch(() => false))) {
    await page.locator(".settings-profile-button").click();
  }
  await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".settings-nav button").filter({ hasText: "能力与权限" }).click();
  await page.getByRole("heading", { name: "能力与权限", exact: true, level: 2 }).waitFor({ state: "visible" });
}

function capabilityCard(page, label) {
  return page.locator(`.capability-card:has(.capability-card-heading strong:text-is("${label}"))`);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-capabilities-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  const tokenPath = path.join(tempRoot, "bridge-token");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.writeFileSync(tokenPath, `${bridgeToken}\n`, { mode: 0o600 });
  const runtimePort = await freePort();
  const vitePort = await freePort();
  let runtime;
  let vite;
  let browser;
  try {
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appRoot });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);

    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(({ bridgeUrl, token, project }) => {
      localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
      localStorage.setItem("openagent.desktop.token", token);
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "capabilities", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openCapabilities(page);

    const browserCard = capabilityCard(page, "Browser");
    const computerCard = capabilityCard(page, "Computer");
    const terminalCard = capabilityCard(page, "Terminal");
    await browserCard.waitFor({ state: "visible" });
    assert.match((await browserCard.textContent()) || "", /rust-web-fetch/);
    assert.match((await computerCard.textContent()) || "", /不可用/);
    assert.match((await terminalCard.textContent()) || "", /workspace-shell/);

    await browserCard.getByLabel("Browser permission policy").selectOption("ask");
    await terminalCard.getByLabel("Terminal permission policy").selectOption("ask");
    await computerCard.getByRole("button", { name: /诊断/ }).click();
    await computerCard.getByText(/no computer-control adapter/).waitFor({ state: "visible" });

    const created = await bridgeJson(runtimePort, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ cwd: workspace, title: "Capability approval" }),
    });
    assert.equal(created.response.status, 201);
    const sessionId = created.payload.session_id;
    const started = await bridgeJson(runtimePort, `/api/sessions/${sessionId}/turns`, {
      method: "POST",
      body: JSON.stringify({
        input: "run approved terminal",
        permission: "FULL",
        tool_call: { call_id: "call_terminal_smoke", name: "bash", input: { command: "printf terminal-approved" } },
      }),
    });
    assert.equal(started.response.status, 200);
    assert.equal(started.payload.status, "waiting_approval");
    const approvalEvent = started.payload.events.find((event) => event.method === "turn/approval_requested");
    assert.equal(approvalEvent.params.approval.metadata.capability_id, "terminal");
    const approval = approvalEvent.params.approval;
    const resolved = await bridgeJson(runtimePort, `/api/turns/${approval.turn_id}/approvals/${approval.request_id}`, {
      method: "POST",
      body: JSON.stringify({ action: "allow", scope: "once" }),
    });
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.payload.events.some((event) => event.params?.output === "terminal-approved"), true);

    await terminalCard.getByLabel("Terminal permission policy").selectOption("allow");
    await page.getByLabel("Terminal command").fill("printf settings-terminal-ok");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByText("settings-terminal-ok", { exact: true }).waitFor({ state: "visible" });
    await page.screenshot({ path: "/tmp/openagent-capabilities-ui-smoke.png", fullPage: true });

    await stopChild(runtime);
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openCapabilities(page);
    assert.equal(await capabilityCard(page, "Browser").getByLabel("Browser permission policy").inputValue(), "ask");
    assert.equal(await capabilityCard(page, "Terminal").getByLabel("Terminal permission policy").inputValue(), "allow");

    const persisted = JSON.parse(fs.readFileSync(path.join(sessionRoot, ".openagent-runtime", "capabilities.json"), "utf8"));
    assert.equal(persisted.capabilities.browser.policy, "ask");
    assert.equal(persisted.capabilities.terminal.policy, "allow");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.join(sessionRoot, ".openagent-runtime", "capabilities.json")).mode & 0o777, 0o600);
    }
    console.log("capabilities UI smoke passed");
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
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
