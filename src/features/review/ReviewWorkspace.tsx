import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  RotateCcw,
  Send,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import "./review-workspace.css";

export type ReviewDiffRow = {
  kind?: string;
  old_line?: number | null;
  new_line?: number | null;
  old?: string | null;
  new?: string | null;
};

export type ReviewPatch = {
  id?: string;
  path: string;
  status?: string;
  runId?: string;
  diff?: string;
  sideBySide?: {
    oldLabel?: string;
    newLabel?: string;
    rows?: ReviewDiffRow[];
    truncated?: boolean;
    omittedRows?: number;
  };
};

export type ReviewFile = {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
};

type ReviewGitWorkflow = {
  branch?: string;
  base_branch?: string;
  change_count?: number;
  changes?: Array<{ path?: string }>;
  summary?: {
    title?: string;
    body?: string;
    base_branch?: string;
    head_branch?: string;
    file_count?: number;
    additions?: number;
    deletions?: number;
  } | null;
  handoff?: {
    status?: string;
    title?: string;
    url?: string;
    error?: string;
  } | null;
  last_result?: {
    action?: string;
    status?: string;
    commit?: string;
    message?: string;
    error?: string;
  } | null;
  pending?: {
    workflow_action?: string;
    input?: Record<string, unknown>;
  } | null;
};

type ReviewWorkspaceProps = {
  projectLabel: string;
  branch?: string;
  files: ReviewFile[];
  patches: ReviewPatch[];
  selectedDiff?: ReviewPatch | null;
  selectedPath: string;
  previewContent?: string | null;
  redoCount: number;
  canUndoSelected: boolean;
  undoingSelected?: boolean;
  canRestoreTurn: boolean;
  restoringTurn: boolean;
  restoreCompleted: boolean;
  restoreTargetId?: string;
  decisionStatus?: string;
  decisionBusy?: boolean;
  error?: string;
  gitWorkflow?: ReviewGitWorkflow | null;
  gitWorkflowBusy?: string;
  gitWorkflowError?: string;
  hasPendingGitApproval?: boolean;
  onBack: () => void;
  onSelectPath: (path: string) => void;
  onAccept: () => void;
  onRequestChanges: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRestoreTurn: () => void;
  onCreateBranch: (branch: string) => void;
  onCommit: (message: string, paths: string[]) => void;
  onGenerateSummary: (baseBranch: string, title: string) => void;
  onCreateReview: (input: Record<string, unknown>) => void;
  onGitApproval: (action: "allow" | "deny") => void;
};

function changeLabel(status = "") {
  const normalized = status.trim().toLowerCase();
  if (normalized.includes("added") || normalized === "a" || normalized === "??") return "新增";
  if (normalized.includes("deleted") || normalized === "d") return "删除";
  if (normalized.includes("rename") || normalized === "r") return "重命名";
  return "修改";
}

function countChangedLines(patches: ReviewPatch[]) {
  let additions = 0;
  let deletions = 0;
  for (const patch of patches) {
    for (const line of (patch.diff ?? "").split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
  }
  return { additions, deletions };
}

function lineNumber(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function workflowActionLabel(action = "") {
  switch (action) {
    case "create_branch":
      return "创建并切换 Git 分支";
    case "commit":
      return "提交选中的工作区变更";
    case "create_pr":
      return "推送分支并创建 Pull Request";
    default:
      return "执行 Git/GitHub 写操作";
  }
}

export function ReviewWorkspace({
  projectLabel,
  branch,
  files,
  patches,
  selectedDiff,
  selectedPath,
  previewContent,
  redoCount,
  canUndoSelected,
  undoingSelected,
  canRestoreTurn,
  restoringTurn,
  restoreCompleted,
  restoreTargetId,
  decisionStatus,
  decisionBusy,
  error,
  gitWorkflow,
  gitWorkflowBusy = "",
  gitWorkflowError,
  hasPendingGitApproval,
  onBack,
  onSelectPath,
  onAccept,
  onRequestChanges,
  onUndo,
  onRedo,
  onRestoreTurn,
  onCreateBranch,
  onCommit,
  onGenerateSummary,
  onCreateReview,
  onGitApproval,
}: ReviewWorkspaceProps) {
  const [confirmUndoPath, setConfirmUndoPath] = useState("");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [branchDraft, setBranchDraft] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [baseBranchDraft, setBaseBranchDraft] = useState("");
  const [summaryTitle, setSummaryTitle] = useState("");
  const [summaryBody, setSummaryBody] = useState("");
  const [draftReview, setDraftReview] = useState(true);
  useEffect(() => setConfirmUndoPath(""), [selectedPath]);
  useEffect(() => {
    setBaseBranchDraft(gitWorkflow?.summary?.base_branch || gitWorkflow?.base_branch || "main");
    setSummaryTitle(gitWorkflow?.summary?.title || "");
    setSummaryBody(gitWorkflow?.summary?.body || "");
  }, [gitWorkflow?.base_branch, gitWorkflow?.summary]);
  const patch = patches.find((item) => item.path === selectedPath) ??
    (selectedDiff?.path === selectedPath ? selectedDiff : undefined);
  const diffRows = patch?.sideBySide?.rows ?? [];
  const fallbackCounts = countChangedLines(patches);
  const hasFileCounts = files.some((file) => file.additions != null || file.deletions != null);
  const counts = hasFileCounts
    ? files.reduce(
        (total, file) => ({
          additions: total.additions + (file.additions ?? 0),
          deletions: total.deletions + (file.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      )
    : fallbackCounts;
  const reviewedCount = new Set([...files.map((file) => file.path), ...patches.map((item) => item.path)]).size;
  const uncommittedPaths = (gitWorkflow?.changes ?? [])
    .map((change) => change.path?.trim() || "")
    .filter(Boolean);

  return (
    <section className="change-review-workspace" data-testid="review-panel">
      <header className="change-review-header">
        <button className="review-back-button" onClick={onBack} type="button">
          <ArrowLeft size={16} />
          返回对话
        </button>
        <div className="change-review-heading">
          <span>变更审查</span>
          <strong>{projectLabel}</strong>
        </div>
        <div className="change-review-actions">
          <button
            className={workflowOpen ? "selected" : ""}
            onClick={() => setWorkflowOpen((current) => !current)}
            type="button"
          >
            <GitPullRequest size={15} />
            提交与交付
          </button>
          <button disabled={decisionBusy} onClick={onRequestChanges} type="button">
            要求修改
          </button>
          <button className="review-accept-button" disabled={decisionBusy} onClick={onAccept} type="button">
            <Check size={15} />
            完成审查
          </button>
        </div>
      </header>

      <div className="change-review-summary" aria-label="Change summary">
        <div>
          <strong>{reviewedCount}</strong>
          <span>个文件</span>
        </div>
        <div className="review-additions">
          <strong>+{counts.additions}</strong>
          <span>新增</span>
        </div>
        <div className="review-deletions">
          <strong>-{counts.deletions}</strong>
          <span>删除</span>
        </div>
        <div className="review-branch">
          <GitBranch size={14} />
          <span>{branch || "工作区"}</span>
        </div>
        {decisionStatus ? (
          <div className="review-decision-state" data-testid="review-decision-state">
            <CheckCircle2 size={14} />
            <span>{decisionStatus === "accepted" ? "已完成审查" : "已要求修改"}</span>
          </div>
        ) : null}
      </div>

      <div className={`change-review-body ${workflowOpen ? "workflow-open" : ""}`}>
        <aside className="change-review-files" aria-label="Changed files">
          <div className="change-review-files-title">
            <strong>文件</strong>
            <span>{reviewedCount}</span>
          </div>
          <div className="change-review-file-list">
            {files.map((file) => (
              <button
                className={file.path === selectedPath ? "selected" : ""}
                data-testid="change-review-card"
                key={file.path}
                onClick={() => onSelectPath(file.path)}
                type="button"
              >
                <FileCode2 size={14} />
                <span title={file.path}>{file.path}</span>
                <small>
                  {file.binary
                    ? "二进制"
                    : `${changeLabel(file.status)}${file.additions || file.deletions ? ` +${file.additions ?? 0} -${file.deletions ?? 0}` : ""}`}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <main className="change-review-diff">
          <div className="change-review-diff-header">
            <div>
              <strong>{selectedPath || patch?.path || "暂无文件变更"}</strong>
              <span>{patch ? changeLabel(patch.status) : "当前文件"}</span>
            </div>
            <div className="change-review-diff-actions">
              <button
                disabled={!canUndoSelected || undoingSelected}
                onClick={() => {
                  if (confirmUndoPath === selectedPath) {
                    setConfirmUndoPath("");
                    onUndo();
                  } else {
                    setConfirmUndoPath(selectedPath);
                  }
                }}
                title="撤销 Agent 最近一轮对选中文件的变更"
                type="button"
              >
                <Undo2 size={14} />
                {undoingSelected ? "正在撤销" : confirmUndoPath === selectedPath ? "确认撤销" : "撤销此文件"}
              </button>
              <button disabled={!redoCount} onClick={onRedo} title="重做最近撤销的文件变更" type="button">
                重做
              </button>
            </div>
          </div>

          {diffRows.length ? (
            <div className="change-review-split" data-testid="review-diff">
              <div className="change-review-split-labels">
                <span>{patch?.sideBySide?.oldLabel || "修改前"}</span>
                <span>{patch?.sideBySide?.newLabel || "修改后"}</span>
              </div>
              <div className="change-review-split-rows">
                {diffRows.map((row, index) => (
                  <div className={`change-review-split-row ${row.kind || "context"}`} key={`${row.old_line}:${row.new_line}:${index}`}>
                    <div className="change-review-code-cell old">
                      <span>{lineNumber(row.old_line)}</span>
                      <code>{row.old ?? ""}</code>
                    </div>
                    <div className="change-review-code-cell new">
                      <span>{lineNumber(row.new_line)}</span>
                      <code>{row.new ?? ""}</code>
                    </div>
                  </div>
                ))}
              </div>
              {patch?.sideBySide?.truncated ? (
                <p className="change-review-truncated">还有 {patch.sideBySide.omittedRows ?? 0} 行未显示</p>
              ) : null}
            </div>
          ) : patch?.diff ? (
            <pre className="change-review-unified" data-testid="review-diff">{patch.diff}</pre>
          ) : previewContent != null ? (
            <pre className="change-review-preview" data-testid="review-file-preview">{previewContent}</pre>
          ) : (
            <div className="change-review-empty">这个文件没有可展示的文本差异。</div>
          )}
        </main>

        {workflowOpen ? (
          <aside className="change-review-workflow" aria-label="Git and GitHub workflow" data-testid="git-workflow-panel">
            <div className="review-workflow-heading">
              <div>
                <strong>提交与交付</strong>
                <span>所有写操作都需要批准</span>
              </div>
              <button onClick={() => setWorkflowOpen(false)} title="关闭" type="button">
                <X size={15} />
              </button>
            </div>

            <div className="review-workflow-status">
              <span><GitBranch size={13} /> 当前分支</span>
              <strong>{gitWorkflow?.branch || branch || "-"}</strong>
              <small>{gitWorkflow?.change_count ?? files.length} 个未提交文件</small>
            </div>

            {hasPendingGitApproval ? (
              <section className="review-workflow-approval" data-testid="git-workflow-approval">
                <strong>等待批准</strong>
                <p>{workflowActionLabel(gitWorkflow?.pending?.workflow_action)}</p>
                <div>
                  <button disabled={Boolean(gitWorkflowBusy)} onClick={() => onGitApproval("deny")} type="button">
                    拒绝
                  </button>
                  <button
                    className="primary"
                    disabled={Boolean(gitWorkflowBusy)}
                    onClick={() => onGitApproval("allow")}
                    type="button"
                  >
                    <Check size={13} />
                    批准并执行
                  </button>
                </div>
              </section>
            ) : null}

            <section className="review-workflow-section">
              <div className="review-workflow-section-title">
                <GitBranch size={14} />
                <strong>分支</strong>
              </div>
              <label>
                <span>新分支名称</span>
                <input
                  onChange={(event) => setBranchDraft(event.target.value)}
                  placeholder="feature/review-ready"
                  value={branchDraft}
                />
              </label>
              <button
                disabled={
                  !branchDraft.trim() ||
                  branchDraft.trim() === (gitWorkflow?.branch || branch) ||
                  Boolean(gitWorkflowBusy) ||
                  hasPendingGitApproval
                }
                onClick={() => onCreateBranch(branchDraft.trim())}
                type="button"
              >
                请求创建分支
              </button>
            </section>

            <section className="review-workflow-section">
              <div className="review-workflow-section-title">
                <GitCommitHorizontal size={14} />
                <strong>提交</strong>
              </div>
              <label>
                <span>提交说明</span>
                <input
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Describe this change"
                  value={commitMessage}
                />
              </label>
              <button
                disabled={!commitMessage.trim() || !uncommittedPaths.length || Boolean(gitWorkflowBusy) || hasPendingGitApproval}
                onClick={() => onCommit(commitMessage.trim(), uncommittedPaths)}
                type="button"
              >
                请求提交 {uncommittedPaths.length} 个文件
              </button>
            </section>

            <section className="review-workflow-section">
              <div className="review-workflow-section-title">
                <GitPullRequest size={14} />
                <strong>Pull Request</strong>
              </div>
              <label>
                <span>目标分支</span>
                <input onChange={(event) => setBaseBranchDraft(event.target.value)} value={baseBranchDraft} />
              </label>
              <label>
                <span>标题</span>
                <input
                  onChange={(event) => setSummaryTitle(event.target.value)}
                  placeholder="根据提交自动生成"
                  value={summaryTitle}
                />
              </label>
              <button
                disabled={!baseBranchDraft.trim() || Boolean(gitWorkflowBusy) || hasPendingGitApproval}
                onClick={() => onGenerateSummary(baseBranchDraft.trim(), summaryTitle)}
                type="button"
              >
                {gitWorkflowBusy === "summary" ? "正在生成" : "生成 PR 摘要"}
              </button>
              {gitWorkflow?.summary ? (
                <>
                  <label>
                    <span>Review handoff</span>
                    <textarea onChange={(event) => setSummaryBody(event.target.value)} rows={8} value={summaryBody} />
                  </label>
                  <label className="review-workflow-checkbox">
                    <input
                      checked={draftReview}
                      onChange={(event) => setDraftReview(event.target.checked)}
                      type="checkbox"
                    />
                    <span>先创建为 Draft PR</span>
                  </label>
                  <button
                    className="primary"
                    disabled={
                      !summaryTitle.trim() ||
                      !summaryBody.trim() ||
                      Boolean(gitWorkflowBusy) ||
                      hasPendingGitApproval ||
                      Boolean(gitWorkflow?.handoff?.url)
                    }
                    onClick={() => onCreateReview({
                      title: summaryTitle.trim(),
                      body: summaryBody.trim(),
                      base_branch: baseBranchDraft.trim(),
                      draft: draftReview,
                    })}
                    type="button"
                  >
                    <Send size={13} />
                    {gitWorkflow?.handoff?.url ? "PR 已创建" : "请求推送并创建 PR"}
                  </button>
                </>
              ) : null}
            </section>

            {gitWorkflow?.handoff?.url ? (
              <a
                className="review-workflow-handoff"
                href={gitWorkflow.handoff.url}
                rel="noreferrer"
                target="_blank"
              >
                <GitPullRequest size={14} />
                <span>
                  <strong>Review 已交付</strong>
                  <small>{gitWorkflow.handoff.url}</small>
                </span>
                <ChevronRight size={14} />
              </a>
            ) : null}

            {gitWorkflow?.last_result?.commit ? (
              <p className="review-workflow-notice">
                已提交 {gitWorkflow.last_result.commit.slice(0, 8)}
              </p>
            ) : null}
            {gitWorkflowError || gitWorkflow?.last_result?.error ? (
              <p className="review-workflow-error">{gitWorkflowError || gitWorkflow?.last_result?.error}</p>
            ) : null}
          </aside>
        ) : null}
      </div>

      <footer className="change-review-footer">
        <div>
          <strong>{restoreCompleted ? "工作区已恢复" : "不满意这轮修改？"}</strong>
          <span>{restoreCompleted ? "文件已经回到本轮执行前。" : "整轮恢复会回到这次任务开始前，不展示内部检查点。"}</span>
          {error ? <span className="change-review-error">{error}</span> : null}
        </div>
        <button
          className="review-restore-button"
          data-checkpoint-id={restoreTargetId || ""}
          data-testid="review-restore-turn"
          disabled={!canRestoreTurn || restoringTurn || restoreCompleted}
          onClick={onRestoreTurn}
          type="button"
        >
          <RotateCcw size={14} />
          {restoringTurn ? "正在恢复" : restoreCompleted ? "已恢复" : "恢复整轮"}
        </button>
      </footer>
    </section>
  );
}
