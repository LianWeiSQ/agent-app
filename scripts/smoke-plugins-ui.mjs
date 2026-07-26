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
const bridgeToken = "plugins-ui-smoke-token";

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

function writePlugin(root, version) {
  fs.mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "release-helper"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "release-helper",
      version,
      description: "Prepare a verified release summary.",
      interface: { capabilities: ["Read", "Write"] },
    }),
  );
  fs.writeFileSync(
    path.join(root, "skills", "release-helper", "SKILL.md"),
    "---\nname: release-helper-skill\ndescription: Prepare release notes with repository evidence\nallowed-tools:\n  - read\n  - git\n---\nPrepare a verified release summary.\n",
  );
}

function startRuntime(port, workspace, sessionRoot, tokenPath, vitePort) {
  return spawnLogged(
    "cargo",
    [
      "run", "-q", "-p", "openagent-http-runtime", "--", "--host", "127.0.0.1",
      "--port", String(port), "--workspace", workspace, "--session-root", sessionRoot,
      "--cors-origin", `http://127.0.0.1:${vitePort}`,
    ],
    { cwd: coreRoot, env: { ...process.env, OPENAGENT_BRIDGE_AUTH_TOKEN_FILE: tokenPath } },
  );
}

async function openPluginSettings(page) {
  if (!(await page.locator(".settings-shell").isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "插件", exact: true }).first().click();
  }
  await page.locator(".settings-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".settings-nav button").filter({ hasText: "插件" }).click();
  await page.getByRole("heading", { name: "Skills 与插件" }).waitFor({ state: "visible" });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-plugins-ui-"));
  const workspace = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(tempRoot, "sessions");
  const pluginSource = path.join(tempRoot, "release-helper-source");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  writePlugin(pluginSource, "1.0.0");
  const tokenPath = path.join(tempRoot, "bridge-token");
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
      localStorage.setItem("openagent.desktop.projects", JSON.stringify([{ id: project, name: "plugins-ui", path: project }]));
      localStorage.setItem("openagent.desktop.activeProject", project);
    }, { bridgeUrl: `http://127.0.0.1:${runtimePort}`, token: bridgeToken, project: workspace });
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openPluginSettings(page);

    await page.getByLabel("Plugin source").fill(pluginSource);
    await page.getByRole("button", { name: "安装", exact: true }).click();
    const row = page.locator(".plugin-row").filter({ hasText: "release-helper" });
    await row.waitFor({ state: "visible", timeout: 15_000 });
    assert.match((await row.textContent()) || "", /1\.0\.0/);
    assert.match((await row.textContent()) || "", /已启用/);
    await row.getByTitle("查看插件权限和 Skills").click();
    assert.match((await row.textContent()) || "", /tool:read/);
    assert.match((await row.textContent()) || "", /capability:write/);
    await page.getByText("release-helper-skill", { exact: true }).last().waitFor({ state: "visible" });
    let skillPayload = await bridgeJson(runtimePort, "/api/skills");
    assert.ok(skillPayload.skills.some((skill) => skill.name === "release-helper-skill"));

    await row.getByTitle("停用插件").click();
    await row.getByText("已停用", { exact: true }).waitFor({ state: "visible" });
    skillPayload = await bridgeJson(runtimePort, "/api/skills");
    assert.equal(skillPayload.skills.some((skill) => skill.name === "release-helper-skill"), false);
    await row.getByTitle("启用插件").click();
    await row.getByText("已启用", { exact: true }).waitFor({ state: "visible" });

    const skillToggle = page.locator(".settings-toggle-row").filter({ hasText: "release-helper-skill" });
    await skillToggle.click();
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll(".settings-toggle-row")]
        .find((item) => item.textContent?.includes("release-helper-skill"));
      return row && !row.querySelector(".settings-switch")?.classList.contains("on");
    });
    skillPayload = await bridgeJson(runtimePort, "/api/skills");
    assert.equal(skillPayload.skills.some((skill) => skill.name === "release-helper-skill"), false);

    writePlugin(pluginSource, "1.1.0");
    await row.getByTitle("从安装来源更新").click();
    await row.getByText("1.1.0", { exact: false }).waitFor({ state: "visible", timeout: 15_000 });

    await stopChild(runtime);
    runtime = startRuntime(runtimePort, workspace, sessionRoot, tokenPath, vitePort);
    await waitForHttp(`http://127.0.0.1:${runtimePort}/api/health`, { authorization: `Bearer ${bridgeToken}` });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".composer").waitFor({ state: "visible", timeout: 15_000 });
    await openPluginSettings(page);
    const restartedRow = page.locator(".plugin-row").filter({ hasText: "release-helper" });
    await restartedRow.waitFor({ state: "visible" });
    assert.match((await restartedRow.textContent()) || "", /1\.1\.0/);
    const restartedSkill = page.locator(".settings-toggle-row").filter({ hasText: "release-helper-skill" });
    assert.equal(await restartedSkill.locator(".settings-switch.on").count(), 0);
    await restartedSkill.click();
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll(".settings-toggle-row")]
        .find((item) => item.textContent?.includes("release-helper-skill"));
      return row?.querySelector(".settings-switch")?.classList.contains("on");
    });
    skillPayload = await bridgeJson(runtimePort, "/api/skills");
    assert.ok(skillPayload.skills.some((skill) => skill.name === "release-helper-skill"));

    await restartedRow.getByTitle("查看插件权限和 Skills").click();
    await page.screenshot({ path: "/tmp/openagent-plugins-ui-smoke.png", fullPage: true });

    await restartedRow.getByTitle("删除插件").click();
    await restartedRow.waitFor({ state: "detached", timeout: 15_000 });
    const finalPayload = await bridgeJson(runtimePort, "/api/plugins");
    assert.equal(finalPayload.plugin_count, 0);
    assert.equal(fs.existsSync(path.join(sessionRoot, ".openagent-runtime", "plugins", "release-helper")), false);
    process.stdout.write("plugins UI smoke passed\n");
  } finally {
    await browser?.close().catch(() => {});
    await stopChild(vite);
    await stopChild(runtime);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
