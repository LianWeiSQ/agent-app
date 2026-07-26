#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const legacyWorkspace = "/tmp/openagent-sse-stability-workspace";
const legacySessionId = "session_legacy_sse_stability";

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
  const child = spawn(command, args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const output = [];
  child.stdout?.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => output.push(chunk.toString()));
  child.outputText = () => output.join("").trim();
  return child;
}

function signalChildTree(child, signal) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ESRCH") throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signalChildTree(child, "SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    signalChildTree(child, "SIGTERM");
  });
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function jsonPayload(urlPath) {
  if (urlPath === "/api/protocol") return { protocol: "openagent.bridge", version: "1" };
  if (urlPath.startsWith("/api/models")) {
    return { healthy: true, provider: "openai", model: "gpt-5.5", models: [{ id: "gpt-5.5", default: true }] };
  }
  if (urlPath.startsWith("/api/mcp")) return { configured: false, enabled: false, servers: [] };
  if (urlPath === "/api/plugins") return { plugins: [], skills: [] };
  if (urlPath === "/api/capabilities") return { capabilities: [] };
  if (urlPath === "/api/sessions") {
    return {
      sessions: [{
        id: legacySessionId,
        session_id: legacySessionId,
        title: "Legacy session",
        workspace: legacyWorkspace,
        created_at_ms: 1_780_000_000_000,
        updated_at_ms: 1_780_000_010_000,
      }],
    };
  }
  if (urlPath === `/api/sessions/${legacySessionId}/messages`) {
    return {
      session_id: legacySessionId,
      messages: [
        { index: 0, role: "user", content: "legacy question", metadata: { message_id: "msg_0" } },
        { index: 1, role: "assistant", content: "legacy assistant response", metadata: { message_id: "msg_1" } },
      ],
      messages_v2: [
        {
          info: {
            id: "msg_0",
            role: "user",
            session_id: legacySessionId,
            run_id: "turn_legacy",
            seq: 0,
            status: "completed",
            created_at_ms: 1_780_000_000_000,
            updated_at_ms: 1_780_000_000_000,
          },
          parts: [{
            id: "part_0",
            message_id: "msg_0",
            session_id: legacySessionId,
            run_id: "turn_legacy",
            seq: 0,
            kind: "text",
            status: "completed",
            content: "legacy question",
            timestamp_ms: 1_780_000_000_000,
          }],
        },
        {
          info: {
            id: "msg_1",
            role: "assistant",
            session_id: legacySessionId,
            run_id: "turn_legacy",
            seq: 1,
            status: "completed",
            created_at_ms: 1_780_000_001_000,
            updated_at_ms: 1_780_000_001_000,
          },
          parts: [{
            id: "part_1",
            message_id: "msg_1",
            session_id: legacySessionId,
            run_id: "turn_legacy",
            seq: 0,
            kind: "text",
            status: "completed",
            content: "legacy assistant response",
            timestamp_ms: 1_780_000_001_000,
          }],
        },
      ],
    };
  }
  if (urlPath === `/api/sessions/${legacySessionId}/tasks`) {
    return { session_id: legacySessionId, tree: [], flat_tasks: [], count: 0 };
  }
  if (urlPath === `/api/sessions/${legacySessionId}/diff`) return { session_id: legacySessionId, files: [] };
  if (urlPath === `/api/sessions/${legacySessionId}/context`) return { session_id: legacySessionId, status: "unavailable" };
  if (urlPath === `/api/sessions/${legacySessionId}/checkpoints`) {
    return { session_id: legacySessionId, checkpoints: [] };
  }
  if (urlPath === "/api/approvals") return { approvals: [] };
  if (urlPath === "/api/questions") return { questions: [] };
  if (urlPath === "/api/turns") return { turns: [] };
  if (urlPath.startsWith("/api/files")) return { entries: [], path: "" };
  if (urlPath.startsWith("/api/git")) return { is_repo: false, changes: [] };
  return {};
}

function startClosingSseBridge(port) {
  let eventRequestCount = 0;
  const server = http.createServer((request, response) => {
    const origin = request.headers.origin || "*";
    const headers = {
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "access-control-allow-origin": origin,
      "cache-control": "no-store",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/api/events") {
      eventRequestCount += 1;
      response.writeHead(200, { ...headers, "content-type": "text/event-stream" });
      response.end(": ping\n\n");
      return;
    }
    if (
      url.pathname === `/api/sessions/${legacySessionId}/goal`
      || url.pathname === `/api/sessions/${legacySessionId}/plan`
    ) {
      response.writeHead(404, { ...headers, "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unknown endpoint" }));
      return;
    }
    response.writeHead(200, { ...headers, "content-type": "application/json" });
    response.end(JSON.stringify(jsonPayload(url.pathname)));
  });
  return {
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
    eventRequestCount: () => eventRequestCount,
  };
}

async function main() {
  const bridgePort = await freePort();
  const vitePort = await freePort();
  const bridge = startClosingSseBridge(bridgePort);
  let vite;
  let browser;
  try {
    await bridge.listen();
    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appRoot });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);

    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(({ bridgeUrl, workspace, sessionId }) => {
      localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
      localStorage.removeItem("openagent.desktop.token");
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([
        { id: workspace, name: "legacy-workspace", path: workspace },
      ]));
      localStorage.setItem("openagent.desktop.activeProject", workspace);
      localStorage.setItem("openagent.desktop.activeSessions", JSON.stringify({
        [workspace]: sessionId,
      }));
    }, {
      bridgeUrl: `http://127.0.0.1:${bridgePort}`,
      workspace: legacyWorkspace,
      sessionId: legacySessionId,
    });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    const legacySession = page.locator(".project-session-button").filter({ hasText: "Legacy session" });
    await legacySession.waitFor({ state: "visible" });
    await page.getByText("legacy assistant response", { exact: true }).waitFor({ state: "visible" });
    await page.waitForTimeout(3_200);

    const requests = bridge.eventRequestCount();
    assert.ok(requests >= 2, `expected the SSE client to reconnect, got ${requests} request(s)`);
    assert.ok(requests <= 5, `empty SSE response caused a reconnect storm: ${requests} requests in 3.2s`);
    assert.ok(
      (await legacySession.getAttribute("class"))?.includes("selected"),
      "unsupported optional session endpoints cleared the active session",
    );
    assert.equal(await page.getByText("legacy assistant response", { exact: true }).isVisible(), true);
    assert.equal(await page.locator(".workspace").isVisible(), true);
    assert.equal(await page.locator(".composer").isVisible(), true);
    await page.screenshot({ path: "/tmp/openagent-sse-stability-ui-smoke.png", fullPage: true });
    console.log(`SSE stability UI smoke passed (${requests} empty stream cycles in 3.2s)`);
  } catch (error) {
    const details = [
      error instanceof Error ? error.stack || error.message : String(error),
      vite?.outputText?.() ? `vite:\n${vite.outputText()}` : "",
    ].filter(Boolean).join("\n\n");
    throw new Error(details);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopChild(vite);
    await bridge.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
