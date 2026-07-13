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
const token = "desktop-session-lifecycle-smoke-token";

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

async function waitForHttp(url, headers = {}, timeoutMs = 60_000) {
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
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function startFakeProvider(port) {
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "session-lifecycle-model", object: "model" }] }));
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
      requests.push(raw);
      const marker = raw.includes("ALPHA_REQUEST")
        ? "ALPHA_ONLY_ANSWER"
        : raw.includes("BETA_REQUEST")
          ? "BETA_ONLY_ANSWER"
          : raw.includes("GAMMA_REQUEST")
            ? "GAMMA_ONLY_ANSWER"
            : "UNKNOWN_ANSWER";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `resp_${requests.length}`, output_text: marker, usage: { input_tokens: 2, output_tokens: 2 } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, requests }));
  });
}

function sessionId(payload) {
  return payload.session_id || payload.id || payload.session?.id;
}

async function createAnsweredSession(port, workspace, title, input) {
  const created = await bridgeJson(port, "POST", "/api/sessions", { cwd: workspace, title });
  const id = sessionId(created);
  assert.ok(id, `${title} session id missing`);
  const turn = await bridgeJson(port, "POST", `/api/sessions/${id}/turns`, {
    input,
    permission: "FULL",
    stream: false,
  });
  assert.equal(turn.status, "completed", `${title} turn did not complete: ${JSON.stringify(turn)}`);
  return id;
}

async function waitForSelectedSession(page, title, expectedText, absentText = "") {
  const row = page.locator(".project-session-button.selected").filter({ hasText: title }).first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    ({ expected, absent }) => {
      const timeline = document.querySelector(".timeline")?.textContent || "";
      return timeline.includes(expected) && (!absent || !timeline.includes(absent));
    },
    { expected: expectedText, absent: absentText },
    { timeout: 15_000 },
  );
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-session-lifecycle-"));
  const workspaceA = path.join(tempRoot, "workspace-alpha");
  const workspaceB = path.join(tempRoot, "workspace-gamma");
  const sessionRoot = path.join(tempRoot, "sessions");
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  const tokenPath = path.join(tempRoot, "bridge-auth-token");
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });

  let runtime;
  let vite;
  let browser;
  let page;
  let provider;
  try {
    const runtimePort = await freePort();
    const vitePort = await freePort();
    const providerPort = await freePort();
    provider = await startFakeProvider(providerPort);
    const startRuntime = () =>
      spawnLogged(
        "cargo",
        [
          "run", "-q", "-p", "openagent-http-runtime", "--",
          "--host", "127.0.0.1", "--port", String(runtimePort),
          "--workspace", workspaceA, "--session-root", sessionRoot,
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
            OPENAI_MODEL: "session-lifecycle-model",
            OPENAGENT_PROVIDER_STREAM: "0",
          },
        },
      );

    runtime = startRuntime();
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${token}` }, 90_000);

    const alphaId = await createAnsweredSession(runtimePort, workspaceA, "Alpha session", "ALPHA_REQUEST");
    const betaId = await createAnsweredSession(runtimePort, workspaceA, "Beta session", "BETA_REQUEST");
    const gammaId = await createAnsweredSession(runtimePort, workspaceB, "Gamma session", "GAMMA_REQUEST");
    const betaTool = await bridgeJson(runtimePort, "POST", `/api/sessions/${betaId}/turns`, {
      input: "write beta marker",
      permission: "FULL",
      tool_call: { call_id: "beta_write", name: "write", input: { file_path: "beta-only.txt", content: "beta\n" } },
    });
    assert.equal(betaTool.status, "completed", `beta tool did not complete: ${JSON.stringify(betaTool)}`);

    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appDir });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);

    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const pageErrors = [];
    const consoleIssues = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) consoleIssues.push(message.text());
    });

    let delayedSession = "";
    await page.route("**/api/sessions/**", async (route) => {
      const requestPath = new URL(route.request().url()).pathname;
      if (delayedSession && requestPath.includes(`/api/sessions/${delayedSession}/`)) {
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
      await route.continue();
    });

    await page.addInitScript(
      ({ bridgeUrl, tokenValue, projects, activeProject, activeSessions }) => {
        window.localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
        window.localStorage.setItem("openagent.desktop.token", tokenValue);
        window.localStorage.setItem("openagent.desktop.projects", JSON.stringify(projects));
        window.localStorage.setItem("openagent.desktop.activeProject", activeProject);
        if (!window.localStorage.getItem("openagent.desktop.activeSessions")) {
          window.localStorage.setItem("openagent.desktop.activeSessions", JSON.stringify(activeSessions));
        }
      },
      {
        bridgeUrl: `http://127.0.0.1:${runtimePort}`,
        tokenValue: token,
        projects: [
          { id: workspaceA, name: "workspace-alpha", path: workspaceA, last_opened_at_ms: Date.now() },
          { id: workspaceB, name: "workspace-gamma", path: workspaceB, last_opened_at_ms: Date.now() - 1 },
        ],
        activeProject: workspaceA,
        activeSessions: { [workspaceA]: alphaId, [workspaceB]: gammaId },
      },
    );
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");

    assert.equal(await page.getByRole("button", { name: "搜索" }).count(), 0, "inert search entry should be hidden");
    assert.equal(await page.getByTitle("More").count(), 0, "inert topbar menu should be hidden");
    await page.getByRole("button", { name: "已安排" }).click();
    await page.locator(".inspector.open").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTitle("Close").click();
    await page.getByRole("button", { name: "插件" }).click();
    await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("heading", { name: "插件" }).last().waitFor({ state: "visible" });
    const settingsNavText = (await page.locator(".settings-nav").textContent()) || "";
    for (const hiddenEntry of ["外观", "个性化", "浏览器", "钩子"]) {
      assert.equal(settingsNavText.includes(hiddenEntry), false, `${hiddenEntry} placeholder should be hidden`);
    }
    assert.equal((await page.locator(".settings-shell").textContent())?.includes("适用于日常工作"), false);
    await page.getByRole("button", { name: "返回应用" }).click();
    await page.locator(".composer").waitFor({ state: "visible", timeout: 10_000 });

    const alphaButton = page.locator(".project-session-button").filter({ hasText: "Alpha session" }).first();
    const betaButton = page.locator(".project-session-button").filter({ hasText: "Beta session" }).first();
    delayedSession = betaId;
    await betaButton.click();
    await page.waitForTimeout(60);
    delayedSession = "";
    await alphaButton.click();
    await page.waitForTimeout(850);
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");

    await page.getByTitle("Toggle details").click();
    await page.locator(".inspector.open").waitFor({ state: "visible", timeout: 10_000 });
    assert.equal((await page.locator(".inspector").textContent())?.includes("beta-only.txt"), false, "late Beta diff leaked into Alpha inspector");
    await page.getByTitle("Close").click();

    const gammaProject = page.locator(".project-open-button").filter({ hasText: "workspace-gamma" }).first();
    await gammaProject.click();
    await waitForSelectedSession(page, "Gamma session", "GAMMA_ONLY_ANSWER", "ALPHA_ONLY_ANSWER");
    const alphaProject = page.locator(".project-open-button").filter({ hasText: "workspace-alpha" }).first();
    await alphaProject.click();
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "GAMMA_ONLY_ANSWER");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");

    assert.equal(pageErrors.length, 0, `page errors before Bridge restart: ${pageErrors.join("\n")}`);
    assert.equal(consoleIssues.length, 0, `console issues before Bridge restart: ${consoleIssues.join("\n")}`);
    await stopChild(runtime);
    runtime = startRuntime();
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${token}` }, 90_000);
    pageErrors.length = 0;
    consoleIssues.length = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");
    await page.getByTitle("Toggle details").click();
    await page.locator(".inspector.open").waitFor({ state: "visible", timeout: 10_000 });
    const restartedInspector = (await page.locator(".inspector").textContent()) || "";
    assert.equal(restartedInspector.includes("beta-only.txt"), false, "Bridge restart leaked Beta inspector state into Alpha");
    await page.getByTitle("Close").click();

    await betaButton.click();
    await waitForSelectedSession(page, "Beta session", "BETA_ONLY_ANSWER", "ALPHA_ONLY_ANSWER");
    const deleteBeta = page.getByRole("button", { name: "Delete session Beta session" });
    await deleteBeta.click();
    await deleteBeta.click();
    await page.waitForFunction(() => !(document.body.textContent || "").includes("BETA_ONLY_ANSWER"));
    await page.locator(".project-session-button").filter({ hasText: "Beta session" }).waitFor({ state: "detached", timeout: 10_000 });

    await alphaButton.click();
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER");
    await page.getByRole("button", { name: "New session in workspace-alpha" }).click();
    await page.locator(".project-session-button.selected").filter({ hasText: "新对话" }).waitFor({ state: "visible", timeout: 10_000 });
    assert.equal((await page.locator(".timeline").textContent())?.includes("ALPHA_ONLY_ANSWER"), false, "new session retained Alpha timeline");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".project-session-button.selected").filter({ hasText: "新对话" }).waitFor({ state: "visible", timeout: 15_000 });
    assert.equal((await page.locator(".timeline").textContent())?.includes("ALPHA_ONLY_ANSWER"), false, "reloaded new session retained Alpha timeline");

    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join("\n")}`);
    assert.equal(consoleIssues.length, 0, `console issues: ${consoleIssues.join("\n")}`);
    assert.equal(provider.requests.length, 3, `provider request count mismatch: ${provider.requests.length}`);
    console.log(JSON.stringify({ ok: true, alpha_session: alphaId, deleted_session: betaId, gamma_session: gammaId }, null, 2));
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await stopChild(vite);
    await stopChild(runtime);
    if (provider?.server) await new Promise((resolve) => provider.server.close(resolve)).catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
