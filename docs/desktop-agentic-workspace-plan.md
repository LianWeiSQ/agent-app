# Desktop Agentic Workspace Plan

This document is the product planning source for moving OpenAgent/OpenHarness toward a Rust-first Desktop Agentic Coding Workspace, aligned with the interaction shape of Codex, Zcode, and Claude Code Desktop.

It is intentionally product-facing: it lists what exists, what is partial, what is missing, and the order in which the project should move.

## Product Direction

OpenAgent should become a desktop-first coding agent workspace:

- Desktop is the primary product surface.
- Rust Bridge API is the shared local runtime API.
- Rust Agent Runtime is the source of truth for turns, tools, permissions, checkpoints, messages, and MCP.
- CLI and TUI are compatibility and automation surfaces over the same runtime state.
- No Python runtime should be reintroduced as a main path.
- Secrets, API keys, local provider endpoints, and local tokens must stay out of git history and product docs.

The core product rule:

```text
Every surface is a projection of the same durable runtime state.
```

## Current Capabilities

### Desktop App

Status: usable for local packaged validation, but still product-polish heavy.

Available:

- Packaged Tauri desktop app.
- Project list and project switching.
- Sessions under projects.
- Session rename and delete.
- New session creation under a project.
- Codex-like conversation timeline layout.
- Markdown rendering for assistant output, including lists, tables, code blocks, inline code, and bold text.
- Collapsed tool-call cards in the timeline.
- Composer with model selector and permission selector.
- Bridge lifecycle managed by the desktop app.
- Local workspace/session root wiring for packaged app smoke.
- MCP panel and lifecycle actions.
- Approval/question dock and resolved history.
- Checkpoint/diff/restore workflow exposed in UI.
- Basic provider/model health display.

Partial:

- Session switching was recently tightened, but needs more smoke coverage.
- Tool progress rendering is more readable, but long-turn status still needs a clearer "what is happening now" state model.
- Model switching exists, but provider/model catalog UX is still simple.
- Composer UX is close to Codex visually, but the `+` menu is not implemented.
- Permission selector maps to runtime permission flags, but the product explanation and risk display are still shallow.

Missing:

- Desktop file/folder attachments.
- Desktop document/image/media attachments.
- Goal mode.
- Plan mode as a real product mode.
- Workspace file browser as a first-class panel.
- Git/diff review as a first-class panel.
- Full background task/task tree navigation.
- Subagent panes.
- Durable failure diagnostics visible in the timeline.
- Cross-platform packaged validation for Windows.

### Rust Bridge

Status: the correct center of the product, with several usable APIs already in place.

Available:

- Health, provider, model, session, turn, and event APIs.
- SSE/global event replay.
- Session messages API.
- Approval/question routes.
- Interrupt route.
- MCP config and lifecycle routes.
- Files API for workspace listing and content preview.
- Git/diff/checkpoint/restore routes.
- Turn queue and background turn status.
- Basic auth token support for local desktop use.

Partial:

- Event model is usable but not yet the only source of truth for every UI state.
- Error states exist but are not consistently normalized for user-friendly UI.
- Session state recovery is file-backed but not yet fully productized for crash/restart scenarios.
- Attachments are not a Bridge API contract yet.
- Goal/plan state is not a Bridge API contract yet.

Missing:

- First-class attachment routes.
- First-class goal routes.
- First-class plan-mode routes.
- Better durable turn diagnostics and retry/fallback metadata.
- Stable API contract docs for desktop/TUI/CLI consumers.

### Rust Agent Runtime

Status: capable enough for real local turns, still needs durability and product-mode hardening.

Available:

- Multi-step agent loop.
- Provider requests through OpenAI-compatible APIs.
- Tool execution.
- Built-in workspace tools.
- Permission rulesets.
- Approval/question pause and resume.
- MCP tool bridge.
- Session/message persistence.
- Checkpoint and restore primitives.
- Context and instruction loading.

Partial:

- Provider streaming and event projection are present, but UI-level streaming needs stable ordering and failure semantics.
- Provider retry exists, but upstream outage handling should become visible and configurable.
- MCP lifecycle reuse works, but Desktop needs stronger inspection and error rendering.
- Session recovery works in parts, but interrupted or failed turns still need better continuation semantics.

Missing:

- Attachment-aware context assembly.
- Goal-aware context assembly.
- Plan-only execution policy that guarantees no write/side-effect tools.
- Strong task-level status model: running, waiting, retrying, failed, resumable, completed.
- More complete rollback/checkpoint UX integration.

### CLI and TUI

Status: important surfaces, but not the main product direction.

Available:

- CLI `run`, session, models, agent, plugin, MCP, auth/provider, skills, debug, attach, approval/question, import/export/share/checkpoint/restore style surfaces.
- CLI text file attachment with `--file`/`-f`.
- TUI session picker, file/model/agent pickers, approval/question docks, diff/checkpoint rendering, and Bridge attach/control concepts.

Partial:

- CLI/TUI parity is not the primary workstream now.
- CLI file attachments are prompt-injection style, not a shared Bridge API attachment model.
- TUI still trails the Desktop product experience.

Missing:

- Unified attachment contract shared by Desktop, CLI, TUI, and Bridge.
- Unified goal and plan-mode contract shared by all surfaces.

## Capability Matrix

| Capability | Current State | Target State |
| --- | --- | --- |
| Project workspace | Available | Stable project switch, per-project bridge lifecycle, project settings |
| Sessions | Available | Reliable create/switch/rename/delete/restore with no stale UI state |
| Timeline | Partial | Stable ordered transcript with final answer separated from process state |
| Tool progress | Partial | Collapsed by default, expandable, with clear current-state summary |
| Markdown output | Available | Stable code/table/list rendering across streamed and persisted messages |
| Attach files/folders | CLI only | Desktop `+` menu, Bridge API contract, persisted attachment history |
| Attach documents/media | Missing | Text/doc/image/pdf ingestion with previews and model-compatible context |
| Attach OpenAgent context | Missing | Add current workspace/git/diff/session/MCP snapshot to a turn |
| Goal mode | Missing | Durable per-session/per-project goal with progress state and resume |
| Plan mode | Partial permission base | True read-only planning turn with execution handoff |
| Permissions | Partial | Codex-like risk UX, scope choices, persisted decisions |
| Provider/model | Partial | Clean catalog, health, retry state, fallback UX, no secret leakage |
| MCP | Available | Product-grade panel, trace, lifecycle reuse, error diagnosis |
| Checkpoint/diff | Available | First-class review panel and rollback flow |
| Task status | Partial | Durable task tree, retry/resume/interrupt/fail explanations |
| Subagents | Runtime partial | Desktop subagent panes and task tree navigation |
| Packaging | Partial | macOS stable, then Windows validation |

## Near-Term Roadmap

### Phase 0: Stabilize The Current Desktop Loop

Goal: make the existing app feel reliable before adding large new surfaces.

Scope:

- Session create/switch/delete should never show stale timeline state.
- Provider failures should render as clear, actionable messages.
- Long turns should show current status without flooding the transcript.
- Tool calls stay collapsed by default.
- Composer sizing, spacing, and session sidebar should remain Codex-like.

Acceptance:

- New session opens an empty timeline.
- Switching sessions reloads only that session.
- Failed provider turn displays a stable failed state with retry guidance.
- No API key, token, or private provider URL appears in committed files.

### Phase 1: Composer `+` Menu And Text Attachments

Goal: make the `+` menu real.

Scope:

- Add a popover with:
  - Files and folders.
  - Attach OpenAgent context.
  - Goal.
  - Plan mode.
- Implement files/folders first.
- Use Tauri file dialog for local selection.
- Read text/code/Markdown files safely.
- Show attachment chips with path, type, size, and remove action.
- Add a Bridge API turn payload field for attachments.
- Persist attachment metadata and content references in session history.
- Inject attached text into agent context through runtime, not frontend-only prompt concatenation.

Out of scope for this phase:

- PDF parsing.
- Image understanding.
- Cloud documents.
- Long-term attachment indexing.

Acceptance:

- User can click `+`, choose one or more files, see chips, remove chips, send a prompt, reload the session, and see attachment history.
- Agent answer can use the attached text.
- CLI/TUI can later use the same attachment schema.

### Phase 2: Goal Mode

Goal: make a durable current goal part of the session.

Scope:

- Add goal create/edit/clear UI.
- Store goal in session metadata or a dedicated goal record.
- Show current goal near composer when active.
- Include current goal in runtime context every turn.
- Record goal progress events in timeline.
- Add completion/cancel state.

Acceptance:

- User can set a goal, send multiple turns, reload app, and continue with the same goal.
- Timeline shows goal started/progress/completed.
- Goal is not a frontend-only local state.

### Phase 3: Plan Mode

Goal: support a true planning-only interaction.

Scope:

- Add plan mode toggle in the `+` menu or composer.
- Runtime receives `mode: plan`.
- Runtime restricts tools to read-only/search/list/context tools.
- No write, shell side effects, git mutation, or checkpoint restore allowed.
- Plan output is structured and can be converted into an execution turn.

Acceptance:

- Plan mode produces a plan without modifying files.
- Attempted write/side-effect tools are denied by runtime policy, not just hidden in UI.
- User can click "Start executing this plan" to continue in normal mode.

### Phase 4: Task Status And Resume Productization

Goal: make long-running tasks understandable and recoverable.

Scope:

- Durable task state: queued, running, waiting approval, waiting answer, retrying, failed, resumable, completed.
- Timeline status card for the active turn.
- Retry/resume affordances.
- Provider retry and fallback metadata shown in UI.
- Crash/restart recovery smoke.

Acceptance:

- User can tell whether a task is still running, waiting, failed, or resumable.
- Reloading app preserves enough state to continue or understand failure.

### Phase 5: Workspace Review Panels

Goal: turn Desktop into a coding workspace, not only a chat window.

Scope:

- Files panel.
- Git status panel.
- Diff review panel.
- Checkpoint panel.
- MCP/tool inspector.
- Approval dock polish.

Acceptance:

- User can inspect file changes, review diffs, restore checkpoint, and continue the turn without leaving Desktop.

### Phase 6: Subagents And Task Tree

Goal: expose multi-agent work as a product feature.

Scope:

- Task tree navigation.
- Subagent panes.
- Parent/child session links.
- Task logs and outputs.
- Fork/attach for child tasks.

Acceptance:

- User can see which subagent is doing what, inspect its output, and return to the parent session.

### Phase 7: Packaging, Security, And Cross-Platform

Goal: make the desktop app safe and distributable.

Scope:

- macOS packaged smoke suite.
- Windows package validation.
- Secret redaction and config isolation.
- Provider config UI without committing secrets.
- Local auth token lifecycle.
- Crash logs and diagnostics export.

Acceptance:

- Fresh install can configure provider, open project, run a turn, attach a file, approve a tool, and recover after restart.
- No committed test fixture contains real credentials.

## Execution Rules

Use this document as the planning source for future Desktop work.

For each implementation slice:

1. Pick one user-visible loop.
2. Keep it within Desktop + Bridge + Rust Runtime.
3. Add/adjust only the minimal tests needed for the completed loop.
4. Rebuild the packaged app when the user needs to verify it.
5. Report only:
   - changed
   - verified
   - next

Do not:

- Push to GitHub unless explicitly requested.
- Commit API keys, provider base URLs, local tokens, or `.openagent` session data.
- Expand into unrelated CLI/TUI work unless required by the shared runtime contract.
- Add fake UI controls that do not map to runtime behavior.

## Immediate Next Work

The next recommended loop is:

```text
Composer + menu and text attachments
```

Why:

- The `+` button is visible but currently inactive.
- CLI already proves simple text attachment value.
- It creates the shared attachment schema needed by Desktop, CLI, TUI, Bridge, and Runtime.
- It is a user-visible feature that matches the Codex product shape.

First implementation slice:

- Add the `+` menu UI.
- Implement file/folder selection.
- Add attachment chips.
- Send text attachments with a turn.
- Persist attachment metadata in session messages.
- Verify with one packaged Desktop smoke.
