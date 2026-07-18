import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = path.resolve(appDir, "../openharness");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const token = "desktop-provider-recovery-smoke-token";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
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
      if (!(error instanceof Error) || !Object.hasOwn(error, "code") || error.code !== "ESRCH") throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    signalChildTree(child, "SIGTERM");
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signalChildTree(child, "SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    signalChildTree(child, "SIGTERM");
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

async function bridgeJson(port, method, urlPath, body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function startFakeProvider(port) {
  const models = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-5.5", object: "model" }, { id: "gpt-5.4", object: "model" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      const requestCount = models.length + 1;
      const payload = JSON.parse(raw || "{}");
      models.push(payload.model || "");
      if (requestCount !== 3 && requestCount !== 8) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Service temporarily unavailable", type: "api_error" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: requestCount === 3 ? "resp_fallback" : "resp_recovered",
        output_text: requestCount === 3 ? "PROVIDER_FALLBACK_SUCCEEDED" : "PROVIDER_RECOVERY_SUCCEEDED",
        usage: { input_tokens: 2, output_tokens: 2 },
      }));
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, models }));
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-provider-recovery-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  const tokenPath = path.join(tempRoot, "bridge-auth-token");
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });

  let runtime;
  let vite;
  let browser;
  let provider;
  try {
    const runtimePort = await freePort();
    const vitePort = await freePort();
    const providerPort = await freePort();
    provider = await startFakeProvider(providerPort);
    runtime = spawnLogged(
      "cargo",
      [
        "run", "-q", "-p", "openagent-http-runtime", "--",
        "--host", "127.0.0.1", "--port", String(runtimePort),
        "--workspace", workspace, "--session-root", sessionRoot,
        "--cors-origin", `http://127.0.0.1:${vitePort}`, "--no-mdns",
      ],
      {
        cwd: coreDir,
        env: {
          ...process.env,
          OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath,
          OPENAI_API_KEY: "test-key",
          OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
          OPENAI_WIRE_API: "responses",
          OPENAI_MODEL: "gpt-5.5",
          OPENAGENT_PROVIDER_RETRIES: "1",
          OPENAGENT_PROVIDER_FALLBACK_MODELS: "gpt-5.4",
          OPENAGENT_PROVIDER_STREAM: "0",
        },
      },
    );
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${token}` });
    const created = await bridgeJson(runtimePort, "POST", "/api/sessions", { cwd: workspace, title: "Provider recovery" });
    const sessionId = created.session_id || created.id || created.session?.id;
    assert.ok(sessionId, "session id missing");

    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appDir });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);
    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(
      ({ bridgeUrl, tokenValue, project, activeSession }) => {
        window.localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
        window.localStorage.setItem("openagent.desktop.token", tokenValue);
        window.localStorage.setItem("openagent.desktop.projects", JSON.stringify([project]));
        window.localStorage.setItem("openagent.desktop.activeProject", project.path);
        window.localStorage.setItem("openagent.desktop.activeSessions", JSON.stringify({ [project.path]: activeSession }));
      },
      {
        bridgeUrl: `http://127.0.0.1:${runtimePort}`,
        tokenValue: token,
        project: { id: workspace, name: "workspace", path: workspace, last_opened_at_ms: Date.now() },
        activeSession: sessionId,
      },
    );
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    const composer = page.locator(".composer textarea");
    await composer.waitFor({ state: "visible", timeout: 15_000 });
    await composer.fill("AUTOMATIC_FALLBACK_REQUEST");
    await page.locator(".composer .send-button").last().click();
    await page.getByText("PROVIDER_FALLBACK_SUCCEEDED", { exact: false }).waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-testid="live-turn-process-card"] .live-turn-process-summary').click();
    await page.getByText("模型请求重试", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText("已切换备用模型", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    assert.deepEqual(provider.models.slice(0, 3), ["gpt-5.5", "gpt-5.5", "gpt-5.4"]);

    await composer.fill("MANUAL_RECOVERY_REQUEST");
    await page.locator(".composer .send-button").last().click();
    const retryButton = page.getByRole("button", { name: "重试任务" });
    await retryButton.waitFor({ state: "visible", timeout: 15_000 });
    const errorText = await page.locator(".error-line").textContent();
    assert.match(errorText || "", /模型服务暂时不可用/);
    assert.match(errorText || "", /HTTP 503/);
    assert.doesNotMatch(errorText || "", /provider returned HTTP 503/i);
    const processCardText = await page.locator('[data-testid="live-turn-process-card"]').last().textContent();
    assert.match(processCardText || "", /模型服务暂时不可用/);
    assert.doesNotMatch(processCardText || "", /provider returned HTTP 503|session_\d+|turn_\d+/i);
    await retryButton.click();
    await page.getByText("PROVIDER_RECOVERY_SUCCEEDED", { exact: false }).waitFor({ state: "visible", timeout: 15_000 });
    assert.deepEqual(provider.models, [
      "gpt-5.5", "gpt-5.5", "gpt-5.4",
      "gpt-5.5", "gpt-5.5", "gpt-5.4", "gpt-5.4",
      "gpt-5.5",
    ]);
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("\n")}`);

    process.stdout.write(`${JSON.stringify({ ok: true, session_id: sessionId, provider_requests: provider.models.length, automatic_retry: true, fallback: true, manual_recovery: true }, null, 2)}\n`);
  } catch (error) {
    const diagnostics = [runtime?.outputText(), vite?.outputText()].filter(Boolean).join("\n---\n");
    throw new Error(`${error instanceof Error ? error.stack || error.message : String(error)}${diagnostics ? `\n${diagnostics}` : ""}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (provider?.server) await new Promise((resolve) => provider.server.close(resolve));
    await stopChild(vite);
    await stopChild(runtime);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
