# Desktop Product Status And Roadmap

OpenAgent App is the Desktop product surface for the Rust-first OpenHarness
runtime. The app owns React/Tauri UI and packaged lifecycle; OpenHarness owns
agent execution, sessions, tools, providers, MCP, and the Bridge API.

## Product Rule

```text
Desktop UI -> Bridge HTTP/SSE API -> Rust runtime -> durable session state
```

Desktop, CLI, and TUI must project the same runtime facts. Session, task,
permission, and provider state must not exist only in React local state.

## Current Capabilities

The completed P0 foundation includes:

- project and per-project session navigation;
- session create, switch, rename, delete, and reload isolation;
- ordered timeline with Markdown rendering and collapsed tool details;
- text/code file and folder attachments plus OpenAgent context attachment;
- composer model and permission controls;
- Bridge-owned provider catalog and private GPT/GLM configuration;
- one-click provider validation and immediate Runtime selection without restart;
- provider retry, fallback, terminal failure, and manual retry UI;
- MCP server configuration, test, lifecycle, and tool visibility;
- approval/question handling and persisted history;
- Inspector views for current session runtime details;
- managed Bridge token files, restricted CORS, and Tauri CSP;
- `npm run ci:p0` covering frontend, Rust, secret checks, session isolation,
  provider recovery, and browser smokes.

## Product Boundaries

Settings owns persistent configuration. Inspector owns only the current
session's runtime details. The main conversation shows user messages, compact
progress, and final answers; verbose tool output stays collapsed.

Provider keys and private endpoints are local-only. They must never be added to
Git, screenshots intended for publication, fixtures, or documentation.

## Completed Version

### V0.2: Change Review Workspace

V0.2 is locally accepted. A changes summary opens a
full-width Review workspace with Git-backed changed-file counts and per-file
diffs, side-by-side Agent patches, durable accept/request-changes decisions,
latest-turn single-file rollback with conflict protection, and a
checkpoint-backed whole-turn restore that does not expose checkpoint cards.
The browser release journey also proves Review decisions and selected patches
remain session-scoped across switching, reload, and Bridge process restart.
Rust Runtime now persists a typed final-result message part derived from the
current run's file changes, completed or failed tools, and durable todos. The
Desktop renders the same changed / verified / remaining result from either the
transcript or the terminal event without reconstructing it in React state.
File tree, preview, Git diff, and terminal are scoped to the active session
workspace. Session creation succeeds only after state is persisted and read
back. The release journey covers two workspaces, Review, reload, Bridge
restart, deletion, creation, and isolation.

## Completed Version

### V0.3: Rich Input + Goal / Plan

V0.3 is locally accepted. Typed image, PDF, document, and large-text attachment
metadata persists through the Bridge and session transcript, while ContextPack
records inclusion, truncation, and drop decisions without exposing attachment
bodies. Durable Goal state supports create, update, pause, resume, and complete.
Durable Plan state supports planning, executing, and complete: planning is
enforced as READONLY by the Rust Runtime even when a client requests FULL plus
permission bypass, and only an explicit start-execution action restores normal
tool permissions. Goal and Plan both survive reload and Bridge process restart,
remain session-isolated, and appear as pinned ContextPack decisions.

### V0.4: Task Tree + Background + Subagents

V0.4 is locally verified. Runtime child sessions are the durable task source,
and the Bridge exposes their nested parent/child tree with canonical status,
background start/wait/promote/cancel/resume, cooperative cancellation, and
persisted execution mode. Task Tree v2 projects each subagent's role, bounded
input summary, allowed tools, workspace isolation, live run progress, final
result, and failure cause. The main timeline remains aggregated; details live
in the Inspector and survive reload, session switching, and Bridge restart.

## Completed Versions

### V0.5: Integrations + Extensibility

Completed locally:

- remote MCP OAuth discovery, dynamic registration, browser login, refresh,
  revoke, private token persistence, and authenticated tool reuse;
- Bridge-owned skills/plugins discovery, install, update, enable/disable,
  permissions, and Runtime injection;
- Provider Catalog capability metadata and private GPT Responses / GLM Chat
  configuration with validation and restart recovery;
- session-scoped Git/GitHub workflow in the full-width Review workspace:
  branch creation, selected-path commit, PR summary, push, and `gh pr create`
  review handoff. Every repository or GitHub write enters the same durable
  approval queue and executes only after explicit approval. Workflow summary,
  handoff result, session isolation, and Bridge restart recovery are covered by
  a real browser smoke with a temporary Git remote.
- Bridge-owned Browser, Computer, and Terminal capability policies with private
  restart-safe state, independent allow/ask/deny boundaries, Runtime tool-list
  filtering, execution-time enforcement, availability state, and actionable
  diagnostics. Browser maps to the Rust `web_fetch` runtime, Terminal maps to
  workspace-scoped `bash`, and Computer is honestly reported unavailable until
  a native adapter is installed. Agent `ask` enters the durable approval flow.
  Terminal also has a Bridge-owned persistent session lifecycle with start,
  incremental stdout/stderr cursors, continued input, interrupt, close, and
  current-session workspace isolation in Desktop Settings.

V0.5 passed its local six-item acceptance audit. Remote issue creation and
commit publication remain deferred until explicitly authorized.

## Active Version

### V1.0: Production Desktop

- complete native Browser and Computer adapters plus persistent Terminal;
- crash, network, provider, Bridge, and upgrade recovery;
- performance, accessibility, privacy, diagnostics, and full release gates.

Signing, installers, commercial configuration, and update distribution are
deferred while functional completeness is the active priority.

## Delivery Rules

1. Complete one user-visible loop at a time.
2. Put shared behavior in Rust/Bridge contracts before product UI state.
3. Run focused checks during development and `npm run ci:p0` at the completed
   boundary.
4. Do not add controls without working behavior.
5. Do not push or publish local secrets.
6. Update this file instead of creating new phase-specific progress documents.
