import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Bot,
  CheckCircle2,
  Circle,
  Database,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCompare,
  History,
  PanelRight,
  PencilLine,
  Paperclip,
  Play,
  PlugZap,
  Plus,
  Power,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sidebar,
  Square,
  Terminal,
  Trash2,
  Undo2,
  Wrench,
  XCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Fragment, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type JsonRecord = Record<string, unknown>;

class ApiError extends Error {
  status: number;
  method: string;
  path: string;
  body?: JsonRecord;

  constructor(method: string, path: string, status: number, body?: JsonRecord) {
    const bodyError = typeof body?.error === "string" ? body.error : "";
    super(bodyError ? `${method} ${path} ${status}: ${bodyError}` : `${method} ${path} ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

function isMissingSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const body = error instanceof ApiError ? error.body : undefined;
  const code = typeof body?.code === "string" ? body.code : "";
  const bodyError = typeof body?.error === "string" ? body.error : "";
  const text = `${message}\n${code}\n${bodyError}`.toLowerCase();
  return (
    (error instanceof ApiError && error.status === 404) ||
    code === "session_not_found" ||
    text.includes("session not found") ||
    text.includes("session state not found") ||
    text.includes("no such file or directory")
  );
}

function userFacingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const body = error instanceof ApiError ? error.body : undefined;
  const bodyError = typeof body?.error === "string" ? body.error : "";
  const text = `${message}\n${bodyError}`.toLowerCase();
  if (isMissingSessionError(error)) return "会话状态丢失或已过期，请重新打开该会话，或新建一个会话继续。";
  if (text.includes("provider returned http 502") || text.includes("upstream service temporarily unavailable")) {
    return "模型服务暂时不可用，上游返回 502。请稍后重试，或在 Settings → 配置里切换模型/Provider。";
  }
  if (text.includes("provider returned http 429") || text.includes("rate limit")) {
    return "模型服务限流了，请稍后重试。";
  }
  if (text.includes("401") || text.includes("unauthorized")) {
    return "Bridge 未授权，请在 Settings → 连接里检查本地 token。";
  }
  if (text.includes("failed to fetch") || text.includes("events 502") || text.includes("events 503")) {
    return "App Bridge 连接不稳定，正在重连。";
  }
  return message || "操作失败，请稍后重试。";
}

type AppEvent = {
  event_id?: string;
  schema_version?: string;
  protocol_version?: number;
  sequence?: number;
  global_sequence?: number;
  method: string;
  params?: JsonRecord;
  created_at_ms?: number;
};

type SessionSummary = {
  session_id?: string;
  id?: string;
  title?: string;
  workspace?: string;
  status?: string;
  updated_at_ms?: number;
  message_count?: number;
  archived?: boolean;
  archived_at_ms?: number | null;
  metadata?: JsonRecord;
};

type CreateSessionPayload = {
  session_id?: string;
  id?: string;
  session?: SessionSummary;
};

type TurnJobSummary = {
  session_id?: string;
  turn_id?: string;
  status?: string;
  started_at_ms?: number;
  updated_at_ms?: number;
  queue_position?: number | null;
  queue_reason?: string | null;
  payload_persisted?: boolean;
  cancel_requested?: boolean;
  cancel_requested_at_ms?: number | null;
};

type TurnSchedulerSummary = {
  max_queued_turns_per_session?: number;
  max_running_turn_workers?: number;
  running_turn_workers?: number;
  turn_queue_lease_stale_ms?: number;
  turn_queue_timeout_ms?: number;
  expired_queued_turns?: number;
};

type TurnJobsPayload = {
  turns?: TurnJobSummary[];
  count?: number;
  running_count?: number;
  queued_count?: number;
  active_count?: number;
  terminal_count?: number;
  scheduler?: TurnSchedulerSummary;
  filters?: JsonRecord;
  source?: string;
  index_persisted?: boolean;
  error?: string;
};

type ProtocolPayload = {
  protocol?: string;
  protocol_version?: number;
  event_schema_version?: string;
  endpoints?: JsonRecord;
  terminal_methods?: string[];
};

type ProviderPayload = {
  healthy?: boolean;
  provider?: string;
  provider_label?: string;
  model?: string;
  model_count?: number;
  model_endpoint_ok?: boolean;
  configured_model_available?: boolean;
  api_key?: string;
  models?: Array<{ id?: string; default?: boolean }>;
};

type McpServerSummary = {
  name?: string;
  type?: string;
  enabled?: boolean;
  transport?: string;
  selected_transport?: string | null;
  status?: string;
  tool_count?: number;
  tools?: Array<{ name?: string; title?: string; description?: string; original_name?: string }>;
  remote_url_configured?: boolean;
  command?: string;
  args_count?: number;
  cwd_configured?: boolean;
  env_count?: number;
  header_count?: number;
  timeout_ms?: number;
  last_error?: string | null;
  last_refreshed_at?: number | null;
  lifecycle_status?: string | null;
  lifecycle_pid?: number | null;
  lifecycle_started_at?: number | null;
  lifecycle_last_refreshed_at?: number | null;
  lifecycle_tool_count?: number | null;
};

type McpPayload = {
  configured?: boolean;
  enabled?: boolean;
  server_count?: number;
  tool_count?: number;
  refresh_ttl_s?: number | null;
  source?: string;
  writable?: boolean;
  config_path?: string | null;
  readonly_reason?: string | null;
  status?: string;
  error?: string | null;
  servers?: McpServerSummary[];
};

type McpServerDraft = {
  mode: "remote" | "local";
  name: string;
  url: string;
  transport: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  headers: string;
  timeoutMs: string;
};

type PendingApproval = {
  kind?: string;
  status?: string;
  session_id?: string;
  turn_id?: string;
  request_id?: string;
  approval?: JsonRecord;
  session?: SessionSummary;
};

type PendingQuestion = {
  kind?: string;
  status?: string;
  session_id?: string;
  turn_id?: string;
  request_id?: string;
  question?: JsonRecord;
  session?: SessionSummary;
};

type SessionDiff = {
  undo_count?: number;
  redo_count?: number;
  latest?: JsonRecord | null;
  patches?: JsonRecord[];
  redo?: JsonRecord[];
};

type CheckpointSummary = {
  checkpoint_id?: string;
  kind?: string;
  run_id?: string;
  timestamp_ms?: number;
  file_count?: number;
  total_bytes?: number;
};

type CheckpointsPayload = {
  count?: number;
  latest?: CheckpointSummary | null;
  checkpoints?: CheckpointSummary[];
};

type CheckpointRestoreRecord = {
  checkpoint_id?: string;
  run_id?: string;
  restored_at_ms?: number;
  checkpoint_kind?: string;
  file_count?: number;
  total_bytes?: number;
  message_id?: string;
  part_id?: string;
};

type FileEntry = {
  path?: string;
  name?: string;
  kind?: string;
  size_bytes?: number;
  text?: boolean;
};

type ComposerAttachment = {
  id: string;
  kind: "file";
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  content: string;
  error?: string | null;
};

type AttachmentSummary = {
  id?: string;
  kind: "file";
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  contentChars?: number;
  contentLines?: number;
};

type FilesPayload = {
  workspace?: string;
  path?: string;
  absolute_path?: string;
  exists?: boolean;
  is_file?: boolean;
  is_dir?: boolean;
  entries?: FileEntry[];
  entry_count?: number;
  truncated?: boolean;
  content?: string | null;
  error?: string;
};

type GitChange = {
  status?: string;
  index?: string;
  worktree?: string;
  path?: string;
};

type GitPayload = {
  workspace?: string;
  is_repo?: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  changes?: GitChange[];
  change_count?: number;
  error?: string;
};

type TerminalRunResult = {
  command?: string;
  workspace?: string;
  cwd?: string;
  cwd_relative?: string;
  success?: boolean;
  exit_code?: number;
  timed_out?: boolean;
  timeout_ms?: number;
  duration_ms?: number;
  stdout?: string;
  stderr?: string;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
};

type MessageInfo = {
  id?: string;
  role?: string;
  status?: string;
  seq?: number;
  created_at_ms?: number;
  run_id?: string | null;
  metadata?: JsonRecord;
};

type MessagePart = {
  id?: string;
  kind?: string;
  status?: string;
  content?: unknown;
  attributes?: JsonRecord;
  timestamp_ms?: number;
};

type MessageWithParts = {
  info?: MessageInfo;
  parts?: MessagePart[];
};

type TimelineMessageItem = {
  message: MessageWithParts;
  index: number;
};

type SessionMessagesPayload = {
  session_id?: string;
  message_count?: number;
  message_v2_count?: number;
  limit?: number;
  messages?: JsonRecord[];
  messages_v2?: MessageWithParts[];
};

type StreamHealth = {
  status: string;
  resume_cursor: number;
  reconnect_attempts: number;
  recovered_count: number;
  last_batch_count: number;
  last_error?: string;
  last_connected_at_ms?: number;
  next_retry_ms?: number;
};

type InteractionSync = {
  last_synced_at_ms?: number;
  last_event_method?: string;
};

type StreamingDraft = {
  turnId: string;
  text: string;
  eventCount: number;
  completed: boolean;
  terminalMethod?: string;
};

type LiveFinalAnswer = {
  turnId: string;
  text: string;
};

type TrustHistoryItem = {
  id: string;
  kind: "approval" | "question";
  status: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  title: string;
  summary: string;
  detail: string;
  requestId: string;
  callId: string;
};

type ElicitationFieldKind = "text" | "select" | "number" | "integer" | "boolean" | "multiselect";

type ElicitationOption = {
  label: string;
  value: string;
};

type ElicitationField = {
  id: string;
  index: number;
  label: string;
  description: string;
  value: string;
  values: string[];
  options: ElicitationOption[];
  required: boolean;
  kind: ElicitationFieldKind;
  placeholder: string;
  error: string;
  min?: number;
  max?: number;
};

type McpToolTrace = {
  toolName: string;
  originalTool: string;
  dynamicTool: string;
  server: string;
  transport: string;
  callId: string;
  status: string;
  output: string;
  error: string;
  nonTextBlockCount: number;
  lifecycleReused: boolean;
  lifecyclePid: number;
};

type DesktopDiagnosticPath = {
  source?: string;
  path?: string;
  exists?: boolean;
};

type DesktopProviderEnvSummary = {
  env_file?: string | null;
  profile?: string | null;
  base_url?: string | null;
  model?: string | null;
  wire_api?: string | null;
  base_url_configured?: boolean;
  api_key_configured?: boolean;
};

type ProviderEnvPreview = {
  key?: string;
  value?: string;
  secret?: boolean;
};

type ProviderConfigPayload = {
  profile?: string;
  profile_label?: string;
  base_url?: string;
  model?: string;
  wire_api?: string;
  api_key_configured?: boolean;
  env_file?: string;
  env_preview?: ProviderEnvPreview[];
};

type ProviderValidationResult = {
  ok?: boolean;
  profile?: string;
  base_url?: string;
  model?: string;
  wire_api?: string;
  models_ok?: boolean;
  response_ok?: boolean;
  model_available?: boolean | null;
  model_count?: number | null;
  models_status?: number | null;
  response_status?: number | null;
  message?: string;
  sample?: string | null;
};

type ProviderDraft = {
  profile: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: string;
};

type DesktopDiagnostics = {
  runtime?: string;
  app_version?: string;
  os?: string;
  arch?: string;
  bridge_default_url?: string;
  bridge_url_env?: string | null;
  bridge_binary?: DesktopDiagnosticPath | null;
  bridge_binary_candidates?: DesktopDiagnosticPath[];
  core_root_default?: string;
  core_root_default_source?: string;
  workspace_default?: string;
  workspace_default_source?: string;
  session_root_default?: string;
  provider?: DesktopProviderEnvSummary;
  warnings?: string[];
};

type ManagedBridgeStatus = {
  running?: boolean;
  pid?: number | null;
  url?: string;
  port?: number;
  workspace?: string;
  core_root?: string;
  session_root?: string;
  binary?: string | null;
  provider?: DesktopProviderEnvSummary;
  error?: string | null;
};

type ProjectPathInfo = {
  input?: string;
  path?: string;
  name?: string;
  exists?: boolean;
  is_dir?: boolean;
  canonical?: string | null;
  error?: string | null;
};

type DesktopAuthToken = {
  token?: string;
  path?: string;
  created?: boolean;
};

type DesktopProject = {
  id: string;
  name: string;
  path: string;
  last_opened_at_ms?: number;
};

type SettingsPage =
  | "general"
  | "profile"
  | "configuration"
  | "plugins"
  | "mcp"
  | "computer"
  | "connections"
  | "git"
  | "environment"
  | "worktree"
  | "archived";

type SseEventHandler = (events: AppEvent[]) => void | Promise<void>;

const DEFAULT_BRIDGE = import.meta.env.VITE_OPENAGENT_BRIDGE_URL ?? "http://127.0.0.1:8787";
const STORAGE_BRIDGE = "openagent.desktop.bridgeUrl";
const STORAGE_CORE_ROOT = "openagent.desktop.coreRoot";
const STORAGE_TOKEN = "openagent.desktop.token";
const STORAGE_PROJECTS = "openagent.desktop.projects";
const STORAGE_ACTIVE_PROJECT = "openagent.desktop.activeProject";
const STORAGE_ACTIVE_SESSIONS = "openagent.desktop.activeSessions";
const STORAGE_PERMISSION_MODE = "openagent.desktop.permissionMode";

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; model: string; wireApi: string; models: string[] }> = {
  gpt: {
    label: "GPT / OpenAI compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    wireApi: "responses",
    models: ["gpt-5.4", "gpt-5.5", "gpt-image-1.5", "gpt-image-2"],
  },
  glm: {
    label: "GLM / OpenAI compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    wireApi: "chat",
    models: ["glm-4.5", "glm-4.5-air", "glm-4-flash", "glm-4-plus"],
  },
};

function providerPreset(profile?: string | null) {
  return PROVIDER_PRESETS[profile === "glm" ? "glm" : "gpt"];
}

function defaultProviderDraft(): ProviderDraft {
  const preset = providerPreset("gpt");
  return {
    profile: "gpt",
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.model,
    wireApi: preset.wireApi,
  };
}

function providerDraftFromPayload(payload?: ProviderConfigPayload | null): ProviderDraft {
  const profile = payload?.profile === "glm" ? "glm" : "gpt";
  const preset = providerPreset(profile);
  return {
    profile,
    baseUrl: payload?.base_url || preset.baseUrl,
    apiKey: "",
    model: payload?.model || preset.model,
    wireApi: payload?.wire_api || preset.wireApi,
  };
}

function normalizeProviderBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("/v1") || lower.includes("/api/")) return trimmed;
  return `${trimmed}/v1`;
}

function inferProviderProfile(baseUrl = "", model = ""): string {
  const text = `${baseUrl} ${model}`.toLowerCase();
  return text.includes("glm") || text.includes("bigmodel") || text.includes("zhipu") ? "glm" : "gpt";
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseProviderEnvText(input: string, current: ProviderDraft): ProviderDraft {
  const text = input.trim();
  if (!text) return current;
  let env: Record<string, string> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
    const rawEnv = record.env && typeof record.env === "object" && !Array.isArray(record.env) ? (record.env as JsonRecord) : record;
    env = Object.fromEntries(
      Object.entries(rawEnv)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => [key, String(value)]),
    );
  } catch {
    env = Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
          const [key, ...rest] = normalized.split("=");
          return [key.trim(), parseEnvValue(rest.join("="))];
        }),
    );
  }
  const baseUrl = env.OPENAI_BASE_URL || env.ANTHROPIC_BASE_URL || current.baseUrl;
  const model = env.OPENAGENT_MODEL || env.OPENAI_MODEL || current.model;
  return {
    profile: env.OPENAGENT_PROVIDER_PROFILE || inferProviderProfile(baseUrl, model),
    baseUrl: normalizeProviderBaseUrl(baseUrl),
    apiKey: env.OPENAI_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || current.apiKey,
    model,
    wireApi: env.OPENAI_WIRE_API || current.wireApi || providerPreset(inferProviderProfile(baseUrl, model)).wireApi,
  };
}

function storedValue(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function storedActiveSessions(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_ACTIVE_SESSIONS) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sessions: Record<string, string> = {};
    for (const [projectPath, session] of Object.entries(parsed)) {
      if (!normalizeProjectPath(projectPath) || typeof session !== "string" || !session.trim()) continue;
      sessions[normalizeProjectPath(projectPath)] = session.trim();
    }
    return sessions;
  } catch {
    return {};
  }
}

function storedActiveSession(projectPath: string): string {
  return storedActiveSessions()[normalizeProjectPath(projectPath)] ?? "";
}

function persistActiveSession(projectPath: string, session: string): void {
  if (typeof window === "undefined") return;
  const normalizedProject = normalizeProjectPath(projectPath);
  if (!normalizedProject) return;
  const sessions = storedActiveSessions();
  if (session.trim()) {
    sessions[normalizedProject] = session.trim();
  } else {
    delete sessions[normalizedProject];
  }
  window.localStorage.setItem(STORAGE_ACTIVE_SESSIONS, JSON.stringify(sessions));
}

function forgetStoredSession(session: string): void {
  if (typeof window === "undefined" || !session.trim()) return;
  const sessions = storedActiveSessions();
  let changed = false;
  for (const [projectPath, storedSession] of Object.entries(sessions)) {
    if (storedSession !== session) continue;
    delete sessions[projectPath];
    changed = true;
  }
  if (changed) window.localStorage.setItem(STORAGE_ACTIVE_SESSIONS, JSON.stringify(sessions));
}

function normalizePermissionMode(value?: string | null): string {
  switch ((value ?? "").trim()) {
    case "FULL":
    case "FULL_ACCESS":
      return "FULL_ACCESS";
    case "READONLY":
    case "READ_ONLY":
      return "READONLY";
    case "AUTO":
    case "AUTO_APPROVE":
      return "AUTO_APPROVE";
    case "PLAN_ONLY":
    case "ASK":
    case "REQUEST_APPROVAL":
      return "REQUEST_APPROVAL";
    default:
      return "REQUEST_APPROVAL";
  }
}

function permissionPayloadForMode(mode: string): JsonRecord {
  switch (normalizePermissionMode(mode)) {
    case "FULL_ACCESS":
      return {
        permission: "FULL",
        dangerously_skip_permissions: true,
        skip_permissions: true,
        permission_mode: "full_access",
      };
    case "AUTO_APPROVE":
      return {
        permission: "PLAN_ONLY",
        dangerously_skip_permissions: true,
        skip_permissions: true,
        permission_mode: "auto_approve",
      };
    case "READONLY":
      return {
        permission: "READONLY",
        dangerously_skip_permissions: false,
        skip_permissions: false,
        permission_mode: "readonly",
      };
    default:
      return {
        permission: "PLAN_ONLY",
        dangerously_skip_permissions: false,
        skip_permissions: false,
        permission_mode: "request_approval",
      };
  }
}

function storedProjects(): DesktopProject[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_PROJECTS) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as JsonRecord;
        const path = typeof record.path === "string" ? normalizeProjectPath(record.path) : "";
        if (!path) return null;
        return {
          id: path,
          name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : projectNameFromPath(path),
          path,
          last_opened_at_ms:
            typeof record.last_opened_at_ms === "number" ? record.last_opened_at_ms : undefined,
        } satisfies DesktopProject;
      })
      .filter(Boolean) as DesktopProject[];
  } catch {
    return [];
  }
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function normalizeProjectPath(value?: string): string {
  const path = (value ?? "").trim();
  if (!path) return "";
  if (/^[A-Za-z]:\\?$/.test(path)) return path;
  return path.replace(/[\\/]+$/, "") || path;
}

function projectNameFromPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function projectFromPath(path: string, name?: string): DesktopProject {
  const normalized = normalizeProjectPath(path);
  return {
    id: normalized,
    name: name?.trim() || projectNameFromPath(normalized),
    path: normalized,
    last_opened_at_ms: Date.now(),
  };
}

function isDisplayableProject(project: DesktopProject): boolean {
  const path = normalizeProjectPath(project.path);
  return Boolean(path && path !== "/" && path !== "\\");
}

function upsertProject(projects: DesktopProject[], project: DesktopProject): DesktopProject[] {
  if (!isDisplayableProject(project)) return projects;
  const next = projects.filter((item) => normalizeProjectPath(item.path) !== normalizeProjectPath(project.path));
  return [project, ...next].slice(0, 12);
}

function sameProjectPath(left?: string, right?: string): boolean {
  return normalizeProjectPath(left) === normalizeProjectPath(right);
}

function sessionId(session: SessionSummary): string {
  return session.session_id ?? session.id ?? "";
}

function isSessionIdLike(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^(session|new session)$/i.test(text)) return true;
  if (/^session[-_][A-Za-z0-9-]+$/i.test(text)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  return /^[0-9a-f]{24,}$/i.test(text);
}

function sessionDisplayTitle(session: SessionSummary): string {
  const title = session.title?.trim() ?? "";
  const id = sessionId(session);
  if (title && title !== id && !isSessionIdLike(title)) return title;
  return "新对话";
}

function isArchivedSession(session: SessionSummary): boolean {
  return Boolean(session.archived || session.archived_at_ms || session.metadata?.archived || session.metadata?.archived_at_ms);
}

function sessionTimeLabel(session: SessionSummary, nowMs: number): string {
  return formatElapsed(session.updated_at_ms, nowMs) || session.status || "";
}

function createdSessionSummary(payload: CreateSessionPayload, workspace: string): SessionSummary | null {
  const nested = payload.session ?? {};
  const id = payload.session_id ?? payload.id ?? sessionId(nested);
  if (!id) return null;
  return {
    ...nested,
    id: nested.id ?? id,
    session_id: nested.session_id ?? id,
    workspace: normalizeProjectPath(nested.workspace || workspace),
    status: nested.status ?? "idle",
    updated_at_ms: nested.updated_at_ms ?? Date.now(),
    message_count: nested.message_count ?? 0,
  };
}

function upsertSessionSummary(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
  const id = sessionId(session);
  if (!id) return sessions;
  const next = [session, ...sessions.filter((item) => sessionId(item) !== id)];
  return next.sort((left, right) => (right.updated_at_ms ?? 0) - (left.updated_at_ms ?? 0));
}

function isImeKeyboardEvent(event: KeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as typeof event.nativeEvent & {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
  return Boolean(nativeEvent.isComposing || nativeEvent.keyCode === 229 || nativeEvent.which === 229);
}

function turnJobId(job: TurnJobSummary): string {
  return job.turn_id ?? "";
}

function turnJobSessionId(job: TurnJobSummary): string {
  return job.session_id ?? "";
}

function isTurnJobTerminal(job: TurnJobSummary): boolean {
  return ["completed", "failed", "interrupted", "expired"].includes(job.status ?? "");
}

function isTurnJobQueued(job: TurnJobSummary): boolean {
  return job.status === "queued";
}

function isTurnJobInterruptible(job: TurnJobSummary): boolean {
  return Boolean(turnJobId(job)) && !job.cancel_requested && !isTurnJobTerminal(job);
}

function turnJobLabel(job: TurnJobSummary): string {
  return compactId(turnJobId(job));
}

function normalizeTurnJobs(payload?: TurnJobsPayload): TurnJobsPayload {
  const turns = payload?.turns ?? [];
  const queuedCount = turns.filter(isTurnJobQueued).length;
  const runningCount = turns.filter((job) => !isTurnJobQueued(job) && !isTurnJobTerminal(job)).length;
  const terminalCount = turns.filter(isTurnJobTerminal).length;
  return {
    ...payload,
    turns,
    count: payload?.count ?? turns.length,
    running_count: payload?.running_count ?? runningCount,
    queued_count: payload?.queued_count ?? queuedCount,
    active_count: payload?.active_count ?? runningCount + queuedCount,
    terminal_count: payload?.terminal_count ?? terminalCount,
  };
}

function upsertTurnJob(payload: TurnJobsPayload, job: TurnJobSummary): TurnJobsPayload {
  const id = turnJobId(job);
  if (!id) return normalizeTurnJobs(payload);
  const now = Date.now();
  const current = payload.turns ?? [];
  const existing = current.find((item) => turnJobId(item) === id) ?? {};
  const nextJob = {
    started_at_ms: now,
    updated_at_ms: now,
    ...existing,
    ...job,
  };
  const next = [nextJob, ...current.filter((item) => turnJobId(item) !== id)].slice(0, 20);
  return normalizeTurnJobs({
    ...payload,
    turns: next,
    source: payload.source ?? "desktop",
  });
}

function eventSessionId(event: AppEvent): string {
  const params = event.params ?? {};
  const direct = params.session_id ?? params.thread_id;
  if (typeof direct === "string") return direct;
  const approval = params.approval;
  if (approval && typeof approval === "object" && "session_id" in approval) {
    const value = (approval as JsonRecord).session_id;
    if (typeof value === "string") return value;
  }
  return "";
}

function eventTurnId(event: AppEvent): string {
  const params = event.params ?? {};
  const direct = params.turn_id ?? params.run_id;
  return typeof direct === "string" ? direct : "";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function eventSemanticKey(event: AppEvent): string {
  const sessionId = eventSessionId(event);
  const turnId = eventTurnId(event);
  if (!sessionId || !turnId) return "";
  return `turn:${sessionId}:${turnId}:${event.method}:${stableJson(event.params ?? {})}`;
}

function eventKey(event: AppEvent): string {
  if (event.event_id) return `event:${event.event_id}`;
  const semantic = eventSemanticKey(event);
  if (semantic) return semantic;
  if (event.global_sequence) return `g:${event.global_sequence}`;
  if (event.sequence) return `s:${eventSessionId(event)}:${event.sequence}:${event.method}`;
  return `${event.method}:${event.created_at_ms ?? 0}:${JSON.stringify(event.params ?? {})}`;
}

function methodLabel(method: string): string {
  if (method === "item/agentMessage/thinking") return "agent thinking";
  return method.replace("item/", "").replace("turn/", "").replace(/\//g, " ");
}

function statusClass(value?: string): string {
  if (!value) return "neutral";
  if (["completed", "healthy", "online", "idle", "ok", "listening", "polling", "resumed", "allowed", "answered"].includes(value)) {
    return "ok";
  }
  if (["running", "queued", "interrupting", "streaming", "thinking", "waiting_approval", "waiting_question", "receiving", "connecting", "reconnecting", "pending"].includes(value)) {
    return "warn";
  }
  if (["failed", "interrupted", "expired", "missing", "offline", "denied", "dismissed", "error"].includes(value)) return "bad";
  return "neutral";
}

function stringField(record: JsonRecord | null | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function numberField(record: JsonRecord | null | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" ? value : 0;
}

function booleanField(record: JsonRecord | null | undefined, key: string): boolean {
  const value = record?.[key];
  return value === true || value === "true";
}

function compactId(value?: string): string {
  if (!value) return "-";
  return value.length > 28 ? `${value.slice(0, 18)}...${value.slice(-6)}` : value;
}

function compactPath(value?: string): string {
  if (!value) return "-";
  return value.length > 42 ? `${value.slice(0, 20)}...${value.slice(-18)}` : value;
}

function checkpointLabel(checkpoint: CheckpointSummary): string {
  return `${checkpoint.kind ?? "checkpoint"} · ${compactId(checkpoint.checkpoint_id)}`;
}

function checkpointKindLabel(kind?: string): string {
  if (!kind || kind === "checkpoint" || kind === "step_start" || kind === "step_end") return "检查点";
  return kind;
}

function checkpointRestoreHistoryFromSession(session?: SessionSummary): CheckpointRestoreRecord[] {
  const metadata = session?.metadata;
  const history = jsonArray(metadata?.checkpoint_restore_history).map((item) => ({
    checkpoint_id: firstText(item.checkpoint_id),
    run_id: firstText(item.run_id),
    restored_at_ms: numberField(item, "restored_at_ms") || undefined,
    checkpoint_kind: firstText(item.checkpoint_kind),
    file_count: numberField(item, "file_count") || undefined,
    total_bytes: numberField(item, "total_bytes") || undefined,
    message_id: firstText(item.message_id),
    part_id: firstText(item.part_id),
  }));
  if (history.length) return history;
  const latest = nestedRecord(metadata, "latest_checkpoint_restore");
  const checkpointId = firstText(latest?.checkpoint_id);
  if (!checkpointId) return [];
  return [
    {
      checkpoint_id: checkpointId,
      run_id: firstText(latest?.run_id),
      restored_at_ms: numberField(latest, "restored_at_ms") || undefined,
      checkpoint_kind: firstText(latest?.checkpoint_kind),
      file_count: numberField(latest, "file_count") || undefined,
      total_bytes: numberField(latest, "total_bytes") || undefined,
      message_id: firstText(latest?.message_id),
      part_id: firstText(latest?.part_id),
    },
  ];
}

function restoredCheckpointIdFromSession(session?: SessionSummary): string {
  return firstText(checkpointRestoreHistoryFromSession(session)[0]?.checkpoint_id);
}

function checkpointForRestore(record: CheckpointRestoreRecord, checkpoints?: CheckpointsPayload | null): CheckpointSummary | undefined {
  const checkpointId = record.checkpoint_id;
  if (!checkpointId) return undefined;
  return (checkpoints?.checkpoints ?? []).find((checkpoint) => checkpoint.checkpoint_id === checkpointId);
}

function checkpointRestoreFileLabel(record: CheckpointRestoreRecord, checkpoint?: CheckpointSummary): string {
  const fileCount = record.file_count ?? checkpoint?.file_count ?? 0;
  const totalBytes = record.total_bytes ?? checkpoint?.total_bytes ?? 0;
  return `${fileCount} files · ${formatBytes(totalBytes)}`;
}

function checkpointRestoreTimeLabel(record: CheckpointRestoreRecord): string {
  return record.restored_at_ms ? formatTime(record.restored_at_ms) : "-";
}

function fileBadge(entry: FileEntry): string {
  if (entry.kind === "dir") return "dir";
  if (entry.text) return "txt";
  return "bin";
}

function formatBytes(value?: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentName(path: string, fallback = "attachment"): string {
  const trimmed = path.trim();
  if (!trimmed) return fallback;
  const normalized = trimmed.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || fallback;
}

function normalizeComposerAttachment(item: Partial<ComposerAttachment>, index: number): ComposerAttachment {
  const path = firstText(item.path);
  const name = firstText(item.name) || attachmentName(path, `attachment-${index + 1}.txt`);
  return {
    id: firstText(item.id) || `${path || name}:${Date.now()}:${index}`,
    kind: "file",
    path,
    name,
    sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : 0,
    contentType: firstText(item.contentType) || "text/plain",
    content: typeof item.content === "string" ? item.content : "",
    error: typeof item.error === "string" ? item.error : null,
  };
}

function attachmentPayload(attachment: ComposerAttachment): JsonRecord {
  return {
    kind: attachment.kind,
    path: attachment.path,
    name: attachment.name,
    size_bytes: attachment.sizeBytes,
    content_type: attachment.contentType,
    content: attachment.content,
  };
}

function attachmentSummariesFromMessage(message: MessageWithParts): AttachmentSummary[] {
  const metadata = message.info?.metadata;
  return jsonArray(metadata?.attachments).map((item, index) => ({
    id: firstText(item.id) || `${firstText(item.path, item.name)}:${index}`,
    kind: "file",
    path: firstText(item.path),
    name: firstText(item.name) || attachmentName(firstText(item.path), `attachment-${index + 1}`),
    sizeBytes: numberField(item, "size_bytes") || numberField(item, "sizeBytes"),
    contentType: firstText(item.content_type, item.contentType) || "text/plain",
    contentChars: numberField(item, "content_chars") || undefined,
    contentLines: numberField(item, "content_lines") || undefined,
  }));
}

function openAgentContextAttachment({
  projectPath,
  session,
  fileTree,
  gitStatus,
  sessionDiff,
  mcp,
}: {
  projectPath: string;
  session?: SessionSummary;
  fileTree?: FilesPayload | null;
  gitStatus?: GitPayload | null;
  sessionDiff?: SessionDiff | null;
  mcp?: McpPayload | null;
}): ComposerAttachment {
  const lines: string[] = [];
  const sessionLabel = session ? sessionDisplayTitle(session) : "No active session";
  lines.push("# OpenAgent Context");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Project: ${projectPath || fileTree?.workspace || gitStatus?.workspace || "unknown"}`);
  lines.push(`Session: ${sessionLabel}`);
  if (session) {
    lines.push(`Session status: ${session.status || "unknown"}`);
    lines.push(`Session messages: ${session.message_count ?? 0}`);
  }

  lines.push("");
  lines.push("## Workspace files");
  const entries = (fileTree?.entries ?? []).slice(0, 30);
  if (entries.length) {
    for (const entry of entries) {
      const label = entry.path || entry.name || "unknown";
      const kind = entry.kind || "file";
      const size = entry.size_bytes ? ` · ${formatBytes(entry.size_bytes)}` : "";
      const text = entry.text ? " · text" : "";
      lines.push(`- ${kind}: ${label}${size}${text}`);
    }
    if (fileTree?.truncated) lines.push("- ...truncated");
  } else {
    lines.push("- unavailable");
  }

  lines.push("");
  lines.push("## Git status");
  if (gitStatus?.error) {
    lines.push(`- unavailable: ${gitStatus.error}`);
  } else if (gitStatus?.is_repo) {
    lines.push(`- branch: ${gitStatus.branch || "unknown"}`);
    lines.push(`- ahead/behind: ${gitStatus.ahead ?? 0}/${gitStatus.behind ?? 0}`);
    const changes = (gitStatus.changes ?? []).slice(0, 30);
    if (changes.length) {
      for (const change of changes) {
        const status = [change.index, change.worktree, change.status].filter(Boolean).join("/") || "changed";
        lines.push(`- ${status}: ${change.path || "unknown"}`);
      }
    } else {
      lines.push("- clean");
    }
    if ((gitStatus.change_count ?? 0) > changes.length) {
      lines.push(`- ...${(gitStatus.change_count ?? 0) - changes.length} more changes`);
    }
  } else {
    lines.push("- not a git repository or unavailable");
  }

  lines.push("");
  lines.push("## Session diff");
  if (sessionDiff) {
    lines.push(`- undo: ${sessionDiff.undo_count ?? 0}`);
    lines.push(`- redo: ${sessionDiff.redo_count ?? 0}`);
    const latestPath = stringField(sessionDiff.latest ?? undefined, "path");
    if (latestPath) lines.push(`- latest path: ${latestPath}`);
    const patches = (sessionDiff.patches ?? []).slice(0, 12);
    if (patches.length) {
      for (const patch of patches) {
        const path = stringField(patch, "path") || stringField(patch, "file") || "unknown";
        const status = stringField(patch, "status") || stringField(patch, "kind") || "patch";
        lines.push(`- ${status}: ${path}`);
      }
    }
  } else {
    lines.push("- unavailable");
  }

  lines.push("");
  lines.push("## MCP");
  if (mcp) {
    lines.push(`- status: ${mcp.status || (mcp.enabled ? "enabled" : "disabled")}`);
    lines.push(`- servers: ${mcp.server_count ?? mcp.servers?.length ?? 0}`);
    lines.push(`- tools: ${mcp.tool_count ?? 0}`);
    for (const server of (mcp.servers ?? []).slice(0, 12)) {
      lines.push(
        `- ${server.name || "server"}: ${server.enabled ? "enabled" : "disabled"} · ${server.status || "unknown"} · ${
          server.tool_count ?? server.tools?.length ?? 0
        } tools`,
      );
    }
  } else {
    lines.push("- unavailable");
  }

  const content = lines.join("\n");
  return {
    id: "openagent-context",
    kind: "file",
    path: "openagent://context/current-workspace.md",
    name: "OpenAgent context.md",
    sizeBytes: new TextEncoder().encode(content).length,
    contentType: "text/markdown",
    content,
    error: null,
  };
}

function compactText(value: string, limit = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function compactJson(value: unknown, limit = 160): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return compactText(value, limit);
  try {
    return compactText(JSON.stringify(value), limit);
  } catch {
    return compactText(String(value), limit);
  }
}

function lineCountLabel(value: string): string {
  if (!value.trim()) return "no output";
  const count = value.split(/\r?\n/).filter((line) => line.length > 0).length;
  return count === 1 ? "1 line" : `${count} lines`;
}

function formatElapsed(startMs?: number, nowMs = Date.now()): string {
  if (!startMs || startMs > nowMs) return "";
  const totalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatTime(value?: number): string {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function turnSubmitState(status?: string, queued?: boolean): string {
  if (queued || status === "queued") return "queued";
  if (status === "running") return "running";
  return "idle";
}

function queuePositionForJob(job: TurnJobSummary, queuedJobs: TurnJobSummary[]): number {
  if (typeof job.queue_position === "number" && job.queue_position > 0) return job.queue_position;
  const sessionId = turnJobSessionId(job);
  const sameSessionQueued = queuedJobs.filter((item) => turnJobSessionId(item) === sessionId);
  const index = sameSessionQueued.findIndex((item) => turnJobId(item) === turnJobId(job));
  return index >= 0 ? index + 1 : 0;
}

function queueReasonLabel(reason?: string | null): string {
  if (reason === "global_worker_quota") return "worker 配额";
  if (reason === "session_active") return "会话忙碌";
  if (reason === "recovered") return "已恢复";
  return reason ? reason.replace(/_/g, " ") : "queued";
}

function queueReasonMessage(job: TurnJobSummary): string {
  if (job.queue_reason === "recovered") return "运行时重启后从持久队列恢复，正在等待 worker 接手。";
  if (job.queue_reason === "global_worker_quota") return "正在等待空闲的 runtime worker。";
  if (job.queue_reason === "session_active") return "正在等待当前会话里上一轮任务结束。";
  if (job.payload_persisted) return "任务已持久化，运行时重启后可以恢复。";
  return "正在等待调度器容量。";
}

function schedulerValue(value: number | undefined, fallback = "-"): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function schedulerDuration(valueMs: number | undefined): string {
  if (!valueMs || !Number.isFinite(valueMs)) return "-";
  if (valueMs < 1000) return `${Math.round(valueMs)}ms`;
  const seconds = Math.round(valueMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function turnJobStatusLabel(job: TurnJobSummary): string {
  if (job.status === "expired") return "已过期";
  if (job.status === "interrupted" && job.cancel_requested) return "已停止";
  if (job.cancel_requested && !isTurnJobTerminal(job)) return "正在停止";
  if (job.status === "queued") return "等待中";
  if (job.status === "running") return "正在执行";
  if (job.status === "completed") return "已完成";
  if (job.status === "failed") return "失败";
  if (job.status === "interrupted") return "已中断";
  if (job.status === "interrupting") return "正在停止";
  return job.status ?? "未知";
}

function turnJobLifecycleTone(job: TurnJobSummary): string {
  if (job.status === "expired" || job.status === "failed" || job.status === "interrupted") return "bad";
  if (job.queue_reason === "global_worker_quota") return "quota";
  if (job.queue_reason === "recovered") return "recovered";
  if (job.status === "queued" || job.cancel_requested) return "warn";
  return "neutral";
}

function turnJobLifecycleMessage(job: TurnJobSummary, scheduler: TurnSchedulerSummary): string {
  if (job.status === "expired") {
    const timeout = schedulerDuration(scheduler.turn_queue_timeout_ms);
    return timeout === "-"
      ? "这个任务在被 worker 接手前已经过期，已从持久队列移除。"
      : `这个任务等待 ${timeout} 后仍没有 worker 接手，已从持久队列移除。`;
  }
  if (job.status === "interrupted") {
    return job.cancel_requested
      ? "已请求停止，运行时把这轮任务标记为中断。"
      : "运行时不再持有这轮任务，已按中断状态恢复。";
  }
  if (job.cancel_requested) return "已请求停止，运行时会在下一个安全点中断。";
  if (isTurnJobQueued(job)) return queueReasonMessage(job);
  return "";
}

function queueFullMessage(payload?: JsonRecord): string {
  const queued = typeof payload?.queued_count === "number" ? payload.queued_count : undefined;
  const maxQueued = typeof payload?.max_queued_turns_per_session === "number" ? payload.max_queued_turns_per_session : undefined;
  if (queued !== undefined && maxQueued !== undefined) {
    return `排队已满：当前会话已有 ${queued}/${maxQueued} 个等待任务。`;
  }
  return "排队已满：请等待当前任务完成后再提交。";
}

function messageKey(message: MessageWithParts, index: number): string {
  const stable = message.info?.id || `${message.info?.role ?? "message"}:${message.info?.created_at_ms ?? index}`;
  return `${stable}:${index}`;
}

function messageRoleLabel(message: MessageWithParts): string {
  return message.info?.role || "message";
}

function messageContent(message: MessageWithParts): string {
  const displayContent = message.info?.metadata?.display_content;
  if (message.info?.role === "user" && typeof displayContent === "string") {
    return displayContent.trim();
  }
  const parts = message.parts ?? [];
  const text = parts
    .filter((part) => part.kind === "text")
    .map((part) => valueText(part.content))
    .filter(Boolean)
    .join("\n\n");
  if (text.trim()) return text.trim();
  return "";
}

function interactionRequestKey(item: TrustHistoryItem | null): string {
  if (!item) return "";
  const identifier = item.requestId || item.callId;
  return identifier ? `${item.kind}:${identifier}` : "";
}

function isPendingInteractionStatus(status: string): boolean {
  return ["", "pending", "running", "waiting", "waiting_approval", "waiting_question"].includes(status);
}

function resolvedInteractionKeys(messages: MessageWithParts[]): Set<string> {
  const keys = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const item = interactionHistoryItem(part);
      const key = interactionRequestKey(item);
      if (key && item && !isPendingInteractionStatus(item.status)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function isSupersededPendingInteraction(part: MessagePart, resolvedKeys: Set<string>): boolean {
  const item = interactionHistoryItem(part);
  const key = interactionRequestKey(item);
  return Boolean(key && item && isPendingInteractionStatus(item.status) && resolvedKeys.has(key));
}

function messagePartCallId(part: MessagePart): string {
  const content = jsonRecord(part.content);
  return firstText(content?.call_id, content?.tool_call_id, part.attributes?.call_id, part.attributes?.tool_call_id);
}

function messagePartIdentity(part: MessagePart): string {
  const callId = messagePartCallId(part);
  if (callId && ["tool", "mcp_tool"].includes(part.kind ?? "")) return `${part.kind}:${callId}`;
  return "";
}

function isPendingMessagePart(part: MessagePart): boolean {
  return isPendingInteractionStatus(part.status ?? "");
}

function isCheckpointMessagePart(part: MessagePart): boolean {
  const content = jsonRecord(part.content);
  return part.kind === "context" && content?.kind === "checkpoint";
}

function visibleMessageParts(
  message: MessageWithParts,
  resolvedKeys: Set<string> = new Set(),
  terminalRunStatus = "",
): MessagePart[] {
  const parts = message.parts ?? [];
  const latestPartIndexes = new Set<number>();
  const seenIdentities = new Set<string>();
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const identity = messagePartIdentity(parts[index]);
    if (!identity || seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    latestPartIndexes.add(index);
  }
  return parts.filter((part, index) => {
    if (part.kind === "text") return false;
    if (isCheckpointMessagePart(part)) return false;
    if (isSupersededPendingInteraction(part, resolvedKeys)) return false;
    if (terminalRunStatus && ["tool", "mcp_tool"].includes(part.kind ?? "") && isPendingMessagePart(part)) return false;
    const identity = messagePartIdentity(part);
    return !identity || latestPartIndexes.has(index);
  });
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as JsonRecord;
    for (const key of ["text", "output", "error", "command", "path"]) {
      const field = record[key];
      if (typeof field === "string" && field.trim()) return field;
    }
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function renderInlineText(text: string, keyPrefix: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+?\*\*|\[[^\]\n]+?\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code className="inline-code" key={`${keyPrefix}:code:${index}`}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong className="inline-strong" key={`${keyPrefix}:strong:${index}`}>
          {renderInlineText(part.slice(2, -2), `${keyPrefix}:strong:${index}`)}
        </strong>
      );
    }
    const linkMatch = part.match(/^\[([^\]\n]+?)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, target] = linkMatch;
      const href = target.startsWith("http://") || target.startsWith("https://") ? target : undefined;
      return href ? (
        <a className="inline-link" href={href} key={`${keyPrefix}:link:${index}`} rel="noreferrer" target="_blank">
          {label}
        </a>
      ) : (
        <span className="inline-link" key={`${keyPrefix}:link:${index}`} title={target}>
          {label}
        </span>
      );
    }
    return <Fragment key={`${keyPrefix}:text:${index}`}>{part}</Fragment>;
  });
}

function markdownHeading(level: number, children: React.ReactNode, key: string) {
  const className = `event-markdown-heading level-${level}`;
  switch (level) {
    case 1:
      return <h1 className={className} key={key}>{children}</h1>;
    case 2:
      return <h2 className={className} key={key}>{children}</h2>;
    case 3:
      return <h3 className={className} key={key}>{children}</h3>;
    case 4:
      return <h4 className={className} key={key}>{children}</h4>;
    case 5:
      return <h5 className={className} key={key}>{children}</h5>;
    default:
      return <h6 className={className} key={key}>{children}</h6>;
  }
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isMarkdownTableSeparator(lines[index + 1]));
}

function isMarkdownListLine(line: string): boolean {
  return /^\s*[-*+]\s+\S/.test(line) || /^\s*\d+[.)]\s+\S/.test(line);
}

function orderedMarkdownListMatch(line: string): { number: number; text: string } | null {
  const match = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
  if (!match) return null;
  return {
    number: Number.parseInt(match[1], 10) || 1,
    text: match[2],
  };
}

function unorderedMarkdownListMatch(line: string): string | null {
  return line.match(/^\s*[-*+]\s+(.+)$/)?.[1] ?? null;
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    /^#{1,6}\s+\S/.test(line) ||
    isMarkdownTableStart(lines, index) ||
    isMarkdownListLine(line) ||
    /^>\s?/.test(line) ||
    /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)
  );
}

function renderMarkdownLineBreaks(lines: string[], keyPrefix: string) {
  return lines.map((line, index) => (
    <Fragment key={`${keyPrefix}:line:${index}`}>
      {index > 0 ? <br /> : null}
      {renderInlineText(line, `${keyPrefix}:inline:${index}`)}
    </Fragment>
  ));
}

function trimMarkdownListItemLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function renderMarkdownTextBlock(text: string, blockIndex: number) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      nodes.push(markdownHeading(level, renderInlineText(heading[2].trim(), `${blockIndex}:heading:${index}`), `${blockIndex}:heading:${index}`));
      index += 1;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const header = splitMarkdownTableRow(lines[index]);
      const align = splitMarkdownTableRow(lines[index + 1]).map((cell) => {
        if (cell.startsWith(":") && cell.endsWith(":")) return "center";
        if (cell.endsWith(":")) return "right";
        return "left";
      });
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      nodes.push(
        <div className="event-markdown-table-wrap" key={`${blockIndex}:table:${index}`}>
          <table className="event-markdown-table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`${blockIndex}:table:head:${cellIndex}`} style={{ textAlign: align[cellIndex] as "left" | "center" | "right" | undefined }}>
                    {renderInlineText(cell, `${blockIndex}:table:head:${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${blockIndex}:table:row:${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`${blockIndex}:table:row:${rowIndex}:${cellIndex}`} style={{ textAlign: align[cellIndex] as "left" | "center" | "right" | undefined }}>
                      {renderInlineText(row[cellIndex] ?? "", `${blockIndex}:table:row:${rowIndex}:${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (isMarkdownListLine(line)) {
      const firstOrdered = orderedMarkdownListMatch(line);
      const ordered = Boolean(firstOrdered);
      const items: { lines: string[]; number?: number }[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const orderedMatch = ordered ? orderedMarkdownListMatch(current) : null;
        const unorderedMatch = ordered ? null : unorderedMarkdownListMatch(current);
        if (orderedMatch || unorderedMatch) {
          items.push({
            lines: [orderedMatch?.text ?? unorderedMatch ?? ""],
            number: orderedMatch?.number,
          });
          index += 1;
          continue;
        }
        if (!items.length || isMarkdownBlockStart(lines, index)) break;
        if (!current.trim()) {
          const nextNonEmpty = lines.slice(index + 1).find((candidate) => candidate.trim());
          if (!nextNonEmpty) break;
          const continuesSameList = ordered
            ? Boolean(orderedMarkdownListMatch(nextNonEmpty))
            : Boolean(unorderedMarkdownListMatch(nextNonEmpty));
          if (!continuesSameList && isMarkdownBlockStart([nextNonEmpty], 0)) break;
          index += 1;
          continue;
        }
        items[items.length - 1].lines.push(current);
        index += 1;
      }
      const Tag = ordered ? "ol" : "ul";
      const start = ordered ? items[0]?.number ?? 1 : undefined;
      nodes.push(
        <Tag className="event-markdown-list" key={`${blockIndex}:list:${index}`} start={start}>
          {items.map((item, itemIndex) => (
            <li key={`${blockIndex}:list:${index}:${itemIndex}`}>
              {renderMarkdownLineBreaks(
                trimMarkdownListItemLines(item.lines),
                `${blockIndex}:list:${index}:${itemIndex}`,
              )}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote className="event-markdown-quote" key={`${blockIndex}:quote:${index}`}>
          {renderMarkdownLineBreaks(quoteLines, `${blockIndex}:quote:${index}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      nodes.push(<hr className="event-markdown-rule" key={`${blockIndex}:rule:${index}`} />);
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    nodes.push(
      <p className="event-paragraph" key={`${blockIndex}:paragraph:${index}`}>
        {renderMarkdownLineBreaks(paragraphLines, `${blockIndex}:paragraph:${index}`)}
      </p>,
    );
  }

  return nodes;
}

function TextContent({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?```)/g).filter((block) => block.length > 0);
  return (
    <div className="event-text">
      {blocks.map((block, blockIndex) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const raw = block.slice(3, -3).replace(/^\n/, "");
          const firstLineBreak = raw.indexOf("\n");
          const firstLine = firstLineBreak >= 0 ? raw.slice(0, firstLineBreak).trim() : "";
          const hasLanguage = /^[A-Za-z0-9_+.#-]{1,24}$/.test(firstLine);
          const language = hasLanguage ? firstLine : "";
          const code = hasLanguage && firstLineBreak >= 0 ? raw.slice(firstLineBreak + 1) : raw;
          return (
            <pre className="event-code-block" data-language={language || undefined} key={`code-block:${blockIndex}`}>
              <code>{code.trimEnd()}</code>
            </pre>
          );
        }
        return renderMarkdownTextBlock(block, blockIndex);
      })}
    </div>
  );
}

function jsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function jsonArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonRecord => Boolean(jsonRecord(item)));
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function partIcon(kind?: string) {
  if (kind === "tool") return <Wrench size={14} />;
  if (kind === "approval") return <ShieldCheck size={14} />;
  if (kind === "question") return <Bot size={14} />;
  if (kind === "patch") return <GitCompare size={14} />;
  if (kind === "context") return <History size={14} />;
  return <Database size={14} />;
}

function partTitle(part: MessagePart): string {
  const kind = part.kind ?? "part";
  const content = jsonRecord(part.content);
  if (kind === "tool") {
    const mcp = mcpToolTraceFromPart(part);
    if (mcp) return mcp.toolName ? `MCP: ${mcp.toolName}` : "MCP tool";
    const name = firstText(content?.name, part.attributes?.name);
    return name ? `Tool: ${name}` : "Tool result";
  }
  if (kind === "approval") return "Approval";
  if (kind === "question") return "Question";
  if (kind === "patch") return "Patch";
  if (kind === "context" && content?.kind === "checkpoint") return "Checkpoint";
  return kind;
}

function partSummary(part: MessagePart): string {
  const kind = part.kind ?? "part";
  const content = jsonRecord(part.content);
  if (kind === "tool") {
    const mcp = mcpToolTraceFromPart(part);
    if (mcp) {
      const result = mcp.error || mcp.output || part.status || "completed";
      const prefix = [mcp.server, mcp.transport].filter(Boolean).join(" · ");
      return prefix ? `${prefix}: ${result}` : result;
    }
    const error = firstText(content?.error);
    if (error) return error;
    return firstText(content?.output, content?.command) || part.status || "completed";
  }
  if (kind === "approval" || kind === "question") {
    return interactionHistoryItem(part)?.summary ?? part.status ?? "pending";
  }
  if (kind === "patch") {
    const added = numberField(content, "added") || numberField(part.attributes, "added");
    const modified = numberField(content, "modified") || numberField(part.attributes, "modified");
    const deleted = numberField(content, "deleted") || numberField(part.attributes, "deleted");
    return `+${added} ~${modified} -${deleted}`;
  }
  if (kind === "context" && content?.kind === "checkpoint") {
    return `${compactId(firstText(content.snapshot_start))} -> ${compactId(firstText(content.snapshot_end))}`;
  }
  return valueText(part.content) || part.status || "completed";
}

function nonEmptyRows(rows: Array<[string, string]>): Array<[string, string]> {
  return rows.filter(([, value]) => value && value !== "-");
}

function toolPartMetadata(part: MessagePart): JsonRecord {
  return nestedRecord(jsonRecord(part.content), "metadata") ?? {};
}

function mcpToolTraceFromPart(part: MessagePart): McpToolTrace | null {
  if (part.kind !== "tool") return null;
  const content = jsonRecord(part.content);
  const metadata = toolPartMetadata(part);
  const backend = firstText(metadata.backend);
  const server = firstText(metadata.mcp_server);
  const originalTool = firstText(metadata.mcp_original_tool_name);
  const transport = firstText(metadata.mcp_transport);
  const dynamicTool = firstText(metadata.mcp_tool_name, content?.name, part.attributes?.name);
  if (backend !== "mcp" && !server && !originalTool && !dynamicTool.startsWith("mcp_tool_")) return null;
  const nonTextBlocks = Array.isArray(metadata.mcp_non_text_blocks) ? metadata.mcp_non_text_blocks.length : 0;
  const lifecyclePid = numberField(metadata, "mcp_lifecycle_pid");
  return {
    toolName: originalTool || dynamicTool || "mcp tool",
    originalTool,
    dynamicTool,
    server,
    transport,
    callId: firstText(content?.call_id, part.attributes?.call_id),
    status: part.status ?? "completed",
    output: firstText(content?.output),
    error: firstText(content?.error),
    nonTextBlockCount: nonTextBlocks,
    lifecycleReused: booleanField(metadata, "mcp_lifecycle_reused"),
    lifecyclePid,
  };
}

function mcpToolTracesFromMessages(messages: MessageWithParts[]): McpToolTrace[] {
  const traces: McpToolTrace[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const trace = mcpToolTraceFromPart(part);
      if (trace) traces.push(trace);
    }
  }
  return traces;
}

function mcpEndpointLabel(server: McpServerSummary): string {
  if (server.command) return `${server.command}${server.args_count ? ` +${server.args_count}` : ""}`;
  if (server.remote_url_configured) return "remote URL";
  return "no endpoint";
}

function mcpTransportLabel(server: McpServerSummary): string {
  const configured = server.transport ?? "";
  const selected = server.selected_transport ?? "";
  if (configured && selected && configured !== selected) return `${configured} -> ${selected}`;
  return selected || configured || "-";
}

function mcpToolLabel(tool: { name?: string; title?: string; original_name?: string }): string {
  return tool.title || tool.original_name || tool.name || "mcp tool";
}

function defaultMcpServerDraft(): McpServerDraft {
  return {
    mode: "remote",
    name: "",
    url: "",
    transport: "http",
    command: "",
    args: "",
    cwd: "",
    env: "",
    headers: "",
    timeoutMs: "",
  };
}

function mcpDraftFromServer(server: McpServerSummary): McpServerDraft {
  const mode = server.type === "local" ? "local" : "remote";
  return {
    ...defaultMcpServerDraft(),
    mode,
    name: server.name ?? "",
    transport: server.transport ?? server.selected_transport ?? "http",
    timeoutMs: server.timeout_ms ? String(server.timeout_ms) : "",
  };
}

function mcpCheckedLabel(server: McpServerSummary): string {
  if (!server.last_refreshed_at) return "-";
  const value = server.last_refreshed_at;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return formatTime(milliseconds);
}

function mcpLifecycleTimeLabel(value?: number | null): string {
  if (!value) return "-";
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return formatTime(milliseconds);
}

function mcpLifecycleStatusLabel(server: McpServerSummary): string {
  if (server.type !== "local") return "-";
  return server.lifecycle_status || "stopped";
}

function mcpLifecycleStatusClass(server: McpServerSummary): string {
  const status = mcpLifecycleStatusLabel(server);
  if (["running", "ready", "connected"].includes(status)) return "ok";
  if (["starting", "stopping", "restarting", "refreshing"].includes(status)) return "warn";
  if (["failed", "error", "exited", "stale"].includes(status)) return "bad";
  return "neutral";
}

function parseMcpList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMcpMap(value: string, label: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = value.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    const colonIndex = line.indexOf(":");
    const splitIndex =
      equalsIndex >= 0 && colonIndex >= 0
        ? Math.min(equalsIndex, colonIndex)
        : equalsIndex >= 0
          ? equalsIndex
          : colonIndex;
    if (splitIndex <= 0) {
      throw new Error(`${label} must use KEY=value lines.`);
    }
    const key = line.slice(0, splitIndex).trim();
    const next = line.slice(splitIndex + 1).trim();
    if (!key) throw new Error(`${label} contains an empty key.`);
    result[key] = next;
  }
  return result;
}

function partRows(part: MessagePart): Array<[string, string]> {
  const kind = part.kind ?? "part";
  const content = jsonRecord(part.content);
  const attributes = part.attributes ?? {};
  if (kind === "tool") {
    const mcp = mcpToolTraceFromPart(part);
    if (mcp) {
      return nonEmptyRows([
        ["Server", mcp.server],
        ["Tool", mcp.originalTool || mcp.toolName],
        ["Transport", mcp.transport],
        ["Call", compactId(mcp.callId)],
        ["Dynamic", compactId(mcp.dynamicTool)],
        ["Blocks", mcp.nonTextBlockCount ? String(mcp.nonTextBlockCount) : ""],
      ]);
    }
    return nonEmptyRows([
      ["Name", firstText(content?.name, attributes.name)],
      ["Call", compactId(firstText(content?.call_id, attributes.call_id))],
      ["Status", part.status ?? "completed"],
    ]);
  }
  if (kind === "approval" || kind === "question") {
    const item = interactionHistoryItem(part);
    return nonEmptyRows([
      ["Status", item?.status ?? part.status ?? "pending"],
      ["Request", compactId(item?.requestId)],
      ["Call", compactId(item?.callId)],
    ]);
  }
  if (kind === "patch") {
    return nonEmptyRows([
      ["Added", String(numberField(content, "added") || numberField(attributes, "added"))],
      ["Modified", String(numberField(content, "modified") || numberField(attributes, "modified"))],
      ["Deleted", String(numberField(content, "deleted") || numberField(attributes, "deleted"))],
      [
        "From",
        compactId(firstText(content?.before_checkpoint_id, attributes.before_checkpoint_id)),
      ],
      ["To", compactId(firstText(content?.after_checkpoint_id, attributes.after_checkpoint_id))],
    ]);
  }
  if (kind === "context" && content?.kind === "checkpoint") {
    return nonEmptyRows([
      ["Start", compactId(firstText(content.snapshot_start))],
      ["End", compactId(firstText(content.snapshot_end))],
    ]);
  }
  return [["Status", part.status ?? "completed"]];
}

function patchEntries(part: MessagePart): JsonRecord[] {
  const entries = jsonRecord(part.content)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry): entry is JsonRecord => Boolean(jsonRecord(entry)));
}

function sideBySideRows(patch: JsonRecord | null | undefined): JsonRecord[] {
  const sideBySide = nestedRecord(patch, "side_by_side");
  return nestedArray(sideBySide, "rows");
}

function diffCellText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function partPreText(part: MessagePart): string {
  const kind = part.kind ?? "part";
  const content = jsonRecord(part.content);
  if (kind === "tool") return firstText(content?.error);
  if (kind === "patch" || (kind === "context" && content?.kind === "checkpoint")) return "";
  if (kind === "approval" || kind === "question") return "";
  return valueText(part.content);
}

function nestedRecord(record: JsonRecord | null | undefined, key: string): JsonRecord | null {
  return jsonRecord(record?.[key]);
}

function nestedArray(record: JsonRecord | null | undefined, key: string): JsonRecord[] {
  return jsonArray(record?.[key]);
}

function interactionQuestions(content: JsonRecord | null, request: JsonRecord | null): JsonRecord[] {
  const direct = nestedArray(content, "questions");
  if (direct.length) return direct;
  const requestQuestions = nestedArray(request, "questions");
  if (requestQuestions.length) return requestQuestions;
  const requestToolInput = nestedRecord(request, "tool_input");
  const toolQuestions = nestedArray(requestToolInput, "questions");
  if (toolQuestions.length) return toolQuestions;
  const wrappedQuestion = nestedRecord(content, "question") ?? nestedRecord(request, "question");
  return nestedArray(wrappedQuestion, "questions");
}

function interactionQuestionPrompt(content: JsonRecord | null, request: JsonRecord | null): string {
  const [first] = interactionQuestions(content, request);
  return firstText(first?.question, first?.header, request?.question, content?.question) || "Question";
}

function interactionTarget(content: JsonRecord | null, request: JsonRecord | null): string {
  const preview = nestedRecord(request, "preview") ?? nestedRecord(content, "preview");
  const toolInput = nestedRecord(request, "tool_input") ?? nestedRecord(content, "tool_input") ?? nestedRecord(content, "input");
  return firstText(
    preview?.path,
    preview?.command,
    toolInput?.file_path,
    toolInput?.path,
    toolInput?.command,
    content?.command,
    request?.permission_pattern,
  );
}

function interactionResolutionText(kind: "approval" | "question", resolution: JsonRecord | null, status: string): string {
  if (kind === "approval") {
    const action = firstText(resolution?.action, status);
    const scope = firstText(resolution?.scope);
    return scope ? `${action} · ${scope}` : action;
  }
  if (resolution?.dismissed === true || status === "dismissed") return "dismissed";
  const answers = resolution?.answers;
  if (Array.isArray(answers) && answers.length) {
    return answers
      .map((answer) => (Array.isArray(answer) ? answer.join(", ") : valueText(answer)))
      .filter(Boolean)
      .join("; ");
  }
  return status;
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function approvalToolLabel(approval: JsonRecord): string {
  const tool = stringField(approval, "tool_name").toLowerCase();
  if (["write", "edit", "replace"].includes(tool)) return "File write";
  if (["read", "list", "glob", "search"].includes(tool)) return "File read";
  if (["bash", "shell", "command", "terminal"].some((name) => tool.includes(name))) return "Shell command";
  if (tool.startsWith("mcp") || tool.includes("mcp_")) return "MCP tool";
  return tool ? `${humanizeToken(tool)} tool` : "Approval needed";
}

function approvalReasonLabel(approval: JsonRecord): string {
  const metadata = nestedRecord(approval, "metadata");
  const reason = firstText(
    approval.reason,
    approval.permission_action,
    metadata?.permission_action,
    metadata?.error_kind,
    "permission required",
  );
  switch (reason) {
    case "permission_required":
    case "ask":
      return "Needs approval";
    case "permission_denied":
    case "deny":
      return "Blocked";
    case "allow":
      return "Allowed";
    default:
      return humanizeToken(reason);
  }
}

function approvalPermissionLabel(approval: JsonRecord): string {
  const action = firstText(approval.permission_action, nestedRecord(approval, "metadata")?.permission_action, "ask");
  switch (action) {
    case "ask":
      return "Permission: confirm before running";
    case "deny":
      return "Permission: blocked by policy";
    case "allow":
      return "Permission: allowed by policy";
    default:
      return `Permission: ${humanizeToken(action)}`;
  }
}

function approvalRiskLabel(approval: JsonRecord): string {
  const metadata = nestedRecord(approval, "metadata");
  const tool = stringField(approval, "tool_name").toLowerCase();
  const pattern = firstText(
    approval.permission_pattern,
    metadata?.permission_pattern,
    metadata?.permission,
    metadata?.sandbox,
  );
  if (["write", "edit", "replace"].includes(tool)) return "Risk: can edit files";
  if (["bash", "shell", "command", "terminal"].some((name) => tool.includes(name))) return "Risk: can run shell";
  if (tool.startsWith("mcp") || tool.includes("mcp_")) return "Risk: external tool";
  if (pattern) return `Risk: ${humanizeToken(pattern)}`;
  return "Risk: workspace action";
}

function approvalRiskTone(approval: JsonRecord): string {
  const tool = stringField(approval, "tool_name").toLowerCase();
  if (["write", "edit", "replace"].includes(tool)) return "write";
  if (["bash", "shell", "command", "terminal"].some((name) => tool.includes(name))) return "command";
  if (tool.startsWith("mcp") || tool.includes("mcp_")) return "external";
  return "workspace";
}

function approvalInputSummary(approval: JsonRecord): string {
  const preview = nestedRecord(approval, "preview");
  const previewPath = firstText(preview?.path);
  const diff = firstText(preview?.diff);
  const toolInput = approval.tool_input ?? approval.input;
  if (previewPath && diff) return `${previewPath} · ${compactText(diff, 120)}`;
  if (previewPath) return previewPath;
  return compactJson(toolInput, 150) || compactId(firstText(approval.request_id));
}

function interactionHistoryItem(part: MessagePart): TrustHistoryItem | null {
  const kind = part.kind === "approval" || part.kind === "question" ? part.kind : null;
  if (!kind) return null;
  const content = jsonRecord(part.content);
  const request = nestedRecord(content, "request") ?? nestedRecord(content, kind) ?? content;
  const resolution = nestedRecord(content, "resolution");
  const rawStatus = firstText(content?.status, part.attributes?.resolution_status, part.status, "pending");
  const status = rawStatus === "completed" ? "answered" : rawStatus;
  const callId = firstText(content?.call_id, request?.call_id, request?.tool_call_id, part.attributes?.call_id);
  const requestId = firstText(content?.request_id, request?.request_id, part.attributes?.request_id);
  const name = firstText(content?.name, request?.tool_name, request?.tool, part.attributes?.name, kind);
  const target = interactionTarget(content, request);
  const prompt = interactionQuestionPrompt(content, request);
  const resolutionText = interactionResolutionText(kind, resolution, status);
  const title = kind === "approval" ? `Approval · ${name}` : prompt;
  const summary =
    kind === "approval"
      ? status === "pending"
        ? `Waiting for permission to run ${name}`
        : `Permission ${resolutionText}`
      : status === "pending"
        ? "Waiting for user answer"
        : `Question ${resolutionText}`;
  const detail = kind === "approval" ? target || compactId(callId) : prompt;
  return {
    id: part.id ?? `${kind}:${requestId || callId || String(part.timestamp_ms ?? "")}`,
    kind,
    status,
    tone: statusClass(status) as TrustHistoryItem["tone"],
    title,
    summary,
    detail,
    requestId,
    callId,
  };
}

function trustHistoryFromMessages(messages: MessageWithParts[]): TrustHistoryItem[] {
  const resolvedKeys = resolvedInteractionKeys(messages);
  return messages
    .flatMap((message) => message.parts ?? [])
    .filter((part) => !isSupersededPendingInteraction(part, resolvedKeys))
    .map(interactionHistoryItem)
    .filter((item): item is TrustHistoryItem => Boolean(item))
    .reverse()
    .slice(0, 8);
}

function questionSchema(item: JsonRecord): JsonRecord | null {
  return nestedRecord(item, "schema") ?? nestedRecord(item, "json_schema") ?? nestedRecord(item, "input_schema");
}

function optionPrimitiveText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const record = jsonRecord(value);
  if (record) {
    return optionPrimitiveText(record.value ?? record.id ?? record.name ?? record.label ?? record.title);
  }
  return "";
}

function questionItems(question?: JsonRecord): JsonRecord[] {
  const direct = jsonArray(question?.questions);
  if (direct.length) return direct;
  const toolInput = nestedRecord(question ?? null, "tool_input");
  const nested = nestedArray(toolInput, "questions");
  if (nested.length) return nested;
  const prompt = firstText(question?.question, question?.prompt, question?.message);
  return prompt ? [{ question: prompt }] : [{ question: "Answer" }];
}

function questionOption(option: unknown): ElicitationOption | null {
  if (typeof option === "string" || typeof option === "number" || typeof option === "boolean") {
    const value = optionPrimitiveText(option);
    return value ? { label: value, value } : null;
  }
  const record = jsonRecord(option);
  if (!record) return null;
  const value = optionPrimitiveText(record.value ?? record.id ?? record.name ?? record.label ?? record.title);
  if (!value) return null;
  return {
    label: firstText(record.label, record.title, record.name) || value,
    value,
  };
}

function questionOptions(item: JsonRecord): ElicitationOption[] {
  const schema = questionSchema(item);
  const itemSchema = nestedRecord(schema, "items");
  const rawOptions = [item.options, item.choices, item.enum, schema?.enum, itemSchema?.enum].find(Array.isArray);
  if (!Array.isArray(rawOptions)) return [];
  const seen = new Set<string>();
  return rawOptions
    .map(questionOption)
    .filter((option): option is ElicitationOption => Boolean(option))
    .filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
}

function schemaTypeText(schema: JsonRecord | null): string {
  const raw = schema?.type;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.find((item): item is string => typeof item === "string") ?? "";
  return "";
}

function questionKind(item: JsonRecord, options: ElicitationOption[]): ElicitationFieldKind {
  const schema = questionSchema(item);
  const rawType = [
    item.type,
    item.input_type,
    item.control,
    item.kind,
    item.format,
    schemaTypeText(schema),
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .filter(Boolean)
    .join(" ");
  if (item.multiple === true || item.multi === true || item.multiselect === true) return "multiselect";
  if (rawType.includes("array") || rawType.includes("multi")) return "multiselect";
  if (rawType.includes("bool") || rawType.includes("checkbox") || rawType.includes("toggle") || rawType.includes("switch")) {
    return "boolean";
  }
  if (rawType.includes("integer") || rawType.includes("int")) return "integer";
  if (rawType.includes("number") || rawType.includes("float")) return "number";
  return options.length ? "select" : "text";
}

function questionBooleanText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value === 0 ? "false" : "true";
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on", "allow", "enabled"].includes(normalized)) return "true";
  if (["false", "no", "n", "0", "off", "deny", "disabled"].includes(normalized)) return "false";
  return "";
}

function questionOptionValue(value: string, options: ElicitationOption[]): string {
  const trimmed = value.trim();
  const match = options.find((option) => option.value === trimmed || option.label === trimmed);
  return match?.value ?? trimmed;
}

function questionValuesFromUnknown(value: unknown, kind: ElicitationFieldKind, options: ElicitationOption[]): string[] {
  const rawValues =
    Array.isArray(value) || (kind === "multiselect" && typeof value === "string" && value.includes(","))
      ? (Array.isArray(value) ? value : value.split(","))
      : [value];
  const values = rawValues.map(optionPrimitiveText).map((item) => item.trim()).filter(Boolean);
  if (kind === "boolean") {
    const bool = questionBooleanText(values[0]);
    return bool ? [bool] : [];
  }
  if (kind === "select" || kind === "multiselect") {
    const seen = new Set<string>();
    return values
      .map((item) => questionOptionValue(item, options))
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }
  return values.length ? [values[0]] : [];
}

function questionIsBarePrompt(item: JsonRecord): boolean {
  return Boolean(
    firstText(item.question) &&
      !firstText(item.id, item.key, item.name, item.field, item.header, item.label, item.title) &&
      item.type === undefined &&
      item.input_type === undefined &&
      item.options === undefined &&
      item.default === undefined &&
      item.default_value === undefined &&
      item.value === undefined &&
      item.answer === undefined,
  );
}

function questionDefaultValues(item: JsonRecord, kind: ElicitationFieldKind, options: ElicitationOption[]): string[] {
  for (const candidate of [item.answer, item.answers, item.default, item.default_value, item.value, item.values, item.selected, item.checked]) {
    if (candidate === undefined || candidate === null) continue;
    const values = questionValuesFromUnknown(candidate, kind, options);
    if (values.length) return values;
  }
  if (kind === "boolean") return ["false"];
  if (kind === "select" && options[0]) return [options[0].value];
  if (questionIsBarePrompt(item)) return ["yes"];
  return [];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function questionNumberBound(item: JsonRecord, keys: string[]): number | undefined {
  const schema = questionSchema(item);
  for (const key of keys) {
    const value = numberValue(item[key]) ?? numberValue(schema?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function questionFieldId(requestId: string, item: JsonRecord, index: number): string {
  return firstText(item.id, item.key, item.name, item.field, `${requestId || "question"}:${index}`);
}

function questionFieldError(
  label: string,
  kind: ElicitationFieldKind,
  required: boolean,
  values: string[],
  options: ElicitationOption[],
  min?: number,
  max?: number,
): string {
  const nonEmpty = values.filter((value) => value.trim());
  if (required && kind !== "boolean" && nonEmpty.length === 0) return `${label} is required`;
  if (nonEmpty.length === 0) return "";
  if (kind === "select" || kind === "multiselect") {
    const valid = new Set(options.map((option) => option.value));
    const invalid = nonEmpty.find((value) => options.length > 0 && !valid.has(value));
    if (invalid) return `${label} has an invalid option`;
  }
  if (kind === "number" || kind === "integer") {
    const parsed = Number(nonEmpty[0]);
    if (!Number.isFinite(parsed)) return `${label} must be a number`;
    if (kind === "integer" && !Number.isInteger(parsed)) return `${label} must be an integer`;
    if (min !== undefined && parsed < min) return `${label} must be at least ${min}`;
    if (max !== undefined && parsed > max) return `${label} must be at most ${max}`;
  }
  return "";
}

function questionElicitationFields(
  question: JsonRecord | undefined,
  requestId: string,
  drafts: Record<string, string[][]>,
): ElicitationField[] {
  const draft = requestId ? drafts[requestId] ?? [] : [];
  return questionItems(question).map((item, index) => {
    const options = questionOptions(item);
    const kind = questionKind(item, options);
    const defaultValues = questionDefaultValues(item, kind, options);
    const values = questionValuesFromUnknown(draft[index] ?? defaultValues, kind, options);
    const value = values[0] ?? "";
    const label = firstText(item.header, item.label, item.title, item.question, `Question ${index + 1}`);
    const min = questionNumberBound(item, ["min", "minimum"]);
    const max = questionNumberBound(item, ["max", "maximum"]);
    return {
      id: questionFieldId(requestId, item, index),
      index,
      label,
      description: firstText(item.question, item.description, item.help),
      value,
      values,
      options,
      required: item.required !== false,
      kind,
      placeholder: firstText(item.placeholder, item.example),
      error: questionFieldError(label, kind, item.required !== false, values, options, min, max),
      min,
      max,
    };
  });
}

function questionAnswers(question: JsonRecord | undefined, requestId: string, drafts: Record<string, string[][]>): string[][] {
  return questionElicitationFields(question, requestId, drafts).map((field) => {
    if (field.kind === "multiselect") return field.values.filter((value) => value.trim());
    if (field.kind === "boolean") return [field.value === "true" ? "true" : "false"];
    const value = field.value.trim();
    return value ? [value] : [];
  });
}

function questionValidationErrors(question: JsonRecord | undefined, requestId: string, drafts: Record<string, string[][]>): string[] {
  return questionElicitationFields(question, requestId, drafts)
    .map((field) => field.error)
    .filter(Boolean);
}

function eventIcon(method: string) {
  if (method === "turn/retrying" || method === "turn/fallback") return <RefreshCw size={16} />;
  if (method.includes("toolCall")) return <Wrench size={16} />;
  if (method.includes("question")) return <Bot size={16} />;
  if (method.includes("approval")) return <ShieldCheck size={16} />;
  if (method.includes("completed")) return <CheckCircle2 size={16} />;
  if (method.includes("failed") || method.includes("interrupted")) return <XCircle size={16} />;
  if (method.includes("agentMessage")) return <Bot size={16} />;
  return <Circle size={14} />;
}

function messageIcon(role?: string) {
  if (role === "assistant") return <Bot size={16} />;
  if (role === "tool") return <Wrench size={16} />;
  if (role === "system") return <Terminal size={16} />;
  return <Circle size={14} />;
}

function retryDelayMs(attempt: number): number {
  return Math.min(5000, 750 * Math.max(1, attempt));
}

function streamStateAfterEvents(events: AppEvent[], fallback: string): string {
  return events.reduce((state, event) => {
    const status = stringParam(event.params ?? {}, "status");
    if (event.method === "turn/completed") return "idle";
    if (event.method === "turn/failed") return "failed";
    if (event.method === "turn/interrupted") return "interrupted";
    if (event.method === "turn/retrying") return "retrying";
    if (event.method === "turn/fallback") return "running";
    if (event.method === "turn/approval_requested") return "waiting_approval";
    if (event.method === "item/question/requested") return "waiting_question";
    if (event.method === "turn/approval_resolved" || event.method === "item/question/resolved") {
      return status === "denied" || status === "dismissed" ? "idle" : "running";
    }
    if (event.method === "item/agentMessage/delta") return "streaming";
    if (event.method === "item/agentMessage/thinking") return "running";
    if (event.method === "turn/started" || event.method === "item/toolCall/started") return "running";
    if (status === "queued" || status === "waiting_approval" || status === "waiting_question" || status === "running") return status;
    return state;
  }, fallback);
}

function activeTurnIdFromEvents(events: AppEvent[]): string {
  let activeTurnId = "";
  for (const event of events) {
    const turnId = eventTurnId(event);
    if (event.method === "turn/started" && turnId) {
      activeTurnId = turnId;
      continue;
    }
    if (
      turnId &&
      (event.method === "item/agentMessage/delta" ||
        event.method === "item/agentMessage/thinking" ||
        event.method === "turn/retrying" ||
        event.method === "turn/fallback" ||
        event.method === "item/toolCall/started" ||
        event.method === "turn/approval_requested" ||
        event.method === "item/question/requested")
    ) {
      activeTurnId = turnId;
      continue;
    }
    if (
      turnId &&
      activeTurnId === turnId &&
      (event.method === "turn/completed" || event.method === "turn/failed" || event.method === "turn/interrupted")
    ) {
      activeTurnId = "";
    }
  }
  return activeTurnId;
}

type RetryableTurnFailure = {
  turnId: string;
  message: string;
  retryable: boolean;
  resumable: boolean;
};

function latestRetryableTurnFailure(events: AppEvent[]): RetryableTurnFailure | null {
  for (const event of [...events].reverse()) {
    if (event.method === "turn/completed" || event.method === "turn/interrupted") return null;
    if (event.method !== "turn/failed") continue;
    const turnId = eventTurnId(event);
    if (!turnId) return null;
    const params = event.params ?? {};
    return {
      turnId,
      message: stringParam(params, "error"),
      retryable: params.retryable === true,
      resumable: params.resumable === true,
    };
  }
  return null;
}

function latestTerminalErrorTurnIdFromEvents(events: AppEvent[]): string {
  for (const event of [...events].reverse()) {
    const turnId = eventTurnId(event);
    if (!turnId) continue;
    if (event.method === "turn/failed" || event.method === "turn/interrupted") return turnId;
    if (
      event.method === "turn/completed" ||
      event.method === "turn/started" ||
      event.method === "item/agentMessage/delta" ||
      event.method === "item/agentMessage/thinking" ||
      event.method.includes("toolCall")
    ) {
      return "";
    }
  }
  return "";
}

function activeStreamingDraftFromEvents(events: AppEvent[]): StreamingDraft | null {
  let currentTurnId = "";
  let text = "";
  let eventCount = 0;
  let completed = false;
  let terminalMethod = "";
  for (const event of events) {
    const turnId = eventTurnId(event) || currentTurnId || "current";
    if (event.method === "turn/started") {
      currentTurnId = turnId;
      text = "";
      eventCount = 0;
      completed = false;
      terminalMethod = "";
      continue;
    }
    if (event.method === "item/agentMessage/delta") {
      const delta = stringParam(event.params ?? {}, "delta");
      if (!delta) continue;
      if (turnId !== currentTurnId) {
        currentTurnId = turnId;
        text = "";
        eventCount = 0;
        completed = false;
        terminalMethod = "";
      }
      text += delta;
      eventCount += 1;
      completed = false;
      terminalMethod = "";
      continue;
    }
    if (
      currentTurnId &&
      (event.method === "turn/completed" ||
        event.method === "turn/failed" ||
        event.method === "turn/interrupted") &&
      turnId === currentTurnId
    ) {
      completed = true;
      terminalMethod = event.method;
    }
  }
  if (!text) return null;
  return {
    turnId: currentTurnId || "current",
    text,
    eventCount,
    completed,
    terminalMethod,
  };
}

function liveFinalAnswerFromEvents(events: AppEvent[]): LiveFinalAnswer | null {
  for (const event of [...events].reverse()) {
    if (event.method !== "turn/completed") continue;
    const text = stringParam(event.params ?? {}, "final_answer");
    if (!text.trim()) continue;
    return {
      turnId: eventTurnId(event) || "current",
      text,
    };
  }
  return null;
}

function hasPersistedAssistantForTurn(messages: MessageWithParts[], turnId: string): boolean {
  return messages.some((message) => {
    if (message.info?.role !== "assistant") return false;
    if (!messageContent(message)) return false;
    const runId = message.info?.run_id;
    return !turnId || turnId === "current" || !runId || runId === turnId;
  });
}

function shouldDeferAssistantMessageAfterLiveEvents(message: MessageWithParts, turnId: string, hasLiveEvents: boolean): boolean {
  if (!hasLiveEvents || !turnId || turnId === "current") return false;
  if (message.info?.role !== "assistant") return false;
  if (!messageContent(message)) return false;
  return message.info?.run_id === turnId;
}

function interactionEventChanged(method: string): boolean {
  return (
    method === "turn/approval_requested" ||
    method === "turn/approval_resolved" ||
    method === "item/question/requested" ||
    method === "item/question/resolved"
  );
}

function sessionEventChanged(method: string): boolean {
  return (
    method.startsWith("turn/") ||
    method === "item/agentMessage/thinking" ||
    method.includes("toolCall") ||
    method.includes("question") ||
    method.includes("approval") ||
    method.includes("checkpoint") ||
    method.includes("patch")
  );
}

function isVisibleProcessEvent(event: AppEvent): boolean {
  const method = event.method;
  if (method === "item/agentMessage/delta" || method === "turn/started" || method === "turn/completed") return false;
  return (
    method === "item/agentMessage/thinking" ||
    method.includes("toolCall") ||
    method.includes("approval") ||
    method.includes("question") ||
    method.includes("patch") ||
    method === "turn/retrying" ||
    method === "turn/fallback" ||
    method === "turn/failed" ||
    method === "turn/interrupted"
  );
}

function eventSessionIds(events: AppEvent[]): Set<string> {
  return events.reduce((ids, event) => {
    const id = eventSessionId(event);
    if (id) ids.add(id);
    return ids;
  }, new Set<string>());
}

function restoredCheckpointIdFromEvents(events: AppEvent[]): string {
  for (const event of [...events].reverse()) {
    if (event.method !== "checkpoint/restored") continue;
    const value = event.params?.checkpoint_id;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isInitialBridgeFetchError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message === "Failed to fetch" || message === "Load failed" || message.includes("NetworkError");
}

export function App() {
  const [bridgeUrl, setBridgeUrl] = useState(() => storedValue(STORAGE_BRIDGE, DEFAULT_BRIDGE));
  const [token, setToken] = useState(() => storedValue(STORAGE_TOKEN, ""));
  const [projects, setProjects] = useState<DesktopProject[]>(() => storedProjects());
  const [activeProjectPath, setActiveProjectPath] = useState(() => storedValue(STORAGE_ACTIVE_PROJECT, ""));
  const [projectPathInput, setProjectPathInput] = useState(() => storedValue(STORAGE_ACTIVE_PROJECT, ""));
  const [projectError, setProjectError] = useState("");
  const [projectBusy, setProjectBusy] = useState("");
  const [protocol, setProtocol] = useState<ProtocolPayload | null>(null);
  const [provider, setProvider] = useState<ProviderPayload | null>(null);
  const [mcp, setMcp] = useState<McpPayload | null>(null);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpServerDraft, setMcpServerDraft] = useState<McpServerDraft>(() => defaultMcpServerDraft());
  const [mcpEditingServerName, setMcpEditingServerName] = useState("");
  const [mcpMutationBusy, setMcpMutationBusy] = useState("");
  const [mcpMutationError, setMcpMutationError] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [sessionRenameDraft, setSessionRenameDraft] = useState("");
  const [sessionRenameBusy, setSessionRenameBusy] = useState("");
  const [sessionRenameError, setSessionRenameError] = useState("");
  const [deleteConfirmationSessionId, setDeleteConfirmationSessionId] = useState("");
  const [sessionDeleteBusy, setSessionDeleteBusy] = useState("");
  const [sessionDeleteError, setSessionDeleteError] = useState("");
  const [sessionArchiveBusy, setSessionArchiveBusy] = useState("");
  const [sessionArchiveError, setSessionArchiveError] = useState("");
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [interactionSync, setInteractionSync] = useState<InteractionSync>({});
  const [respondingInteractionId, setRespondingInteractionId] = useState("");
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string[][]>>({});
  const [restoringCheckpointId, setRestoringCheckpointId] = useState("");
  const [restoredCheckpointId, setRestoredCheckpointId] = useState("");
  const [sessionDiff, setSessionDiff] = useState<SessionDiff | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointsPayload | null>(null);
  const [fileTree, setFileTree] = useState<FilesPayload | null>(null);
  const [filePreview, setFilePreview] = useState<FilesPayload | null>(null);
  const [gitStatus, setGitStatus] = useState<GitPayload | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessagesPayload | null>(null);
  const [turnJobs, setTurnJobs] = useState<TurnJobsPayload>({ turns: [], count: 0, running_count: 0, terminal_count: 0 });
  const [selectedTurnJobId, setSelectedTurnJobId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(() =>
    storedActiveSession(storedValue(STORAGE_ACTIVE_PROJECT, "")),
  );
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [composerDockHeight, setComposerDockHeight] = useState(164);
  const [permission, setPermission] = useState(() => normalizePermissionMode(storedValue(STORAGE_PERMISSION_MODE, "REQUEST_APPROVAL")));
  const [model, setModel] = useState("");
  const [providerConfig, setProviderConfig] = useState<ProviderConfigPayload | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(() => defaultProviderDraft());
  const [providerBusy, setProviderBusy] = useState("");
  const [providerConfigError, setProviderConfigError] = useState("");
  const [providerValidation, setProviderValidation] = useState<ProviderValidationResult | null>(null);
  const [providerEnvText, setProviderEnvText] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("pwd");
  const [terminalResult, setTerminalResult] = useState<TerminalRunResult | null>(null);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalError, setTerminalError] = useState("");
  const [connection, setConnection] = useState("offline");
  const [streamState, setStreamState] = useState("idle");
  const [activeTurnId, setActiveTurnId] = useState("");
  const [interruptingTurnId, setInterruptingTurnId] = useState("");
  const [retryingTurnId, setRetryingTurnId] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [streamHealth, setStreamHealth] = useState<StreamHealth>({
    status: "idle",
    resume_cursor: 0,
    reconnect_attempts: 0,
    recovered_count: 0,
    last_batch_count: 0,
  });
  const [desktopRuntime, setDesktopRuntime] = useState(() => (isTauriRuntime() ? "tauri" : "web preview"));
  const [desktopDiagnostics, setDesktopDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [desktopDiagnosticError, setDesktopDiagnosticError] = useState("");
  const [desktopAuth, setDesktopAuth] = useState<DesktopAuthToken | null>(null);
  const [desktopAuthError, setDesktopAuthError] = useState("");
  const [desktopAuthReady, setDesktopAuthReady] = useState(() => !isTauriRuntime());
  const [managedBridge, setManagedBridge] = useState<ManagedBridgeStatus | null>(null);
  const [managedBridgeBusy, setManagedBridgeBusy] = useState("");
  const [managedBridgeError, setManagedBridgeError] = useState("");
  const [coreRoot, setCoreRoot] = useState(() => storedValue(STORAGE_CORE_ROOT, ""));
  const [coreRootInput, setCoreRootInput] = useState(() => storedValue(STORAGE_CORE_ROOT, ""));
  const [coreRootError, setCoreRootError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [, setInspectorMode] = useState<"overview" | "review">("overview");
  const [error, setError] = useState("");
  const lastGlobalId = useRef(0);
  const eventKeysRef = useRef<Set<string>>(new Set());
  const refreshEffectKey = useRef("");
  const streamReconnectAttempts = useRef(0);
  const managedBridgeAutoSyncKey = useRef("");
  const activeSessionIdRef = useRef(activeSessionId);
  const sessionViewEpochRef = useRef(0);
  const sessionRenameCancelledRef = useRef(false);
  const composerComposingRef = useRef(false);
  const composerCompositionEndAtRef = useRef(0);
  const timelineRef = useRef<HTMLElement | null>(null);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const streamingDraftRef = useRef<HTMLElement | null>(null);
  const streamingDraftAnchoredTurnRef = useRef("");
  const timelineAutoScrollFrameRef = useRef<number | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);

  const clearSessionListErrors = useCallback(() => {
    setSessionRenameError("");
    setSessionDeleteError("");
    setSessionArchiveError("");
  }, []);

  useEffect(() => {
    if (!sessionRenameError && !sessionDeleteError && !sessionArchiveError) return;
    const timeout = window.setTimeout(clearSessionListErrors, 4500);
    return () => window.clearTimeout(timeout);
  }, [clearSessionListErrors, sessionArchiveError, sessionDeleteError, sessionRenameError]);

  const activeProject = projects.find((project) => sameProjectPath(project.path, activeProjectPath));
  const selectedProjectPath = activeProject?.path || activeProjectPath || desktopDiagnostics?.workspace_default || managedBridge?.workspace || "";
  const selectedCoreRoot = normalizeProjectPath(
    coreRoot || desktopDiagnostics?.core_root_default || managedBridge?.core_root || "",
  );
  const managedBridgeBusyAny = Boolean(managedBridgeBusy);
  const managedBridgeWorkspaceMismatch =
    Boolean(managedBridge?.running && managedBridge.workspace && selectedProjectPath) &&
    !sameProjectPath(managedBridge?.workspace, selectedProjectPath);
  const managedBridgeCoreMismatch =
    Boolean(managedBridge?.running && managedBridge.core_root && selectedCoreRoot) &&
    !sameProjectPath(managedBridge?.core_root, selectedCoreRoot);
  const bridgeSwitchInProgress =
    isTauriRuntime() && (managedBridgeBusyAny || managedBridgeWorkspaceMismatch || managedBridgeCoreMismatch);
  const bridgeApiReady = desktopAuthReady && (!isTauriRuntime() || Boolean(managedBridge?.running));

  const loadProviderConfig = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const payload = await invoke<ProviderConfigPayload>("provider_config_read", {
        options: { workspace: selectedProjectPath || undefined, coreRoot: selectedCoreRoot || undefined },
      });
      setProviderConfig(payload);
      setProviderDraft(providerDraftFromPayload(payload));
      setModel((current) => current || payload.model || "");
      setProviderConfigError("");
      setProviderValidation(null);
    } catch (err) {
      setProviderConfigError(userFacingErrorMessage(err));
    }
  }, [selectedCoreRoot, selectedProjectPath]);

  useEffect(() => {
    loadProviderConfig().catch((err: unknown) => setProviderConfigError(userFacingErrorMessage(err)));
  }, [loadProviderConfig]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke<DesktopDiagnostics>("desktop_diagnostics")
      .then((payload) => {
        setDesktopRuntime(payload.runtime || "tauri");
        setDesktopDiagnostics(payload);
        setDesktopDiagnosticError("");
        if (payload.bridge_default_url && !window.localStorage.getItem(STORAGE_BRIDGE)) {
          setBridgeUrl(payload.bridge_default_url);
        }
        if (payload.core_root_default && !window.localStorage.getItem(STORAGE_CORE_ROOT)) {
          setCoreRoot(payload.core_root_default);
          setCoreRootInput(payload.core_root_default);
        }
        if (payload.workspace_default) {
          const project = projectFromPath(payload.workspace_default);
          setProjects((current) => upsertProject(current, project));
          if (payload.workspace_default_source === "env") {
            setActiveProjectPath(project.path);
            setProjectPathInput(project.path);
          } else {
            setActiveProjectPath((current) => current || project.path);
            setProjectPathInput((current) => current || project.path);
          }
        }
      })
      .catch((diagnosticError) => {
        setDesktopRuntime("tauri");
        setDesktopDiagnosticError(userFacingErrorMessage(diagnosticError));
      });
    invoke<ManagedBridgeStatus>("bridge_status")
      .then((payload) => {
        setManagedBridge(payload);
        setManagedBridgeError(payload.error ?? "");
        if (payload.running && payload.url) {
          setBridgeUrl(payload.url);
        }
      })
      .catch((statusError) => {
        setManagedBridgeError(userFacingErrorMessage(statusError));
      });
    invoke<DesktopAuthToken>("desktop_auth_token")
      .then((payload) => {
        setDesktopAuth(payload);
        setDesktopAuthError("");
        if (payload.token) {
          setToken(payload.token);
        }
      })
      .catch((authError) => {
        setDesktopAuthError(userFacingErrorMessage(authError));
      })
      .finally(() => {
        setDesktopAuthReady(true);
      });
  }, []);

  const api = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const headers = new Headers(init.headers);
      headers.set("accept", headers.get("accept") ?? "application/json");
      if (init.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      if (token.trim()) headers.set("authorization", `Bearer ${token.trim()}`);
      const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers,
      });
      if (!response.ok) {
        let body: JsonRecord | undefined;
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const parsed = (await response.json().catch(() => null)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            body = parsed as JsonRecord;
          }
        }
        throw new ApiError(init.method ?? "GET", path, response.status, body);
      }
      return (await response.json()) as T;
    },
    [bridgeUrl, token],
  );

  const refreshMcp = useCallback(async () => {
    setMcpRefreshing(true);
    try {
      const payload = await api<McpPayload>("/api/mcp?refresh=true");
      setMcp(payload);
      setMcpMutationError("");
      setConnection("online");
      return payload;
    } catch (err) {
      const message = userFacingErrorMessage(err);
      setMcp({
        configured: false,
        enabled: false,
        server_count: 0,
        tool_count: 0,
        source: "unavailable",
        status: "error",
        error: message,
        servers: [],
      });
      if (!isInitialBridgeFetchError(err)) setError(message);
      throw err;
    } finally {
      setMcpRefreshing(false);
    }
  }, [api]);

  const commitMcpMutation = useCallback(
    async (busyKey: string, path: string, init: RequestInit) => {
      setMcpMutationBusy(busyKey);
      setMcpMutationError("");
      try {
        const payload = await api<McpPayload>(path, init);
        setMcp(payload);
        setConnection("online");
        return payload;
      } catch (err) {
      const message = userFacingErrorMessage(err);
        setMcpMutationError(message);
        return null;
      } finally {
        setMcpMutationBusy("");
      }
    },
    [api],
  );

  const submitMcpServer = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const editingName = mcpEditingServerName.trim();
      const editing = Boolean(editingName);
      const name = mcpServerDraft.name.trim();
      const url = mcpServerDraft.url.trim();
      const command = mcpServerDraft.command.trim();
      const transport = mcpServerDraft.transport.trim() || "http";
      if (!mcp?.writable) {
        setMcpMutationError("MCP config is read-only.");
        return;
      }
      if (!name) {
        setMcpMutationError("Name is required.");
        return;
      }
      if (!editing && mcpServerDraft.mode === "remote" && !url) {
        setMcpMutationError("Remote MCP URL is required.");
        return;
      }
      if (!editing && mcpServerDraft.mode === "local" && !command) {
        setMcpMutationError("Local MCP command is required.");
        return;
      }
      let env: Record<string, string>;
      let headers: Record<string, string>;
      try {
        env = parseMcpMap(mcpServerDraft.env, "Env");
        headers = parseMcpMap(mcpServerDraft.headers, "Headers");
      } catch (err) {
        setMcpMutationError(userFacingErrorMessage(err));
        return;
      }
      const timeoutText = mcpServerDraft.timeoutMs.trim();
      let timeoutMs: number | undefined;
      if (timeoutText) {
        const parsedTimeout = Number.parseInt(timeoutText, 10);
        if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
          setMcpMutationError("Timeout must be a positive number of milliseconds.");
          return;
        }
        timeoutMs = parsedTimeout;
      }
      const body =
        mcpServerDraft.mode === "local"
          ? {
              name,
              type: "local",
              command,
              args: parseMcpList(mcpServerDraft.args),
              cwd: mcpServerDraft.cwd.trim() || undefined,
              env,
              headers,
              timeout_ms: timeoutMs,
              enabled: true,
            }
          : {
              name,
              type: "remote",
              url,
              transport,
              env,
              headers,
              timeout_ms: timeoutMs,
              enabled: true,
            };
      if (editing) {
        const patchBody: JsonRecord = { type: mcpServerDraft.mode };
        if (timeoutMs) patchBody.timeout_ms = timeoutMs;
        if (Object.keys(env).length) patchBody.env = env;
        if (Object.keys(headers).length) patchBody.headers = headers;
        if (mcpServerDraft.mode === "local") {
          if (command) {
            patchBody.command = command;
            patchBody.args = parseMcpList(mcpServerDraft.args);
          }
          if (mcpServerDraft.cwd.trim()) patchBody.cwd = mcpServerDraft.cwd.trim();
        } else {
          if (url) patchBody.url = url;
          if (transport) patchBody.transport = transport;
        }
        const payload = await commitMcpMutation(`edit:${editingName}`, `/api/mcp/servers/${encodeURIComponent(editingName)}`, {
          method: "PATCH",
          body: JSON.stringify(patchBody),
        });
        if (payload) {
          setMcpServerDraft(defaultMcpServerDraft());
          setMcpEditingServerName("");
        }
        return;
      }
      const payload = await commitMcpMutation("add", "/api/mcp/servers", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (payload) {
        setMcpServerDraft(defaultMcpServerDraft());
        setMcpEditingServerName("");
      }
    },
    [commitMcpMutation, mcp?.writable, mcpEditingServerName, mcpServerDraft],
  );

  const editMcpServer = useCallback((server: McpServerSummary) => {
    const name = server.name?.trim();
    if (!name) return;
    setMcpMutationError("");
    setMcpEditingServerName(name);
    setMcpServerDraft(mcpDraftFromServer(server));
  }, []);

  const cancelMcpEdit = useCallback(() => {
    setMcpMutationError("");
    setMcpEditingServerName("");
    setMcpServerDraft(defaultMcpServerDraft());
  }, []);

  const toggleMcpServer = useCallback(
    async (server: McpServerSummary) => {
      const name = server.name?.trim();
      if (!name) return;
      await commitMcpMutation(`toggle:${name}`, `/api/mcp/servers/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !server.enabled }),
      });
    },
    [commitMcpMutation],
  );

  const deleteMcpServer = useCallback(
    async (server: McpServerSummary) => {
      const name = server.name?.trim();
      if (!name) return;
      await commitMcpMutation(`delete:${name}`, `/api/mcp/servers/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
    },
    [commitMcpMutation],
  );

  const testMcpServer = useCallback(
    async (server: McpServerSummary) => {
      const name = server.name?.trim();
      if (!name) return;
      await commitMcpMutation(`test:${name}`, `/api/mcp/servers/${encodeURIComponent(name)}/test`, {
        method: "POST",
      });
    },
    [commitMcpMutation],
  );

  const controlMcpServerLifecycle = useCallback(
    async (server: McpServerSummary, action: "start" | "stop" | "restart") => {
      const name = server.name?.trim();
      if (!name || server.type !== "local") return;
      await commitMcpMutation(`lifecycle:${action}:${name}`, `/api/mcp/servers/${encodeURIComponent(name)}/${action}`, {
        method: "POST",
      });
    },
    [commitMcpMutation],
  );

  const addEvents = useCallback((incoming: AppEvent[]): AppEvent[] => {
    if (!incoming.length) return [];
    lastGlobalId.current = incoming.reduce((cursor, event) => {
      return Math.max(cursor, event.global_sequence ?? 0);
    }, lastGlobalId.current);

    const seen = new Set(eventKeysRef.current);
    const accepted: AppEvent[] = [];
    for (const event of incoming) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      accepted.push(event);
    }
    eventKeysRef.current = seen;
    if (!accepted.length) return [];

    setEvents((current) => {
      const next = [...current, ...accepted].slice(-300);
      eventKeysRef.current = new Set(next.map(eventKey));
      return next;
    });
    return accepted;
  }, []);

  const refreshWorkspaceContext = useCallback(
    async (focusPath = "", expectedEpoch?: number) => {
      const normalizedPath = focusPath.trim();
      const previewPath = normalizedPath ? `?path=${encodeURIComponent(normalizedPath)}&content=true` : "?depth=2";
      const [treePayload, previewPayload, gitPayload] = await Promise.all([
        api<FilesPayload>("/api/files?depth=2"),
        api<FilesPayload>(`/api/files${previewPath}`),
        api<GitPayload>("/api/git"),
      ]);
      if (expectedEpoch !== undefined && sessionViewEpochRef.current !== expectedEpoch) return;
      setFileTree(treePayload);
      setFilePreview(previewPayload);
      setGitStatus(gitPayload);
    },
    [api],
  );

  const resetSessionView = useCallback(() => {
    setSelectedTurnJobId("");
    setSessionMessages(null);
    setSessionDiff(null);
    setCheckpoints(null);
    setRestoredCheckpointId("");
    setEvents([]);
    setActiveTurnId("");
    setInterruptingTurnId("");
    setStreamState("idle");
    setComposerAttachments([]);
    setAttachmentMenuOpen(false);
    setAttachmentError("");
  }, []);

  const activateSession = useCallback(
    (session: string, projectPath = selectedProjectPath) => {
      sessionViewEpochRef.current += 1;
      activeSessionIdRef.current = session;
      setActiveSessionId(session);
      persistActiveSession(projectPath, session);
      resetSessionView();
      return sessionViewEpochRef.current;
    },
    [resetSessionView, selectedProjectPath],
  );

  const clearMissingSession = useCallback(
    (session: string) => {
      if (!session) return;
      clearSessionListErrors();
      setSessions((current) => current.filter((record) => sessionId(record) !== session));
      forgetStoredSession(session);
      if (activeSessionIdRef.current !== session) return;
      activateSession("");
    },
    [activateSession, activeSessionId, clearSessionListErrors],
  );

  const refreshSessionMessages = useCallback(
    async (session: string, expectedEpoch = sessionViewEpochRef.current) => {
      if (!session) {
        if (activeSessionIdRef.current === "" && sessionViewEpochRef.current === expectedEpoch) {
          setSessionMessages(null);
        }
        return;
      }
      try {
        const payload = await api<SessionMessagesPayload>(`/api/sessions/${session}/messages?limit=100`);
        if (activeSessionIdRef.current !== session || sessionViewEpochRef.current !== expectedEpoch) return;
        setSessionMessages({ ...payload, session_id: payload.session_id || session });
      } catch (err) {
        if (activeSessionIdRef.current !== session || sessionViewEpochRef.current !== expectedEpoch) return;
        if (isMissingSessionError(err)) {
          clearMissingSession(session);
          return;
        }
        throw err;
      }
    },
    [api, clearMissingSession],
  );

  const refreshInteractions = useCallback(
    async (lastEventMethod = "") => {
      const [approvalsPayload, questionsPayload] = await Promise.all([
        api<{ approvals?: PendingApproval[] }>("/api/approvals"),
        api<{ questions?: PendingQuestion[] }>("/api/questions"),
      ]);
      setApprovals(approvalsPayload.approvals ?? []);
      setQuestions(questionsPayload.questions ?? []);
      setInteractionSync({
        last_synced_at_ms: Date.now(),
        last_event_method: lastEventMethod || undefined,
      });
    },
    [api],
  );

  const refreshTurnJobs = useCallback(async () => {
    const payload = await api<TurnJobsPayload>("/api/turns").catch((err: unknown) => ({
      turns: [],
      count: 0,
      running_count: 0,
      terminal_count: 0,
      source: "unavailable",
      error: userFacingErrorMessage(err),
    }));
    const normalized = normalizeTurnJobs(payload);
    setTurnJobs(normalized);
    return normalized;
  }, [api]);

  const refreshSessionTrust = useCallback(
    async (session: string, expectedEpoch = sessionViewEpochRef.current) => {
      if (!session) {
        if (activeSessionIdRef.current !== "" || sessionViewEpochRef.current !== expectedEpoch) return;
        setSessionDiff(null);
        setCheckpoints(null);
        await refreshWorkspaceContext("", expectedEpoch);
        return;
      }
      try {
        const [diffPayload, checkpointsPayload] = await Promise.all([
          api<SessionDiff>(`/api/sessions/${session}/diff`),
          api<CheckpointsPayload>(`/api/sessions/${session}/checkpoints`),
        ]);
        if (activeSessionIdRef.current !== session || sessionViewEpochRef.current !== expectedEpoch) return;
        setSessionDiff(diffPayload);
        setCheckpoints(checkpointsPayload);
        await refreshWorkspaceContext(stringField(diffPayload.latest ?? undefined, "path"), expectedEpoch);
      } catch (err) {
        if (activeSessionIdRef.current !== session || sessionViewEpochRef.current !== expectedEpoch) return;
        if (isMissingSessionError(err)) {
          clearMissingSession(session);
          await refreshWorkspaceContext("", expectedEpoch);
          return;
        }
        throw err;
      }
    },
    [api, clearMissingSession, refreshWorkspaceContext],
  );

  const refresh = useCallback(async () => {
    const expectedEpoch = sessionViewEpochRef.current;
    setError("");
    clearSessionListErrors();
    const [protocolPayload, providerPayload, mcpPayload, sessionsPayload, approvalsPayload, questionsPayload, turnJobsPayload] = await Promise.all([
      api<ProtocolPayload>("/api/protocol"),
      api<ProviderPayload>("/api/models?check=true").catch((err: unknown) => ({
        healthy: false,
        model_endpoint_ok: false,
        provider: "openai",
        model: undefined,
        error: userFacingErrorMessage(err),
        models: [],
      })),
      api<McpPayload>("/api/mcp?refresh=true").catch((err: unknown) => ({
        configured: false,
        enabled: false,
        server_count: 0,
        tool_count: 0,
        source: "unavailable",
        status: "error",
        error: userFacingErrorMessage(err),
        servers: [],
      })),
      api<{ sessions?: SessionSummary[] }>("/api/sessions"),
      api<{ approvals?: PendingApproval[] }>("/api/approvals"),
      api<{ questions?: PendingQuestion[] }>("/api/questions"),
      api<TurnJobsPayload>("/api/turns").catch((err: unknown) => ({
        turns: [],
        count: 0,
        running_count: 0,
        terminal_count: 0,
        source: "unavailable",
        error: userFacingErrorMessage(err),
      })),
    ]);
    if (sessionViewEpochRef.current !== expectedEpoch) return;
    setProtocol(protocolPayload);
    setProvider(providerPayload);
    setMcp(mcpPayload);
    setTurnJobs(normalizeTurnJobs(turnJobsPayload));
    setApprovals(approvalsPayload.approvals ?? []);
    setQuestions(questionsPayload.questions ?? []);
    setInteractionSync({ last_synced_at_ms: Date.now(), last_event_method: "refresh" });
    setModel((current) => current || providerPayload.model || "");
    const records = sessionsPayload.sessions ?? [];
    setSessions(records);
    const current = activeSessionIdRef.current;
    const currentRecord = records.find((session) => sessionId(session) === current);
    const currentIsValid = Boolean(
      currentRecord &&
        (!selectedProjectPath || !currentRecord.workspace || sameProjectPath(currentRecord.workspace, selectedProjectPath)),
    );
    if (!currentIsValid) {
      const stored = storedActiveSession(selectedProjectPath);
      const storedRecord = records.find((session) => sessionId(session) === stored);
      const storedIsValid = Boolean(
        storedRecord &&
          (!selectedProjectPath || !storedRecord.workspace || sameProjectPath(storedRecord.workspace, selectedProjectPath)),
      );
      if (storedIsValid) {
        activateSession(stored, selectedProjectPath);
      } else if (current) {
        activateSession("", selectedProjectPath);
      }
    }
    await refreshWorkspaceContext("", sessionViewEpochRef.current);
    setConnection("online");
  }, [activateSession, api, clearSessionListErrors, refreshWorkspaceContext, selectedProjectPath]);

  const createSession = useCallback(async () => {
    if (bridgeSwitchInProgress) {
      throw new Error("Bridge is switching to the selected project. Try again in a moment.");
    }
    clearSessionListErrors();
    const workspace = selectedProjectPath || undefined;
    const payload = await api<CreateSessionPayload>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        cwd: workspace,
      }),
    });
    const id = payload.session_id ?? payload.id ?? sessionId(payload.session ?? {});
    const session = createdSessionSummary(payload, workspace ?? selectedProjectPath);
    if (session) setSessions((current) => upsertSessionSummary(current, session));
    activateSession(id, workspace ?? selectedProjectPath);
    return id;
  }, [activateSession, api, bridgeSwitchInProgress, clearSessionListErrors, selectedProjectPath]);

	  const beginRenameSession = useCallback((session: SessionSummary) => {
	    const id = sessionId(session);
	    if (!id) return;
	    sessionRenameCancelledRef.current = false;
	    setDeleteConfirmationSessionId("");
	    clearSessionListErrors();
	    setRenamingSessionId(id);
	    setSessionRenameDraft(sessionDisplayTitle(session));
	  }, [clearSessionListErrors]);

  const cancelRenameSession = useCallback(() => {
    sessionRenameCancelledRef.current = true;
    setRenamingSessionId("");
    setSessionRenameDraft("");
    setSessionRenameError("");
  }, []);

  const saveSessionRename = useCallback(
    async (session: SessionSummary) => {
      const id = sessionId(session);
      if (!id) return;
      const title = sessionRenameDraft.trim();
      const currentTitle = sessionDisplayTitle(session);
      if (!title || title === currentTitle) {
        setRenamingSessionId("");
        setSessionRenameDraft("");
        return;
      }

      setSessionRenameBusy(id);
      setSessionRenameError("");
      try {
        const payload = await api<{ session?: SessionSummary }>(`/api/sessions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        });
        const updated = payload.session;
        if (updated) {
          setSessions((current) => current.map((record) => (sessionId(record) === id ? updated : record)));
        } else {
          await refresh();
        }
        setRenamingSessionId("");
        setSessionRenameDraft("");
      } catch (err) {
        if (isMissingSessionError(err)) {
          clearMissingSession(id);
          setRenamingSessionId("");
          setSessionRenameDraft("");
          refresh().catch(() => undefined);
        } else {
          setSessionRenameError("重命名失败，请刷新后重试。");
        }
      } finally {
        setSessionRenameBusy("");
      }
    },
    [api, clearMissingSession, refresh, sessionRenameDraft],
  );

  const deleteSession = useCallback(
    async (session: SessionSummary) => {
      const id = sessionId(session);
      if (!id || sessionDeleteBusy) return;
      if (deleteConfirmationSessionId !== id) {
        setDeleteConfirmationSessionId(id);
        clearSessionListErrors();
        return;
      }

      setSessionDeleteBusy(id);
      clearSessionListErrors();
      const deletingActive = activeSessionIdRef.current === id;
      const deletingWorkspace = session.workspace || selectedProjectPath;
      if (deletingActive) activateSession("", deletingWorkspace);
      try {
        await api(`/api/sessions/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        forgetStoredSession(id);
        setSessions((current) => current.filter((record) => sessionId(record) !== id));
        setDeleteConfirmationSessionId("");
        if (renamingSessionId === id) {
          setRenamingSessionId("");
          setSessionRenameDraft("");
        }
        await refresh();
      } catch (err) {
        if (isMissingSessionError(err)) {
          clearMissingSession(id);
          setDeleteConfirmationSessionId("");
          refresh().catch(() => undefined);
          return;
        }
        if (deletingActive) activateSession(id, deletingWorkspace);
        setSessionDeleteError("删除失败，请刷新后重试。");
      } finally {
        setSessionDeleteBusy("");
      }
    },
    [
      api,
      clearMissingSession,
      clearSessionListErrors,
      deleteConfirmationSessionId,
      refresh,
      activateSession,
      renamingSessionId,
      sessionDeleteBusy,
      selectedProjectPath,
    ],
  );

  const archiveSession = useCallback(
    async (session: SessionSummary, archived = true) => {
      const id = sessionId(session);
      if (!id || sessionArchiveBusy) return;
      setSessionArchiveBusy(id);
      clearSessionListErrors();
      try {
        const payload = await api<{ session?: SessionSummary }>(`/api/sessions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ archived }),
        });
        const updated = payload.session ?? { ...session, archived, archived_at_ms: archived ? Date.now() : null };
        setSessions((current) => current.map((record) => (sessionId(record) === id ? updated : record)));
        if (archived) forgetStoredSession(id);
        if (archived && activeSessionId === id) {
          activateSession("");
        }
        await refresh();
      } catch (err) {
        if (isMissingSessionError(err)) {
          clearMissingSession(id);
          refresh().catch(() => undefined);
          return;
        }
        setSessionArchiveError(archived ? "归档失败，请刷新后重试。" : "恢复失败，请刷新后重试。");
      } finally {
        setSessionArchiveBusy("");
      }
    },
    [
      activeSessionId,
      api,
      clearMissingSession,
      clearSessionListErrors,
      refresh,
      activateSession,
      sessionArchiveBusy,
    ],
  );

  const refreshFromEvents = useCallback(
    async (incoming: AppEvent[]) => {
      if (!incoming.length) return;
      const methods = incoming.map((event) => event.method);
      const touchedSessions = eventSessionIds(incoming);
      const lastInteractionMethod = [...methods].reverse().find(interactionEventChanged) ?? "";
      const interactionChanged = Boolean(lastInteractionMethod);
      const sessionChanged = methods.some(sessionEventChanged);
      const restoredId = restoredCheckpointIdFromEvents(incoming);
      if (restoredId) setRestoredCheckpointId(restoredId);
      const currentSession = activeSessionIdRef.current;
      const activeTouched = currentSession
        ? touchedSessions.size === 0 || touchedSessions.has(currentSession)
        : false;
      const tasks: Array<Promise<unknown>> = [];

      if (interactionChanged) tasks.push(refreshInteractions(lastInteractionMethod));
      if (sessionChanged) tasks.push(refreshTurnJobs());
      if (sessionChanged) tasks.push(api<{ sessions?: SessionSummary[] }>("/api/sessions").then((payload) => {
        const records = payload.sessions ?? [];
        setSessions(records);
        if (!activeSessionIdRef.current && touchedSessions.size > 0) {
          const touched = records.find((session) => touchedSessions.has(sessionId(session)));
          const touchedId = sessionId(touched ?? {});
          if (touchedId) {
            const epoch = activateSession(touchedId, touched?.workspace || selectedProjectPath);
            void refreshSessionMessages(touchedId, epoch);
            void refreshSessionTrust(touchedId, epoch);
          }
        }
      }));
      if (activeTouched && sessionChanged) {
        const epoch = sessionViewEpochRef.current;
        tasks.push(refreshSessionMessages(currentSession, epoch));
        tasks.push(refreshSessionTrust(currentSession, epoch));
      }

      if (tasks.length === 0) return;
      const results = await Promise.allSettled(tasks);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected && rejected.status === "rejected") {
        setInteractionSync((current) => ({
          ...current,
          last_event_method: `sync failed: ${rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason)}`,
        }));
      }
    },
    [
      activateSession,
      api,
      refreshInteractions,
      refreshSessionMessages,
      refreshSessionTrust,
      refreshTurnJobs,
      selectedProjectPath,
    ],
  );
  const refreshFromEventsRef = useRef(refreshFromEvents);
  useEffect(() => {
    refreshFromEventsRef.current = refreshFromEvents;
  }, [refreshFromEvents]);

  const respondApproval = useCallback(
    async (approval: PendingApproval, action: "allow" | "deny") => {
      const requestId = approval.request_id;
      if (!requestId) return;
      setError("");
      setRespondingInteractionId(requestId);
      try {
        const payload = await api<{ events?: AppEvent[] }>(`/api/approvals/${requestId}`, {
          method: "POST",
          body: JSON.stringify({ action, scope: "once" }),
        });
        const incoming = payload.events ?? [];
        const accepted = addEvents(incoming);
        if (accepted.length) {
          await refreshFromEvents(accepted);
        } else {
          await refreshInteractions("turn/approval_resolved");
          await refreshSessionMessages(approval.session_id || activeSessionId);
          await refreshSessionTrust(approval.session_id || activeSessionId);
        }
      } catch (err) {
        setError(userFacingErrorMessage(err));
      } finally {
        setRespondingInteractionId("");
      }
    },
    [
      activeSessionId,
      addEvents,
      api,
      refreshFromEvents,
      refreshInteractions,
      refreshSessionMessages,
      refreshSessionTrust,
    ],
  );

  const updateQuestionDraft = useCallback((requestId: string | undefined, index: number, fieldValues: string[]) => {
    if (!requestId) return;
    setQuestionDrafts((current) => {
      const next = { ...current };
      const draftValues = [...(next[requestId] ?? [])];
      draftValues[index] = fieldValues;
      next[requestId] = draftValues;
      return next;
    });
  }, []);

  const respondQuestion = useCallback(
    async (question: PendingQuestion, dismissed = false) => {
      const requestId = question.request_id;
      if (!requestId) return;
      setError("");
      if (!dismissed) {
        const validationErrors = questionValidationErrors(question.question, requestId, questionDrafts);
        if (validationErrors.length) {
          setError(validationErrors[0]);
          return;
        }
      }
      setRespondingInteractionId(requestId);
      try {
        const payload = await api<{ events?: AppEvent[] }>(`/api/questions/${requestId}/reply`, {
          method: "POST",
          body: JSON.stringify(
            dismissed
              ? { dismissed: true, note: "dismissed from Desktop" }
              : { answers: questionAnswers(question.question, requestId, questionDrafts) },
          ),
        });
        const incoming = payload.events ?? [];
        const accepted = addEvents(incoming);
        if (accepted.length) {
          await refreshFromEvents(accepted);
        } else {
          await refreshInteractions("item/question/resolved");
          await refreshSessionMessages(question.session_id || activeSessionId);
          await refreshSessionTrust(question.session_id || activeSessionId);
        }
        setQuestionDrafts((current) => {
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      } catch (err) {
        setError(userFacingErrorMessage(err));
      } finally {
        setRespondingInteractionId("");
      }
    },
    [
      activeSessionId,
      addEvents,
      api,
      questionDrafts,
      refreshFromEvents,
      refreshInteractions,
      refreshSessionMessages,
      refreshSessionTrust,
    ],
  );

  const runPatchAction = useCallback(
    async (action: "undo" | "redo") => {
      if (!activeSessionId) return;
      setError("");
      try {
        const payload = await api<{ events?: AppEvent[] }>(`/api/sessions/${activeSessionId}/${action}`, {
          method: "POST",
        });
        addEvents(payload.events ?? []);
        await refreshSessionMessages(activeSessionId);
        await refreshSessionTrust(activeSessionId);
      } catch (err) {
        setError(userFacingErrorMessage(err));
      }
    },
    [activeSessionId, addEvents, api, refreshSessionMessages, refreshSessionTrust],
  );

  const restoreCheckpoint = useCallback(
    async (checkpointId?: string) => {
      if (!activeSessionId || !checkpointId) return;
      setError("");
      setRestoringCheckpointId(checkpointId);
      try {
        const payload = await api<{ events?: AppEvent[] }>(
          `/api/sessions/${activeSessionId}/checkpoints/${checkpointId}/restore`,
          { method: "POST" },
        );
        const incoming = payload.events ?? [];
        const accepted = addEvents(incoming);
        if (accepted.length) {
          await refreshFromEvents(accepted);
        } else {
          setRestoredCheckpointId(checkpointId);
          await refreshSessionMessages(activeSessionId);
          await refreshSessionTrust(activeSessionId);
        }
      } catch (err) {
        setError(userFacingErrorMessage(err));
      } finally {
        setRestoringCheckpointId("");
      }
    },
    [activeSessionId, addEvents, api, refreshFromEvents, refreshSessionMessages, refreshSessionTrust],
  );

  const runTerminalCommand = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const command = terminalCommand.trim();
      if (!command) return;
      setTerminalBusy(true);
      setTerminalError("");
      try {
        const payload = await api<TerminalRunResult>("/api/terminal/run", {
          method: "POST",
          body: JSON.stringify({ command }),
        });
        setTerminalResult(payload);
      } catch (err) {
        setTerminalError(userFacingErrorMessage(err));
      } finally {
        setTerminalBusy(false);
      }
    },
    [api, terminalCommand],
  );

  const attachOpenAgentContext = useCallback(async () => {
    setAttachmentMenuOpen(false);
    setAttachmentError("");
    const activeSession = sessions.find((session) => sessionId(session) === activeSessionId);
    try {
      const [freshFileTree, freshGitStatus, freshSessionDiff, freshMcp] = await Promise.all([
        api<FilesPayload>("/api/files?depth=2").catch(() => null),
        api<GitPayload>("/api/git").catch(() => null),
        activeSessionId ? api<SessionDiff>(`/api/sessions/${activeSessionId}/diff`).catch(() => null) : Promise.resolve(null),
        api<McpPayload>("/api/mcp?refresh=true").catch(() => null),
      ]);
      if (freshFileTree) setFileTree(freshFileTree);
      if (freshGitStatus) setGitStatus(freshGitStatus);
      if (freshSessionDiff) setSessionDiff(freshSessionDiff);
      if (freshMcp) setMcp(freshMcp);
      const attachment = openAgentContextAttachment({
        projectPath: selectedProjectPath,
        session: activeSession,
        fileTree: freshFileTree ?? fileTree,
        gitStatus: freshGitStatus ?? gitStatus,
        sessionDiff: freshSessionDiff ?? sessionDiff,
        mcp: freshMcp ?? mcp,
      });
      setComposerAttachments((current) => {
        const withoutContext = current.filter((item) => item.id !== attachment.id && item.path !== attachment.path);
        return [attachment, ...withoutContext].slice(0, 12);
      });
    } catch (err) {
      setAttachmentError(userFacingErrorMessage(err));
    }
  }, [activeSessionId, api, fileTree, gitStatus, mcp, selectedProjectPath, sessionDiff, sessions]);

  const chooseComposerAttachments = useCallback(async (command: "choose_attachment_files" | "choose_attachment_folders") => {
    setAttachmentMenuOpen(false);
    setAttachmentError("");
    if (!isTauriRuntime()) {
      setAttachmentError("文件附件只能在 Desktop App 中使用。");
      return;
    }
    try {
      const selected = await invoke<Partial<ComposerAttachment>[]>(command);
      if (!selected.length) return;
      const normalized = selected.map(normalizeComposerAttachment);
      const failed = normalized.filter((item) => item.error);
      const accepted = normalized.filter((item) => !item.error);
      if (failed.length) {
        setAttachmentError(failed.map((item) => `${item.name}: ${item.error}`).join("\n"));
      }
      if (!accepted.length) return;
      setComposerAttachments((current) => {
        const byPath = new Map(current.map((item) => [item.path || item.id, item]));
        for (const item of accepted) {
          byPath.set(item.path || item.id, item);
        }
        return Array.from(byPath.values()).slice(0, 12);
      });
    } catch (err) {
      setAttachmentError(userFacingErrorMessage(err));
    }
  }, []);

  const removeComposerAttachment = useCallback((id: string) => {
    setComposerAttachments((current) => current.filter((item) => item.id !== id));
    setAttachmentError("");
  }, []);

  const submitPrompt = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (bridgeSwitchInProgress) {
        setError("Bridge is switching to the selected project. Try again in a moment.");
        return;
      }
      const text = prompt.trim();
      if (!text) return;
      setError("");
      setStreamState("running");
      try {
        type TurnSubmitPayload = {
          events?: AppEvent[];
          status?: string;
          turn_id?: string;
          queued?: boolean;
          queue_position?: number;
          queue_reason?: string;
          scheduler?: TurnSchedulerSummary;
        };
        const startTurn = (session: string) =>
          api<TurnSubmitPayload>(`/api/sessions/${session}/turns`, {
            method: "POST",
            body: JSON.stringify({
              input: text,
              model: model || undefined,
              attachments: composerAttachments.map(attachmentPayload),
              ...permissionPayloadForMode(permission),
              stream: true,
              async: true,
            }),
          });
        const acceptTurnPayload = async (session: string, payload: TurnSubmitPayload) => {
          const incoming = payload.events ?? [];
          const hasStreamedDeltas = incoming.some((event) => event.method === "item/agentMessage/delta");
          if (payload.turn_id) {
            setActiveTurnId(payload.turn_id);
            setTurnJobs((current) =>
              upsertTurnJob(current, {
                session_id: session,
                turn_id: payload.turn_id,
                status: payload.status ?? (payload.queued ? "queued" : "running"),
                queue_position: payload.queue_position,
                queue_reason: payload.queue_reason,
                started_at_ms: Date.now(),
                updated_at_ms: Date.now(),
              }),
            );
          }
          const accepted = addEvents(incoming);
          setStreamState(streamStateAfterEvents(accepted.length ? accepted : incoming, turnSubmitState(payload.status, payload.queued)));
          setPrompt("");
          setComposerAttachments([]);
          setAttachmentMenuOpen(false);
          setAttachmentError("");
          if (hasStreamedDeltas) {
            await nextPaint();
            await sleepMs(320);
          }
          window.setTimeout(() => {
            refresh().catch((err: unknown) => {
              if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
            });
            refreshTurnJobs().catch((err: unknown) => {
              if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
            });
            refreshSessionMessages(session).catch((err: unknown) => {
              if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
            });
            refreshSessionTrust(session).catch((err: unknown) => {
              if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
            });
          }, 250);
        };
        let session = activeSessionId || (await createSession());
        try {
          await acceptTurnPayload(session, await startTurn(session));
        } catch (err) {
          if (!isMissingSessionError(err)) throw err;
          clearMissingSession(session);
          session = await createSession();
          await acceptTurnPayload(session, await startTurn(session));
        }
      } catch (err) {
        if (err instanceof ApiError && err.body?.error_code === "turn_queue_full") {
          setStreamState("idle");
          setError(queueFullMessage(err.body));
          await refreshTurnJobs().catch(() => undefined);
        } else {
          setStreamState("failed");
          setError(userFacingErrorMessage(err));
        }
      }
    },
    [
      activeSessionId,
      addEvents,
      api,
      bridgeSwitchInProgress,
      clearMissingSession,
      composerAttachments,
      createSession,
      model,
      permission,
      prompt,
      refresh,
      refreshSessionMessages,
      refreshSessionTrust,
      refreshTurnJobs,
    ],
  );

  const interruptTurn = useCallback(async (turnId: string) => {
    if (!turnId || interruptingTurnId) return;
    setError("");
    setInterruptingTurnId(turnId);
    setTurnJobs((current) =>
      upsertTurnJob(current, {
        turn_id: turnId,
        status: "interrupting",
        cancel_requested: true,
        cancel_requested_at_ms: Date.now(),
        updated_at_ms: Date.now(),
      }),
    );
    try {
      const payload = await api<{ events?: AppEvent[]; status?: string; job?: TurnJobSummary }>(`/api/turns/${turnId}/interrupt`, {
        method: "POST",
      });
      const incoming = payload.events ?? [];
      const accepted = addEvents(incoming);
      setStreamState(streamStateAfterEvents(accepted.length ? accepted : incoming, payload.status ?? "interrupted"));
      if (accepted.length) await refreshFromEvents(accepted);
      setTurnJobs((current) =>
        upsertTurnJob(current, {
          ...(payload.job ?? {}),
          turn_id: turnId,
          status: payload.status ?? payload.job?.status ?? "interrupted",
          cancel_requested: true,
          updated_at_ms: Date.now(),
        }),
      );
      if (turnId === activeTurnId) setActiveTurnId("");
      await refreshTurnJobs();
    } catch (err) {
      setError(userFacingErrorMessage(err));
    } finally {
      setInterruptingTurnId("");
    }
  }, [activeTurnId, addEvents, api, interruptingTurnId, refreshFromEvents, refreshTurnJobs]);

  const interruptActiveTurn = useCallback(async () => {
    await interruptTurn(activeTurnId);
  }, [activeTurnId, interruptTurn]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_BRIDGE, bridgeUrl);
  }, [bridgeUrl]);

  useEffect(() => {
    const value = normalizeProjectPath(coreRoot);
    if (value) {
      window.localStorage.setItem(STORAGE_CORE_ROOT, value);
    } else {
      window.localStorage.removeItem(STORAGE_CORE_ROOT);
    }
  }, [coreRoot]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_TOKEN, token);
  }, [token]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (activeProjectPath) {
      window.localStorage.setItem(STORAGE_ACTIVE_PROJECT, activeProjectPath);
    }
  }, [activeProjectPath]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_PERMISSION_MODE, normalizePermissionMode(permission));
  }, [permission]);

  useEffect(() => {
    if (!bridgeApiReady) return;
    refreshSessionMessages(activeSessionId).catch((err: unknown) => {
      if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
    });
  }, [activeSessionId, bridgeApiReady, refreshSessionMessages]);

  useEffect(() => {
    if (!bridgeApiReady) return;
    refreshSessionTrust(activeSessionId).catch((err: unknown) => {
      if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
    });
  }, [activeSessionId, bridgeApiReady, refreshSessionTrust]);

  useEffect(() => {
    if (!bridgeApiReady) return;
    const key = `${bridgeUrl}\n${token}\n${selectedProjectPath}\n${selectedCoreRoot}`;
    if (refreshEffectKey.current === key) return;
    refreshEffectKey.current = key;
    refresh().catch((err: unknown) => {
      setConnection("offline");
      if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
    });
  }, [bridgeApiReady, bridgeUrl, refresh, selectedCoreRoot, selectedProjectPath, token]);

  useEffect(() => {
    if (!bridgeApiReady) return;
    let cancelled = false;
    let controller: AbortController | null = null;

    async function readLoop() {
      while (!cancelled) {
        controller = new AbortController();
        const resumeCursor = lastGlobalId.current;
        setStreamHealth((current) => ({
          ...current,
          status: streamReconnectAttempts.current > 0 ? "reconnecting" : "polling",
          resume_cursor: resumeCursor,
        }));
        try {
          const headers = new Headers({ accept: "text/event-stream" });
          if (token.trim()) headers.set("authorization", `Bearer ${token.trim()}`);
          const response = await fetch(
            `${bridgeUrl.replace(/\/$/, "")}/api/events?last_event_id=${resumeCursor}&live_timeout_ms=300000`,
            { headers, signal: controller.signal },
          );
          if (!response.ok) throw new Error(`events ${response.status}`);
          const parsed = await readSse(response, async (incoming) => {
            if (cancelled) return;
            const accepted = addEvents(incoming);
            if (!accepted.length) return;
            setStreamState((current) => streamStateAfterEvents(accepted, current));
            setStreamHealth((current) => ({
              ...current,
              status: "receiving",
              resume_cursor: lastGlobalId.current,
              last_batch_count: accepted.length,
            }));
            await refreshFromEventsRef.current(accepted);
          });
          const recovered = streamReconnectAttempts.current > 0;
          streamReconnectAttempts.current = 0;
          setConnection("online");
          setStreamHealth((current) => ({
            ...current,
            status: recovered ? "resumed" : "listening",
            resume_cursor: lastGlobalId.current,
            reconnect_attempts: 0,
            recovered_count: current.recovered_count + (recovered ? 1 : 0),
            last_batch_count: parsed.length,
            last_error: undefined,
            last_connected_at_ms: Date.now(),
            next_retry_ms: undefined,
          }));
        } catch (err) {
          if (!cancelled) {
            streamReconnectAttempts.current += 1;
            const attempts = streamReconnectAttempts.current;
            const retryMs = retryDelayMs(attempts);
            setConnection("offline");
            setStreamHealth((current) => ({
              ...current,
              status: "reconnecting",
              resume_cursor: lastGlobalId.current,
              reconnect_attempts: attempts,
              last_error: userFacingErrorMessage(err),
              next_retry_ms: retryMs,
            }));
            await new Promise((resolve) => window.setTimeout(resolve, retryMs));
          }
        }
      }
    }

    readLoop();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [addEvents, bridgeApiReady, bridgeUrl, token]);

  const activeEvents = useMemo(() => {
    if (!activeSessionId) return [];
    return events.filter((event) => eventSessionId(event) === activeSessionId);
  }, [activeSessionId, events]);
  const eventActiveTurnId = useMemo(() => activeTurnIdFromEvents(activeEvents), [activeEvents]);
  useEffect(() => {
    if (!activeEvents.length) return;
    setActiveTurnId((current) => (current === eventActiveTurnId ? current : eventActiveTurnId));
    if (!eventActiveTurnId) setInterruptingTurnId("");
  }, [activeEvents.length, eventActiveTurnId]);
  const rawStreamingDraft = useMemo(() => activeStreamingDraftFromEvents(activeEvents), [activeEvents]);
  const activeMessages =
    activeSessionId && sessionMessages?.session_id === activeSessionId ? sessionMessages.messages_v2 ?? [] : [];
  const activeStreamingDraft = useMemo(() => {
    if (!rawStreamingDraft) return null;
    if (rawStreamingDraft.completed) return null;
    if (hasPersistedAssistantForTurn(activeMessages, rawStreamingDraft.turnId)) {
      return null;
    }
    return rawStreamingDraft;
  }, [activeMessages, rawStreamingDraft]);
  const liveFinalAnswer = useMemo(() => {
    if (activeStreamingDraft) return null;
    const finalAnswer = liveFinalAnswerFromEvents(activeEvents);
    if (finalAnswer && !hasPersistedAssistantForTurn(activeMessages, finalAnswer.turnId)) return finalAnswer;
    if (
      rawStreamingDraft?.completed &&
      rawStreamingDraft.terminalMethod === "turn/completed" &&
      rawStreamingDraft.text.trim() &&
      !hasPersistedAssistantForTurn(activeMessages, rawStreamingDraft.turnId)
    ) {
      return {
        turnId: rawStreamingDraft.turnId,
        text: rawStreamingDraft.text,
      };
    }
    return null;
  }, [activeEvents, activeMessages, activeStreamingDraft, rawStreamingDraft]);
  const latestTerminalErrorTurnId = useMemo(() => latestTerminalErrorTurnIdFromEvents(activeEvents), [activeEvents]);
  const retryableTurnFailure = useMemo(() => latestRetryableTurnFailure(activeEvents), [activeEvents]);
  const visibleLiveTurnId =
    eventActiveTurnId || activeTurnId || liveFinalAnswer?.turnId || rawStreamingDraft?.turnId || latestTerminalErrorTurnId || "";
  const visibleLiveEvents = useMemo(() => {
    if (!visibleLiveTurnId) return [];
    return activeEvents
      .filter((event) => {
        if (!isVisibleProcessEvent(event)) return false;
        const turnId = eventTurnId(event);
        return !turnId || turnId === visibleLiveTurnId;
      })
      .slice(-10);
  }, [activeEvents, visibleLiveTurnId]);
  const retryFailedTurn = useCallback(async () => {
    const failed = retryableTurnFailure;
    if (!failed || retryingTurnId) return;
    setRetryingTurnId(failed.turnId);
    setError("");
    setStreamState("retrying");
    try {
      const payload = await api<{
        events?: AppEvent[];
        status?: string;
        turn_id?: string;
        queued?: boolean;
        queue_position?: number;
        queue_reason?: string;
      }>(`/api/turns/${failed.turnId}/retry`, { method: "POST" });
      const incoming = payload.events ?? [];
      const accepted = addEvents(incoming);
      if (payload.turn_id) {
        setActiveTurnId(payload.turn_id);
        setTurnJobs((current) =>
          upsertTurnJob(current, {
            session_id: activeSessionId,
            turn_id: payload.turn_id,
            status: payload.status ?? (payload.queued ? "queued" : "running"),
            queue_position: payload.queue_position,
            queue_reason: payload.queue_reason,
            started_at_ms: Date.now(),
            updated_at_ms: Date.now(),
          }),
        );
      }
      setStreamState(
        streamStateAfterEvents(
          accepted.length ? accepted : incoming,
          turnSubmitState(payload.status, payload.queued),
        ),
      );
      window.setTimeout(() => {
        refreshTurnJobs().catch(() => undefined);
        if (activeSessionId) refreshSessionMessages(activeSessionId).catch(() => undefined);
      }, 250);
    } catch (err) {
      setStreamState("failed");
      setError(userFacingErrorMessage(err));
    } finally {
      setRetryingTurnId("");
    }
  }, [activeSessionId, addEvents, api, refreshSessionMessages, refreshTurnJobs, retryableTurnFailure, retryingTurnId]);
  const timelineMessageItems = useMemo(
    () => activeMessages.map((message, index) => ({ message, index })),
    [activeMessages],
  );
  const deferredAssistantMessages = useMemo(
    () =>
      timelineMessageItems.filter(({ message }) =>
        shouldDeferAssistantMessageAfterLiveEvents(message, visibleLiveTurnId, visibleLiveEvents.length > 0),
      ),
    [timelineMessageItems, visibleLiveEvents.length, visibleLiveTurnId],
  );
  const inlineTimelineMessages = useMemo(() => {
    if (!deferredAssistantMessages.length) return timelineMessageItems;
    const deferred = new Set(deferredAssistantMessages.map(({ index }) => index));
    return timelineMessageItems.filter(({ index }) => !deferred.has(index));
  }, [deferredAssistantMessages, timelineMessageItems]);
  const activeResolvedInteractionKeys = useMemo(() => resolvedInteractionKeys(activeMessages), [activeMessages]);
  const trustHistory = useMemo(() => trustHistoryFromMessages(activeMessages), [activeMessages]);
  const modelOptions = useMemo(
    () =>
      (provider?.models?.map((item) => item.id).filter(Boolean) as string[] | undefined)?.filter(
        (item) => !item.toLowerCase().includes("mini"),
      ),
    [provider?.models],
  );
  const providerDraftModelOptions = useMemo(() => {
    const preset = providerPreset(providerDraft.profile);
    return Array.from(
      new Set([providerDraft.model, model, ...preset.models, ...(modelOptions ?? [])].filter(Boolean)),
    );
  }, [model, modelOptions, providerDraft.model, providerDraft.profile]);
  const mcpServers = mcp?.servers ?? [];
  const mcpToolTraces = useMemo(() => mcpToolTracesFromMessages(activeMessages), [activeMessages]);
  const latestMcpToolTrace = mcpToolTraces[mcpToolTraces.length - 1];
  const mcpStatus = mcp?.status ?? (mcp?.configured ? "idle" : "unconfigured");
  const mcpStatusClass = mcp?.error ? "bad" : mcp?.enabled ? "ok" : mcp?.configured ? "neutral" : "missing";
  const mcpWritable = Boolean(mcp?.writable);
  const mcpConfigPath = mcp?.config_path ?? "";
  const mcpEditing = Boolean(mcpEditingServerName);
  const workspaceStyle = useMemo(
    () => ({ "--composer-dock-height": `${Math.ceil(composerDockHeight)}px` }) as CSSProperties,
    [composerDockHeight],
  );
  useEffect(() => {
    const dock = composerDockRef.current;
    if (!dock) return;
    const measure = () => {
      setComposerDockHeight((current) => {
        const next = Math.ceil(dock.getBoundingClientRect().height);
        return next > 0 && Math.abs(current - next) > 1 ? next : current;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    if (activeStreamingDraft) {
      const draft = streamingDraftRef.current;
      if (!draft || streamingDraftAnchoredTurnRef.current === activeStreamingDraft.turnId) return;
      streamingDraftAnchoredTurnRef.current = activeStreamingDraft.turnId;
      if (timelineAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineAutoScrollFrameRef.current);
      }
      timelineAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
        timeline.scrollTop = Math.max(0, draft.offsetTop - 18);
        timelineAutoScrollFrameRef.current = null;
      });
      return () => {
        if (timelineAutoScrollFrameRef.current !== null) {
          window.cancelAnimationFrame(timelineAutoScrollFrameRef.current);
          timelineAutoScrollFrameRef.current = null;
        }
      };
    }
    streamingDraftAnchoredTurnRef.current = "";
    const shouldStickToBottom =
      streamState !== "idle" ||
      Boolean(liveFinalAnswer) ||
      visibleLiveEvents.length > 0;
    if (!shouldStickToBottom) return;
    if (timelineAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(timelineAutoScrollFrameRef.current);
    }
    timelineAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
      timelineAutoScrollFrameRef.current = null;
    });
    return () => {
      if (timelineAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineAutoScrollFrameRef.current);
        timelineAutoScrollFrameRef.current = null;
      }
    };
  }, [
    activeMessages.length,
    activeStreamingDraft?.text,
    deferredAssistantMessages.length,
    inlineTimelineMessages.length,
    liveFinalAnswer?.text,
    streamState,
    visibleLiveEvents.length,
  ]);
  const activeSession = sessions.find((session) => sessionId(session) === activeSessionId);
  const checkpointRestoreHistory = useMemo(() => checkpointRestoreHistoryFromSession(activeSession), [activeSession]);
  const restoredCheckpointIdFromActiveSession = restoredCheckpointIdFromSession(activeSession);
  useEffect(() => {
    setRestoredCheckpointId((current) => {
      if (current === restoredCheckpointIdFromActiveSession) return current;
      return restoredCheckpointIdFromActiveSession;
    });
  }, [restoredCheckpointIdFromActiveSession]);
  const sessionsByProjectPath = useMemo(() => {
    const grouped = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      if (isArchivedSession(session)) continue;
      const workspace = normalizeProjectPath(session.workspace);
      if (!workspace) continue;
      const records = grouped.get(workspace) ?? [];
      records.push(session);
      grouped.set(workspace, records);
    }
    for (const records of grouped.values()) {
      records.sort((left, right) => {
        const rightTime = right.updated_at_ms ?? 0;
        const leftTime = left.updated_at_ms ?? 0;
        return rightTime - leftTime;
      });
    }
    return grouped;
  }, [sessions]);
  const archivedSessions = useMemo(() => sessions.filter(isArchivedSession), [sessions]);
  const sessionById = useMemo(() => {
    const records = new Map<string, SessionSummary>();
    for (const session of sessions) {
      const id = sessionId(session);
      if (id) records.set(id, session);
    }
    return records;
  }, [sessions]);
  const visibleTurnJobs = useMemo(() => {
    const jobs = turnJobs.turns ?? [];
    return jobs
      .filter((job) => {
        const jobSessionId = turnJobSessionId(job);
        if (activeSessionId) return jobSessionId === activeSessionId;
        if (!selectedProjectPath) return true;
        const session = sessionById.get(turnJobSessionId(job));
        return !session?.workspace || sameProjectPath(session.workspace, selectedProjectPath);
      })
      .sort((left, right) => {
        const rightTime = right.updated_at_ms ?? right.started_at_ms ?? 0;
        const leftTime = left.updated_at_ms ?? left.started_at_ms ?? 0;
        return rightTime - leftTime;
      });
  }, [activeSessionId, selectedProjectPath, sessionById, turnJobs.turns]);
  const activeTurnJobs = visibleTurnJobs.filter((job) => !isTurnJobTerminal(job));
  const terminalTurnStatusById = useMemo(() => {
    const records = new Map<string, string>();
    for (const job of turnJobs.turns ?? []) {
      const id = turnJobId(job);
      if (id && isTurnJobTerminal(job)) records.set(id, job.status ?? "completed");
    }
    return records;
  }, [turnJobs.turns]);
  const queuedTurnJobs = activeTurnJobs
    .filter(isTurnJobQueued)
    .sort((left, right) => {
      const leftTime = left.started_at_ms ?? left.updated_at_ms ?? 0;
      const rightTime = right.started_at_ms ?? right.updated_at_ms ?? 0;
      return leftTime - rightTime;
    });
  const runningTurnJobs = activeTurnJobs.filter((job) => !isTurnJobQueued(job));
  const selectedTurnJob =
    visibleTurnJobs.find((job) => turnJobId(job) === selectedTurnJobId) ??
    runningTurnJobs[0] ??
    queuedTurnJobs[0] ??
    visibleTurnJobs[0];
  const selectedTurnJobIdResolved = turnJobId(selectedTurnJob ?? {});
  const selectedTurnJobSession = selectedTurnJob ? sessionById.get(turnJobSessionId(selectedTurnJob)) : undefined;
  const selectedTurnJobEvents = selectedTurnJobIdResolved
    ? events.filter((event) => eventTurnId(event) === selectedTurnJobIdResolved).slice(-8).reverse()
    : [];
  const scheduler = turnJobs.scheduler ?? {};
  const runningWorkerCount = scheduler.running_turn_workers ?? turnJobs.running_count ?? runningTurnJobs.length;
  const maxRunningWorkers = scheduler.max_running_turn_workers;
  const maxQueuedPerSession = scheduler.max_queued_turns_per_session;
  const persistedQueuedCount = queuedTurnJobs.filter((job) => job.payload_persisted).length;
  const globalQuotaQueuedCount = queuedTurnJobs.filter((job) => job.queue_reason === "global_worker_quota").length;
  const recoveredQueuedCount = queuedTurnJobs.filter((job) => job.queue_reason === "recovered").length;
  const expiredTurnCount = scheduler.expired_queued_turns ?? visibleTurnJobs.filter((job) => job.status === "expired").length;
  const queueTimeoutLabel = schedulerDuration(scheduler.turn_queue_timeout_ms);
  const leaseStaleLabel = schedulerDuration(scheduler.turn_queue_lease_stale_ms);
  const activeProjectLabel = activeProject?.name || projectNameFromPath(selectedProjectPath || "Workspace");
  const activeProjectDisplayPath = selectedProjectPath || "No project selected";
  const pendingInteractionCount = approvals.length + questions.length;
  const trustSyncLabel = interactionSync.last_synced_at_ms
    ? `${new Date(interactionSync.last_synced_at_ms).toLocaleTimeString()}${
        interactionSync.last_event_method ? ` · ${methodLabel(interactionSync.last_event_method)}` : ""
      }`
    : "not synced";
  const bridgeManagedLabel = !isTauriRuntime() ? "web preview" : managedBridge?.running ? "running" : "stopped";
  const bridgeManagedClass = !isTauriRuntime() ? "neutral" : managedBridge?.running ? "ok" : "neutral";
  const bridgeAuthLabel = desktopAuth?.token ? (desktopAuth.created ? "created" : "local") : token.trim() ? "manual" : "none";
  const bridgeAuthClass = desktopAuth?.token || token.trim() ? "ok" : "neutral";
  const settingsGroups: Array<{
    title: string;
    items: Array<{ id: SettingsPage; label: string; icon: ReactNode; keywords: string }>;
  }> = [
    {
      title: "个人",
      items: [
        { id: "general", label: "常规", icon: <Settings size={15} />, keywords: "general permission model mode 权限 模型" },
        { id: "profile", label: "个人资料", icon: <Bot size={15} />, keywords: "profile account user 账号" },
        { id: "configuration", label: "配置", icon: <Database size={15} />, keywords: "configuration provider bridge token 配置" },
        { id: "plugins", label: "插件", icon: <PlugZap size={15} />, keywords: "plugins apps tools 插件" },
      ],
    },
    {
      title: "集成",
      items: [
        { id: "mcp", label: "MCP 服务器", icon: <Wrench size={15} />, keywords: "mcp servers tools lifecycle" },
        { id: "computer", label: "电脑操控", icon: <Terminal size={15} />, keywords: "computer control terminal 电脑" },
      ],
    },
    {
      title: "编码",
      items: [
        { id: "connections", label: "连接", icon: <Radio size={15} />, keywords: "connection bridge auth url 连接" },
        { id: "git", label: "Git", icon: <GitBranch size={15} />, keywords: "git diff branch changes" },
        { id: "environment", label: "环境", icon: <Terminal size={15} />, keywords: "environment harness runtime terminal 环境" },
        { id: "worktree", label: "工作树", icon: <Folder size={15} />, keywords: "worktree workspace project 工作树" },
      ],
    },
    {
      title: "已归档",
      items: [
        { id: "archived", label: "已归档对话", icon: <History size={15} />, keywords: "archived sessions history 已归档" },
      ],
    },
  ];
  const settingsSearchText = settingsSearch.trim().toLowerCase();
  const visibleSettingsGroups = settingsSearchText
    ? settingsGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(settingsSearchText)),
        }))
        .filter((group) => group.items.length)
    : settingsGroups;
  const settingsPageLabel =
    settingsGroups.flatMap((group) => group.items).find((item) => item.id === settingsPage)?.label ?? "设置";
  const latestPatch = sessionDiff?.latest ?? null;
  const latestPatchPath = stringField(latestPatch, "path") || "latest patch";
  const latestPatchStatus =
    stringField(latestPatch, "status") ||
    (latestPatch ? `${sessionDiff?.undo_count ?? 0} undo · ${sessionDiff?.redo_count ?? 0} redo` : "");
  const showWorkspaceDock =
    pendingInteractionCount > 0 ||
    Boolean(latestPatch);
  const showComposerContext = false;
  const timelineEmpty =
    activeMessages.length === 0 && visibleLiveEvents.length === 0 && !activeStreamingDraft && !liveFinalAnswer;
  const latestUserActivity = useMemo(() => {
    for (const message of [...activeMessages].reverse()) {
      if (message.info?.role !== "user") continue;
      const text = messageContent(message);
      if (!text.trim()) continue;
      return {
        text,
        created_at_ms: message.info?.created_at_ms,
      };
    }
    return null;
  }, [activeMessages]);
  const latestTurnStartedAtMs = useMemo(() => {
    for (const event of [...activeEvents].reverse()) {
      if (event.method === "turn/started" && event.created_at_ms) return event.created_at_ms;
    }
    return undefined;
  }, [activeEvents]);
  const conversationPhaseLabel =
    streamState === "queued"
      ? "排队中"
      : streamState === "retrying"
        ? "模型重试中"
      : streamState === "running" || streamState === "streaming"
      ? "正在思考"
      : streamState === "waiting_approval"
        ? "等待权限"
        : streamState === "waiting_question"
          ? "等待回答"
          : streamState === "interrupted"
            ? "已中断"
            : streamState === "failed"
              ? "运行失败"
          : activeSessionId
            ? "可以继续发这段"
            : "新任务";
  const isTurnInterruptible =
    Boolean(activeTurnId) &&
    ["queued", "running", "streaming", "retrying", "waiting_approval", "waiting_question"].includes(streamState);
  const interruptBusy = Boolean(interruptingTurnId);
  const canRetryPrompt = Boolean(error && prompt.trim() && !bridgeSwitchInProgress && !interruptBusy);
  const canRetryFailedTurn = Boolean(
    retryableTurnFailure?.retryable &&
      retryableTurnFailure.resumable &&
      !retryingTurnId &&
      !bridgeSwitchInProgress &&
      !interruptBusy,
  );
  const failedTurnMessage = retryableTurnFailure?.message
    ? userFacingErrorMessage(new Error(retryableTurnFailure.message))
    : "";
  const activityStartedAtMs = latestTurnStartedAtMs || latestUserActivity?.created_at_ms || activeSession?.updated_at_ms;
  const activityElapsedLabel = activeSessionId ? formatElapsed(activityStartedAtMs, nowMs) : "";
  const activityTitle = latestUserActivity
    ? streamState === "queued"
      ? "排队中的任务"
      : streamState === "running" || streamState === "streaming"
      ? "进行中的任务"
      : streamState === "waiting_approval" || streamState === "waiting_question"
        ? "等待处理"
        : "最近任务"
    : activeSessionId
      ? "当前会话"
      : "新任务";
  const activityDetailFull = latestUserActivity?.text || activeSession?.title || activeProjectDisplayPath;
  const activityDetail = compactText(activityDetailFull, 148);
  const activityMetaLabel =
    activityElapsedLabel && activeSessionId
      ? `${activityElapsedLabel}${streamState !== "idle" ? ` · ${conversationPhaseLabel}` : ""}`
      : conversationPhaseLabel;

  const managedBridgeStartOptions = useCallback(
    (workspaceOverride = "", coreRootOverride = "") => ({
      workspace: workspaceOverride || selectedProjectPath || activeSession?.workspace || desktopDiagnostics?.workspace_default,
      coreRoot: coreRootOverride || selectedCoreRoot || desktopDiagnostics?.core_root_default,
      sessionRoot: desktopDiagnostics?.session_root_default,
      port: managedBridge?.port || 8787,
      authToken: token.trim() || undefined,
    }),
    [
      activeSession?.workspace,
      desktopDiagnostics?.core_root_default,
      desktopDiagnostics?.session_root_default,
      desktopDiagnostics?.workspace_default,
      managedBridge?.port,
      selectedCoreRoot,
      selectedProjectPath,
      token,
    ],
  );

  const runManagedBridgeCommand = useCallback(
    async (action: "start" | "restart", workspaceOverride = "", coreRootOverride = "") => {
      if (!isTauriRuntime()) return;
      setManagedBridgeBusy(action);
      setManagedBridgeError("");
      try {
        const payload = await invoke<ManagedBridgeStatus>(
          action === "start" ? "bridge_start" : "bridge_restart",
          { options: managedBridgeStartOptions(workspaceOverride, coreRootOverride) },
        );
        setManagedBridge(payload);
        setManagedBridgeError(payload.error ?? "");
        if (payload.url) {
          setBridgeUrl(payload.url);
        }
        window.setTimeout(() => {
          refresh().catch((err: unknown) => {
            if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
          });
        }, 250);
      } catch (err) {
        managedBridgeAutoSyncKey.current = "";
        setManagedBridgeError(userFacingErrorMessage(err));
      } finally {
        setManagedBridgeBusy("");
      }
    },
    [managedBridgeStartOptions, refresh],
  );

  const updateProviderDraft = useCallback((patch: Partial<ProviderDraft>) => {
    setProviderDraft((current) => {
      const nextProfile = patch.profile ?? current.profile;
      if (patch.profile && patch.profile !== current.profile) {
        const preset = providerPreset(nextProfile);
        return {
          profile: nextProfile,
          baseUrl: preset.baseUrl,
          apiKey: current.apiKey,
          model: preset.model,
          wireApi: preset.wireApi,
        };
      }
      return { ...current, ...patch };
    });
    setProviderValidation(null);
    setProviderConfigError("");
  }, []);

  const importProviderEnvText = useCallback(() => {
    setProviderDraft((current) => parseProviderEnvText(providerEnvText, current));
    setProviderValidation(null);
    setProviderConfigError("");
  }, [providerEnvText]);

  const validateProviderDraft = useCallback(async () => {
    if (!isTauriRuntime()) {
      setProviderConfigError("Provider 验证需要在 Tauri 桌面 app 内执行。");
      return;
    }
    setProviderBusy("validate");
    setProviderConfigError("");
    try {
      const payload = await invoke<ProviderValidationResult>("provider_config_validate", {
        request: {
          workspace: selectedProjectPath || undefined,
          coreRoot: selectedCoreRoot || undefined,
          profile: providerDraft.profile,
          baseUrl: providerDraft.baseUrl,
          apiKey: providerDraft.apiKey || undefined,
          model: providerDraft.model,
          wireApi: providerDraft.wireApi,
        },
      });
      setProviderValidation(payload);
    } catch (err) {
      setProviderConfigError(userFacingErrorMessage(err));
    } finally {
      setProviderBusy("");
    }
  }, [providerDraft, selectedCoreRoot, selectedProjectPath]);

  const applyProviderDraft = useCallback(async () => {
    if (!isTauriRuntime()) {
      setProviderConfigError("Provider 配置需要在 Tauri 桌面 app 内保存。");
      return;
    }
    setProviderBusy("apply");
    setProviderConfigError("");
    try {
      const payload = await invoke<ProviderConfigPayload>("provider_config_apply", {
        request: {
          workspace: selectedProjectPath || undefined,
          coreRoot: selectedCoreRoot || undefined,
          profile: providerDraft.profile,
          baseUrl: providerDraft.baseUrl,
          apiKey: providerDraft.apiKey || undefined,
          model: providerDraft.model,
          wireApi: providerDraft.wireApi,
        },
      });
      setProviderConfig(payload);
      setProviderDraft(providerDraftFromPayload(payload));
      setModel(payload.model || providerDraft.model);
      await runManagedBridgeCommand(managedBridge?.running ? "restart" : "start", selectedProjectPath, selectedCoreRoot);
      await loadProviderConfig();
    } catch (err) {
      setProviderConfigError(userFacingErrorMessage(err));
    } finally {
      setProviderBusy("");
    }
  }, [loadProviderConfig, managedBridge?.running, providerDraft, runManagedBridgeCommand, selectedCoreRoot, selectedProjectPath]);

  const refreshManagedBridge = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setManagedBridgeBusy("status");
    try {
      const payload = await invoke<ManagedBridgeStatus>("bridge_status");
      setManagedBridge(payload);
      setManagedBridgeError(payload.error ?? "");
      if (payload.running && payload.url) {
        setBridgeUrl(payload.url);
      }
    } catch (err) {
      setManagedBridgeError(userFacingErrorMessage(err));
    } finally {
      setManagedBridgeBusy("");
    }
  }, []);

  const startManagedBridge = useCallback(async () => {
    await runManagedBridgeCommand("start");
  }, [runManagedBridgeCommand]);

  const restartManagedBridge = useCallback(async () => {
    await runManagedBridgeCommand("restart");
  }, [runManagedBridgeCommand]);

  const stopManagedBridge = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setManagedBridgeBusy("stop");
    setManagedBridgeError("");
    try {
      const payload = await invoke<ManagedBridgeStatus>("bridge_stop");
      setManagedBridge(payload);
      setManagedBridgeError(payload.error ?? "");
      setConnection("offline");
    } catch (err) {
      setManagedBridgeError(userFacingErrorMessage(err));
    } finally {
      setManagedBridgeBusy("");
    }
  }, []);

  const syncManagedBridgeToWorkspace = useCallback(
    (workspace: string) => {
      const target = normalizeProjectPath(workspace);
      if (!isTauriRuntime() || !target || managedBridgeBusyAny) return;
      const coreMatches = !selectedCoreRoot || sameProjectPath(managedBridge?.core_root, selectedCoreRoot);
      if (managedBridge?.running && sameProjectPath(managedBridge.workspace, target) && coreMatches) {
        if (managedBridge.url) setBridgeUrl(managedBridge.url);
        return;
      }
      const action = managedBridge?.running ? "restart" : "start";
      void runManagedBridgeCommand(action, target);
    },
    [managedBridge, managedBridgeBusyAny, runManagedBridgeCommand, selectedCoreRoot],
  );

  useEffect(() => {
    if (!desktopAuthReady || !isTauriRuntime() || managedBridgeBusyAny) return;
    const target = normalizeProjectPath(
      activeProject?.path || activeProjectPath || desktopDiagnostics?.workspace_default || "",
    );
    if (!target) return;

    const coreMatches = !selectedCoreRoot || sameProjectPath(managedBridge?.core_root, selectedCoreRoot);
    if (managedBridge?.running && sameProjectPath(managedBridge.workspace, target) && coreMatches) {
      managedBridgeAutoSyncKey.current = `ready:${target}:${selectedCoreRoot}`;
      if (managedBridge.url) setBridgeUrl(managedBridge.url);
      return;
    }

    const action = managedBridge?.running ? "restart" : "start";
    const source = managedBridge?.running ? normalizeProjectPath(managedBridge.workspace) : "stopped";
    const sourceCore = managedBridge?.running ? normalizeProjectPath(managedBridge.core_root) : "stopped";
    const key = `${action}:${target}:${source}:${selectedCoreRoot}:${sourceCore}`;
    if (managedBridgeAutoSyncKey.current === key) return;
    managedBridgeAutoSyncKey.current = key;
    syncManagedBridgeToWorkspace(target);
  }, [
    activeProject?.path,
    activeProjectPath,
    desktopAuthReady,
    desktopDiagnostics?.workspace_default,
    managedBridge?.running,
    managedBridge?.url,
    managedBridge?.workspace,
    managedBridge?.core_root,
    managedBridgeBusyAny,
    selectedCoreRoot,
    syncManagedBridgeToWorkspace,
  ]);

  const selectProject = useCallback((project: DesktopProject) => {
    clearSessionListErrors();
    const nextProject = { ...project, last_opened_at_ms: Date.now() };
    setProjects((current) => upsertProject(current, nextProject));
    setActiveProjectPath(nextProject.path);
    setProjectPathInput(nextProject.path);
    setProjectError("");
    const stored = storedActiveSession(nextProject.path);
    const restorable = sessions.find(
      (session) => sessionId(session) === stored && !isArchivedSession(session) && sameProjectPath(session.workspace, nextProject.path),
    );
    activateSession(restorable ? stored : "", nextProject.path);
    setFileTree(null);
    setFilePreview(null);
    setGitStatus(null);
    syncManagedBridgeToWorkspace(nextProject.path);
  }, [activateSession, clearSessionListErrors, sessions, syncManagedBridgeToWorkspace]);

  const selectProjectSession = useCallback(
    (project: DesktopProject, session: SessionSummary) => {
      const id = sessionId(session);
      if (!id) return;
      clearSessionListErrors();
      const workspace = normalizeProjectPath(session.workspace || project.path);
      const nextProject = {
        ...project,
        path: workspace || project.path,
        id: workspace || project.id,
        last_opened_at_ms: Date.now(),
      };
      setProjects((current) => upsertProject(current, nextProject));
      setActiveProjectPath(nextProject.path);
      setProjectPathInput(nextProject.path);
      setProjectError("");
      const epoch = activateSession(id, nextProject.path);
      syncManagedBridgeToWorkspace(nextProject.path);
      refreshSessionMessages(id, epoch).catch((err: unknown) => {
        if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
      });
      refreshSessionTrust(id, epoch).catch((err: unknown) => {
        if (!isInitialBridgeFetchError(err)) setError(userFacingErrorMessage(err));
      });
    },
    [activateSession, clearSessionListErrors, refreshSessionMessages, refreshSessionTrust, syncManagedBridgeToWorkspace],
  );

  const createProjectSession = useCallback(
    async (project: DesktopProject) => {
      clearSessionListErrors();
      const nextProject = { ...project, last_opened_at_ms: Date.now() };
      const busyKey = `session:${normalizeProjectPath(nextProject.path)}`;
      setProjectBusy(busyKey);
      setProjectError("");
      setProjects((current) => upsertProject(current, nextProject));
      setActiveProjectPath(nextProject.path);
      setProjectPathInput(nextProject.path);
      activateSession("", nextProject.path);
      setFileTree(null);
      setFilePreview(null);
      setGitStatus(null);
      syncManagedBridgeToWorkspace(nextProject.path);
      try {
        const payload = await api<CreateSessionPayload>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({
            cwd: nextProject.path || undefined,
          }),
        });
        const id = payload.session_id ?? payload.id ?? sessionId(payload.session ?? {});
        const session = createdSessionSummary(payload, nextProject.path);
        if (session) setSessions((current) => upsertSessionSummary(current, session));
        activateSession(id, nextProject.path);
      } catch (err) {
        setProjectError(userFacingErrorMessage(err));
      } finally {
        setProjectBusy("");
      }
    },
    [activateSession, api, clearSessionListErrors, syncManagedBridgeToWorkspace],
  );

  const removeProject = useCallback(
    (project: DesktopProject) => {
      clearSessionListErrors();
      const removedPath = normalizeProjectPath(project.path);
      if (!removedPath) return;
      const remainingProjects = projects.filter((item) => !sameProjectPath(item.path, removedPath));
      const removingActiveProject =
        sameProjectPath(activeProjectPath, removedPath) || sameProjectPath(selectedProjectPath, removedPath);
      const fallbackProject = remainingProjects[0];
      const fallbackPath = fallbackProject?.path ?? "";

      setProjects(remainingProjects);
      setProjectError("");
      if (sameProjectPath(projectPathInput, removedPath)) {
        setProjectPathInput(removingActiveProject ? fallbackPath : activeProjectPath || selectedProjectPath || "");
      }
      if (!removingActiveProject) return;

      setActiveProjectPath(fallbackPath);
      setProjectPathInput(fallbackPath);
      if (!fallbackPath) window.localStorage.removeItem(STORAGE_ACTIVE_PROJECT);
      const stored = storedActiveSession(fallbackPath);
      const restorable = sessions.find(
        (session) => sessionId(session) === stored && !isArchivedSession(session) && sameProjectPath(session.workspace, fallbackPath),
      );
      activateSession(restorable ? stored : "", fallbackPath);
      setFileTree(null);
      setFilePreview(null);
      setGitStatus(null);
      if (fallbackPath) syncManagedBridgeToWorkspace(fallbackPath);
    },
    [
      activeProjectPath,
      activateSession,
      clearSessionListErrors,
      projectPathInput,
      projects,
      sessions,
      selectedProjectPath,
      syncManagedBridgeToWorkspace,
    ],
  );

  const registerProject = useCallback((project: DesktopProject) => {
    clearSessionListErrors();
    setProjects((current) => upsertProject(current, project));
    setActiveProjectPath(project.path);
    setProjectPathInput(project.path);
    activateSession("", project.path);
    setFileTree(null);
    setFilePreview(null);
    setGitStatus(null);
    syncManagedBridgeToWorkspace(project.path);
  }, [activateSession, clearSessionListErrors, syncManagedBridgeToWorkspace]);

  const addProject = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const requested = projectPathInput.trim();
      if (!requested) {
        setProjectError("Project path is required");
        return;
      }

      setProjectBusy("add");
      setProjectError("");
      try {
        let info: ProjectPathInfo | null = null;
        if (isTauriRuntime()) {
          info = await invoke<ProjectPathInfo>("project_path_info", {
            request: { path: requested },
          });
          if (!info.is_dir) {
            setProjectError(info.error || "Project path must be a directory");
            return;
          }
        }
        const project = projectFromPath(info?.canonical || info?.path || requested, info?.name);
        registerProject(project);
      } catch (err) {
        setProjectError(userFacingErrorMessage(err));
      } finally {
        setProjectBusy("");
      }
    },
    [projectPathInput, registerProject],
  );

  const chooseProjectFolder = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setProjectBusy("choose");
    setProjectError("");
    try {
      const info = await invoke<ProjectPathInfo | null>("choose_project_folder");
      if (!info) return;
      if (!info.is_dir) {
        setProjectError(info.error || "Project path must be a directory");
        return;
      }
      registerProject(projectFromPath(info.canonical || info.path || info.input || "", info.name));
    } catch (err) {
      setProjectError(userFacingErrorMessage(err));
    } finally {
      setProjectBusy("");
    }
  }, [registerProject]);

  const applyHarnessRoot = useCallback(
    async (nextValue = coreRootInput) => {
      const requested = normalizeProjectPath(nextValue || desktopDiagnostics?.core_root_default || "");
      if (!requested) {
        setCoreRootError("Harness root is required");
        return;
      }
      try {
        let info: ProjectPathInfo | null = null;
        if (isTauriRuntime()) {
          info = await invoke<ProjectPathInfo>("project_path_info", {
            request: { path: requested },
          });
          if (!info.is_dir) {
            setCoreRootError(info.error || "Harness root must be a directory");
            return;
          }
        }
        const nextRoot = normalizeProjectPath(info?.canonical || info?.path || requested);
        setCoreRoot(nextRoot);
        setCoreRootInput(nextRoot);
        setCoreRootError("");
        managedBridgeAutoSyncKey.current = "";
      } catch (err) {
        setCoreRootError(userFacingErrorMessage(err));
      }
    },
    [coreRootInput, desktopDiagnostics?.core_root_default],
  );

  const chooseHarnessRoot = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setCoreRootError("");
    try {
      const info = await invoke<ProjectPathInfo | null>("choose_project_folder");
      if (!info) return;
      if (!info.is_dir) {
        setCoreRootError(info.error || "Harness root must be a directory");
        return;
      }
      await applyHarnessRoot(info.canonical || info.path || info.input || "");
    } catch (err) {
      setCoreRootError(userFacingErrorMessage(err));
    }
  }, [applyHarnessRoot]);

  const openOverviewPanel = useCallback(() => {
    setInspectorMode("overview");
    setInspectorOpen(true);
  }, []);

  const openReviewPanel = useCallback(() => {
    setInspectorMode("review");
    setInspectorOpen(true);
  }, []);

  const openSettingsPage = useCallback((page: SettingsPage) => {
    setSettingsPage(page);
    setSettingsOpen(true);
    setInspectorOpen(false);
  }, []);

  const handleReviewKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openReviewPanel();
    },
    [openReviewPanel],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        composerComposingRef.current ||
        isImeKeyboardEvent(event) ||
        Date.now() - composerCompositionEndAtRef.current < 120
      ) {
        return;
      }
      event.preventDefault();
      if (bridgeSwitchInProgress || interruptBusy) return;
      if (!prompt.trim()) return;
      event.currentTarget.form?.requestSubmit();
    },
    [bridgeSwitchInProgress, interruptBusy, prompt],
  );

  const renderTimelineMessage = ({ message, index }: TimelineMessageItem) => {
    const role = messageRoleLabel(message);
    const content = messageContent(message);
    const terminalRunStatus = terminalTurnStatusById.get(message.info?.run_id ?? "") ?? "";
    const parts = visibleMessageParts(message, activeResolvedInteractionKeys, terminalRunStatus);
    const attachments = attachmentSummariesFromMessage(message);
    return (
      <article
        className={`event-row message-row role-${role}`}
        key={messageKey(message, index)}
      >
        <div className="event-glyph">{messageIcon(message.info?.role)}</div>
        <div className="event-body">
          <div className="event-heading">
            <strong>{role}</strong>
            <span>{message.info?.status ?? "completed"}</span>
          </div>
          {content ? <TextContent text={content} /> : null}
          {attachments.length ? <AttachmentChips attachments={attachments} /> : null}
          <MessagePartCards parts={parts} />
        </div>
      </article>
    );
  };

  const settingsPageContent = (() => {
    switch (settingsPage) {
      case "general":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>常规</h2>
                <p>设置当前会话使用的模型和默认权限策略。</p>
              </div>
              <label className="settings-row-control">
                <span>
                  <strong>默认模型</strong>
                  <small>{provider?.healthy ? "Provider ready" : "Provider needs attention"}</small>
                </span>
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {(modelOptions?.length ? modelOptions : providerDraftModelOptions).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="settings-section">
              <div className="settings-section-heading compact">
                <h3>权限</h3>
                <p>默认情况下，OpenAgent 如何处理文件和命令权限。</p>
              </div>
              <div className="settings-toggle-list">
                {[
                  ["READONLY", "只读", "只能读取工作区文件，不执行写入操作。"],
                  ["REQUEST_APPROVAL", "请求批准", "风险操作会进入 approval dock。"],
                  ["AUTO_APPROVE", "替我审批", "自动批准检测到的低风险操作。"],
                  ["FULL_ACCESS", "完全访问权限", "可读写文件并运行联网命令，请谨慎使用。"],
                ].map(([value, label, description]) => (
                  <button
                    className={`settings-toggle-row ${permission === value ? "selected" : ""}`}
                    key={value}
                    onClick={() => setPermission(normalizePermissionMode(value))}
                    type="button"
                  >
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <span className={`settings-switch ${permission === value ? "on" : ""}`} />
                  </button>
                ))}
              </div>
            </section>
          </div>
        );

      case "configuration":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>Provider</h2>
                <p>配置 GPT / GLM 的 OpenAI-compatible 接入，并直接验证模型是否可用。</p>
              </div>
              <dl className="settings-definition-grid">
                <dt>Provider</dt>
                <dd>{providerConfig?.profile_label ?? provider?.provider_label ?? provider?.provider ?? "-"}</dd>
                <dt>Status</dt>
                <dd>{providerValidation ? (providerValidation.ok ? "validated" : "needs attention") : provider?.healthy ? "healthy" : "not validated"}</dd>
                <dt>Base URL</dt>
                <dd title={providerConfig?.base_url ?? managedBridge?.provider?.base_url ?? ""}>
                  {providerConfig?.base_url ?? managedBridge?.provider?.base_url ?? "-"}
                </dd>
                <dt>Models</dt>
                <dd>{provider?.model_count ?? "-"}</dd>
                <dt>Current model</dt>
                <dd>{providerConfig?.model ?? provider?.model ?? model ?? "-"}</dd>
                <dt>API key</dt>
                <dd>{providerConfig?.api_key_configured || managedBridge?.provider?.api_key_configured ? "configured" : "-"}</dd>
                <dt>Env file</dt>
                <dd title={providerConfig?.env_file ?? managedBridge?.provider?.env_file ?? desktopDiagnostics?.provider?.env_file ?? ""}>
                  {compactPath(providerConfig?.env_file ?? managedBridge?.provider?.env_file ?? desktopDiagnostics?.provider?.env_file ?? undefined)}
                </dd>
              </dl>
            </section>
            <section className="settings-section">
              <div className="settings-section-heading compact">
                <h3>模型配置</h3>
                <p>保存后会写入本地私有 env 文件，并重启当前 Bridge。</p>
              </div>
              <div className="provider-config-form">
                <label>
                  <span>Provider</span>
                  <select value={providerDraft.profile} onChange={(event) => updateProviderDraft({ profile: event.target.value })}>
                    <option value="gpt">GPT / OpenAI compatible</option>
                    <option value="glm">GLM / OpenAI compatible</option>
                  </select>
                </label>
                <label className="wide">
                  <span>Base URL</span>
                  <input
                    value={providerDraft.baseUrl}
                    onChange={(event) => updateProviderDraft({ baseUrl: event.target.value })}
                    onBlur={() => updateProviderDraft({ baseUrl: normalizeProviderBaseUrl(providerDraft.baseUrl) })}
                    placeholder={providerPreset(providerDraft.profile).baseUrl}
                  />
                </label>
                <label>
                  <span>API Key</span>
                  <input
                    value={providerDraft.apiKey}
                    onChange={(event) => updateProviderDraft({ apiKey: event.target.value })}
                    placeholder={providerConfig?.api_key_configured ? "已配置，留空沿用" : "sk-..."}
                    type="password"
                  />
                </label>
                <label>
                  <span>Wire API</span>
                  <select value={providerDraft.wireApi} onChange={(event) => updateProviderDraft({ wireApi: event.target.value })}>
                    <option value="responses">Responses</option>
                    <option value="chat">Chat Completions</option>
                  </select>
                </label>
                <label>
                  <span>Model</span>
                  <input
                    list="provider-model-options"
                    value={providerDraft.model}
                    onChange={(event) => updateProviderDraft({ model: event.target.value })}
                    placeholder={providerPreset(providerDraft.profile).model}
                  />
                  <datalist id="provider-model-options">
                    {providerDraftModelOptions.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="inline-actions settings-actions">
                <button disabled={providerBusy === "validate"} onClick={validateProviderDraft} type="button">
                  <CheckCircle2 size={15} />
                  {providerBusy === "validate" ? "验证中" : "验证连接"}
                </button>
                <button disabled={providerBusy === "apply" || managedBridgeBusyAny} onClick={applyProviderDraft} type="button">
                  <RefreshCw size={15} />
                  {providerBusy === "apply" ? "应用中" : "应用并重启"}
                </button>
                <button disabled={providerBusy !== ""} onClick={loadProviderConfig} type="button">
                  <RotateCcw size={15} />
                  重新读取
                </button>
              </div>
              {providerConfigError ? <p className="diagnostic-warning">{providerConfigError}</p> : null}
              {providerValidation ? (
                <div className={`provider-validation ${providerValidation.ok ? "ok" : "bad"}`}>
                  <strong>{providerValidation.ok ? "验证通过" : "验证未通过"}</strong>
                  <span>{providerValidation.message}</span>
                  <small>
                    /models {providerValidation.models_status ?? "-"} · response {providerValidation.response_status ?? "-"} ·{" "}
                    {providerValidation.model_count ?? "-"} models
                  </small>
                  {providerValidation.sample ? <code>{providerValidation.sample}</code> : null}
                </div>
              ) : null}
            </section>
            <section className="settings-section">
              <div className="settings-section-heading compact">
                <h3>Env 形式</h3>
                <p>支持粘贴 JSON env 或 KEY=value；保存时会转换成 Runtime 使用的 OpenAI-compatible 变量。</p>
              </div>
              <textarea
                className="provider-env-import"
                value={providerEnvText}
                onChange={(event) => setProviderEnvText(event.target.value)}
                placeholder={'{\n  "env": {\n    "OPENAI_BASE_URL": "http://host/v1",\n    "OPENAI_API_KEY": "sk-...",\n    "OPENAI_MODEL": "gpt-5.5"\n  }\n}'}
              />
              <div className="inline-actions settings-actions">
                <button disabled={!providerEnvText.trim()} onClick={importProviderEnvText} type="button">
                  <FileText size={15} />
                  从 env 填入表单
                </button>
              </div>
              <div className="provider-env-preview">
                {(providerConfig?.env_preview ?? []).map((item) => (
                  <div key={item.key}>
                    <span>{item.key}</span>
                    <code>{item.value || (item.secret ? "未配置" : "-")}</code>
                  </div>
                ))}
              </div>
            </section>
          </div>
        );

      case "connections":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>连接</h2>
                <p>配置 Desktop 与本地 Bridge API 的连接。</p>
              </div>
              <label className="field-stack">
                <span>Bridge URL</span>
                <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} />
              </label>
              <label className="field-stack">
                <span>Token</span>
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={isTauriRuntime() ? "managed local token" : "optional"}
                  type="password"
                />
              </label>
              <dl className="settings-definition-grid">
                <dt>Auth</dt>
                <dd>
                  <span className={`stream-state ${bridgeAuthClass}`}>{bridgeAuthLabel}</span>
                </dd>
                <dt>Connection</dt>
                <dd>{connection}</dd>
                <dt>Default URL</dt>
                <dd>{desktopDiagnostics?.bridge_default_url ?? DEFAULT_BRIDGE}</dd>
              </dl>
            </section>
          </div>
        );

      case "environment":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>环境</h2>
                <p>选择背后的 harness 工程，管理 Bridge 生命周期。</p>
              </div>
              <label className="field-stack">
                <span>Harness root</span>
                <div className="path-control">
                  <input
                    value={coreRootInput}
                    onChange={(event) => setCoreRootInput(event.target.value)}
                    placeholder={desktopDiagnostics?.core_root_default ?? "/path/to/openharness"}
                  />
                  <button
                    type="button"
                    disabled={!isTauriRuntime() || managedBridgeBusyAny}
                    onClick={chooseHarnessRoot}
                    title="Choose harness root"
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={!coreRootInput.trim() || managedBridgeBusyAny}
                    onClick={() => void applyHarnessRoot()}
                    title="Apply harness root"
                  >
                    Apply
                  </button>
                </div>
              </label>
              <dl className="settings-definition-grid">
                <dt>Runtime</dt>
                <dd>{desktopRuntime}</dd>
                <dt>Platform</dt>
                <dd>{desktopDiagnostics ? `${desktopDiagnostics.os ?? "-"} / ${desktopDiagnostics.arch ?? "-"}` : "-"}</dd>
                <dt>Harness</dt>
                <dd title={managedBridge?.core_root ?? selectedCoreRoot}>{compactPath(managedBridge?.core_root ?? selectedCoreRoot)}</dd>
                <dt>Binary</dt>
                <dd title={desktopDiagnostics?.bridge_binary?.path ?? ""}>{compactPath(desktopDiagnostics?.bridge_binary?.path)}</dd>
                <dt>Sessions</dt>
                <dd title={desktopDiagnostics?.session_root_default ?? ""}>{compactPath(desktopDiagnostics?.session_root_default)}</dd>
                <dt>PID</dt>
                <dd>{managedBridge?.pid ?? "-"}</dd>
                <dt>Workspace</dt>
                <dd title={managedBridge?.workspace ?? desktopDiagnostics?.workspace_default ?? ""}>
                  {compactPath(managedBridge?.workspace ?? desktopDiagnostics?.workspace_default)}
                </dd>
              </dl>
              <div className="inline-actions bridge-actions settings-actions">
                <button type="button" disabled={!isTauriRuntime() || managedBridgeBusyAny || managedBridge?.running} onClick={startManagedBridge}>
                  <Power size={13} />
                  {managedBridgeBusy === "start" ? "Starting" : "Start"}
                </button>
                <button type="button" disabled={!isTauriRuntime() || managedBridgeBusyAny || !managedBridge?.running} onClick={restartManagedBridge}>
                  <RotateCcw size={13} />
                  {managedBridgeBusy === "restart" ? "Restarting" : "Restart"}
                </button>
                <button type="button" disabled={!isTauriRuntime() || managedBridgeBusyAny || !managedBridge?.running} onClick={stopManagedBridge}>
                  <Square size={13} />
                  {managedBridgeBusy === "stop" ? "Stopping" : "Stop"}
                </button>
                <button type="button" disabled={!isTauriRuntime() || managedBridgeBusyAny} onClick={refreshManagedBridge}>
                  <RefreshCw size={13} />
                  {managedBridgeBusy === "status" ? "Checking" : "Status"}
                </button>
              </div>
              {coreRootError ? <p className="diagnostic-warning">{coreRootError}</p> : null}
              {managedBridgeError ? <p className="diagnostic-warning">{managedBridgeError}</p> : null}
            </section>
          </div>
        );

      case "mcp":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>MCP 服务器</h2>
                <p>管理 MCP server、lifecycle 和工具发现状态。</p>
              </div>
              <dl className="settings-definition-grid">
                <dt>Status</dt>
                <dd>
                  <span className={`stream-state ${mcpStatusClass}`}>{mcpStatus}</span>
                </dd>
                <dt>Source</dt>
                <dd>{mcp?.source ?? "none"}</dd>
                <dt>Servers</dt>
                <dd>{mcp?.server_count ?? 0}</dd>
                <dt>Tools</dt>
                <dd>{mcp?.tool_count ?? 0}</dd>
                <dt>Config</dt>
                <dd title={mcpConfigPath}>{mcpConfigPath ? compactText(mcpConfigPath, 54) : "-"}</dd>
              </dl>
              <div className="inline-actions settings-actions">
                <button
                  type="button"
                  disabled={mcpRefreshing}
                  onClick={() => {
                    refreshMcp().catch(() => {});
                  }}
                >
                  <RefreshCw size={13} className={mcpRefreshing ? "spin" : ""} />
                  Refresh
                </button>
              </div>
              {mcp?.error ? <p className="stream-error">{userFacingErrorMessage(new Error(mcp.error))}</p> : null}
              <form className="mcp-config-form" data-testid="mcp-server-form" onSubmit={submitMcpServer}>
                {mcpEditing ? (
                  <div className="mcp-edit-banner" data-testid="mcp-edit-banner">
                    <span>Editing {mcpEditingServerName}</span>
                    <button type="button" onClick={cancelMcpEdit} disabled={Boolean(mcpMutationBusy)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                <label>
                  <span>Mode</span>
                  <select
                    value={mcpServerDraft.mode}
                    disabled={!mcpWritable || Boolean(mcpMutationBusy) || mcpEditing}
                    onChange={(event) =>
                      setMcpServerDraft((draft) => ({ ...draft, mode: event.target.value === "local" ? "local" : "remote" }))
                    }
                  >
                    <option value="remote">Remote HTTP/SSE</option>
                    <option value="local">Local stdio</option>
                  </select>
                </label>
                <label>
                  <span>Name</span>
                  <input
                    value={mcpServerDraft.name}
                    disabled={!mcpWritable || Boolean(mcpMutationBusy) || mcpEditing}
                    onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, name: event.target.value }))}
                    placeholder={mcpServerDraft.mode === "local" ? "local-tools" : "remote-tools"}
                  />
                </label>
                {mcpServerDraft.mode === "remote" ? (
                  <>
                    <label className="full">
                      <span>URL</span>
                      <input
                        value={mcpServerDraft.url}
                        disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                        onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, url: event.target.value }))}
                        placeholder={mcpEditing ? "leave blank to keep current remote URL" : "http://127.0.0.1:3000/mcp"}
                      />
                    </label>
                    <label>
                      <span>Transport</span>
                      <select
                        value={mcpServerDraft.transport}
                        disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                        onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, transport: event.target.value }))}
                      >
                        <option value="http">HTTP</option>
                        <option value="sse">SSE</option>
                        <option value="auto">Auto</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="full">
                      <span>Command</span>
                      <input
                        value={mcpServerDraft.command}
                        disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                        onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, command: event.target.value }))}
                        placeholder={mcpEditing ? "leave blank to keep current command" : "npx"}
                      />
                    </label>
                    <label className="full">
                      <span>Args</span>
                      <textarea
                        rows={2}
                        value={mcpServerDraft.args}
                        disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                        onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, args: event.target.value }))}
                        placeholder={mcpEditing ? "only used when replacing command" : "@modelcontextprotocol/server-filesystem\n/Users/william/project"}
                      />
                    </label>
                    <label className="full">
                      <span>Cwd</span>
                      <input
                        value={mcpServerDraft.cwd}
                        disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                        onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, cwd: event.target.value }))}
                        placeholder={mcpEditing ? "leave blank to keep current cwd" : "optional working directory"}
                      />
                    </label>
                  </>
                )}
                <label>
                  <span>Timeout ms</span>
                  <input
                    value={mcpServerDraft.timeoutMs}
                    disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                    inputMode="numeric"
                    onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, timeoutMs: event.target.value }))}
                    placeholder="5000"
                  />
                </label>
                <label className="full">
                  <span>Env</span>
                  <textarea
                    rows={2}
                    value={mcpServerDraft.env}
                    disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                    onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, env: event.target.value }))}
                    placeholder={mcpEditing ? "leave blank to keep current env" : "API_KEY=..."}
                  />
                </label>
                <label className="full">
                  <span>Headers</span>
                  <textarea
                    rows={2}
                    value={mcpServerDraft.headers}
                    disabled={!mcpWritable || Boolean(mcpMutationBusy)}
                    onChange={(event) => setMcpServerDraft((draft) => ({ ...draft, headers: event.target.value }))}
                    placeholder={mcpEditing ? "leave blank to keep current headers" : "Authorization: Bearer ..."}
                  />
                </label>
                <button
                  className="mcp-action-button"
                  type="submit"
                  disabled={
                    !mcpWritable ||
                    Boolean(mcpMutationBusy) ||
                    !mcpServerDraft.name.trim() ||
                    (!mcpEditing && (mcpServerDraft.mode === "remote" ? !mcpServerDraft.url.trim() : !mcpServerDraft.command.trim()))
                  }
                  title={mcpWritable ? (mcpEditing ? "Save MCP server" : "Add MCP server") : "MCP config is read-only"}
                >
                  {mcpEditing ? <PencilLine size={13} /> : <Plus size={13} />}
                  {mcpEditing ? "Save" : "Add"}
                </button>
              </form>
              {mcp?.readonly_reason && !mcpWritable ? <p className="muted-line">{mcp.readonly_reason}</p> : null}
              {mcpMutationError ? (
                <p className="stream-error" data-testid="mcp-mutation-error">
                  {mcpMutationError}
                </p>
              ) : null}
              {latestMcpToolTrace ? (
                <div className="mcp-latest-call" data-testid="mcp-latest-call">
                  <div>
                    <span>Latest call</span>
                    <strong>{latestMcpToolTrace.toolName}</strong>
                  </div>
                  <dl>
                    <dt>Server</dt>
                    <dd>{latestMcpToolTrace.server || "-"}</dd>
                    <dt>Transport</dt>
                    <dd>{latestMcpToolTrace.transport || "-"}</dd>
                    <dt>Call</dt>
                    <dd>{compactId(latestMcpToolTrace.callId)}</dd>
                    <dt>Status</dt>
                    <dd>{latestMcpToolTrace.status}</dd>
                    <dt>Lifecycle</dt>
                    <dd>{latestMcpToolTrace.lifecycleReused ? "reused" : "-"}</dd>
                    <dt>PID</dt>
                    <dd>{latestMcpToolTrace.lifecyclePid || "-"}</dd>
                  </dl>
                  <p>{compactText(latestMcpToolTrace.error || latestMcpToolTrace.output || "No textual output", 180)}</p>
                </div>
              ) : null}
              <div className="mcp-server-list" data-testid="mcp-server-list">
                {mcpServers.length ? (
                  mcpServers.map((server) => {
                    const tools = server.tools ?? [];
                    const serverName = server.name?.trim() ?? "";
                    const serverBusy = serverName ? mcpMutationBusy.endsWith(`:${serverName}`) : false;
                    const localServer = server.type === "local";
                    const lifecycleStatus = mcpLifecycleStatusLabel(server);
                    const lifecycleRunning = ["running", "ready", "connected"].includes(lifecycleStatus);
                    const lifecycleBusy = serverName ? mcpMutationBusy.startsWith("lifecycle:") && mcpMutationBusy.endsWith(`:${serverName}`) : false;
                    return (
                      <section className="mcp-server-row" key={server.name ?? mcpEndpointLabel(server)}>
                        <div className="mcp-server-heading">
                          <span className="file-badge">{server.type ?? "mcp"}</span>
                          <div className="mcp-server-copy">
                            <strong>{server.name ?? "mcp server"}</strong>
                            <span>
                              {server.enabled ? "enabled" : "disabled"} · {mcpTransportLabel(server)} · {mcpEndpointLabel(server)}
                            </span>
                          </div>
                          <div className="mcp-server-actions">
                            <span className={`stream-state ${statusClass(server.status)}`}>{server.status ?? "-"}</span>
                            {localServer ? (
                              <>
                                <button
                                  className="icon-button mini"
                                  type="button"
                                  aria-label={`Start MCP server ${server.name ?? ""}`}
                                  title="Start MCP server"
                                  disabled={Boolean(mcpMutationBusy) || !server.name || lifecycleRunning}
                                  onClick={() => {
                                    controlMcpServerLifecycle(server, "start");
                                  }}
                                >
                                  <Play size={12} />
                                </button>
                                <button
                                  className="icon-button mini"
                                  type="button"
                                  aria-label={`Stop MCP server ${server.name ?? ""}`}
                                  title="Stop MCP server"
                                  disabled={Boolean(mcpMutationBusy) || !server.name || !lifecycleRunning}
                                  onClick={() => {
                                    controlMcpServerLifecycle(server, "stop");
                                  }}
                                >
                                  <Square size={12} />
                                </button>
                                <button
                                  className="icon-button mini"
                                  type="button"
                                  aria-label={`Restart MCP server ${server.name ?? ""}`}
                                  title="Restart MCP server"
                                  disabled={Boolean(mcpMutationBusy) || !server.name}
                                  onClick={() => {
                                    controlMcpServerLifecycle(server, "restart");
                                  }}
                                >
                                  <RotateCcw size={12} className={mcpMutationBusy === `lifecycle:restart:${serverName}` ? "spin" : ""} />
                                </button>
                              </>
                            ) : null}
                            <button
                              className="icon-button mini"
                              type="button"
                              aria-label={`Test MCP server ${server.name ?? ""}`}
                              title="Test MCP server"
                              disabled={Boolean(mcpMutationBusy) || !server.name}
                              onClick={() => {
                                testMcpServer(server);
                              }}
                            >
                              <RefreshCw size={12} className={mcpMutationBusy === `test:${serverName}` ? "spin" : ""} />
                            </button>
                            <button
                              className="icon-button mini"
                              type="button"
                              aria-label={`Edit MCP server ${server.name ?? ""}`}
                              title="Edit MCP server"
                              disabled={!mcpWritable || Boolean(mcpMutationBusy) || !server.name}
                              onClick={() => {
                                editMcpServer(server);
                              }}
                            >
                              <PencilLine size={12} />
                            </button>
                            <button
                              className="icon-button mini"
                              type="button"
                              aria-label={`${server.enabled ? "Disable" : "Enable"} MCP server ${server.name ?? ""}`}
                              title={server.enabled ? "Disable MCP server" : "Enable MCP server"}
                              disabled={!mcpWritable || Boolean(mcpMutationBusy) || !server.name}
                              onClick={() => {
                                toggleMcpServer(server);
                              }}
                            >
                              <Power size={12} />
                            </button>
                            <button
                              className="icon-button mini danger"
                              type="button"
                              aria-label={`Delete MCP server ${server.name ?? ""}`}
                              title="Delete MCP server"
                              disabled={!mcpWritable || Boolean(mcpMutationBusy) || !server.name}
                              onClick={() => {
                                deleteMcpServer(server);
                              }}
                            >
                              <XCircle size={12} />
                            </button>
                          </div>
                        </div>
                        {localServer ? (
                          <div className="mcp-lifecycle-strip">
                            <span className={`stream-state ${mcpLifecycleStatusClass(server)}`}>{lifecycleBusy ? "updating" : lifecycleStatus}</span>
                            <span>pid {server.lifecycle_pid ?? "-"}</span>
                            <span>started {mcpLifecycleTimeLabel(server.lifecycle_started_at)}</span>
                            <span>runtime tools {server.lifecycle_tool_count ?? "-"}</span>
                          </div>
                        ) : null}
                        <dl className="mcp-server-meta">
                          <div>
                            <dt>Tools</dt>
                            <dd>{server.tool_count ?? tools.length}</dd>
                          </div>
                          <div>
                            <dt>Timeout</dt>
                            <dd>{server.timeout_ms ? `${server.timeout_ms}ms` : "-"}</dd>
                          </div>
                          <div>
                            <dt>Auth</dt>
                            <dd>{server.header_count ? `${server.header_count} headers` : "none"}</dd>
                          </div>
                          <div>
                            <dt>Env</dt>
                            <dd>{server.env_count ? `${server.env_count} vars` : "none"}</dd>
                          </div>
                          <div>
                            <dt>Checked</dt>
                            <dd>{serverBusy ? "testing" : mcpCheckedLabel(server)}</dd>
                          </div>
                        </dl>
                        {server.last_error ? <p className="stream-error">{userFacingErrorMessage(new Error(server.last_error))}</p> : null}
                        {tools.length ? (
                          <div className="mcp-tool-list">
                            {tools.slice(0, 6).map((tool) => (
                              <div className="mcp-tool-row" key={tool.name ?? mcpToolLabel(tool)}>
                                <strong>{mcpToolLabel(tool)}</strong>
                                <span>{compactId(tool.name)}</span>
                                {tool.description ? <p>{compactText(tool.description, 150)}</p> : null}
                              </div>
                            ))}
                            {tools.length > 6 ? <span className="part-more">+{tools.length - 6} more tools</span> : null}
                          </div>
                        ) : (
                          <p className="muted-line">No tools discovered</p>
                        )}
                      </section>
                    );
                  })
                ) : (
                  <p className="muted-line">No MCP servers configured.</p>
                )}
              </div>
            </section>
          </div>
        );

      case "computer":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>电脑操控</h2>
                <p>运行本地终端诊断命令。</p>
              </div>
              <form className="terminal-run-form" onSubmit={runTerminalCommand}>
                <input
                  aria-label="Terminal command"
                  value={terminalCommand}
                  onChange={(event) => setTerminalCommand(event.target.value)}
                  placeholder="pwd"
                />
                <button disabled={terminalBusy || !terminalCommand.trim()} type="submit">
                  {terminalBusy ? "Running" : "Run"}
                </button>
              </form>
              {terminalResult ? (
                <div className="terminal-output">
                  <dl className="settings-definition-grid">
                    <dt>CWD</dt>
                    <dd title={terminalResult.cwd ?? ""}>{terminalResult.cwd_relative || compactPath(terminalResult.cwd)}</dd>
                    <dt>Exit</dt>
                    <dd>{terminalResult.exit_code ?? "-"}</dd>
                    <dt>Time</dt>
                    <dd>{terminalResult.duration_ms ?? 0}ms</dd>
                  </dl>
                  {terminalResult.stdout ? (
                    <div>
                      <span>stdout</span>
                      <pre>{terminalResult.stdout}</pre>
                    </div>
                  ) : null}
                  {terminalResult.stderr ? (
                    <div>
                      <span>stderr</span>
                      <pre>{terminalResult.stderr}</pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {terminalError ? <p className="stream-error">{terminalError}</p> : null}
            </section>
          </div>
        );

      case "git":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>Git</h2>
                <p>查看当前 workspace 的 Git 状态。</p>
              </div>
              {gitStatus?.is_repo ? (
                <>
                  <dl className="settings-definition-grid">
                    <dt>Branch</dt>
                    <dd>{gitStatus.branch || "-"}</dd>
                    <dt>Changes</dt>
                    <dd>{gitStatus.change_count ?? 0}</dd>
                    <dt>Ahead</dt>
                    <dd>{gitStatus.ahead ?? 0}</dd>
                    <dt>Behind</dt>
                    <dd>{gitStatus.behind ?? 0}</dd>
                  </dl>
                  <div className="settings-list">
                    {(gitStatus.changes ?? []).slice(0, 12).map((change) => (
                      <div className="settings-list-row" key={`${change.status}:${change.path}`}>
                        <GitBranch size={15} />
                        <span>
                          <strong>{change.path || "-"}</strong>
                          <small>
                            {change.index || " "}
                            {change.worktree || " "}
                          </small>
                        </span>
                        <span className="file-badge">{change.status || "?"}</span>
                      </div>
                    ))}
                    {(gitStatus.change_count ?? 0) === 0 ? <p className="muted-line">Clean workspace.</p> : null}
                  </div>
                </>
              ) : (
                <p className="muted-line warning-line">
                  <AlertTriangle size={13} />
                  {gitStatus?.error || "No git repository"}
                </p>
              )}
            </section>
          </div>
        );

      case "worktree":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>工作树</h2>
                <p>管理 Desktop 左侧项目和当前工作目录。</p>
              </div>
              <div className="inline-actions settings-actions">
                <button disabled={!isTauriRuntime() || projectBusy === "choose" || managedBridgeBusyAny} onClick={chooseProjectFolder} type="button">
                  <FolderOpen size={13} />
                  Add project
                </button>
              </div>
              <div className="settings-list">
                {projects.filter(isDisplayableProject).map((project) => (
                  <div className="settings-list-row" key={project.id}>
                    <Folder size={15} />
                    <span>
                      <strong>{project.name}</strong>
                      <small>{project.path}</small>
                    </span>
                    <button type="button" onClick={() => selectProject(project)} disabled={managedBridgeBusyAny}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        );

      case "profile":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>个人资料</h2>
                <p>本地 Desktop 账号与运行身份。</p>
              </div>
              <dl className="settings-definition-grid">
                <dt>App</dt>
                <dd>OpenAgent</dd>
                <dt>Runtime</dt>
                <dd>{desktopRuntime}</dd>
                <dt>Auth</dt>
                <dd>
                  <span className={`stream-state ${bridgeAuthClass}`}>{bridgeAuthLabel}</span>
                </dd>
                <dt>Projects</dt>
                <dd>{projects.filter(isDisplayableProject).length}</dd>
                <dt>Sessions</dt>
                <dd>{sessions.filter((session) => !isArchivedSession(session)).length}</dd>
                <dt>Archived</dt>
                <dd>{archivedSessions.length}</dd>
              </dl>
            </section>
          </div>
        );

      case "archived":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>已归档对话</h2>
                <p>管理从侧边栏收起的会话。</p>
              </div>
              <div className="settings-list">
                {archivedSessions.length ? (
                  archivedSessions.map((session) => {
                    const id = sessionId(session);
                    const busy = sessionArchiveBusy === id;
                    return (
                      <div className="settings-list-row" key={id || sessionDisplayTitle(session)}>
                        <History size={15} />
                        <span>
                          <strong>{sessionDisplayTitle(session)}</strong>
                          <small>{projectNameFromPath(session.workspace || "Workspace")} · {sessionTimeLabel(session, nowMs)}</small>
                        </span>
                        <button
                          disabled={!id || Boolean(sessionArchiveBusy && !busy)}
                          onClick={() => archiveSession(session, false)}
                          type="button"
                        >
                          {busy ? "恢复中" : "恢复"}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="muted-line">没有已归档对话。</p>
                )}
              </div>
              {sessionArchiveError ? <p className="stream-error">{sessionArchiveError}</p> : null}
            </section>
          </div>
        );

      case "plugins":
        return (
          <div className="settings-content-grid">
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>插件</h2>
                <p>管理已经接通的 MCP 与本机工具入口。</p>
              </div>
              <div className="settings-list">
                {[
                  { label: "MCP 服务器", description: "管理 server、transport、lifecycle 和工具发现。", page: "mcp" as SettingsPage, icon: <Wrench size={15} /> },
                  { label: "电脑操控", description: "本地终端和电脑操控能力。", page: "computer" as SettingsPage, icon: <Terminal size={15} /> },
                ].map(({ label, description, page, icon }) => (
                  <div className="settings-list-row" key={page}>
                    {icon}
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <button type="button" onClick={() => setSettingsPage(page)}>
                      打开
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        );

      default:
        return null;
    }
  })();

  if (settingsOpen) {
    return (
      <main className="settings-shell">
        <aside className="settings-rail">
          <button className="settings-back" onClick={() => setSettingsOpen(false)} type="button">
            <span aria-hidden="true">←</span>
            返回应用
          </button>
          <label className="settings-search">
            <Search size={15} />
            <input
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder="搜索设置..."
            />
          </label>
          <nav className="settings-nav" aria-label="Settings navigation">
            {visibleSettingsGroups.map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                {group.items.map((item) => (
                  <button
                    className={settingsPage === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() => setSettingsPage(item.id)}
                    type="button"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
          <button className="settings-chat-link" onClick={() => setSettingsOpen(false)} type="button">
            <Bot size={15} />
            Chat Settings
          </button>
        </aside>
        <section className="settings-main">
          <header className="settings-main-header">
            <h1>{settingsPageLabel}</h1>
            <span>⌘,</span>
          </header>
          {settingsPageContent}
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${inspectorOpen ? "inspector-visible" : ""}`}>
      <aside className="rail">
        <nav className="primary-nav" aria-label="OpenAgent navigation">
          <button
            className="nav-action"
            disabled={bridgeSwitchInProgress}
            onClick={createSession}
            type="button"
            title={bridgeSwitchInProgress ? "Bridge is switching project" : "New session"}
          >
            <PencilLine size={17} />
            <span>新对话</span>
          </button>
          <button className="nav-action" onClick={openOverviewPanel} type="button" title="查看待处理事项">
            <History size={17} />
            <span>已安排</span>
            {pendingInteractionCount ? <b>{pendingInteractionCount}</b> : null}
          </button>
          <button className="nav-action" onClick={() => openSettingsPage("plugins")} type="button" title="打开插件设置">
            <PlugZap size={17} />
            <span>插件</span>
          </button>
        </nav>

        <section className="rail-section projects">
          <div className="section-title section-title-row">
            <span>项目</span>
            <button
              className="icon-button"
              disabled={!isTauriRuntime() || projectBusy === "choose" || managedBridgeBusyAny}
              onClick={chooseProjectFolder}
              type="button"
              title="Choose project folder"
            >
              <FolderOpen size={14} />
            </button>
          </div>
          <form className="project-add" onSubmit={addProject}>
            <input
              aria-label="Project path"
              value={projectPathInput}
              onChange={(event) => setProjectPathInput(event.target.value)}
              placeholder="/path/to/project"
            />
            <button disabled={projectBusy === "add"} type="submit" title="Add project">
              <FolderPlus size={14} />
            </button>
          </form>
          {projectError ? <p className="project-error">{projectError}</p> : null}
          <div className="project-list">
            {projects.filter(isDisplayableProject).map((project) => {
              const isSelectedProject = sameProjectPath(project.path, selectedProjectPath);
              const projectPath = normalizeProjectPath(project.path);
              const projectSessions = sessionsByProjectPath.get(projectPath) ?? [];
              const showProjectSessions =
                isSelectedProject || projectSessions.some((session) => sessionId(session) === activeSessionId);
              return (
                <div className="project-group" key={project.id}>
                  <div
                    className={`project-row ${isSelectedProject ? "selected" : ""}`}
                    title={project.path}
                  >
                    <button
                      className="project-open-button"
                      disabled={managedBridgeBusyAny}
                      onClick={() => selectProject(project)}
                      type="button"
                    >
                      <Folder size={15} />
                      <span>{project.name}</span>
                    </button>
                    <button
                      aria-label={`New session in ${project.name}`}
                      className="project-new-session-button"
                      disabled={managedBridgeBusyAny || projectBusy === `session:${normalizeProjectPath(project.path)}`}
                      onClick={() => createProjectSession(project)}
                      title="New session in project"
                      type="button"
                    >
                      <PencilLine size={14} />
                    </button>
                    <button
                      aria-label={`Remove project ${project.name}`}
                      className="project-remove-button"
                      disabled={managedBridgeBusyAny}
                      onClick={() => removeProject(project)}
                      title="Remove project from workspace list"
                      type="button"
                    >
                      <XCircle size={13} />
                    </button>
                  </div>
                  {showProjectSessions && projectSessions.length ? (
                    <div className="project-session-list">
	                      {projectSessions.map((session) => {
	                        const id = sessionId(session);
	                        const isActiveSession = id === activeSessionId;
	                        const isRenaming = renamingSessionId === id;
	                        const isDeleteConfirming = deleteConfirmationSessionId === id;
	                        const isDeleting = sessionDeleteBusy === id;
	                        const isArchiving = sessionArchiveBusy === id;
	                        return (
	                          <div className="project-session-row" key={id || `${project.id}:session`}>
	                            {isRenaming ? (
	                              <input
                                aria-label="Session title"
                                autoFocus
                                className="session-rename-input"
                                disabled={sessionRenameBusy === id}
                                onBlur={() => {
                                  if (sessionRenameCancelledRef.current) {
                                    sessionRenameCancelledRef.current = false;
                                    return;
                                  }
                                  void saveSessionRename(session);
                                }}
                                onChange={(event) => setSessionRenameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void saveSessionRename(session);
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelRenameSession();
                                  }
                                }}
                                value={sessionRenameDraft}
                              />
	                            ) : (
	                              <>
	                                <button
	                                  className={`project-session-button ${isActiveSession ? "selected" : ""}`}
	                                  disabled={!id}
	                                  onClick={() => {
	                                    setDeleteConfirmationSessionId("");
	                                    selectProjectSession(project, session);
	                                  }}
	                                  onDoubleClick={() => beginRenameSession(session)}
	                                  title={id ? `Session ${id}` : "Session"}
	                                  type="button"
	                                >
	                                  <span>{sessionDisplayTitle(session)}</span>
	                                  <small>{sessionTimeLabel(session, nowMs)}</small>
	                                </button>
	                                <button
	                                  aria-label={`Archive session ${sessionDisplayTitle(session)}`}
	                                  className="project-session-archive-button"
	                                  disabled={!id || Boolean(sessionArchiveBusy && !isArchiving)}
	                                  onClick={() => {
	                                    void archiveSession(session, true);
	                                  }}
	                                  title="归档会话"
	                                  type="button"
	                                >
	                                  {isArchiving ? <RefreshCw className="spin" size={12} /> : <History size={12} />}
	                                </button>
	                                <button
	                                  aria-label={`Delete session ${sessionDisplayTitle(session)}`}
	                                  className={`project-session-delete-button ${isDeleteConfirming ? "confirm" : ""}`}
	                                  disabled={!id || Boolean(sessionDeleteBusy && !isDeleting)}
	                                  onClick={() => {
	                                    void deleteSession(session);
	                                  }}
	                                  title={isDeleteConfirming ? "再次点击确认删除" : "删除会话"}
	                                  type="button"
	                                >
	                                  {isDeleting ? <RefreshCw className="spin" size={12} /> : <Trash2 size={12} />}
	                                </button>
	                              </>
	                            )}
	                          </div>
	                        );
	                      })}
	                      {sessionRenameError ? <p className="project-session-error">{sessionRenameError}</p> : null}
	                      {sessionDeleteError ? <p className="project-session-error">{sessionDeleteError}</p> : null}
	                      {sessionArchiveError ? <p className="project-session-error">{sessionArchiveError}</p> : null}
	                    </div>
	                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rail-section bridge-settings">
          <button className="status-row" onClick={() => openSettingsPage("environment")} type="button">
            <PlugZap size={15} />
            <span>Bridge</span>
            <small className={bridgeManagedClass}>{bridgeManagedLabel}</small>
          </button>
          <button className="status-row" onClick={() => openSettingsPage("configuration")} type="button">
            <Radio size={15} />
            <span>{provider?.model ?? "Model"}</span>
            <small className={statusClass(provider?.healthy ? "healthy" : "missing")}>
              {provider?.healthy ? "ready" : "check"}
            </small>
          </button>
          {managedBridgeWorkspaceMismatch ? (
            <div className="project-warning project-warning-action">
              <span>Bridge on {compactPath(managedBridge?.workspace)}</span>
              <button
                disabled={!isTauriRuntime() || managedBridgeBusyAny}
                onClick={restartManagedBridge}
                type="button"
                title="Restart managed Bridge on selected project"
              >
                <RotateCcw size={12} />
                Restart
              </button>
            </div>
          ) : null}
        </section>

        <button
          className="sidebar-profile settings-profile-button"
          onClick={() => {
            setSettingsPage("general");
            setSettingsOpen(true);
          }}
          title="Open settings"
          type="button"
        >
          <div className="profile-avatar">OA</div>
          <div>
            <strong>OpenAgent</strong>
            <span>{desktopRuntime}</span>
          </div>
          <Settings size={15} />
        </button>
      </aside>

      <section
        className={`workspace ${showWorkspaceDock ? "has-dock" : ""} ${showComposerContext ? "has-context" : ""}`}
        style={workspaceStyle}
      >
        <header className="topbar">
          <div className="title-cluster">
            <div className="title-icon">
              <Sidebar size={16} />
            </div>
            <h1>{activeSession?.title || activeProjectLabel || "OpenAgent"}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className={`chrome-button topbar-state ${statusClass(connection)}`}
              onClick={() => openSettingsPage("connections")}
              type="button"
              title={`Bridge ${connection}: ${bridgeUrl}`}
            >
              <GitBranch size={15} />
            </button>
            <button
              className={`chrome-button topbar-state ${statusClass(provider?.healthy ? "healthy" : "missing")}`}
              onClick={() => openSettingsPage("configuration")}
              type="button"
              title={provider?.model ?? "Model"}
            >
              <Square size={15} />
            </button>
            <button
              className={`chrome-button topbar-state ${statusClass(streamState)}`}
              onClick={openOverviewPanel}
              type="button"
              title={`运行状态：${conversationPhaseLabel}`}
            >
              <Activity size={15} />
            </button>
            <button
              className="chrome-button"
              onClick={() => {
                if (inspectorOpen) {
                  setInspectorOpen(false);
                } else {
                  openOverviewPanel();
                }
              }}
              type="button"
              title="Toggle details"
            >
              <PanelRight size={16} />
            </button>
          </div>
        </header>

        <section className={`timeline ${timelineEmpty ? "empty" : ""}`} aria-live="polite" ref={timelineRef}>
          {timelineEmpty ? (
            <div className="empty-state">
              <span>开始一个任务</span>
              <small>{activeProjectDisplayPath}</small>
            </div>
          ) : (
            <>
              {inlineTimelineMessages.map(renderTimelineMessage)}
              {visibleLiveEvents.length ? (
                <LiveTurnProcessCard
                  events={visibleLiveEvents}
                  isStreaming={Boolean(activeStreamingDraft)}
                  key={`live-process:${visibleLiveTurnId}`}
                />
              ) : null}
              {activeStreamingDraft ? (
                <article
                  className="event-row message-row role-assistant streaming-draft"
                  data-testid="streaming-assistant-draft"
                  key={`streaming-draft:${activeStreamingDraft.turnId}`}
                  ref={streamingDraftRef}
                >
                  <div className="event-glyph">{messageIcon("assistant")}</div>
                  <div className="event-body">
                    <div className="event-heading">
                      <strong>assistant</strong>
                      <span>{activeStreamingDraft.eventCount} chunks</span>
                    </div>
                    <TextContent text={activeStreamingDraft.text} />
                  </div>
                </article>
              ) : null}
              {liveFinalAnswer ? (
                <article
                  className="event-row message-row role-assistant live-final-answer"
                  data-testid="live-final-answer"
                  key={`live-final-answer:${liveFinalAnswer.turnId}`}
                >
                  <div className="event-glyph">{messageIcon("assistant")}</div>
                  <div className="event-body">
                    <TextContent text={liveFinalAnswer.text} />
                  </div>
                </article>
              ) : null}
              {deferredAssistantMessages.map(renderTimelineMessage)}
              <div className="timeline-end" ref={timelineEndRef} />
            </>
          )}
        </section>

        <div className={`composer-dock ${showComposerContext ? "with-context" : "bare"}`} ref={composerDockRef}>
          {showWorkspaceDock ? (
            <section className="workspace-dock" aria-label="Workspace activity" data-testid="approval-dock">
              {approvals.slice(0, 2).map((item) => {
                const approval = item.approval ?? {};
                const isResponding = respondingInteractionId === item.request_id;
                const toolName = stringField(approval, "tool_name");
                const riskTone = approvalRiskTone(approval);
                return (
                  <article
                    className="dock-item approval-dock-item dock-item-attention"
                    data-testid="approval-dock-approval"
                    data-approval-risk={riskTone}
                    key={item.request_id}
                  >
                    <span className={`approval-dock-icon approval-risk-${riskTone}`}>
                      <ShieldCheck size={15} />
                    </span>
                    <div className="approval-dock-body">
                      <div className="approval-dock-heading">
                        <div className="approval-dock-title">
                          <strong>{approvalToolLabel(approval)}</strong>
                          {toolName ? <small>{toolName}</small> : null}
                        </div>
                        <span className="approval-dock-status" data-testid="approval-dock-reason">{approvalReasonLabel(approval)}</span>
                      </div>
                      <p data-testid="approval-dock-input">{approvalInputSummary(approval)}</p>
                      <div className="approval-dock-meta" data-testid="approval-dock-meta">
                        <span className="approval-chip permission" data-testid="approval-dock-permission">
                          {approvalPermissionLabel(approval)}
                        </span>
                        <span className={`approval-chip risk risk-${riskTone}`} data-testid="approval-dock-risk">
                          {approvalRiskLabel(approval)}
                        </span>
                        <span>call {compactId(firstText(approval.call_id, item.request_id))}</span>
                      </div>
                    </div>
                    <div className="approval-dock-actions">
                      <button type="button" disabled={isResponding} onClick={() => respondApproval(item, "allow")}>
                        {isResponding ? "Working" : "Allow"}
                      </button>
                      <button type="button" disabled={isResponding} onClick={() => respondApproval(item, "deny")}>
                        Deny
                      </button>
                    </div>
                  </article>
                );
              })}
              {questions.slice(0, 2).map((item) => {
                const question = item.question ?? {};
                const fields = questionElicitationFields(question, item.request_id ?? "", questionDrafts);
                const isResponding = respondingInteractionId === item.request_id;
                return (
                  <article className="dock-item approval-dock-item approval-dock-question dock-item-attention" data-testid="approval-dock-question" key={item.request_id}>
                    <span className="approval-dock-icon approval-risk-question">
                      <Bot size={15} />
                    </span>
                    <div className="approval-dock-body">
                      <div className="approval-dock-heading">
                        <div className="approval-dock-title">
                          <strong>{fields[0]?.label || "Question"}</strong>
                          <small>{stringField(question, "tool_name") || "question"}</small>
                        </div>
                        <span className="approval-dock-status question" data-testid="approval-dock-question-status">Needs answer</span>
                      </div>
                      <p>{fields.length > 1 ? `${fields.length} required fields` : fields[0]?.description || compactId(item.request_id)}</p>
                      <div className="approval-dock-meta">
                        <span className="approval-chip permission">Question: reply to resume</span>
                        <span>call {compactId(firstText(question.call_id, item.request_id))}</span>
                      </div>
                      <QuestionElicitationForm
                        fields={fields}
                        isResponding={isResponding}
                        onChange={(index, value) => updateQuestionDraft(item.request_id, index, value)}
                        onSubmit={() => respondQuestion(item)}
                        onDismiss={() => respondQuestion(item, true)}
                        compact
                      />
                    </div>
                  </article>
                );
              })}
              {pendingInteractionCount === 0 && latestPatch ? (
                <article
                  className="dock-item dock-item-clickable"
                  data-testid="diff-dock-item"
                  onClick={openReviewPanel}
                  onKeyDown={handleReviewKeyDown}
                  role="button"
                  tabIndex={0}
                >
                  <GitCompare size={15} />
                  <div>
                    <strong>{latestPatchPath}</strong>
                    <span>{latestPatchStatus || "workspace changed"}</span>
                  </div>
                  <button
                    disabled={!sessionDiff?.undo_count}
                    onClick={(event) => {
                      event.stopPropagation();
                      runPatchAction("undo");
                    }}
                    type="button"
                  >
                    Undo
                  </button>
                  <button
                    disabled={!sessionDiff?.redo_count}
                    onClick={(event) => {
                      event.stopPropagation();
                      runPatchAction("redo");
                    }}
                    type="button"
                  >
                    Redo
                  </button>
                </article>
              ) : null}
            </section>
          ) : null}
          {showComposerContext ? (
            <>
              <div className="composer-step-pill" aria-live="polite">
                <span className={`step-dot ${statusClass(streamState)}`} />
                {conversationPhaseLabel}
              </div>
              <div className="composer-context-bar" aria-label="Current workspace context" data-testid="composer-context-bar">
                <Activity size={14} />
                <strong>{activityTitle}</strong>
                <span data-testid="composer-activity-detail" title={activityDetailFull}>
                  {activityDetail}
                </span>
                <small>{activityMetaLabel}</small>
                <button onClick={openOverviewPanel} type="button" title="Open details">
                  <PencilLine size={13} />
                </button>
              </div>
            </>
          ) : null}
          <form className="composer" onSubmit={submitPrompt}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onCompositionEnd={() => {
                composerComposingRef.current = false;
                composerCompositionEndAtRef.current = Date.now();
              }}
              onCompositionStart={() => {
                composerComposingRef.current = true;
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder="要求后续变更"
              rows={2}
            />
            {composerAttachments.length || attachmentError ? (
              <div className="composer-attachment-area">
                <AttachmentChips
                  attachments={composerAttachments.map((attachment) => ({
                    id: attachment.id,
                    kind: attachment.kind,
                    path: attachment.path,
                    name: attachment.name,
                    sizeBytes: attachment.sizeBytes,
                    contentType: attachment.contentType,
                    contentLines: attachment.content.split(/\r?\n/).length,
                    contentChars: attachment.content.length,
                  }))}
                  onRemove={removeComposerAttachment}
                />
                {attachmentError ? <p className="attachment-error">{attachmentError}</p> : null}
              </div>
            ) : null}
            <div className="composer-footer">
              <div className="composer-attach">
                <button
                  aria-expanded={attachmentMenuOpen}
                  className="composer-tool-button"
                  onClick={() => setAttachmentMenuOpen((current) => !current)}
                  type="button"
                  title="Attach"
                >
                  <Plus size={18} />
                </button>
                {attachmentMenuOpen ? (
                  <div className="composer-attach-menu" role="menu">
                    <button onClick={() => chooseComposerAttachments("choose_attachment_files")} role="menuitem" type="button">
                      <Paperclip size={15} />
                      <span>文件</span>
                    </button>
                    <button onClick={() => chooseComposerAttachments("choose_attachment_folders")} role="menuitem" type="button">
                      <Folder size={15} />
                      <span>文件夹</span>
                    </button>
                    <button onClick={attachOpenAgentContext} role="menuitem" type="button">
                      <Bot size={15} />
                      <span>附加 OpenAgent</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="composer-controls">
                <select
                  value={permission}
                  onChange={(event) => setPermission(normalizePermissionMode(event.target.value))}
                  title="Permission"
                >
                  <option value="REQUEST_APPROVAL">请求批准</option>
                  <option value="AUTO_APPROVE">替我审批</option>
                  <option value="FULL_ACCESS">完全访问</option>
                  <option value="READONLY">只读</option>
                </select>
                <select value={model} onChange={(event) => setModel(event.target.value)} title="Model">
                  {(modelOptions?.length ? modelOptions : providerDraftModelOptions).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <button
                aria-label={isTurnInterruptible ? "Interrupt active turn" : "Run prompt"}
                className={`send-button ${isTurnInterruptible ? "stop-button" : ""}`}
                disabled={bridgeSwitchInProgress || interruptBusy}
                onClick={isTurnInterruptible ? interruptActiveTurn : undefined}
                type={isTurnInterruptible ? "button" : "submit"}
                title={
                  bridgeSwitchInProgress
                    ? "Bridge is switching project"
                    : isTurnInterruptible
                      ? interruptBusy
                        ? "Interrupting"
                        : `Interrupt ${compactId(activeTurnId)}`
                      : "Run"
                }
              >
                {isTurnInterruptible ? <Square size={15} /> : <ArrowUp size={18} />}
              </button>
              {isTurnInterruptible ? (
                <button
                  aria-label="Queue prompt"
                  className="send-button queue-button"
                  disabled={bridgeSwitchInProgress || !prompt.trim()}
                  title="Queue prompt after the active turn"
                  type="submit"
                >
                  <ArrowUp size={16} />
                </button>
              ) : null}
            </div>
            {error || failedTurnMessage ? (
              <div className="error-line">
                <span>{error || failedTurnMessage}</span>
                {canRetryFailedTurn ? (
                  <button disabled={Boolean(retryingTurnId)} onClick={retryFailedTurn} type="button">
                    {retryingTurnId ? "重试中" : "重试任务"}
                  </button>
                ) : canRetryPrompt ? (
                  <button type="submit">重试</button>
                ) : null}
              </div>
            ) : null}
          </form>
        </div>
      </section>

      <button
        aria-label="Close details"
        className="inspector-scrim"
        onClick={() => setInspectorOpen(false)}
        type="button"
      />
      <aside className={`inspector ${inspectorOpen ? "open" : ""}`}>
        <div className="inspector-header">
          <div>
            <strong>运行详情</strong>
            <span>{activeProjectLabel}</span>
          </div>
          <span className={`stream-state ${statusClass(streamState)}`}>{conversationPhaseLabel}</span>
          <button className="chrome-button" onClick={() => setInspectorOpen(false)} type="button" title="Close">
            <PanelRight size={16} />
          </button>
        </div>
                <div className="inspector-card jobs-inspector-card" data-testid="jobs-inspector-card">
          <div className="inspector-title">
            <Activity size={15} />
            任务状态
            <span className={`trust-count ${activeTurnJobs.length ? "pending" : expiredTurnCount ? "bad" : "clear"}`}>
              {activeTurnJobs.length
                ? `${runningTurnJobs.length} 执行 · ${queuedTurnJobs.length} 等待`
                : expiredTurnCount
                  ? `${expiredTurnCount} 过期`
                  : "空闲"}
            </span>
          </div>
          <div className="job-metrics" aria-label="Job registry summary">
            <div>
                <span>Workers</span>
              <strong>
                {schedulerValue(runningWorkerCount)}
                {maxRunningWorkers ? `/${maxRunningWorkers}` : ""}
              </strong>
            </div>
            <div>
                <span>等待</span>
              <strong>{turnJobs.queued_count ?? queuedTurnJobs.length}</strong>
            </div>
            <div>
                <span>持久化</span>
              <strong>{persistedQueuedCount ? `${persistedQueuedCount} saved` : "clear"}</strong>
            </div>
            <div>
                <span>超时</span>
              <strong>{queueTimeoutLabel}</strong>
            </div>
            <div>
                <span>过期</span>
              <strong>{expiredTurnCount ? `${expiredTurnCount} pruned` : "clear"}</strong>
            </div>
          </div>
          <div className="scheduler-strip" data-testid="scheduler-strip">
            <span>会话队列 {maxQueuedPerSession ? `最多 ${maxQueuedPerSession}` : "默认"}</span>
            <span>{globalQuotaQueuedCount ? `${globalQuotaQueuedCount} 个等待 worker` : "worker 空闲"}</span>
            <span>{recoveredQueuedCount ? `${recoveredQueuedCount} 个从磁盘恢复` : "暂无恢复任务"}</span>
            <span>租约接管 {leaseStaleLabel}</span>
            <span>{turnJobs.index_persisted ? "任务索引已持久化" : turnJobs.source ?? "runtime registry"}</span>
          </div>
          {selectedTurnJob ? (
            <div className="job-detail" data-testid="selected-job-detail" data-turn-id={selectedTurnJobIdResolved}>
              <div className="job-detail-heading">
                <div>
                  <strong>{selectedTurnJobSession?.title || compactId(turnJobSessionId(selectedTurnJob))}</strong>
                  <span>{compactId(selectedTurnJobIdResolved)}</span>
                </div>
                <span className={`stream-state ${statusClass(selectedTurnJob.status)}`}>
                  {turnJobStatusLabel(selectedTurnJob)}
                </span>
              </div>
              <dl>
                <dt>Turn</dt>
                <dd title={selectedTurnJobIdResolved}>{compactId(selectedTurnJobIdResolved)}</dd>
                <dt>Session</dt>
                <dd title={turnJobSessionId(selectedTurnJob)}>{compactId(turnJobSessionId(selectedTurnJob))}</dd>
                <dt>Started</dt>
                <dd>{formatTime(selectedTurnJob.started_at_ms)}</dd>
                <dt>Updated</dt>
                <dd>{formatTime(selectedTurnJob.updated_at_ms)}</dd>
                <dt>Duration</dt>
                <dd>{formatElapsed(selectedTurnJob.started_at_ms, nowMs) || "-"}</dd>
                <dt>Queue</dt>
                <dd>
                  {isTurnJobQueued(selectedTurnJob)
                    ? `#${queuePositionForJob(selectedTurnJob, queuedTurnJobs)} waiting`
                    : "-"}
                </dd>
                <dt>Reason</dt>
                <dd>{isTurnJobQueued(selectedTurnJob) ? queueReasonLabel(selectedTurnJob.queue_reason) : "-"}</dd>
                <dt>Payload</dt>
                <dd>
                  {selectedTurnJob.payload_persisted
                    ? "已持久化"
                    : selectedTurnJob.status === "expired"
                      ? "已移除"
                      : isTurnJobQueued(selectedTurnJob)
                        ? "内存中"
                        : "-"}
                </dd>
                <dt>Cancel</dt>
                <dd>{selectedTurnJob.cancel_requested ? "已请求" : "无"}</dd>
                <dt>Timeout</dt>
                <dd>{queueTimeoutLabel}</dd>
              </dl>
              {turnJobLifecycleMessage(selectedTurnJob, scheduler) ? (
                <p className={`job-queue-note ${turnJobLifecycleTone(selectedTurnJob)}`}>
                  <Circle size={12} />
                  {turnJobLifecycleMessage(selectedTurnJob, scheduler)}
                </p>
              ) : null}
              <div className="inline-actions">
                <button
                  disabled={!isTurnJobInterruptible(selectedTurnJob) || interruptingTurnId === selectedTurnJobIdResolved}
                  onClick={() => interruptTurn(selectedTurnJobIdResolved)}
                  type="button"
                  title={isTurnJobInterruptible(selectedTurnJob) ? `Interrupt ${compactId(selectedTurnJobIdResolved)}` : "Job is not interruptible"}
                >
                  <Square size={13} />
                  {interruptingTurnId === selectedTurnJobIdResolved ? "停止中" : "停止"}
                </button>
                <button onClick={refreshTurnJobs} type="button">
                  <RefreshCw size={13} />
                  刷新
                </button>
              </div>
              <div className="job-trace">
                <span>事件</span>
                {selectedTurnJobEvents.length ? (
                  selectedTurnJobEvents.map((event) => (
                    <div className="job-trace-row" key={eventKey(event)}>
                      <small>{formatTime(event.created_at_ms)}</small>
                      <strong>{methodLabel(event.method)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="muted-line">暂无这轮任务的实时事件。</p>
                )}
              </div>
            </div>
          ) : (
            <p className="muted-line">暂无正在执行或最近任务。</p>
          )}
          {visibleTurnJobs.length ? (
            <div className="job-inspector-list" aria-label="Recent jobs">
              {visibleTurnJobs.slice(0, 8).map((job) => {
                const id = turnJobId(job);
                const session = sessionById.get(turnJobSessionId(job));
                return (
                  <button
                    className={id === selectedTurnJobIdResolved ? "selected" : ""}
                    data-turn-id={id}
                    key={id}
                    onClick={() => {
                      setSelectedTurnJobId(id);
                      const sessionIdForJob = turnJobSessionId(job);
                      if (sessionIdForJob) {
                        activateSession(sessionIdForJob, session?.workspace || selectedProjectPath);
                      }
                    }}
                    type="button"
                  >
                    <span className={`step-dot ${statusClass(job.status)}`} />
                    <strong>{session?.title || compactId(turnJobSessionId(job))}</strong>
                    <small>
                      {isTurnJobQueued(job)
                        ? `等待 #${queuePositionForJob(job, queuedTurnJobs)} · ${queueReasonLabel(job.queue_reason)}`
                        : turnJobStatusLabel(job)}{" "}
                      · {formatElapsed(job.updated_at_ms ?? job.started_at_ms, nowMs) || "刚刚"}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : null}
          {turnJobs.error ? <p className="stream-error">{turnJobs.error}</p> : null}
        </div>
        <div className="inspector-card">
          <div className="inspector-title">
            <Terminal size={15} />
            事件流
          </div>
          <dl>
            <dt>Status</dt>
            <dd>
              <span className={`stream-state ${statusClass(streamHealth.status)}`}>
                {streamHealth.status}
              </span>
            </dd>
            <dt>Events</dt>
            <dd>{events.length}</dd>
            <dt>Messages</dt>
            <dd>{sessionMessages?.message_v2_count ?? sessionMessages?.message_count ?? 0}</dd>
            <dt>Cursor</dt>
            <dd>{lastGlobalId.current}</dd>
            <dt>Resume</dt>
            <dd>{streamHealth.resume_cursor}</dd>
            <dt>Attempts</dt>
            <dd>{streamHealth.reconnect_attempts}</dd>
            <dt>Recovered</dt>
            <dd>{streamHealth.recovered_count}</dd>
            <dt>Batch</dt>
            <dd>{streamHealth.last_batch_count}</dd>
            <dt>Session</dt>
            <dd>{activeSessionId || "-"}</dd>
          </dl>
          {streamHealth.last_error ? (
            <p className="stream-error">
              {streamHealth.last_error}
              {streamHealth.next_retry_ms ? ` · retry ${streamHealth.next_retry_ms}ms` : ""}
            </p>
          ) : null}
        </div>

        <div className="inspector-card">
          <div className="inspector-title">
            <ShieldCheck size={15} />
            权限与问题
            <span className={`trust-count ${pendingInteractionCount ? "pending" : "clear"}`}>
              {pendingInteractionCount ? `${pendingInteractionCount} 待处理` : "无待处理"}
            </span>
          </div>
          <p className="trust-sync">{trustSyncLabel}</p>
          {approvals.length === 0 && questions.length === 0 ? (
            <p className="muted-line">暂无待处理权限或问题。</p>
          ) : null}
          <div className="trust-list">
            {approvals.map((item) => {
              const approval = item.approval ?? {};
              const preview = approval.preview as JsonRecord | undefined;
              const isResponding = respondingInteractionId === item.request_id;
              return (
                <div className="trust-item" key={item.request_id}>
                  <strong>{stringField(approval, "tool_name") || "approval"}</strong>
                  <span>{stringField(preview, "path") || compactId(item.request_id)}</span>
                  {stringField(preview, "diff") ? (
                    <pre className="mini-diff">{stringField(preview, "diff")}</pre>
                  ) : null}
                  <div className="inline-actions">
                    <button type="button" disabled={isResponding} onClick={() => respondApproval(item, "allow")}>
                      {isResponding ? "Working" : "Allow"}
                    </button>
                    <button type="button" disabled={isResponding} onClick={() => respondApproval(item, "deny")}>
                      Deny
                    </button>
                  </div>
                </div>
              );
            })}
            {questions.map((item) => {
              const question = item.question ?? {};
              const isResponding = respondingInteractionId === item.request_id;
              const fields = questionElicitationFields(question, item.request_id ?? "", questionDrafts);
              return (
                <div className="trust-item trust-question-form" key={item.request_id} data-testid="pending-question-form">
                  <strong>{fields[0]?.label || "Question"}</strong>
                  <span>{fields.length > 1 ? `${fields.length} fields` : fields[0]?.description || compactId(item.request_id)}</span>
                  <QuestionElicitationForm
                    fields={fields}
                    isResponding={isResponding}
                    onChange={(index, value) => updateQuestionDraft(item.request_id, index, value)}
                    onSubmit={() => respondQuestion(item)}
                    onDismiss={() => respondQuestion(item, true)}
                  />
                </div>
              );
            })}
          </div>
          <div className="trust-history">
            <div className="trust-history-title">
              <span>最近历史</span>
              <small>{trustHistory.length}</small>
            </div>
            {trustHistory.length ? (
              trustHistory.map((item) => <TrustHistoryCard item={item} key={item.id} compact />)
            ) : (
              <p className="muted-line">暂无权限历史。</p>
            )}
          </div>
        </div>

        <div className="inspector-card">
          <div className="inspector-title">
            <GitCompare size={15} />
            文件变更
          </div>
          <dl>
            <dt>Undo</dt>
            <dd>{sessionDiff?.undo_count ?? 0}</dd>
            <dt>Redo</dt>
            <dd>{sessionDiff?.redo_count ?? 0}</dd>
          </dl>
          <div className="inline-actions">
            <button
              disabled={!sessionDiff?.undo_count}
              onClick={() => runPatchAction("undo")}
              type="button"
            >
              <Undo2 size={13} />
              Undo
            </button>
            <button
              disabled={!sessionDiff?.redo_count}
              onClick={() => runPatchAction("redo")}
              type="button"
            >
              <RefreshCw size={13} />
              Redo
            </button>
          </div>
          {sessionDiff?.latest ? (
            <div className="patch-preview">
              <strong>{stringField(sessionDiff.latest, "path") || "latest patch"}</strong>
              <span>{stringField(sessionDiff.latest, "status")}</span>
              <pre className="mini-diff">{stringField(sessionDiff.latest, "diff")}</pre>
            </div>
          ) : (
            <p className="muted-line">当前会话暂无文件变更。</p>
          )}
        </div>

        <div className="inspector-card">
          <div className="inspector-title">
            <History size={15} />
            检查点
            {restoredCheckpointId ? <span className="checkpoint-restored">已恢复</span> : null}
          </div>
          {restoredCheckpointId ? (
            <p className="restore-state" title={restoredCheckpointId}>
              已恢复到检查点
            </p>
          ) : null}
          <dl>
            <dt>Total</dt>
            <dd>{checkpoints?.count ?? 0}</dd>
            <dt>Latest</dt>
            <dd>{checkpoints?.latest?.kind ?? "-"}</dd>
          </dl>
          <div className="checkpoint-list">
            {(checkpoints?.checkpoints ?? []).slice(0, 5).map((checkpoint) => {
              const isRestoring = restoringCheckpointId === checkpoint.checkpoint_id;
              const isRestored = restoredCheckpointId === checkpoint.checkpoint_id;
              return (
                <div className={`checkpoint-row ${isRestored ? "restored" : ""}`} key={checkpoint.checkpoint_id}>
                  <div>
                    <strong>{checkpointLabel(checkpoint)}</strong>
                    <span>
                      {numberField(checkpoint as JsonRecord, "file_count")} files ·{" "}
                      {numberField(checkpoint as JsonRecord, "total_bytes")} bytes
                    </span>
                  </div>
                  <button
                    data-checkpoint-id={checkpoint.checkpoint_id}
                    disabled={Boolean(restoringCheckpointId) || isRestored}
                    title={isRestored ? "已恢复" : isRestoring ? "正在恢复" : "恢复"}
                    type="button"
                    onClick={() => restoreCheckpoint(checkpoint.checkpoint_id)}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

      </aside>
    </main>
  );
}

function isToolCallEvent(event: AppEvent): boolean {
  return event.method.includes("toolCall");
}

function toolCallStatus(event: AppEvent): string {
  if (event.method.includes("failed")) return "failed";
  if (event.method.includes("completed")) return "completed";
  if (event.method.includes("started")) return "started";
  return stringParam(event.params ?? {}, "status") || "tool call";
}

function toolCallStatusLabel(status: string): string {
  if (status === "started" || status === "running") return "正在运行";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return status;
}

function processEventTitle(event: AppEvent): string {
  const method = event.method;
  if (method === "turn/retrying") return "模型请求重试";
  if (method === "turn/fallback") return "已切换备用模型";
  if (method === "item/agentMessage/thinking") return "正在思考";
  if (method.includes("toolCall")) return "工具调用";
  if (method.includes("approval")) return "权限确认";
  if (method.includes("question")) return "需要回复";
  if (method.includes("patch")) return "文件变更";
  if (method.includes("checkpoint")) return "检查点";
  if (method === "turn/failed") return "运行失败";
  if (method === "turn/interrupted") return "已停止";
  return "运行详情";
}

function processEventStatus(event: AppEvent): string {
  if (event.method.includes("toolCall")) return toolCallStatusLabel(toolCallStatus(event));
  const status = stringParam(event.params ?? {}, "status");
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "running") return "正在运行";
  if (status === "retrying") return "正在重试";
  if (status === "thinking") return "正在思考";
  if (status === "pending") return "待处理";
  return status;
}

function processEventSummary(event: AppEvent): string {
  const params = event.params ?? {};
  if (event.method === "turn/retrying") {
    const attempt = Number(params.attempt ?? 0);
    const maxAttempts = Number(params.max_attempts ?? 0);
    const model = stringParam(params, "model");
    return `${model || "当前模型"} · 第 ${attempt || "?"}/${maxAttempts || "?"} 次请求`;
  }
  if (event.method === "turn/fallback") {
    return `${stringParam(params, "from_model") || "主模型"} → ${stringParam(params, "to_model") || "备用模型"}`;
  }
  if (event.method.includes("toolCall")) {
    return firstText(params.name, params.tool_name, params.tool, params.command, "工具");
  }
  if (event.method === "item/agentMessage/thinking") return "模型正在组织回复";
  const error = stringParam(params, "error");
  if (error) return userFacingErrorMessage(new Error(error));
  return (
    stringParam(params, "output") ||
    stringParam(params, "message") ||
    stringParam(params, "reason") ||
    processEventTitle(event)
  );
}

function ToolCallEventContent({ event }: { event: AppEvent }) {
  const params = event.params ?? {};
  const status = toolCallStatus(event);
  return (
    <details className={`live-tool-event-details ${statusClass(status)}`} data-testid="live-tool-event-details">
      <summary className="live-tool-event-summary">
        <strong>{processEventTitle(event)}</strong>
        <span>{processEventSummary(event)}</span>
        <small>{toolCallStatusLabel(status)}</small>
        <b className="live-tool-event-action" />
      </summary>
      <pre>{JSON.stringify(params, null, 2)}</pre>
    </details>
  );
}

function EventContent({ event }: { event: AppEvent }) {
  if (isToolCallEvent(event)) return <ToolCallEventContent event={event} />;

  const params = event.params ?? {};
  const status = processEventStatus(event);
  return (
    <details className={`live-tool-event-details ${statusClass(status)}`} data-testid="process-event-details">
      <summary className="live-tool-event-summary">
        <strong>{processEventTitle(event)}</strong>
        <span>{processEventSummary(event)}</span>
        {status ? <small>{status}</small> : null}
        <b className="live-tool-event-action" />
      </summary>
      <pre>{JSON.stringify(params, null, 2)}</pre>
    </details>
  );
}

function liveTurnProcessState(events: AppEvent[], isStreaming: boolean): { label: string; tone: string } {
  const hasFailure = events.some((event) => {
    const status = processEventStatus(event);
    return event.method === "turn/failed" || event.method === "turn/interrupted" || status === "失败" || status === "failed";
  });
  if (hasFailure) return { label: "已停止", tone: "failed" };

  const hasPending = events.some((event) => {
    const status = processEventStatus(event);
    return status === "正在运行" || status === "待处理" || status === "started" || status === "running" || status === "pending";
  });
  if (isStreaming || hasPending) return { label: "正在执行", tone: "running" };
  return { label: "执行完成", tone: "completed" };
}

function LiveTurnProcessCard({ events, isStreaming }: { events: AppEvent[]; isStreaming: boolean }) {
  const state = liveTurnProcessState(events, isStreaming);
  const visibleEvents = events.slice(-6);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);
  const latestEvent = [...events].reverse().find((event) => isVisibleProcessEvent(event));
  const latestSummary = latestEvent ? processEventSummary(latestEvent) : "正在整理执行状态";
  const toolCount = events.filter(isToolCallEvent).length;
  const label = toolCount > 0 ? `${toolCount} 个工具调用` : `${events.length} 条执行状态`;

  return (
    <article className="event-row live-turn-process-row" data-testid="live-turn-process-card">
      <div className="event-glyph">
        <Activity size={16} />
      </div>
      <div className="event-body">
        <details className={`live-turn-process-card ${state.tone}`}>
          <summary className="live-turn-process-summary">
            <strong>{state.label}</strong>
            <span>{latestSummary}</span>
            <small>{label}</small>
            <b className="live-tool-event-action" />
          </summary>
          <div className="live-turn-process-events">
            {hiddenCount > 0 ? <small className="live-turn-process-hidden">已折叠较早的 {hiddenCount} 条状态</small> : null}
            {visibleEvents.map((event, index) => (
              <EventContent event={event} key={`${eventKey(event)}:${index}`} />
            ))}
          </div>
        </details>
      </div>
    </article>
  );
}

function MessagePartCards({ parts }: { parts: MessagePart[] }) {
  if (parts.length === 0) return null;
  return (
    <div className="message-parts">
      {parts.map((part, index) => (
        <MessagePartCard key={`${part.id ?? "part"}:${part.kind ?? "part"}:${index}`} part={part} />
      ))}
    </div>
  );
}

function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentSummary[];
  onRemove?: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-chips">
      {attachments.map((attachment, index) => {
        const id = attachment.id || `${attachment.path || attachment.name}:${index}`;
        const title = attachment.path || attachment.name;
        const detail = [
          formatBytes(attachment.sizeBytes),
          attachment.contentLines ? `${attachment.contentLines} lines` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <span className="attachment-chip" key={id} title={title}>
            <FileText size={13} />
            <span>{attachment.name || attachmentName(attachment.path)}</span>
            {detail ? <small>{detail}</small> : null}
            {onRemove ? (
              <button
                aria-label={`Remove ${attachment.name || attachment.path}`}
                onClick={() => onRemove(id)}
                type="button"
              >
                <XCircle size={12} />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function CheckpointRestoreCard({
  record,
  checkpoint,
  variant = "review",
}: {
  record: CheckpointRestoreRecord;
  checkpoint?: CheckpointSummary;
  variant?: "review" | "timeline";
}) {
  const checkpointId = record.checkpoint_id || checkpoint?.checkpoint_id || "";
  const kind = record.checkpoint_kind || checkpoint?.kind || "checkpoint";
  const kindLabel = checkpointKindLabel(kind);
  const restoredAt = checkpointRestoreTimeLabel(record);
  return (
    <section
      className={`checkpoint-restore-card ${variant}`}
      data-checkpoint-id={checkpointId}
      data-run-id={record.run_id || ""}
      data-testid="checkpoint-restore-history"
    >
      <div className="checkpoint-restore-heading">
        <strong>
          <RotateCcw size={14} />
          工作区已恢复
        </strong>
        <span className="part-status ok">已恢复</span>
      </div>
      <p>
        已恢复到{kindLabel}，工作区文件已回到该快照状态。
      </p>
      <dl className="part-grid">
        {nonEmptyRows([
          ["检查点", compactId(checkpointId)],
          ["恢复任务", compactId(record.run_id)],
          ["文件", checkpointRestoreFileLabel(record, checkpoint)],
          ["恢复时间", restoredAt],
        ]).map(([label, value]) => (
          <div key={`${checkpointId}:${label}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MessagePartCard({ part }: { part: MessagePart }) {
  const kind = part.kind ?? "part";
  const interaction = interactionHistoryItem(part);
  if (interaction) return <TrustHistoryCard item={interaction} variant="timeline" />;
  const mcpTrace = mcpToolTraceFromPart(part);
  const entries = patchEntries(part);
  const rows = partRows(part);
  const preText = partPreText(part);
  const summary = partSummary(part);

  if (kind === "tool" && !mcpTrace) {
    const failed = statusClass(part.status) === "bad";
    return (
      <details
        className={`message-part-card part-tool tool-result-details ${failed ? "failed" : ""}`}
        data-part-kind={kind}
        data-testid="tool-result-details"
      >
        <summary className="tool-result-summary">
          <strong>
            {partIcon(kind)}
            {partTitle(part).replace(/^Tool:\s*/i, "")}
          </strong>
          <span className={`part-status ${statusClass(part.status)}`}>{part.status ?? "completed"}</span>
          <small>{failed ? compactText(summary, 72) : lineCountLabel(summary)}</small>
          <b className="tool-result-action" />
        </summary>
        {rows.length > 0 ? (
          <dl className="part-grid tool-result-grid">
            {rows.map(([label, value]) => (
              <div key={`${label}:${value}`}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {summary ? <pre className="tool-result-output">{summary}</pre> : null}
      </details>
    );
  }

  return (
    <section
      className={`message-part-card part-${kind}${mcpTrace ? " part-mcp-tool" : ""}`}
      data-part-kind={kind}
      data-testid={mcpTrace ? "mcp-tool-card" : undefined}
    >
      <div className="part-heading">
        <strong>
          {mcpTrace ? <PlugZap size={14} /> : partIcon(kind)}
          {partTitle(part)}
        </strong>
        <span className={`part-status ${statusClass(part.status)}`}>{part.status ?? "completed"}</span>
      </div>
      {mcpTrace ? (
        <div className="mcp-trace-strip" aria-label="MCP tool trace">
          <span>{mcpTrace.server || "mcp server"}</span>
          <span>{mcpTrace.transport || "transport"}</span>
          <span>{mcpTrace.dynamicTool || mcpTrace.toolName}</span>
          {mcpTrace.lifecycleReused ? <span>lifecycle reused</span> : null}
          {mcpTrace.lifecyclePid ? <span>pid {mcpTrace.lifecyclePid}</span> : null}
        </div>
      ) : null}
      <p className="part-summary">{summary}</p>
      {rows.length > 0 ? (
        <dl className="part-grid">
          {rows.map(([label, value]) => (
            <div key={`${label}:${value}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {entries.length > 0 ? (
        <div className="part-path-list">
          {entries.slice(0, 6).map((entry, index) => {
            const path = firstText(entry.path) || `entry-${index + 1}`;
            const change = firstText(entry.change, entry.status) || "changed";
            return (
              <div className="part-path-row" key={`${path}:${index}`}>
                <span className={`change-chip change-${change}`}>{change}</span>
                <strong>{path}</strong>
              </div>
            );
          })}
          {entries.length > 6 ? <span className="part-more">+{entries.length - 6} more</span> : null}
        </div>
      ) : null}
      {preText ? <pre className="part-pre">{preText}</pre> : null}
    </section>
  );
}

function QuestionElicitationForm({
  fields,
  isResponding,
  onChange,
  onSubmit,
  onDismiss,
  compact = false,
}: {
  fields: ElicitationField[];
  isResponding: boolean;
  onChange: (index: number, values: string[]) => void;
  onSubmit: () => void;
  onDismiss: () => void;
  compact?: boolean;
}) {
  const hasErrors = fields.some((field) => field.error);
  return (
    <div className={`elicitation-form ${compact ? "compact" : ""}`} data-testid="elicitation-form">
      {fields.map((field) => {
        const inputId = `elicitation-${field.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        return (
          <div className={`elicitation-field elicitation-field-${field.kind}`} key={field.id}>
            <label htmlFor={inputId}>
              {field.label}
              <small>{field.required ? field.kind : "optional"}</small>
            </label>
            {field.description && field.description !== field.label ? <em>{field.description}</em> : null}
            {field.kind === "boolean" ? (
              <label className="elicitation-check" htmlFor={inputId}>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={field.value === "true"}
                  disabled={isResponding}
                  onChange={(event) => onChange(field.index, [event.target.checked ? "true" : "false"])}
                />
                <span>{field.value === "true" ? "Yes" : "No"}</span>
              </label>
            ) : field.kind === "multiselect" ? (
              field.options.length ? (
                <div className="elicitation-options" role="group" aria-labelledby={inputId}>
                  {field.options.map((option) => (
                    <label className="elicitation-check" key={option.value}>
                      <input
                        type="checkbox"
                        checked={field.values.includes(option.value)}
                        disabled={isResponding}
                        onChange={(event) => {
                          const selected = event.target.checked
                            ? [...field.values, option.value]
                            : field.values.filter((value) => value !== option.value);
                          onChange(field.index, selected);
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  id={inputId}
                  value={field.values.join(", ")}
                  disabled={isResponding}
                  rows={2}
                  placeholder={field.placeholder || "Separate answers with commas"}
                  onChange={(event) => onChange(field.index, event.target.value.split(",").map((value) => value.trim()).filter(Boolean))}
                />
              )
            ) : field.kind === "select" ? (
              <select
                id={inputId}
                value={field.value}
                disabled={isResponding}
                onChange={(event) => onChange(field.index, [event.target.value])}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === "number" || field.kind === "integer" ? (
              <input
                id={inputId}
                type="number"
                value={field.value}
                disabled={isResponding}
                min={field.min}
                max={field.max}
                step={field.kind === "integer" ? 1 : "any"}
                placeholder={field.placeholder}
                onChange={(event) => onChange(field.index, [event.target.value])}
              />
          ) : (
            <textarea
              id={inputId}
              value={field.value}
              disabled={isResponding}
              rows={2}
              placeholder={field.placeholder}
              onChange={(event) => onChange(field.index, [event.target.value])}
            />
          )}
            {field.error ? <strong className="elicitation-error">{field.error}</strong> : null}
          </div>
        );
      })}
      <div className="inline-actions">
        <button type="button" disabled={isResponding || hasErrors} onClick={onSubmit}>
          {isResponding ? "Working" : "Reply"}
        </button>
        <button type="button" disabled={isResponding} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function trustHistoryTerminalLabel(item: TrustHistoryItem): string {
  if (item.kind === "approval") {
    if (item.status === "allowed" || item.status === "allow") return "Allowed";
    if (item.status === "denied" || item.status === "deny") return "Denied";
    if (item.status === "pending") return "Waiting";
    return humanizeToken(item.status || "Resolved");
  }
  if (item.status === "answered") return "Answered";
  if (item.status === "dismissed") return "Dismissed";
  if (item.status === "pending") return "Waiting";
  return humanizeToken(item.status || "Resolved");
}

function trustHistoryFlowLabel(item: TrustHistoryItem): string {
  const requested = item.kind === "approval" ? "Requested" : "Asked";
  return `${requested} -> ${trustHistoryTerminalLabel(item)}`;
}

function trustHistoryFlowState(item: TrustHistoryItem): string {
  if (item.status === "pending") return "pending";
  if (item.status === "allowed" || item.status === "answered" || item.status === "allow") return "ok";
  if (item.status === "denied" || item.status === "dismissed" || item.status === "deny") return "blocked";
  return "resolved";
}

function TrustHistoryCard({
  item,
  compact = false,
  variant = "dock",
}: {
  item: TrustHistoryItem;
  compact?: boolean;
  variant?: "dock" | "timeline";
}) {
  return (
    <section
      className={`trust-history-item ${item.tone} ${compact ? "compact" : ""} ${variant}`}
      data-testid="trust-history-item"
      data-part-kind={item.kind}
      data-interaction-status={item.status}
      data-flow-state={trustHistoryFlowState(item)}
      data-request-id={item.requestId}
      data-call-id={item.callId}
    >
      <div className="trust-history-heading">
        <strong>
          {item.kind === "approval" ? <ShieldCheck size={13} /> : <Bot size={13} />}
          {item.title}
        </strong>
        <span className={`part-status ${statusClass(item.status)}`}>{item.status}</span>
      </div>
      <div className="trust-history-flow" data-testid="trust-history-flow" aria-label={trustHistoryFlowLabel(item)}>
        <span>{item.kind === "approval" ? "Requested" : "Asked"}</span>
        <span className="trust-history-flow-line" aria-hidden="true" />
        <span>{trustHistoryTerminalLabel(item)}</span>
      </div>
      <p>{item.summary}</p>
      {item.detail ? <span className="trust-history-detail">{item.detail}</span> : null}
      {!compact ? (
        <dl className="part-grid">
          {nonEmptyRows([
            ["Request", compactId(item.requestId)],
            ["Call", compactId(item.callId)],
          ]).map(([label, value]) => (
            <div key={`${item.id}:${label}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function stringParam(params: JsonRecord, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

async function readSse(response: Response, onEvents?: SseEventHandler): Promise<AppEvent[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AppEvent[] = [];

  async function emit(event: AppEvent | null) {
    if (!event) return;
    events.push(event);
    await onEvents?.([event]);
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = parseFrame(frame);
      await emit(event);
      if (shouldYieldStreamPaint(event)) await nextPaint();
      split = buffer.indexOf("\n\n");
    }
  }
  const event = parseFrame(buffer);
  await emit(event);
  if (shouldYieldStreamPaint(event)) await nextPaint();
  return events;
}

function shouldYieldStreamPaint(event: AppEvent | null): boolean {
  return event?.method === "turn/completed" || event?.method === "turn/failed" || event?.method === "turn/interrupted";
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(resolve, 16);
    }
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseFrame(frame: string): AppEvent | null {
  const lines = frame
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"));
  if (!lines.length) return null;
  const data = lines.map((line) => line.replace(/^data:\s?/, "")).join("\n").trim();
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as AppEvent;
    return parsed.method ? parsed : null;
  } catch {
    return null;
  }
}
