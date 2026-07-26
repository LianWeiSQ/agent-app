import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

function initGitWorkspace(workspace) {
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "openagent-smoke@example.invalid"],
    ["config", "user.name", "OpenAgent Smoke"],
    ["commit", "--allow-empty", "-q", "-m", "baseline"],
  ]) {
    const result = spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

async function createAnsweredSession(port, workspace, title, input, attachments = []) {
  const created = await bridgeJson(port, "POST", "/api/sessions", { cwd: workspace, title });
  const id = sessionId(created);
  assert.ok(id, `${title} session id missing`);
  const turn = await bridgeJson(port, "POST", `/api/sessions/${id}/turns`, {
    input,
    permission: "FULL",
    stream: false,
    attachments,
  });
  assert.equal(turn.status, "completed", `${title} turn did not complete: ${JSON.stringify(turn)}`);
  return id;
}

async function writeReviewedFile(port, sessionId, pathName, content, status) {
  const turn = await bridgeJson(port, "POST", `/api/sessions/${sessionId}/turns`, {
    input: `write ${pathName}`,
    permission: "FULL",
    tool_call: {
      call_id: `write_${pathName.replace(/[^a-z0-9]+/gi, "_")}`,
      name: "write",
      input: { file_path: pathName, content },
    },
  });
  assert.equal(turn.status, "completed", `${pathName} tool did not complete: ${JSON.stringify(turn)}`);
  const diff = await bridgeJson(port, "GET", `/api/sessions/${sessionId}/diff`);
  const latest = diff.latest || {};
  assert.equal(latest.path, pathName, `${pathName} was not the latest session patch`);
  const updated = await bridgeJson(port, "PATCH", `/api/sessions/${sessionId}`, {
    change_review: {
      status,
      patch_id: latest.id || "",
      path: pathName,
      run_id: latest.run_id || "",
    },
  });
  assert.equal(updated.session?.metadata?.change_review?.status, status, `${pathName} review decision was not persisted`);
  return latest;
}

async function createBackgroundTask(port, parentSessionId, description, subagentType) {
  const turn = await bridgeJson(port, "POST", `/api/sessions/${parentSessionId}/turns`, {
    input: `create task ${description}`,
    permission: "FULL",
    tool_call: {
      call_id: `task_${description.replace(/[^a-z0-9]+/gi, "_")}`,
      name: "task",
      input: {
        description,
        prompt: `Complete the delegated task: ${description}`,
        subagent_type: subagentType,
        background: true,
      },
    },
  });
  const completed = (turn.events || []).find(
    (event) => event.method === "item/toolCall/completed" && event.params?.name === "task",
  );
  const taskId = completed?.params?.metadata?.session_id;
  assert.ok(taskId, `task ${description} did not return a child session: ${JSON.stringify(turn)}`);
  return taskId;
}

function writeTaskAgentProfiles(workspace) {
  const agentDir = path.join(workspace, ".openagent", "agents");
  fs.mkdirSync(agentDir, { recursive: true });
  for (const profile of [
    {
      id: "tree-root",
      name: "Tree Root",
      description: "Root task used by the Desktop task tree smoke.",
      mode: "subagent",
      permission: "FULL",
      tools: ["read", "task"],
      max_steps: 2,
    },
    {
      id: "tree-child",
      name: "Tree Child",
      description: "Nested task used by the Desktop task tree smoke.",
      mode: "subagent",
      permission: "READONLY",
      tools: ["read"],
      max_steps: 2,
      workspace_isolation: true,
    },
  ]) {
    fs.writeFileSync(path.join(agentDir, `${profile.id}.json`), `${JSON.stringify(profile, null, 2)}\n`);
  }
}

async function openReview(page, fileName, decisionText) {
  await page.locator('[data-testid="diff-dock-item"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.locator('[data-testid="diff-dock-item"]').click();
  await page.locator('[data-testid="review-panel"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.locator('[data-testid="change-review-card"]').filter({ hasText: fileName }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.locator('[data-testid="review-decision-state"]').filter({ hasText: decisionText }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const selectedPath = await page.locator(".change-review-file-list button.selected span").getAttribute("title");
  assert.equal(selectedPath, fileName, `Review selected ${selectedPath} instead of ${fileName}`);
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
  writeTaskAgentProfiles(workspaceA);
  initGitWorkspace(workspaceA);
  initGitWorkspace(workspaceB);
  const workspaceAReal = fs.realpathSync(workspaceA);
  const workspaceBReal = fs.realpathSync(workspaceB);
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
            OPENAGENT_BACKGROUND_WORKER: "0",
          },
        },
      );

    runtime = startRuntime();
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${token}` }, 90_000);

    const alphaId = await createAnsweredSession(runtimePort, workspaceA, "Alpha session", "ALPHA_REQUEST");
    const betaId = await createAnsweredSession(runtimePort, workspaceA, "Beta session", "BETA_REQUEST");
    const gammaId = await createAnsweredSession(runtimePort, workspaceB, "Gamma session", "GAMMA_REQUEST", [
      {
        kind: "document",
        path: path.join(workspaceB, "architecture.md"),
        name: "architecture.md",
        size_bytes: 900_000,
        content_type: "text/markdown",
        content: "# Gamma architecture\nretained attachment context\n",
        source: "desktop_file_picker",
        truncated: true,
        truncation_reason: "desktop_attachment_content_limit",
        original_content_bytes: 900_000,
        included_content_bytes: 49,
      },
      {
        kind: "pdf",
        path: path.join(workspaceB, "product-spec.pdf"),
        name: "product-spec.pdf",
        size_bytes: 1_200_000,
        content_type: "application/pdf",
        content: "",
        source: "desktop_file_picker",
        page_count: 9,
        truncated: true,
        truncation_reason: "pdf_binary_metadata_only",
        original_content_bytes: 1_200_000,
        included_content_bytes: 0,
      },
      {
        kind: "image",
        path: path.join(workspaceB, "design.png"),
        name: "design.png",
        size_bytes: 64_000,
        content_type: "image/png",
        content: "",
        source: "desktop_file_picker",
        media_metadata: { width_px: 1440, height_px: 900 },
        truncated: true,
        truncation_reason: "image_binary_metadata_only",
        original_content_bytes: 64_000,
        included_content_bytes: 0,
      },
    ]);
    const rootTaskId = await createBackgroundTask(runtimePort, alphaId, "Inspect task tree runtime", "tree-root");
    const nestedTaskId = await createBackgroundTask(runtimePort, rootTaskId, "Verify nested task state", "tree-child");
    const cancelledTaskId = await createBackgroundTask(runtimePort, alphaId, "Discard stale task branch", "tree-child");
    const cancelledTask = await bridgeJson(runtimePort, "POST", `/api/sessions/${alphaId}/tasks/${cancelledTaskId}/cancel`, {});
    assert.equal(cancelledTask.task?.canonical_status, "cancelled", "cancelled task did not expose canonical status");
    const seededTaskTree = await bridgeJson(runtimePort, "GET", `/api/sessions/${alphaId}/tasks`);
    assert.equal(seededTaskTree.count, 3, `seeded task tree was incomplete: ${JSON.stringify(seededTaskTree)}`);
    assert.ok(
      seededTaskTree.flat_tasks.some((task) => task.session_id === nestedTaskId && task.parent_session_id === rootTaskId),
      "nested task was not linked to its parent",
    );
    await writeReviewedFile(runtimePort, alphaId, "alpha-only.txt", "alpha\n", "accepted");
    await writeReviewedFile(runtimePort, betaId, "beta-only.txt", "beta\n", "changes_requested");
    await writeReviewedFile(runtimePort, gammaId, "gamma-only.txt", "gamma\n", "accepted");

    vite = spawnLogged("npm", ["run", "dev", "--", "--port", String(vitePort), "--strictPort"], { cwd: appDir });
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);

    const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await chromium.launch(launchOptions);
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const pageErrors = [];
    const consoleIssues = [];
    const failedResponses = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) consoleIssues.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
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
        if (!window.localStorage.getItem("openagent.desktop.activeProject")) {
          window.localStorage.setItem("openagent.desktop.activeProject", activeProject);
        }
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
    const taskTreeSummary = page.getByTestId("task-tree-summary");
    await taskTreeSummary.waitFor({ state: "visible", timeout: 15_000 });
    const taskSummaryText = (await taskTreeSummary.textContent()) || "";
    assert.ok(taskSummaryText.includes("3 个任务"), `task summary count missing: ${taskSummaryText}`);
    assert.ok(taskSummaryText.includes("进行中"), `active task summary missing: ${taskSummaryText}`);
    await taskTreeSummary.click();
    const taskTreeInspector = page.getByTestId("task-tree-inspector");
    await taskTreeInspector.waitFor({ state: "visible", timeout: 10_000 });
    for (const title of ["Inspect task tree runtime", "Verify nested task state", "Discard stale task branch"]) {
      await taskTreeInspector.locator(".task-tree-row").filter({ hasText: title }).waitFor({ state: "visible", timeout: 10_000 });
    }
    await taskTreeInspector.locator(".task-tree-row").filter({ hasText: "Verify nested task state" }).click();
    const nestedDetail = (await page.getByTestId("selected-task-detail").textContent()) || "";
    assert.ok(nestedDetail.includes("Tree Child") || nestedDetail.includes("tree-child"), `nested task role missing: ${nestedDetail}`);
    assert.ok(nestedDetail.includes("Verify nested task state"), `nested task input missing: ${nestedDetail}`);

    await page.getByTestId("task-action-start").click();
    await taskTreeInspector.locator(".task-tree-row").filter({ hasText: "Verify nested task state" }).filter({ hasText: "已完成" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const completedNestedDetail = (await page.getByTestId("selected-task-detail").textContent()) || "";
    for (const expected of ["Tree Child", "READONLY", "独立工作区", "read", "执行完成", "最终结果", "UNKNOWN_ANSWER"]) {
      assert.ok(completedNestedDetail.includes(expected), `nested subagent detail missing ${expected}: ${completedNestedDetail}`);
    }

    await taskTreeInspector.locator(".task-tree-row").filter({ hasText: "Inspect task tree runtime" }).click();
    await page.getByTestId("task-action-promote").click();
    await taskTreeInspector.locator(".task-tree-row").filter({ hasText: "Inspect task tree runtime" }).filter({ hasText: "已完成" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const promotedDetail = (await page.getByTestId("selected-task-detail").textContent()) || "";
    assert.ok(promotedDetail.includes("前台"), `promoted task mode missing: ${promotedDetail}`);
    assert.ok(promotedDetail.includes("read") && promotedDetail.includes("task"), `root allowed tools missing: ${promotedDetail}`);
    assert.ok(promotedDetail.includes("UNKNOWN_ANSWER"), `root final result missing: ${promotedDetail}`);

    await taskTreeInspector.locator(".task-tree-row").filter({ hasText: "Discard stale task branch" }).click();
    await page.getByTestId("task-action-resume").click();
    await page.getByTestId("selected-task-detail").filter({ hasText: "1 次" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("task-action-cancel").click();
    await taskTreeInspector.locator(".task-tree-row").filter({ hasText: "Discard stale task branch" }).filter({ hasText: "已取消" }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByTitle("Close").click();

    const alphaButton = page.locator(".project-session-button").filter({ hasText: "Alpha session" }).first();
    const betaButton = page.locator(".project-session-button").filter({ hasText: "Beta session" }).first();
    await openReview(page, "alpha-only.txt", "已完成审查");
    await betaButton.click();
    await page.locator('[data-testid="review-panel"]').waitFor({ state: "detached", timeout: 10_000 });
    await waitForSelectedSession(page, "Beta session", "BETA_ONLY_ANSWER", "ALPHA_ONLY_ANSWER");
    await openReview(page, "beta-only.txt", "已要求修改");
    assert.equal(
      (await page.locator('[data-testid="review-panel"]').textContent())?.includes("已完成审查"),
      false,
      "Alpha review decision leaked into Beta",
    );
    await alphaButton.click();
    await page.locator('[data-testid="review-panel"]').waitFor({ state: "detached", timeout: 10_000 });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");

    assert.equal(await page.getByRole("button", { name: "搜索" }).count(), 0, "inert search entry should be hidden");
    assert.equal(await page.getByTitle("More").count(), 0, "inert topbar menu should be hidden");
    await page.getByRole("button", { name: "已安排" }).click();
    await page.locator(".inspector.open").waitFor({ state: "visible", timeout: 10_000 });
    const contextCard = page.getByTestId("context-inspector-card");
    await contextCard.waitFor({ state: "visible", timeout: 10_000 });
    const contextText = (await contextCard.textContent()) || "";
    assert.ok(contextText.includes("上下文"), "context diagnostics card missing");
    assert.ok(contextText.includes("已装配"), `context diagnostics unavailable: ${contextText}`);
    assert.ok(contextText.includes("会话消息"), `context source decisions missing: ${contextText}`);
    assert.ok(contextText.includes("稳定前缀"), `prefix cache diagnostics missing: ${contextText}`);
    await contextCard.getByTestId("context-replay-button").click();
    await contextCard.getByTestId("context-replay-result").waitFor({ state: "visible", timeout: 10_000 });
    const replayText = (await contextCard.getByTestId("context-replay-result").textContent()) || "";
    assert.ok(
      replayText.includes("已验证") || replayText.includes("已安全重建"),
      `context replay did not complete safely: ${replayText}`,
    );
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
    const gammaTreeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok() && url.pathname === "/api/files" && url.searchParams.get("session_id") === gammaId && url.searchParams.get("depth") === "2";
    });
    const gammaPreviewResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok() && url.pathname === "/api/files" && url.searchParams.get("session_id") === gammaId && url.searchParams.get("path") === "gamma-only.txt" && url.searchParams.get("content") === "true";
    });
    const gammaGitResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok() && url.pathname === "/api/git" && url.searchParams.get("session_id") === gammaId && url.searchParams.get("path") === "gamma-only.txt";
    });
    await gammaProject.click();
    await waitForSelectedSession(page, "Gamma session", "GAMMA_ONLY_ANSWER", "ALPHA_ONLY_ANSWER");
    assert.equal(await page.getByTestId("task-tree-summary").count(), 0, "Alpha task tree leaked into Gamma session");
    const [gammaTree, gammaPreview, gammaGit] = await Promise.all([
      gammaTreeResponse.then((response) => response.json()),
      gammaPreviewResponse.then((response) => response.json()),
      gammaGitResponse.then((response) => response.json()),
    ]);
    assert.equal(fs.realpathSync(gammaTree.workspace), workspaceBReal, `Gamma file tree used ${gammaTree.workspace}`);
    assert.ok(gammaTree.entries.some((entry) => entry.path === "gamma-only.txt"), "Gamma file tree omitted gamma-only.txt");
    assert.equal(fs.realpathSync(gammaPreview.workspace), workspaceBReal, `Gamma preview used ${gammaPreview.workspace}`);
    assert.equal(gammaPreview.content, "gamma\n", "Gamma preview returned another workspace's content");
    assert.equal(fs.realpathSync(gammaGit.workspace), workspaceBReal, `Gamma Git status used ${gammaGit.workspace}`);
    assert.ok(gammaGit.changes.some((change) => change.path === "gamma-only.txt"), "Gamma Git status omitted gamma-only.txt");
    assert.equal(gammaGit.changes.some((change) => change.path === "alpha-only.txt"), false, "Alpha Git state leaked into Gamma");
    assert.ok(gammaGit.selected_diff?.diff?.includes("+gamma"), "Gamma unified diff did not render gamma content");
    for (const name of ["architecture.md", "product-spec.pdf", "design.png"]) {
      await page.locator(".attachment-chip").filter({ hasText: name }).waitFor({ state: "visible", timeout: 10_000 });
    }
    const attachmentText = (await page.locator(".attachment-chips").textContent()) || "";
    assert.ok(attachmentText.includes("内容已截断"), "large document truncation was not visible");
    assert.ok(attachmentText.includes("9 页"), "PDF page metadata was not visible");
    assert.ok(attachmentText.includes("1440×900"), "image dimensions were not visible");
    assert.ok(attachmentText.includes("仅元数据"), "binary attachment metadata-only state was not visible");

    await page.getByRole("button", { name: "Attach" }).click();
    await page.getByRole("menuitem", { name: "创建目标" }).click();
    await page.getByLabel("Goal title").fill("Gamma durable goal");
    await page.getByLabel("Goal objective").fill("Keep Gamma work durable across reload and restart.");
    await page.getByLabel("Goal acceptance criteria").fill("Create and edit\nPause and resume\nPersist by session");
    await page.getByRole("button", { name: "创建目标" }).click();
    const gammaGoalStrip = page.getByTestId("durable-goal-strip");
    await gammaGoalStrip.filter({ hasText: "Gamma durable goal" }).waitFor({ state: "visible", timeout: 10_000 });
    await gammaGoalStrip.click();
    await page.getByLabel("Goal objective").fill("Keep Gamma goal durable and isolated by session.");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await gammaGoalStrip.click();
    await page.getByRole("button", { name: "暂停" }).click();
    await page.getByTestId("durable-goal-strip").filter({ hasText: "已暂停" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTitle("关闭目标").click();

    await page.getByTitle("Toggle details").click();
    const gammaContext = page.getByTestId("context-inspector-card");
    await gammaContext.waitFor({ state: "visible", timeout: 10_000 });
    const gammaContextText = (await gammaContext.textContent()) || "";
    assert.ok(gammaContextText.includes("architecture.md"), "Context diagnostics omitted the document attachment");
    assert.ok(gammaContextText.includes("product-spec.pdf"), "Context diagnostics omitted the PDF attachment");
    assert.ok(gammaContextText.includes("design.png"), "Context diagnostics omitted the image attachment");
    assert.ok(gammaContextText.includes("已截断"), "Context diagnostics omitted the attachment truncation decision");
    await page.getByTitle("Close").click();

    const persistedGamma = await page.evaluate(() => ({
      activeProject: window.localStorage.getItem("openagent.desktop.activeProject"),
      activeSessions: JSON.parse(window.localStorage.getItem("openagent.desktop.activeSessions") || "{}"),
    }));
    assert.equal(persistedGamma.activeProject, workspaceB, "Gamma project was not persisted before reload");
    assert.equal(persistedGamma.activeSessions[workspaceB], gammaId, "Gamma session was not persisted before reload");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    const reloadedGamma = await page.evaluate(() => ({
      activeProject: window.localStorage.getItem("openagent.desktop.activeProject"),
      activeSessions: JSON.parse(window.localStorage.getItem("openagent.desktop.activeSessions") || "{}"),
      selectedProject: document.querySelector(".project-row.selected")?.textContent || "",
      selectedSession: document.querySelector(".project-session-button.selected")?.textContent || "",
      timeline: document.querySelector(".timeline")?.textContent || "",
    }));
    assert.equal(reloadedGamma.activeProject, workspaceB, `reload rewrote active project: ${JSON.stringify(reloadedGamma)}`);
    assert.equal(reloadedGamma.activeSessions[workspaceB], gammaId, `reload rewrote active session: ${JSON.stringify(reloadedGamma)}`);
    await page.waitForTimeout(2_000);
    const settledGamma = await page.evaluate(() => ({
      activeProject: window.localStorage.getItem("openagent.desktop.activeProject"),
      activeSessions: JSON.parse(window.localStorage.getItem("openagent.desktop.activeSessions") || "{}"),
      selectedProject: document.querySelector(".project-row.selected")?.textContent || "",
      selectedSession: document.querySelector(".project-session-button.selected")?.textContent || "",
      timeline: document.querySelector(".timeline")?.textContent || "",
    }));
    assert.ok(settledGamma.selectedSession.includes("Gamma session"), `Gamma was not selected after reload: ${JSON.stringify(settledGamma)}`);
    assert.ok(settledGamma.timeline.includes("GAMMA_ONLY_ANSWER"), `Gamma timeline did not restore: ${JSON.stringify(settledGamma)}`);
    assert.equal(settledGamma.timeline.includes("ALPHA_ONLY_ANSWER"), false, `Alpha timeline leaked after Gamma reload: ${JSON.stringify(settledGamma)}`);
    for (const name of ["architecture.md", "product-spec.pdf", "design.png"]) {
      await page.locator(".attachment-chip").filter({ hasText: name }).waitFor({ state: "visible", timeout: 10_000 });
    }
    await page.getByTestId("durable-goal-strip").filter({ hasText: "Gamma durable goal" }).waitFor({ state: "visible", timeout: 10_000 });
    assert.ok((await page.getByTestId("durable-goal-strip").textContent())?.includes("已暂停"), "Gamma goal pause state did not survive reload");
    await page.getByTestId("durable-goal-strip").click();
    assert.equal(await page.getByLabel("Goal objective").inputValue(), "Keep Gamma goal durable and isolated by session.");
    await page.getByTestId("durable-goal-editor").getByRole("button", { name: "恢复" }).click();
    await page.getByTestId("durable-goal-strip").filter({ hasText: "进行中" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTitle("关闭目标").click();
    await openReview(page, "gamma-only.txt", "已完成审查");
    const gammaReviewText = (await page.locator('[data-testid="review-panel"]').textContent()) || "";
    assert.ok(gammaReviewText.includes("gamma-only.txt"), "Gamma Review omitted gamma-only.txt");
    assert.equal(gammaReviewText.includes("alpha-only.txt"), false, "Alpha Review state leaked into Gamma");
    assert.ok(((await page.locator('[data-testid="review-diff"]').textContent()) || "").includes("gamma"), "Gamma Review preview did not show gamma content");
    await page.getByRole("button", { name: "返回对话" }).click();

    await page.getByRole("button", { name: "插件" }).click();
    await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(".settings-nav button").filter({ hasText: "能力与权限" }).click();
    const gammaTerminalResponse = page.waitForResponse((response) => (
      response.ok()
      && response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/terminal/sessions"
    ));
    await page.getByRole("button", { name: "启动终端" }).click();
    const gammaTerminal = await gammaTerminalResponse.then((response) => response.json());
    await page.getByLabel("Terminal input").fill("pwd");
    const gammaTerminalInputResponse = page.waitForResponse((response) => (
      response.ok()
      && response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/terminal/sessions/${gammaTerminal.terminal_id}/input`
    ));
    await page.getByRole("button", { name: "发送" }).click();
    await gammaTerminalInputResponse;
    await page.locator(".terminal-session-output").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(".terminal-session-output").filter({ hasText: workspaceB }).waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(gammaTerminal.session_id, gammaId, "Terminal response was not scoped to Gamma");
    assert.equal(fs.realpathSync(gammaTerminal.workspace), workspaceBReal, `Gamma terminal used ${gammaTerminal.workspace}`);
    const gammaTerminalText = (await page.locator(".terminal-session-output").textContent()) || "";
    assert.ok(gammaTerminalText.includes(workspaceBReal) || gammaTerminalText.includes(workspaceB), "Terminal UI did not show Gamma cwd");
    await page.locator(".settings-nav button").filter({ hasText: /^Git$/ }).click();
    const gammaGitSettings = (await page.locator(".settings-main").textContent()) || "";
    assert.ok(gammaGitSettings.includes("gamma-only.txt"), "Git settings omitted Gamma change");
    assert.equal(gammaGitSettings.includes("alpha-only.txt"), false, "Git settings leaked Alpha change");
    await page.getByRole("button", { name: "返回应用" }).click();
    await page.locator(".composer").waitFor({ state: "visible", timeout: 10_000 });

    const alphaProject = page.locator(".project-open-button").filter({ hasText: "workspace-alpha" }).first();
    const alphaPreviewResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok() && url.pathname === "/api/files" && url.searchParams.get("session_id") === alphaId && url.searchParams.get("path") === "alpha-only.txt" && url.searchParams.get("content") === "true";
    });
    await alphaProject.click();
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "GAMMA_ONLY_ANSWER");
    assert.equal(await page.getByTestId("durable-goal-strip").count(), 0, "Gamma goal leaked into Alpha session");
    assert.equal(await page.getByTestId("durable-plan-strip").count(), 0, "another session's plan leaked into Alpha session");
    const alphaPreview = await alphaPreviewResponse.then((response) => response.json());
    assert.equal(fs.realpathSync(alphaPreview.workspace), workspaceAReal, `Alpha preview used ${alphaPreview.workspace}`);
    assert.equal(alphaPreview.content, "alpha\n", "Alpha preview did not recover after project switch");

    await page.getByRole("button", { name: "Attach" }).click();
    await page.getByRole("menuitem", { name: "创建目标" }).click();
    await page.getByLabel("Goal title").fill("Alpha restart goal");
    await page.getByLabel("Goal objective").fill("Survive the managed Bridge process restart.");
    await page.getByRole("button", { name: "创建目标" }).click();
    await page.getByTestId("durable-goal-strip").filter({ hasText: "Alpha restart goal" }).waitFor({ state: "visible", timeout: 10_000 });

    await page.getByRole("button", { name: "Attach" }).click();
    await page.getByRole("menuitem", { name: "计划模式" }).click();
    await page.getByLabel("Plan title").fill("Alpha safe execution plan");
    await page.getByLabel("Plan objective").fill("Remain read-only until execution is explicitly approved.");
    await page.getByLabel("Plan steps").fill("Inspect the workspace\nConfirm the plan\nExecute the approved change");
    await page.getByRole("button", { name: "创建计划" }).click();
    await page.getByTestId("durable-plan-strip").filter({ hasText: "计划中 · 只读" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("composer-plan-readonly").waitFor({ state: "visible", timeout: 10_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");
    await page.getByTestId("durable-goal-strip").filter({ hasText: "Alpha restart goal" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("durable-plan-strip").filter({ hasText: "计划中 · 只读" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("composer-plan-readonly").waitFor({ state: "visible", timeout: 10_000 });
    await openReview(page, "alpha-only.txt", "已完成审查");
    await page.getByRole("button", { name: "返回对话" }).click();

    assert.equal(pageErrors.length, 0, `page errors before Bridge restart: ${pageErrors.join("\n")}`);
    assert.equal(consoleIssues.length, 0, `console issues before Bridge restart: ${consoleIssues.join("\n")}`);
    await stopChild(runtime);
    runtime = startRuntime();
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${token}` }, 90_000);
    pageErrors.length = 0;
    consoleIssues.length = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");
    await page.getByTestId("durable-goal-strip").filter({ hasText: "Alpha restart goal" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("durable-plan-strip").filter({ hasText: "计划中 · 只读" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("composer-plan-readonly").waitFor({ state: "visible", timeout: 10_000 });
    await openReview(page, "alpha-only.txt", "已完成审查");
    await page.getByRole("button", { name: "返回对话" }).click();
    await page.getByTitle("Toggle details").click();
    await page.locator(".inspector.open").waitFor({ state: "visible", timeout: 10_000 });
    const restartedInspector = (await page.locator(".inspector").textContent()) || "";
    assert.equal(restartedInspector.includes("beta-only.txt"), false, "Bridge restart leaked Beta inspector state into Alpha");
    assert.ok(restartedInspector.includes("已装配"), "context diagnostics did not survive Bridge restart");
    const restartedTaskTree = page.getByTestId("task-tree-inspector");
    await restartedTaskTree.waitFor({ state: "visible", timeout: 10_000 });
    const restartedTaskText = (await restartedTaskTree.textContent()) || "";
    assert.ok(restartedTaskText.includes("Inspect task tree runtime"), "root task did not survive Bridge restart");
    assert.ok(restartedTaskText.includes("Verify nested task state"), "nested task did not survive Bridge restart");
    assert.ok(restartedTaskText.includes("已取消"), "cancelled task status did not survive Bridge restart");
    await restartedTaskTree.locator(".task-tree-row").filter({ hasText: "Verify nested task state" }).click();
    const restartedNestedDetail = (await page.getByTestId("selected-task-detail").textContent()) || "";
    for (const expected of ["Tree Child", "独立工作区", "read", "执行完成", "UNKNOWN_ANSWER"]) {
      assert.ok(restartedNestedDetail.includes(expected), `restarted subagent detail missing ${expected}: ${restartedNestedDetail}`);
    }
    await page.locator('[data-testid="context-performance"]').waitFor({ state: "visible", timeout: 10_000 });
    const contextPerformance = (await page.locator('[data-testid="context-performance"]').textContent()) || "";
    assert.ok(contextPerformance.includes("装配"), "context build performance was not rendered");
    assert.ok(contextPerformance.includes("请求体"), "provider payload performance was not rendered");
    await page.getByTitle("Close").click();

    await page.getByTestId("durable-plan-strip").click();
    assert.equal(await page.getByLabel("Plan objective").inputValue(), "Remain read-only until execution is explicitly approved.");
    await page.getByTestId("durable-plan-editor").getByRole("button", { name: "开始执行" }).click();
    await page.getByTestId("durable-plan-strip").filter({ hasText: "执行中" }).waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await page.getByTestId("composer-plan-readonly").count(), 0, "execution mode kept the composer locked to Plan read-only");
    await page.getByTestId("durable-plan-strip").click();
    await page.getByTestId("durable-plan-editor").getByRole("button", { name: "完成计划" }).click();
    await page.getByTestId("durable-plan-strip").filter({ hasText: "已完成" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTitle("关闭计划").click();

    await page.getByTestId("durable-goal-strip").click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.getByTestId("durable-goal-strip").filter({ hasText: "已完成" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTitle("关闭目标").click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForSelectedSession(page, "Alpha session", "ALPHA_ONLY_ANSWER", "BETA_ONLY_ANSWER");
    await page.getByTestId("durable-goal-strip").filter({ hasText: "已完成" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("durable-plan-strip").filter({ hasText: "已完成" }).waitFor({ state: "visible", timeout: 10_000 });

    await betaButton.click();
    await waitForSelectedSession(page, "Beta session", "BETA_ONLY_ANSWER", "ALPHA_ONLY_ANSWER");
    assert.equal(await page.getByTestId("durable-plan-strip").count(), 0, "Alpha plan leaked into Beta session");
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
    assert.equal(await page.getByTestId("durable-plan-strip").count(), 0, "new session retained Alpha plan");
    assert.equal(await page.getByTestId("task-tree-summary").count(), 0, "new session retained Alpha task tree");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".project-session-button.selected").filter({ hasText: "新对话" }).waitFor({ state: "visible", timeout: 15_000 });
    assert.equal((await page.locator(".timeline").textContent())?.includes("ALPHA_ONLY_ANSWER"), false, "reloaded new session retained Alpha timeline");

    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join("\n")}`);
    assert.equal(consoleIssues.length, 0, `console issues: ${consoleIssues.join("\n")}\nfailed responses: ${failedResponses.join("\n")}`);
    assert.equal(provider.requests.length, 5, `provider request count mismatch: ${provider.requests.length}`);
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
