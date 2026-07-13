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
- provider settings for GPT and GLM OpenAI-compatible endpoints;
- one-click provider validation and managed Bridge restart;
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

## Remaining Work

### P1: Rich Input And Modes

- harden large attachment persistence and truncation;
- add image/PDF/document ingestion through a typed Bridge contract;
- implement durable Goal state in Rust and Desktop;
- implement true read-only Plan mode with runtime-enforced tool policy;
- make plan-to-execution handoff explicit and resumable.

### P1: Coding Workspace

- first-class file tree and preview;
- Git status and diff review workflow;
- checkpoint history without intrusive timeline cards;
- task tree, background work, and subagent navigation;
- clearer crash/restart recovery and diagnostics export.

### P2: Distribution

- Windows packaging and lifecycle validation;
- provider catalog capability metadata and native streaming breadth;
- MCP OAuth/dynamic registration UX;
- update/install lifecycle and release diagnostics.

## Delivery Rules

1. Complete one user-visible loop at a time.
2. Put shared behavior in Rust/Bridge contracts before product UI state.
3. Run focused checks during development and `npm run ci:p0` at the completed
   boundary.
4. Do not add controls without working behavior.
5. Do not push or publish local secrets.
6. Update this file instead of creating new phase-specific progress documents.
