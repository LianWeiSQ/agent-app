import { Activity, ArrowUpToLine, Circle, Clock3, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import type { CSSProperties } from "react";

export type TaskCanonicalStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type SessionTaskNode = {
  id?: string;
  task_id?: string;
  session_id?: string;
  run_id?: string;
  status?: string;
  canonical_status?: TaskCanonicalStatus;
  title?: string;
  description?: string | null;
  subagent_type?: string;
  agent?: string | null;
  background?: boolean;
  execution_mode?: "background" | "foreground" | string;
  resume_count?: number;
  cancel_requested?: boolean;
  provider?: string | null;
  model?: string | null;
  permission?: string | null;
  max_steps?: number | null;
  workspace?: string | null;
  workspace_isolation?: {
    enabled?: boolean;
    method?: string;
    source_workspace?: string;
    workspace?: string;
  } | null;
  role?: {
    id?: string;
    name?: string;
    description?: string | null;
    permission?: string | null;
  } | null;
  input?: {
    summary?: string | null;
    redacted?: boolean;
  } | null;
  allowed_tools?: string[];
  progress?: {
    status?: TaskCanonicalStatus | string;
    completed_steps?: number;
    tool_call_count?: number;
    completed_tool_calls?: number;
    failed_tool_calls?: number;
    event_count?: number;
    last_event?: string | null;
    last_event_at_ms?: number | null;
    started_at_ms?: number | null;
    ended_at_ms?: number | null;
    duration_ms?: number | null;
  } | null;
  result?: {
    summary?: string | null;
    changed?: unknown[];
    verified?: unknown[];
    remaining?: unknown[];
  } | null;
  failure?: {
    message?: string | null;
    finish_reason?: string | null;
    phase?: string | null;
  } | null;
  task_depth?: number | null;
  parent_session_id?: string | null;
  parent_run_id?: string | null;
  parent_tool_call_id?: string | null;
  updated_at_ms?: number;
  error?: string | null;
  children?: SessionTaskNode[];
};

export type TaskLifecycleAction = "start" | "wait" | "promote" | "cancel" | "resume";

export type SessionTaskTreePayload = {
  schema_version?: string;
  session_id?: string;
  count?: number;
  status_counts?: Partial<Record<TaskCanonicalStatus, number>>;
  tasks?: SessionTaskNode[];
  flat_tasks?: SessionTaskNode[];
  tree?: SessionTaskNode[];
  error?: string;
};

export function taskNodeId(task?: SessionTaskNode | null): string {
  return task?.task_id || task?.session_id || task?.id || "";
}

export function taskStatus(task?: SessionTaskNode | null): TaskCanonicalStatus {
  if (task?.canonical_status) return task.canonical_status;
  switch ((task?.status || "").toLowerCase()) {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "in_progress":
    case "streaming":
    case "retrying":
      return "running";
    case "waiting":
    case "waiting_approval":
    case "waiting_question":
    case "blocked":
      return "waiting";
    case "completed":
    case "success":
      return "completed";
    case "failed":
    case "error":
    case "expired":
      return "failed";
    case "canceled":
    case "cancelled":
    case "interrupted":
      return "cancelled";
    default:
      return "unknown";
  }
}

export function taskStatusLabel(status: TaskCanonicalStatus): string {
  return {
    queued: "排队中",
    running: "执行中",
    waiting: "等待中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    unknown: "未知",
  }[status];
}

function taskLifecycleActions(task: SessionTaskNode): TaskLifecycleAction[] {
  switch (taskStatus(task)) {
    case "queued":
      return ["start", "promote", "cancel"];
    case "running":
    case "waiting":
      return task.cancel_requested ? ["wait"] : ["wait", "cancel"];
    case "failed":
    case "cancelled":
      return ["resume"];
    default:
      return [];
  }
}

const taskActionLabels: Record<TaskLifecycleAction, string> = {
  start: "后台启动",
  wait: "等待结果",
  promote: "提升前台",
  cancel: "取消",
  resume: "恢复",
};

function taskDurationLabel(durationMs?: number | null): string {
  if (!durationMs || durationMs < 1_000) return durationMs ? `${durationMs}ms` : "-";
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function taskProgressLabel(task: SessionTaskNode): string {
  const status = taskStatus(task);
  if (status === "queued") return "等待执行";
  if (status === "waiting") return task.cancel_requested ? "正在安全停止" : "等待交互";
  if (status === "cancelled") return "已停止";
  if (status === "failed") return "执行失败";
  if (status === "completed") return "执行完成";
  const step = task.progress?.completed_steps ?? 0;
  return step ? `已完成 ${step} 步` : "正在启动";
}

function taskProgressPercent(task: SessionTaskNode): number {
  const status = taskStatus(task);
  if (["completed", "failed", "cancelled"].includes(status)) return 100;
  const maxSteps = task.max_steps ?? 0;
  const completedSteps = task.progress?.completed_steps ?? 0;
  if (!maxSteps) return completedSteps ? 32 : status === "queued" ? 4 : 14;
  return Math.max(status === "queued" ? 4 : 10, Math.min(92, Math.round((completedSteps / maxSteps) * 100)));
}

function TaskActionIcon({ action }: { action: TaskLifecycleAction }) {
  switch (action) {
    case "start":
      return <Play aria-hidden="true" size={13} />;
    case "wait":
      return <Clock3 aria-hidden="true" size={13} />;
    case "promote":
      return <ArrowUpToLine aria-hidden="true" size={13} />;
    case "cancel":
      return <Square aria-hidden="true" size={12} />;
    case "resume":
      return <RotateCcw aria-hidden="true" size={13} />;
  }
}

export function flatTaskTree(tree: SessionTaskNode[] = []): SessionTaskNode[] {
  const output: SessionTaskNode[] = [];
  const visit = (nodes: SessionTaskNode[]) => {
    for (const node of nodes) {
      output.push(node);
      visit(node.children ?? []);
    }
  };
  visit(tree);
  return output;
}

function taskCounts(payload: SessionTaskTreePayload): Record<TaskCanonicalStatus, number> {
  const counts: Record<TaskCanonicalStatus, number> = {
    queued: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    unknown: 0,
  };
  const source = payload.status_counts;
  if (source) {
    for (const status of Object.keys(counts) as TaskCanonicalStatus[]) {
      counts[status] = source[status] ?? 0;
    }
    return counts;
  }
  for (const task of payload.flat_tasks ?? flatTaskTree(payload.tree)) {
    counts[taskStatus(task)] += 1;
  }
  return counts;
}

function taskSummary(payload: SessionTaskTreePayload): string {
  const counts = taskCounts(payload);
  const active = counts.running + counts.queued + counts.waiting;
  const issues = counts.failed + counts.cancelled;
  const parts = [`${payload.count ?? (payload.flat_tasks ?? flatTaskTree(payload.tree)).length} 个任务`];
  if (active) parts.push(`${active} 个进行中`);
  if (counts.completed) parts.push(`${counts.completed} 个完成`);
  if (issues) parts.push(`${issues} 个需关注`);
  return parts.join(" · ");
}

export function TaskTreeSummary({
  payload,
  onOpen,
}: {
  payload: SessionTaskTreePayload;
  onOpen: () => void;
}) {
  if (!(payload.count ?? payload.flat_tasks?.length ?? flatTaskTree(payload.tree).length)) return null;
  const counts = taskCounts(payload);
  const tone = counts.failed ? "failed" : counts.running || counts.waiting || counts.queued ? "active" : "completed";
  return (
    <button className={`task-tree-summary ${tone}`} data-testid="task-tree-summary" onClick={onOpen} type="button">
      <Activity aria-hidden="true" size={15} />
      <strong>任务树</strong>
      <span>{taskSummary(payload)}</span>
      <small>查看</small>
    </button>
  );
}

function TaskTreeRows({
  nodes,
  depth,
  selectedTaskId,
  onSelectTask,
}: {
  nodes: SessionTaskNode[];
  depth: number;
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
}) {
  return nodes.map((task) => {
    const id = taskNodeId(task);
    const status = taskStatus(task);
    return (
      <div className="task-tree-branch" key={id}>
        <button
          className={`task-tree-row ${selectedTaskId === id ? "selected" : ""}`}
          data-task-id={id}
          onClick={() => onSelectTask(id)}
          style={{ "--task-depth": depth } as CSSProperties}
          type="button"
        >
          <Circle aria-hidden="true" className={`task-tree-dot ${status}`} size={9} />
          <strong>{task.title || task.subagent_type || "未命名任务"}</strong>
          <small>{taskStatusLabel(status)}</small>
        </button>
        {task.children?.length ? (
          <TaskTreeRows
            depth={depth + 1}
            nodes={task.children}
            onSelectTask={onSelectTask}
            selectedTaskId={selectedTaskId}
          />
        ) : null}
      </div>
    );
  });
}

export function TaskTreeInspector({
  payload,
  selectedTaskId,
  busy,
  error,
  actionBusy,
  actionNotice,
  onSelectTask,
  onRefresh,
  onTaskAction,
}: {
  payload: SessionTaskTreePayload;
  selectedTaskId: string;
  busy: boolean;
  error: string;
  actionBusy: string;
  actionNotice: string;
  onSelectTask: (taskId: string) => void;
  onRefresh: () => void;
  onTaskAction: (action: TaskLifecycleAction, task: SessionTaskNode) => void;
}) {
  const flat = payload.flat_tasks ?? flatTaskTree(payload.tree);
  const selected = flat.find((task) => taskNodeId(task) === selectedTaskId) ?? flat[0];
  const counts = taskCounts(payload);
  return (
    <div className="inspector-card task-tree-inspector-card" data-testid="task-tree-inspector">
      <div className="inspector-title">
        <Activity size={15} />
        任务树
        <span className={`trust-count ${counts.failed ? "bad" : counts.running || counts.waiting || counts.queued ? "pending" : "clear"}`}>
          {taskSummary(payload)}
        </span>
        <button disabled={busy} onClick={onRefresh} title="刷新任务树" type="button">
          <RefreshCw className={busy ? "spin" : ""} size={13} />
        </button>
      </div>
      {payload.tree?.length ? (
        <div className="task-tree-list" role="tree">
          <TaskTreeRows depth={0} nodes={payload.tree} onSelectTask={onSelectTask} selectedTaskId={taskNodeId(selected)} />
        </div>
      ) : (
        <p className="muted-line">当前会话还没有子任务。</p>
      )}
      {selected ? (
        <div className="task-agent-detail" data-testid="selected-task-detail">
          <div className="task-agent-heading">
            <div>
              <strong>{selected.role?.name || selected.subagent_type || selected.agent || "Agent"}</strong>
              <span>{selected.role?.description || selected.title || "子任务执行角色"}</span>
            </div>
            <span className={`task-agent-status ${taskStatus(selected)}`}>
              {selected.cancel_requested ? "正在取消" : taskStatusLabel(taskStatus(selected))}
            </span>
          </div>

          <section className="task-agent-progress" data-testid="task-agent-progress">
            <div>
              <strong>{taskProgressLabel(selected)}</strong>
              <span>
                {selected.progress?.completed_steps ?? 0}/{selected.max_steps ?? "-"} 步
                {selected.progress?.tool_call_count ? ` · ${selected.progress.tool_call_count} 次工具调用` : ""}
              </span>
            </div>
            <div className={`task-agent-progress-track ${taskStatus(selected)}`} aria-hidden="true">
              <span style={{ width: `${taskProgressPercent(selected)}%` }} />
            </div>
          </section>

          <dl className="task-tree-detail">
            <dt>任务输入</dt>
            <dd>{selected.input?.summary || selected.description || selected.title || "-"}</dd>
            <dt>执行模式</dt>
            <dd>{selected.execution_mode === "foreground" || !selected.background ? "前台" : "后台"}</dd>
            <dt>权限</dt>
            <dd>{selected.role?.permission || selected.permission || "继承会话"}</dd>
            <dt>隔离</dt>
            <dd title={selected.workspace_isolation?.workspace || selected.workspace || ""}>
              {selected.workspace_isolation?.enabled
                ? `独立工作区 · ${selected.workspace_isolation.method || "isolated"}`
                : "共享项目工作区"}
            </dd>
            <dt>模型</dt>
            <dd>{selected.model || "继承会话"}</dd>
            <dt>耗时</dt>
            <dd>{taskDurationLabel(selected.progress?.duration_ms)}</dd>
            {selected.resume_count ? (
              <>
                <dt>恢复</dt>
                <dd>{selected.resume_count} 次</dd>
              </>
            ) : null}
          </dl>

          <section className="task-agent-scope" data-testid="task-agent-tools">
            <strong>允许工具</strong>
            <div>
              {selected.allowed_tools?.length
                ? selected.allowed_tools.map((tool) => <span key={tool}>{tool}</span>)
                : <small>未授予工具</small>}
            </div>
          </section>

          {selected.result?.summary ? (
            <section className="task-agent-result" data-testid="task-agent-result">
              <strong>最终结果</strong>
              <p>{selected.result.summary}</p>
            </section>
          ) : null}

          {selected.failure?.message || selected.error ? (
            <section className="task-agent-failure" data-testid="task-agent-failure">
              <strong>失败原因</strong>
              <p>{selected.failure?.message || selected.error}</p>
            </section>
          ) : null}
        </div>
      ) : null}
      {selected && taskLifecycleActions(selected).length ? (
        <div className="task-tree-actions" data-testid="task-tree-actions">
          {taskLifecycleActions(selected).map((action) => {
            const actionKey = `${taskNodeId(selected)}:${action}`;
            return (
              <button
                className={action === "cancel" ? "danger" : action === "promote" ? "primary" : ""}
                data-testid={`task-action-${action}`}
                disabled={Boolean(actionBusy)}
                key={action}
                onClick={() => onTaskAction(action, selected)}
                type="button"
              >
                {actionBusy === actionKey ? <RefreshCw aria-hidden="true" className="spin" size={13} /> : <TaskActionIcon action={action} />}
                {taskActionLabels[action]}
              </button>
            );
          })}
        </div>
      ) : null}
      {actionNotice ? <p className="task-tree-notice" role="status">{actionNotice}</p> : null}
      {error ? <p className="task-tree-error" role="alert">{error}</p> : null}
    </div>
  );
}
