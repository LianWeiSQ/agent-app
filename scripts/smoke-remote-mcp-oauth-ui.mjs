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
const bridgeToken = "remote-mcp-oauth-ui-smoke-token";

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

async function bridgeJson(port, method, urlPath, body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${bridgeToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${urlPath} ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function startOAuthServer(port) {
  const state = { authorizationCodeExchanges: 0, refreshes: 0, revocations: 0, toolCalls: 0 };
  const base = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", base);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const json = (status, payload, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(payload));
    };
    if (request.method === "GET" && requestUrl.pathname === "/mcp") {
      json(401, {}, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` });
      return;
    }
    if (requestUrl.pathname === "/.well-known/oauth-protected-resource") {
      json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      return;
    }
    if (requestUrl.pathname === "/.well-known/oauth-authorization-server") {
      json(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        scopes_supported: ["mcp:tools"],
      });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/register") {
      assert.match(body, /token_endpoint_auth_method/);
      json(201, { client_id: "desktop-oauth-ui" });
      return;
    }
    if (requestUrl.pathname === "/authorize") {
      const callback = new URL(requestUrl.searchParams.get("redirect_uri"));
      callback.searchParams.set("code", "desktop-oauth-code");
      callback.searchParams.set("state", requestUrl.searchParams.get("state") || "");
      response.writeHead(302, { location: callback.toString() });
      response.end();
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        state.refreshes += 1;
        json(200, { access_token: "ui-access-beta", token_type: "Bearer", expires_in: 7200 });
      } else {
        state.authorizationCodeExchanges += 1;
        assert.ok(form.get("code_verifier"));
        json(200, {
          access_token: "ui-access-alpha",
          refresh_token: "ui-refresh-alpha",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/mcp") {
      if (!request.headers.authorization) {
        json(401, {}, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` });
        return;
      }
      assert.match(request.headers.authorization || "", /^Bearer ui-access-/);
      state.toolCalls += 1;
      const rpc = JSON.parse(body);
      json(200, {
        jsonrpc: "2.0",
        id: rpc.id,
        result: { tools: [{ name: "oauth_lookup", description: "Protected lookup", inputSchema: { type: "object" } }] },
      });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/revoke") {
      state.revocations += 1;
      assert.match(body, /token=ui-refresh-alpha/);
      json(200, {});
      return;
    }
    json(404, { error: "not found" });
  });
  return { server, state, base };
}

async function openMcpSettings(page) {
  if (!(await page.locator(".settings-shell").isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "插件" }).click();
  }
  await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".settings-nav button").filter({ hasText: "MCP 服务器" }).click();
  await page.getByRole("heading", { name: "MCP 服务器" }).last().waitFor({ state: "visible" });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-remote-mcp-oauth-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  const tokenPath = path.join(tempRoot, "bridge-token");
  fs.writeFileSync(tokenPath, `${bridgeToken}\n`, { mode: 0o600 });
  const runtimePort = await freePort();
  const vitePort = await freePort();
  const oauthPort = await freePort();
  const oauth = startOAuthServer(oauthPort);
  await new Promise((resolve) => oauth.server.listen(oauthPort, "127.0.0.1", resolve));
  let runtime;
  let vite;
  let browser;
  try {
    runtime = spawnLogged(
      "cargo",
      ["run", "-q", "-p", "openagent-http-runtime", "--", "--host", "127.0.0.1", "--port", String(runtimePort), "--workspace", workspace, "--session-root", sessionRoot, "--cors-origin", `http://127.0.0.1:${vitePort}`],
      { cwd: coreRoot, env: { ...process.env, OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath } },
    );
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await bridgeJson(runtimePort, "POST", "/api/mcp/servers", {
      name: "oauth-tools",
      type: "remote",
      url: `${oauth.base}/mcp`,
      transport: "http",
      timeout_ms: 3000,
      enabled: true,
    });
    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appRoot });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);
    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(({ bridgeUrl, token, project }) => {
      window.__openedOAuthUrl = "";
      window.open = (url) => {
        window.__openedOAuthUrl = String(url || "");
        return { opener: null };
      };
      localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
      localStorage.setItem("openagent.desktop.token", token);
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "oauth-ui", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openMcpSettings(page);
    const row = page.locator(".mcp-server-row").filter({ hasText: "oauth-tools" });
    await row.waitFor({ state: "visible" });
    assert.match((await row.textContent()) || "", /disconnected/);

    await row.getByRole("button", { name: "Connect OAuth for MCP server oauth-tools", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__openedOAuthUrl));
    const authorizationUrl = await page.evaluate(() => window.__openedOAuthUrl);
    const popup = await browser.newPage();
    await popup.goto(authorizationUrl, { waitUntil: "domcontentloaded" });
    await popup.waitForLoadState("domcontentloaded");
    assert.match((await popup.textContent("body")) || "", /MCP connected/);
    await popup.close();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="mcp-oauth-oauth-tools"] .stream-state')?.textContent?.trim() === "connected",
    );
    assert.equal(oauth.state.authorizationCodeExchanges, 1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openMcpSettings(page);
    const reloadedRow = page.locator(".mcp-server-row").filter({ hasText: "oauth-tools" });
    assert.match((await reloadedRow.textContent()) || "", /OAuth connected/);
    const toolCallsBeforeTest = oauth.state.toolCalls;
    await reloadedRow.getByRole("button", { name: "Test MCP server oauth-tools", exact: true }).click();
    await reloadedRow.getByText("oauth_lookup", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    assert.ok(oauth.state.toolCalls > toolCallsBeforeTest);
    await reloadedRow.getByRole("button", { name: "Refresh OAuth for MCP server oauth-tools", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh OAuth for MCP server oauth-tools"]')?.hasAttribute("disabled"));
    assert.equal(oauth.state.refreshes, 1);
    await reloadedRow.getByRole("button", { name: "Disconnect OAuth for MCP server oauth-tools", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="mcp-oauth-oauth-tools"] .stream-state')?.textContent?.trim() === "disconnected",
    );
    assert.equal(oauth.state.revocations, 1);

    const apiPayload = await bridgeJson(runtimePort, "GET", "/api/mcp");
    const serialized = JSON.stringify(apiPayload);
    assert.equal(serialized.includes("ui-access"), false);
    assert.equal(serialized.includes("ui-refresh"), false);
    assert.equal(fs.readFileSync(path.join(workspace, ".openagent", "mcp.json"), "utf8").includes("ui-access"), false);
    process.stdout.write("remote MCP OAuth UI smoke passed\n");
  } finally {
    await browser?.close().catch(() => {});
    await stopChild(vite);
    await stopChild(runtime);
    await new Promise((resolve) => oauth.server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
