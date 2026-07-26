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
const bridgeToken = "git-workflow-smoke-token";

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

function signalChild(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ESRCH") throw error;
    }
  }
  child.kill(signal);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signalChild(child, "SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    signalChild(child, "SIGTERM");
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

async function bridgeJson(port, method, requestPath, body) {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
    method,
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${requestPath} ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function startRuntime(port, workspace, sessionRoot, tokenPath, vitePort, fakeBin) {
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
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath,
        OPENAGENT_BRIDGE_MAX_STEPS: "1",
      },
    },
  );
}

async function chooseSession(page, title) {
  const row = page.locator(".project-session-row").filter({ hasText: title }).first();
  if (await row.count()) await row.locator(".project-session-button").click();
  await page.locator(".topbar h1").filter({ hasText: title }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("diff-dock-item").waitFor({ state: "visible", timeout: 20_000 });
}

async function openWorkflow(page) {
  await page.getByTestId("diff-dock-item").click();
  await page.getByTestId("review-panel").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "提交与交付", exact: true }).click();
  await page.getByTestId("git-workflow-panel").waitFor({ state: "visible" });
}

async function approveWorkflow(page) {
  const approval = page.getByTestId("git-workflow-approval");
  await approval.waitFor({ state: "visible", timeout: 10_000 });
  await approval.getByRole("button", { name: "批准并执行", exact: true }).click();
  await approval.waitFor({ state: "hidden", timeout: 20_000 });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-git-workflow-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  const remote = path.join(tempRoot, "origin.git");
  const fakeBin = path.join(tempRoot, "bin");
  const ghLog = path.join(tempRoot, "gh.log");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.mkdirSync(remote, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  git(workspace, ["init", "-q", "-b", "main"]);
  git(workspace, ["config", "user.email", "openagent-smoke@example.invalid"]);
  git(workspace, ["config", "user.name", "OpenAgent Smoke"]);
  fs.writeFileSync(path.join(workspace, "README.md"), "# Git workflow smoke\n");
  git(workspace, ["add", "README.md"]);
  git(workspace, ["commit", "-q", "-m", "baseline"]);
  git(remote, ["init", "-q", "--bare"]);
  git(workspace, ["remote", "add", "origin", remote]);
  git(workspace, ["push", "-q", "-u", "origin", "main"]);
  const fakeGh = path.join(fakeBin, "gh");
  fs.writeFileSync(
    fakeGh,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\nprintf 'https://example.invalid/review/42\\n'\n`,
    { mode: 0o700 },
  );
  const tokenPath = path.join(tempRoot, "bridge-token");
  fs.writeFileSync(tokenPath, `${bridgeToken}\n`, { mode: 0o600 });

  const runtimePort = await freePort();
  const vitePort = await freePort();
  let runtime;
  let vite;
  let browser;
  try {
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort, fakeBin);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    const created = await bridgeJson(runtimePort, "POST", "/api/sessions", { cwd: workspace, title: "Git delivery" });
    const sessionId = created.session_id || created.session?.id;
    assert.ok(sessionId, "session id missing");
    const setupTurn = await bridgeJson(runtimePort, "POST", `/api/sessions/${sessionId}/turns`, {
      input: "prepare the Git workflow smoke change",
      permission: "FULL",
      dangerously_skip_permissions: true,
      tool_call: {
        call_id: "write_git_workflow_smoke",
        name: "write",
        input: { file_path: "feature.txt", content: "review handoff\n" },
      },
    });
    assert.equal(setupTurn.status, "completed", JSON.stringify(setupTurn));
    const isolated = await bridgeJson(runtimePort, "POST", "/api/sessions", { cwd: workspace, title: "Isolated session" });
    const isolatedId = isolated.session_id || isolated.session?.id;

    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appRoot });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);
    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
    await page.addInitScript(({ bridgeUrl, token, project }) => {
      localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
      localStorage.setItem("openagent.desktop.token", token);
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "git-workflow", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await chooseSession(page, "Git delivery");
    await openWorkflow(page);

    await page.getByPlaceholder("feature/review-ready").fill("feature/desktop-review");
    await page.getByRole("button", { name: "请求创建分支", exact: true }).click();
    await page.getByTestId("git-workflow-approval").waitFor({ state: "visible", timeout: 10_000 });
    let pending = await bridgeJson(runtimePort, "GET", `/api/git/workflow?session_id=${sessionId}`);
    assert.equal(pending.branch, "main", "branch changed before approval");
    assert.equal(pending.pending.workflow_action, "create_branch");
    await approveWorkflow(page);
    await page.getByTestId("git-workflow-panel").getByText("feature/desktop-review", { exact: true }).waitFor({ state: "visible" });

    await page.getByPlaceholder("Describe this change").fill("Add Desktop review handoff");
    await page.getByRole("button", { name: /请求提交 1 个文件/ }).click();
    assert.notEqual(git(workspace, ["status", "--porcelain"]), "", "commit ran before approval");
    await approveWorkflow(page);
    const committedWorkflow = await bridgeJson(runtimePort, "GET", `/api/git/workflow?session_id=${sessionId}`);
    assert.equal(
      committedWorkflow.last_result?.status,
      "completed",
      `commit workflow failed: ${JSON.stringify(committedWorkflow.last_result)}`,
    );
    await page.getByText(/已提交 [0-9a-f]{8}/).waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(git(workspace, ["status", "--porcelain"]), "");

    await page.getByRole("button", { name: "生成 PR 摘要", exact: true }).click();
    const handoffEditor = page.getByLabel("Review handoff");
    await handoffEditor.waitFor({ state: "visible", timeout: 10_000 });
    assert.match(await handoffEditor.inputValue(), /feature\.txt/);
    await page.getByRole("button", { name: "请求推送并创建 PR", exact: true }).click();
    await approveWorkflow(page);
    const handoffLink = page.getByRole("link", { name: /Review 已交付/ });
    await handoffLink.waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await handoffLink.getAttribute("href"), "https://example.invalid/review/42");
    assert.match(fs.readFileSync(ghLog, "utf8"), /pr create/);
    assert.match(git(remote, ["branch", "--list"]), /feature\/desktop-review/);

    const isolatedWorkflow = await bridgeJson(runtimePort, "GET", `/api/git/workflow?session_id=${isolatedId}`);
    assert.equal(isolatedWorkflow.summary, null);
    assert.equal(isolatedWorkflow.handoff, null);
    const approvals = await bridgeJson(runtimePort, "GET", `/api/approvals?session_id=${sessionId}`);
    assert.equal(approvals.count, 0);
    await page.getByTestId("git-workflow-panel").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.screenshot({ path: "/tmp/openagent-git-workflow-ui-smoke.png", fullPage: true });

    await stopChild(runtime);
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort, fakeBin);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await chooseSession(page, "Git delivery");
    await openWorkflow(page);
    await page.getByRole("link", { name: /Review 已交付/ }).waitFor({ state: "visible", timeout: 15_000 });

    console.log("git workflow UI smoke passed");
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
