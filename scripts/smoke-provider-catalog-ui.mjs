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
const bridgeToken = "provider-catalog-smoke-token";
const privateKey = "provider-catalog-private-smoke-key";

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

async function bridgeJson(port, urlPath) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    headers: { authorization: `Bearer ${bridgeToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${urlPath} ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function startProvider(port, label, models) {
  const requests = [];
  let responsesStreamCount = 0;
  let chatStreamCount = 0;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ method: request.method, url: request.url, body, authorization: request.headers.authorization || "" });
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/responses") {
        if (body.stream === true) {
          responsesStreamCount += 1;
          response.writeHead(200, {
            "cache-control": "no-cache",
            connection: "close",
            "content-type": "text/event-stream; charset=utf-8",
          });
          response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: `${label}_RESPONSES_${responsesStreamCount}_` })}\n\n`);
          response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "OK" })}\n\n`);
          response.write(`data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 2 } } })}\n\n`);
          response.end("data: [DONE]\n\n");
        } else {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id: `${label}-validation`, output_text: "pong", usage: { input_tokens: 2, output_tokens: 1 } }));
        }
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        if (body.stream === true) {
          chatStreamCount += 1;
          response.writeHead(200, {
            "cache-control": "no-cache",
            connection: "close",
            "content-type": "text/event-stream; charset=utf-8",
          });
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${label}_CHAT_${chatStreamCount}_` } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`);
          response.end("data: [DONE]\n\n");
        } else {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id: `${label}-chat-validation`, choices: [{ message: { role: "assistant", content: "pong" } }] }));
        }
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, requests }));
  });
}

function startRuntime(port, workspace, sessionRoot, tokenPath, vitePort, fallbackBaseUrl) {
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
        OPENAI_API_KEY: "fallback-env-key",
        OPENAI_BASE_URL: fallbackBaseUrl,
        OPENAI_MODEL: "gpt-env-model",
        OPENAGENT_MODEL: "gpt-env-model",
        OPENAI_WIRE_API: "responses",
        OPENAGENT_PROVIDER_STREAM: "1",
        OPENAGENT_BRIDGE_MAX_STEPS: "1",
      },
    },
  );
}

async function openProviderSettings(page) {
  if (!(await page.locator(".settings-shell").isVisible().catch(() => false))) {
    await page.locator(".settings-profile-button").click();
  }
  await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".settings-nav button").filter({ hasText: "配置" }).click();
  await page.getByRole("heading", { name: "Provider", exact: true }).waitFor({ state: "visible" });
}

async function sendPrompt(page, prompt, expected) {
  const composer = page.locator(".composer textarea");
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Run prompt", exact: true }).click();
  await page.getByText(expected, { exact: false }).last().waitFor({ state: "visible", timeout: 20_000 });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-provider-catalog-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  const tokenPath = path.join(tempRoot, "bridge-token");
  fs.writeFileSync(tokenPath, `${bridgeToken}\n`, { mode: 0o600 });
  const runtimePort = await freePort();
  const vitePort = await freePort();
  const fallbackPort = await freePort();
  const selectedPort = await freePort();
  let runtime;
  let vite;
  let browser;
  let fallbackProvider;
  let selectedProvider;
  try {
    fallbackProvider = await startProvider(fallbackPort, "ENV_PROVIDER_WRONG", ["gpt-env-model"]);
    selectedProvider = await startProvider(selectedPort, "CATALOG", ["gpt-5.7-custom", "gpt-image-2", "glm-5.2"]);
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort, `http://127.0.0.1:${fallbackPort}/v1`);
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
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "provider-catalog", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openProviderSettings(page);

    await page.getByLabel("Base URL").fill(`http://127.0.0.1:${selectedPort}/v1`);
    await page.getByLabel("API Key").fill(privateKey);
    await page.getByLabel("Model").fill("gpt-5.7-custom");
    await page.getByRole("button", { name: "验证连接", exact: true }).click();
    await page.getByText("验证通过", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("button", { name: "保存并应用", exact: true }).click();
    await page.waitForTimeout(500);
    const settingsText = await page.locator(".settings-main").innerText();
    assert.match(settingsText, /Bridge private state/, settingsText);
    const catalogRow = page.locator(".provider-model-row").filter({ hasText: "gpt-5.7-custom" });
    await catalogRow.waitFor({ state: "visible" });
    assert.match((await catalogRow.textContent()) || "", /Responses/);
    assert.match((await catalogRow.textContent()) || "", /stream/);
    assert.match((await catalogRow.textContent()) || "", /reasoning/);
    assert.match((await catalogRow.textContent()) || "", /tools/);
    assert.match((await catalogRow.textContent()) || "", /128k context/);
    const imageRow = page.locator(".provider-model-row").filter({ hasText: "gpt-image-2" });
    assert.equal(await imageRow.isDisabled(), true);
    assert.match((await imageRow.textContent()) || "", /image/);
    await page.screenshot({ path: "/tmp/openagent-provider-catalog-ui-smoke.png", fullPage: true });

    let publicPayload = await bridgeJson(runtimePort, "/api/providers");
    assert.equal(publicPayload.config.model, "gpt-5.7-custom");
    assert.equal(publicPayload.config.api_key_configured, true);
    assert.equal(publicPayload.config.storage, "bridge_private_state");
    assert.equal(JSON.stringify(publicPayload).includes(privateKey), false);
    const statePath = path.join(sessionRoot, ".openagent-runtime", "provider.json");
    assert.equal(fs.existsSync(statePath), true);
    assert.equal(fs.readFileSync(statePath, "utf8").includes(privateKey), true);
    if (process.platform !== "win32") assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);

    await page.getByRole("button", { name: "返回应用", exact: true }).click();
    await sendPrompt(page, "verify selected provider", "CATALOG_RESPONSES_1_OK");
    let runtimeRequests = selectedProvider.requests.filter((item) => item.url === "/v1/responses" && item.body.stream === true);
    assert.equal(runtimeRequests.length, 1);
    assert.equal(runtimeRequests[0].body.model, "gpt-5.7-custom");
    assert.equal(runtimeRequests[0].authorization, `Bearer ${privateKey}`);
    assert.equal(
      fallbackProvider.requests.some((item) => item.url === "/v1/responses" || item.url === "/v1/chat/completions"),
      false,
    );

    await openProviderSettings(page);
    await page.getByLabel("Provider").selectOption("glm");
    await page.getByLabel("Base URL").fill(`http://127.0.0.1:${selectedPort}/v1`);
    await page.getByLabel("Model").fill("glm-5.2");
    await page.getByRole("button", { name: "验证连接", exact: true }).click();
    await page.getByText("验证通过", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("button", { name: "保存并应用", exact: true }).click();
    await page.locator(".provider-model-row").filter({ hasText: "glm-5.2" }).waitFor({ state: "visible" });
    publicPayload = await bridgeJson(runtimePort, "/api/providers");
    assert.equal(publicPayload.config.profile, "glm");
    assert.equal(publicPayload.config.model, "glm-5.2");
    assert.equal(publicPayload.config.wire_api, "chat");
    assert.equal(JSON.stringify(publicPayload).includes(privateKey), false);
    await page.getByRole("button", { name: "返回应用", exact: true }).click();
    await sendPrompt(page, "verify GLM provider", "CATALOG_CHAT_1_OK");
    let chatRequests = selectedProvider.requests.filter((item) => item.url === "/v1/chat/completions" && item.body.stream === true);
    assert.equal(chatRequests.length, 1);
    assert.equal(chatRequests[0].body.model, "glm-5.2");
    assert.equal(chatRequests[0].authorization, `Bearer ${privateKey}`);

    await stopChild(runtime);
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort, `http://127.0.0.1:${fallbackPort}/v1`);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openProviderSettings(page);
    await page.getByText("glm-5.2", { exact: true }).first().waitFor({ state: "visible" });
    publicPayload = await bridgeJson(runtimePort, "/api/providers");
    assert.equal(publicPayload.config.profile, "glm");
    assert.equal(publicPayload.config.model, "glm-5.2");
    assert.equal(JSON.stringify(publicPayload).includes(privateKey), false);
    await page.getByRole("button", { name: "返回应用", exact: true }).click();
    await sendPrompt(page, "verify GLM provider after restart", "CATALOG_CHAT_2_OK");
    chatRequests = selectedProvider.requests.filter((item) => item.url === "/v1/chat/completions" && item.body.stream === true);
    assert.equal(chatRequests.length, 2);
    assert.equal(
      fallbackProvider.requests.some((item) => item.url === "/v1/responses" || item.url === "/v1/chat/completions"),
      false,
    );
    process.stdout.write("provider catalog UI smoke passed\n");
  } finally {
    await browser?.close().catch(() => {});
    await stopChild(vite);
    await stopChild(runtime);
    if (fallbackProvider) await new Promise((resolve) => fallbackProvider.server.close(resolve));
    if (selectedProvider) await new Promise((resolve) => selectedProvider.server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
