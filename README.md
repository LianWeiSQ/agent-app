# OpenAgent App

This directory is the product app surface for OpenAgent.

The app is intentionally outside the `openharness` core workspace. It owns:

- React/Tauri desktop UI
- local desktop commands such as file and folder attachment picking
- managed Bridge process lifecycle
- packaged app resources and smoke scripts

The core workspace remains in `../openharness` and owns:

- Agent runtime
- session store
- tool execution
- MCP runtime
- provider/runtime integration

The app talks to the core through the Bridge HTTP/SSE API. During packaged builds it builds and bundles the runtime sidecar from `../openharness`.

The harness/core root is configurable from Desktop Settings. By default it
uses `../openharness`; `OPENAGENT_CORE_ROOT` remains the process-level fallback,
and the UI setting is passed to the managed Bridge as `coreRoot`.

The current product status and roadmap live in
`docs/desktop-agentic-workspace-plan.md`, next to the app that owns them.
The legacy static bridge console lives in `static/bridge-console/` for
reference and app-side experiments; it is no longer embedded in core.

Provider configuration is intentionally local-only. The desktop app starts the
Bridge sidecar from `../openharness` and injects provider env into that child
process from the first existing file in this order:

1. `OPENAGENT_PROVIDER_ENV_FILE`
2. `OPENAGENT_ENV_FILE`
3. `<workspace>/.openagent/openagent.env`
4. `app/.openagent/openagent.env`
5. `../openharness/.openagent/openagent.env`
6. `~/.openagent/openagent.env`

Create an ignored local file such as `app/.openagent/openagent.env`:

```bash
mkdir -p /Users/william/coding/harness/app/.openagent
chmod 700 /Users/william/coding/harness/app/.openagent
$EDITOR /Users/william/coding/harness/app/.openagent/openagent.env
```

Use OpenAI-compatible keys without committing the file:

```dotenv
OPENAI_API_KEY=<your-api-key>
OPENAI_BASE_URL=<your-openai-compatible-base-url>
OPENAI_MODEL=gpt-5.5
OPENAGENT_MODEL=gpt-5.5
OPENAI_WIRE_API=responses
OPENAGENT_PROVIDER_STREAM=1
```

If no model is set, the app defaults the managed Bridge to `gpt-5.5`.

Useful commands:

```bash
npm --prefix /Users/william/coding/harness/app run build
npm --prefix /Users/william/coding/harness/app run core:runtime
npm --prefix /Users/william/coding/harness/app run tauri -- build --bundles app
```

Set `OPENAGENT_CORE_ROOT` when the core workspace is not at `../openharness`.
