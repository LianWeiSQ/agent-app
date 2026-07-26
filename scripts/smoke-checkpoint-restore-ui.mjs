#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(process.env.OPENAGENT_CORE_ROOT || path.join(desktopDir, "..", "openharness"));
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const token = "desktop-checkpoint-restore-smoke-token";

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

async function waitForHttp(url, { headers = {}, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function waitForJson(label, producer, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const value = await producer();
      if (value) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
  child.outputText = () => `${stdout.join("")}${stderr.join("")}`.trim();
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process may have exited after SIGTERM.
      }
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(killer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(killer);
      resolve();
    }
  });
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
  if (!response.ok) {
    throw new Error(`${method} ${urlPath} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function startModelsProvider(port) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "fake-checkpoint-model", object: "model" }] }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "unused", output_text: "unused" }));
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function selectSmokeSession(page) {
  await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
  const sessionRow = page.locator(".project-session-button").filter({ hasText: "Desktop checkpoint restore smoke" }).first();
  await sessionRow.waitFor({ state: "visible", timeout: 15_000 });
  await sessionRow.click();
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-desktop-checkpoint-restore-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "openagent-smoke@example.invalid"],
    ["config", "user.name", "OpenAgent Smoke"],
    ["commit", "--allow-empty", "-q", "-m", "baseline"],
  ]) {
    const result = spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  }
  const tokenPath = path.join(tempRoot, "bridge-auth-token");
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });

  let runtime;
  let vite;
  let browser;
  let page;
  let provider;
  let phase = "launch";

  try {
    const runtimePort = await freePort();
    const vitePort = await freePort();
    const providerPort = await freePort();
    provider = await startModelsProvider(providerPort);

    runtime = spawnLogged(
      "cargo",
      [
        "run",
        "-q",
        "-p",
        "openagent-http-runtime",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        String(runtimePort),
        "--workspace",
        workspace,
        "--session-root",
        sessionRoot,
        "--cors-origin",
        `http://127.0.0.1:${vitePort}`,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath,
          OPENAI_API_KEY: "test-key",
          OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
          OPENAI_WIRE_API: "responses",
          OPENAI_MODEL: "fake-checkpoint-model",
        },
      },
    );

    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      timeoutMs: 90_000,
    });

    const created = await bridgeJson(runtimePort, "POST", "/api/sessions", {
      cwd: workspace,
      title: "Desktop checkpoint restore smoke",
    });
    const sessionId = created.session_id || created.id || created.session?.id;
    assert.ok(sessionId, "session id missing");

    const writeFile = path.join(workspace, "checkpoint-ui.txt");
    const keepFile = path.join(workspace, "keep-ui.txt");
    const manualFile = path.join(workspace, "manual-ui.txt");
    const turn = await bridgeJson(runtimePort, "POST", `/api/sessions/${sessionId}/turns`, {
      input: "Create two files so the Desktop review panel can restore one file or the whole turn.",
      permission: "FULL",
      tool_calls: [
        {
          call_id: "call_checkpoint_restore_ui",
          name: "write",
          input: { file_path: "checkpoint-ui.txt", content: "checkpoint restore ui smoke\n" },
        },
        {
          call_id: "call_keep_restore_ui",
          name: "write",
          input: { file_path: "keep-ui.txt", content: "keep after selected undo\n" },
        },
      ],
    });
    assert.ok(["completed", "running"].includes(turn.status), `write turn did not run: ${JSON.stringify(turn)}`);

    await waitForJson("checkpoint file write", () => {
      if (!fs.existsSync(writeFile) || !fs.existsSync(keepFile)) return null;
      const content = fs.readFileSync(writeFile, "utf8");
      const kept = fs.readFileSync(keepFile, "utf8");
      return content.includes("checkpoint restore ui smoke") && kept.includes("keep after selected undo")
        ? { content, kept }
        : null;
    });
    const transcript = await bridgeJson(runtimePort, "GET", `/api/sessions/${sessionId}/messages?limit=20`);
    const assistantMessages = (transcript.messages_v2 || []).filter((message) => message.info?.role === "assistant");
    const resultPart = assistantMessages
      .flatMap((message) => message.parts || [])
      .find((part) => part.kind === "result");
    assert.ok(resultPart, `final result part missing: ${JSON.stringify(transcript)}`);
    assert.deepEqual(
      resultPart.content.changed.map((item) => item.path).sort(),
      ["checkpoint-ui.txt", "keep-ui.txt"],
      "final result did not summarize both changed files",
    );
    assert.equal(resultPart.content.verified.filter((item) => item.tool === "write").length, 2);
    assert.deepEqual(resultPart.content.remaining, []);
    fs.writeFileSync(manualFile, "manual workspace change\n");

    const diff = await bridgeJson(runtimePort, "GET", `/api/sessions/${sessionId}/diff`);
    assert.ok(JSON.stringify(diff).includes("checkpoint-ui.txt"), `diff did not include checkpoint-ui.txt: ${JSON.stringify(diff)}`);
    const manualGit = await bridgeJson(runtimePort, "GET", "/api/git?path=manual-ui.txt");
    assert.equal(manualGit.selected_diff?.source, "untracked", `manual diff source missing: ${JSON.stringify(manualGit)}`);
    assert.ok(manualGit.selected_diff?.diff?.includes("+manual workspace change"), "manual Git diff was not rendered");
    const checkpoints = await bridgeJson(runtimePort, "GET", `/api/sessions/${sessionId}/checkpoints`);
    const checkpointList = Array.isArray(checkpoints.checkpoints) ? checkpoints.checkpoints : [];
    assert.ok(checkpointList.length > 0, "expected checkpoints");
    const restoreTarget =
      checkpointList.find((checkpoint) => checkpoint.kind === "step_start") || checkpointList[checkpointList.length - 1];
    const checkpointId = restoreTarget?.checkpoint_id;
    assert.ok(checkpointId, "checkpoint id missing");

    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], {
      cwd: desktopDir,
      env: process.env,
    });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`, { timeoutMs: 60_000 });

    const consoleIssues = [];
    const pageErrors = [];
    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) consoleIssues.push(`[${phase}] ${message.text()}`);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(
      ({ bridgeUrl, tokenValue, workspacePath }) => {
        const project = {
          id: workspacePath,
          name: "checkpoint-restore-smoke",
          path: workspacePath,
          last_opened_at_ms: Date.now(),
        };
        window.localStorage.setItem("openagent.desktop.bridgeUrl", bridgeUrl);
        window.localStorage.setItem("openagent.desktop.token", tokenValue);
        window.localStorage.setItem("openagent.desktop.projects", JSON.stringify([project]));
        window.localStorage.setItem("openagent.desktop.activeProject", workspacePath);
      },
      {
        bridgeUrl: `http://127.0.0.1:${runtimePort}`,
        tokenValue: token,
        workspacePath: workspace,
      },
    );

    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    phase = "initial-load";
    await selectSmokeSession(page);
    const finalResult = page.locator('[data-testid="final-result"]').last();
    await finalResult.waitFor({ state: "visible", timeout: 15_000 });
    const finalResultText = await finalResult.textContent();
    assert.ok(finalResultText.includes("changed"), `changed result section missing: ${finalResultText}`);
    assert.ok(finalResultText.includes("checkpoint-ui.txt"), `changed file missing from result: ${finalResultText}`);
    assert.ok(finalResultText.includes("keep-ui.txt"), `second changed file missing from result: ${finalResultText}`);
    assert.ok(finalResultText.includes("verified"), `verified result section missing: ${finalResultText}`);
    assert.ok(finalResultText.includes("write 已完成"), `tool evidence missing from result: ${finalResultText}`);
    assert.ok(finalResultText.includes("remaining"), `remaining result section missing: ${finalResultText}`);
    await page.locator('[data-testid="diff-dock-item"]').filter({ hasText: "keep-ui.txt" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });

    phase = "review-restore";
    await page.locator('[data-testid="diff-dock-item"]').filter({ hasText: "keep-ui.txt" }).click();
    await page.locator('[data-testid="review-panel"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-testid="change-review-card"]').filter({ hasText: "checkpoint-ui.txt" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.locator('[data-testid="change-review-card"]').filter({ hasText: "manual-ui.txt" }).click();
    await page.locator('[data-testid="review-diff"]').filter({ hasText: "manual workspace change" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });

    phase = "review-decisions";
    await page.getByRole("button", { name: "完成审查" }).click();
    await page.locator('[data-testid="review-panel"]').waitFor({ state: "detached", timeout: 15_000 });
    await waitForJson("accepted review decision", async () => {
      const payload = await bridgeJson(runtimePort, "GET", "/api/sessions");
      const session = (payload.sessions || []).find((item) => (item.session_id || item.id) === sessionId);
      return session?.metadata?.change_review?.status === "accepted" ? session.metadata.change_review : null;
    });

    await page.locator('[data-testid="diff-dock-item"]').click();
    await page.getByRole("button", { name: "要求修改" }).click();
    await page.locator('[data-testid="review-panel"]').waitFor({ state: "detached", timeout: 15_000 });
    await page.locator(".composer textarea").waitFor({ state: "visible", timeout: 15_000 });
    assert.ok(
      (await page.locator(".composer textarea").inputValue()).includes("请根据审查意见继续修改"),
      "request changes did not prepare a follow-up prompt",
    );
    await waitForJson("changes requested review decision", async () => {
      const payload = await bridgeJson(runtimePort, "GET", "/api/sessions");
      const session = (payload.sessions || []).find((item) => (item.session_id || item.id) === sessionId);
      return session?.metadata?.change_review?.status === "changes_requested" ? session.metadata.change_review : null;
    });

    await page.locator('[data-testid="diff-dock-item"]').click();
    phase = "review-restore";
    await page.locator('[data-testid="change-review-card"]').filter({ hasText: "checkpoint-ui.txt" }).click();
    await page.getByRole("button", { name: "撤销此文件" }).click();
    await page.getByRole("button", { name: "确认撤销" }).click();
    await waitForJson("selected file rollback", () =>
      !fs.existsSync(writeFile) && fs.existsSync(keepFile) ? { selectedRemoved: true, otherPreserved: true } : null,
    );
    await page.locator(`[data-testid="review-restore-turn"][data-checkpoint-id="${checkpointId}"]`).click();
    await waitForJson("checkpoint restore file removal", () =>
      !fs.existsSync(writeFile) && !fs.existsSync(keepFile) ? { exists: false } : null,
    );
    await page.locator(`[data-testid="review-restore-turn"][data-checkpoint-id="${checkpointId}"]`).filter({ hasText: "已恢复" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });

    phase = "reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectSmokeSession(page);
    await page.locator('[data-testid="diff-dock-item"]').click();
    await page.locator(`[data-testid="review-restore-turn"][data-checkpoint-id="${checkpointId}"]`).filter({ hasText: "已恢复" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });

    const pageState = await page.evaluate((id) => ({
      overlayVisible: Boolean(document.querySelector("vite-error-overlay")),
      bodyOverflow: Math.max(0, document.body.scrollWidth - window.innerWidth),
      restoreText: document.querySelector(`[data-testid="review-restore-turn"][data-checkpoint-id="${id}"]`)?.textContent || "",
      reviewVisible: Boolean(document.querySelector('[data-testid="review-panel"]')),
      checkpointCards: document.querySelectorAll('[data-testid="review-checkpoint-row"], [data-testid="checkpoint-restore-state"]').length,
    }), checkpointId);
    assert.equal(pageState.overlayVisible, false, "Vite overlay is visible");
    assert.equal(pageState.bodyOverflow, 0, `Horizontal overflow detected: ${pageState.bodyOverflow}`);
    assert.equal(pageState.reviewVisible, true, "change review workspace is not visible after reload");
    assert.ok(pageState.restoreText.includes("已恢复"), `review workspace did not show restored state: ${pageState.restoreText}`);
    assert.equal(pageState.checkpointCards, 0, "internal checkpoint cards leaked into the review workspace");
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("\n")}`);
    assert.deepEqual(consoleIssues, [], `console issues: ${consoleIssues.join("\n")}`);

    const screenshotPath = path.join(os.tmpdir(), `openagent-desktop-checkpoint-restore-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          bridge_url: `http://127.0.0.1:${runtimePort}`,
          session_id: sessionId,
          restore_checkpoint_id: checkpointId,
          file_after_restore_exists: fs.existsSync(writeFile),
          other_file_after_restore_exists: fs.existsSync(keepFile),
          manual_git_file_exists: fs.existsSync(manualFile),
          screenshot: screenshotPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const diagnostics = {
      phase,
      runtime: runtime?.outputText?.(),
      vite: vite?.outputText?.(),
      page: page
        ? await page.evaluate(() => ({
            body: (document.body.textContent || "").slice(0, 4000),
            restoreState: document.querySelector('[data-testid="review-restore-turn"]')?.outerHTML || "",
            review: document.querySelector('[data-testid="review-panel"]')?.outerHTML?.slice(0, 2000) || "",
          })).catch((innerError) => ({ error: innerError instanceof Error ? innerError.message : String(innerError) }))
        : null,
    };
    console.error(JSON.stringify(diagnostics, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopChild(vite);
    await stopChild(runtime);
    if (provider) await new Promise((resolve) => provider.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
