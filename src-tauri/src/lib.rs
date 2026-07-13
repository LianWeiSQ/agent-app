use std::{
    collections::{BTreeMap, VecDeque},
    env,
    error::Error,
    fs,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const DESKTOP_BRIDGE_CORS_ORIGINS: &str =
    "tauri://localhost,http://tauri.localhost,http://127.0.0.1:5173,http://localhost:5173";

#[derive(Clone, Debug, Serialize)]
struct DiagnosticPath {
    source: String,
    path: String,
    exists: bool,
}

#[derive(Debug, Serialize)]
struct DesktopDiagnostics {
    runtime: String,
    app_version: String,
    os: String,
    arch: String,
    bridge_default_url: String,
    bridge_url_env: Option<String>,
    bridge_binary: Option<DiagnosticPath>,
    bridge_binary_candidates: Vec<DiagnosticPath>,
    core_root_default: String,
    core_root_default_source: String,
    workspace_default: String,
    workspace_default_source: String,
    session_root_default: String,
    provider: ProviderEnvSummary,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectPathRequest {
    path: String,
}

#[derive(Debug, Serialize)]
struct ProjectPathInfo {
    input: String,
    path: String,
    name: String,
    exists: bool,
    is_dir: bool,
    canonical: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAttachment {
    kind: String,
    path: String,
    name: String,
    size_bytes: u64,
    content_type: String,
    content: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct DesktopAuthToken {
    token: String,
    path: String,
    created: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
struct ProviderEnvSummary {
    env_file: Option<String>,
    profile: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    wire_api: Option<String>,
    base_url_configured: bool,
    api_key_configured: bool,
}

#[derive(Clone, Debug, Default)]
struct ProviderEnvConfig {
    env_file: Option<PathBuf>,
    values: Vec<(String, String)>,
}

const MAX_DESKTOP_ATTACHMENTS: usize = 12;
const MAX_DESKTOP_ATTACHMENT_BYTES: u64 = 256 * 1024;
const MAX_FOLDER_SCAN_ENTRIES: usize = 750;
const DEFAULT_PROVIDER_MODEL: &str = "gpt-5.5";
const DEFAULT_PROVIDER_WIRE_API: &str = "responses";
const PROVIDER_ENV_KEYS: &[&str] = &[
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAGENT_MODEL",
    "OPENAI_WIRE_API",
    "OPENAGENT_PROVIDER_PROFILE",
    "OPENAGENT_PROVIDER_STREAM",
    "OPENAGENT_BRIDGE_MAX_STEPS",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "CLAUDE_CODE_ATTRIBUTION_HEADER",
];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigOptions {
    workspace: Option<String>,
    core_root: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigWriteRequest {
    workspace: Option<String>,
    core_root: Option<String>,
    profile: Option<String>,
    base_url: String,
    api_key: Option<String>,
    model: String,
    wire_api: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigValidateRequest {
    workspace: Option<String>,
    core_root: Option<String>,
    profile: Option<String>,
    base_url: String,
    api_key: Option<String>,
    model: String,
    wire_api: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigPayload {
    profile: String,
    profile_label: String,
    base_url: String,
    model: String,
    wire_api: String,
    api_key_configured: bool,
    env_file: String,
    env_preview: Vec<ProviderEnvPreview>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderEnvPreview {
    key: String,
    value: String,
    secret: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderValidationResult {
    ok: bool,
    profile: String,
    base_url: String,
    model: String,
    wire_api: String,
    models_ok: bool,
    response_ok: bool,
    model_available: Option<bool>,
    model_count: Option<usize>,
    models_status: Option<u16>,
    response_status: Option<u16>,
    message: String,
    sample: Option<String>,
}

#[derive(Default)]
struct BridgeProcess {
    child: Mutex<Option<ManagedBridgeChild>>,
}

struct ManagedBridgeChild {
    child: Child,
    pid: u32,
    url: String,
    port: u16,
    workspace: String,
    core_root: String,
    session_root: String,
    binary: String,
    provider: ProviderEnvSummary,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStartOptions {
    workspace: Option<String>,
    core_root: Option<String>,
    session_root: Option<String>,
    port: Option<u16>,
    auth_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct BridgeStatus {
    running: bool,
    pid: Option<u32>,
    url: String,
    port: u16,
    workspace: String,
    core_root: String,
    session_root: String,
    binary: Option<String>,
    provider: ProviderEnvSummary,
    error: Option<String>,
}

impl BridgeProcess {
    fn status(&self) -> BridgeStatus {
        let mut guard = self
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            return stopped_bridge_status(None);
        }

        let exited_status = {
            let managed = guard.as_mut().expect("guard checked above");
            match managed.child.try_wait() {
                Ok(None) => return managed.to_status(true, None),
                Ok(Some(status)) => Some(managed.to_status(
                    false,
                    Some(format!("openagent-http-runtime exited with {status}")),
                )),
                Err(error) => {
                    return managed.to_status(
                        true,
                        Some(format!("failed to inspect bridge process: {error}")),
                    );
                }
            }
        };
        *guard = None;
        exited_status.unwrap_or_else(|| stopped_bridge_status(None))
    }

    fn start(&self, options: BridgeStartOptions) -> Result<BridgeStatus, String> {
        let mut guard = self
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_some() {
            let already_running = {
                let managed = guard.as_mut().expect("guard checked above");
                match managed.child.try_wait() {
                    Ok(None) => Some(managed.to_status(true, None)),
                    Ok(Some(_)) => None,
                    Err(error) => Some(managed.to_status(
                        true,
                        Some(format!("failed to inspect bridge process: {error}")),
                    )),
                }
            };
            if let Some(status) = already_running {
                return Ok(status);
            }
            *guard = None;
        }

        let core_root = core_workspace_root_from_option(options.core_root);
        let binary = find_bridge_binary(&core_root).ok_or_else(|| {
            format!(
                "openagent-http-runtime not found for harness root `{}`. Build it with `cargo build --manifest-path {}/Cargo.toml -p openagent-http-runtime` or set OPENAGENT_HTTP_RUNTIME.",
                core_root.display(),
                core_root.display()
            )
        })?;
        let port = options.port.unwrap_or_else(default_bridge_port);
        if port == 0 {
            return Err("bridge port must be greater than 0".to_string());
        }
        let workspace = non_empty(options.workspace).unwrap_or_else(default_workspace);
        let session_root = non_empty(options.session_root)
            .unwrap_or_else(|| default_session_root().display().to_string());
        fs::create_dir_all(&session_root)
            .map_err(|error| format!("failed to create session root `{session_root}`: {error}"))?;

        let url = format!("http://127.0.0.1:{port}");
        let mut command = Command::new(&binary.path);
        let auth_token_path = desktop_auth_token_path();
        if let Some(token) = non_empty(options.auth_token) {
            write_secret_file(&auth_token_path, &token)?;
        } else {
            let _ = desktop_auth_token()?;
        }
        let provider_env = provider_env_config(&workspace, &core_root);
        for (key, value) in &provider_env.values {
            command.env(key, value);
        }
        command.env("OPENAGENT_CORE_ROOT", &core_root);
        command.env("OPENAGENT_BRIDGE_AUTH_TOKEN_FILE", &auth_token_path);
        command
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--workspace")
            .arg(&workspace)
            .arg("--session-root")
            .arg(&session_root)
            .arg("--cors-origin")
            .arg(DESKTOP_BRIDGE_CORS_ORIGINS)
            .arg("--no-mdns")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let workspace_path = PathBuf::from(&workspace);
        if workspace_path.exists() {
            command.current_dir(workspace_path);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start openagent-http-runtime: {error}"))?;
        wait_for_bridge_port(&mut child, port)?;

        let managed = ManagedBridgeChild {
            pid: child.id(),
            child,
            url,
            port,
            workspace,
            core_root: core_root.display().to_string(),
            session_root,
            binary: binary.path,
            provider: provider_env.summary(),
        };
        let status = managed.to_status(true, None);
        *guard = Some(managed);
        Ok(status)
    }

    fn stop(&self) -> Result<BridgeStatus, String> {
        let mut guard = self
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(mut managed) = guard.take() else {
            return Ok(stopped_bridge_status(None));
        };
        let status = managed.to_status(false, None);
        let needs_kill = !matches!(managed.child.try_wait(), Ok(Some(_)));
        if needs_kill {
            let _ = managed.child.kill();
        }
        let _ = managed.child.wait();
        Ok(status)
    }

    fn restart(&self, options: BridgeStartOptions) -> Result<BridgeStatus, String> {
        let _ = self.stop()?;
        thread::sleep(Duration::from_millis(80));
        self.start(options)
    }
}

impl Drop for BridgeProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut managed) = guard.take() {
                let _ = managed.child.kill();
                let _ = managed.child.wait();
            }
        }
    }
}

impl ManagedBridgeChild {
    fn to_status(&self, running: bool, error: Option<String>) -> BridgeStatus {
        BridgeStatus {
            running,
            pid: Some(self.pid),
            url: self.url.clone(),
            port: self.port,
            workspace: self.workspace.clone(),
            core_root: self.core_root.clone(),
            session_root: self.session_root.clone(),
            binary: Some(self.binary.clone()),
            provider: self.provider.clone(),
            error,
        }
    }
}

impl ProviderEnvConfig {
    fn summary(&self) -> ProviderEnvSummary {
        let base_url = self
            .value("OPENAI_BASE_URL")
            .or_else(|| self.value("ANTHROPIC_BASE_URL"));
        let profile = self.value("OPENAGENT_PROVIDER_PROFILE").or_else(|| {
            infer_provider_profile(base_url.as_deref(), self.value("OPENAI_MODEL").as_deref())
        });
        ProviderEnvSummary {
            env_file: self
                .env_file
                .as_ref()
                .map(|path| path.display().to_string()),
            profile,
            base_url,
            model: self
                .value("OPENAGENT_MODEL")
                .or_else(|| self.value("OPENAI_MODEL")),
            wire_api: self.value("OPENAI_WIRE_API"),
            base_url_configured: self.value("OPENAI_BASE_URL").is_some()
                || self.value("ANTHROPIC_BASE_URL").is_some(),
            api_key_configured: self.value("OPENAI_API_KEY").is_some()
                || self.value("ANTHROPIC_API_KEY").is_some()
                || self.value("ANTHROPIC_AUTH_TOKEN").is_some(),
        }
    }

    fn value(&self, key: &str) -> Option<String> {
        self.values
            .iter()
            .rev()
            .find_map(|(candidate_key, value)| (candidate_key == key).then(|| value.clone()))
            .filter(|value| !value.trim().is_empty())
    }
}

fn provider_env_config(workspace: &str, core_root: &Path) -> ProviderEnvConfig {
    let env_file = provider_env_file(workspace, core_root);
    let file_values = env_file
        .as_ref()
        .map(|path| read_provider_env_file(path))
        .unwrap_or_default();
    let mut values = Vec::new();
    for key in PROVIDER_ENV_KEYS {
        if let Ok(value) = env::var(key) {
            if !value.trim().is_empty() {
                values.push(((*key).to_string(), value));
                continue;
            }
        }
        if let Some(value) = file_values.get(*key) {
            if !value.trim().is_empty() {
                values.push(((*key).to_string(), value.clone()));
            }
        }
    }

    ensure_provider_defaults(&mut values);
    ProviderEnvConfig { env_file, values }
}

fn ensure_provider_defaults(values: &mut Vec<(String, String)>) {
    if env_pair_value(values, "OPENAI_API_KEY").is_none() {
        if let Some(value) = env_pair_value(values, "ANTHROPIC_AUTH_TOKEN")
            .or_else(|| env_pair_value(values, "ANTHROPIC_API_KEY"))
        {
            values.push(("OPENAI_API_KEY".to_string(), value));
        }
    }
    if env_pair_value(values, "OPENAI_BASE_URL").is_none() {
        if let Some(value) = env_pair_value(values, "ANTHROPIC_BASE_URL") {
            values.push((
                "OPENAI_BASE_URL".to_string(),
                openai_compatible_base_url(&value),
            ));
        }
    }
    let openai_model = env_pair_value(values, "OPENAI_MODEL");
    let openagent_model = env_pair_value(values, "OPENAGENT_MODEL");
    match (openai_model, openagent_model) {
        (Some(openai_model), None) => {
            values.push(("OPENAGENT_MODEL".to_string(), openai_model));
        }
        (None, Some(openagent_model)) => {
            values.push(("OPENAI_MODEL".to_string(), openagent_model));
        }
        (None, None) => {
            values.push((
                "OPENAI_MODEL".to_string(),
                DEFAULT_PROVIDER_MODEL.to_string(),
            ));
            values.push((
                "OPENAGENT_MODEL".to_string(),
                DEFAULT_PROVIDER_MODEL.to_string(),
            ));
        }
        (Some(_), Some(_)) => {}
    }
    if env_pair_value(values, "OPENAI_WIRE_API").is_none() {
        values.push((
            "OPENAI_WIRE_API".to_string(),
            DEFAULT_PROVIDER_WIRE_API.to_string(),
        ));
    }
    if env_pair_value(values, "OPENAGENT_PROVIDER_STREAM").is_none() {
        values.push(("OPENAGENT_PROVIDER_STREAM".to_string(), "1".to_string()));
    }
}

fn env_pair_value(values: &[(String, String)], key: &str) -> Option<String> {
    values
        .iter()
        .rev()
        .find_map(|(candidate_key, value)| (candidate_key == key).then(|| value.clone()))
        .filter(|value| !value.trim().is_empty())
}

fn normalize_provider_profile(profile: Option<&str>) -> String {
    match profile
        .unwrap_or("gpt")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "glm" | "zhipu" | "bigmodel" => "glm".to_string(),
        _ => "gpt".to_string(),
    }
}

fn infer_provider_profile(base_url: Option<&str>, model: Option<&str>) -> Option<String> {
    let haystack = format!(
        "{} {}",
        base_url.unwrap_or_default().to_ascii_lowercase(),
        model.unwrap_or_default().to_ascii_lowercase()
    );
    if haystack.contains("glm") || haystack.contains("bigmodel") || haystack.contains("zhipu") {
        Some("glm".to_string())
    } else if !haystack.trim().is_empty() {
        Some("gpt".to_string())
    } else {
        None
    }
}

fn provider_profile_label(profile: &str) -> &'static str {
    match profile {
        "glm" => "GLM / OpenAI compatible",
        _ => "GPT / OpenAI compatible",
    }
}

fn provider_profile_default_base_url(profile: &str) -> &'static str {
    match profile {
        "glm" => "https://open.bigmodel.cn/api/paas/v4",
        _ => "https://api.openai.com/v1",
    }
}

fn provider_profile_default_model(profile: &str) -> &'static str {
    match profile {
        "glm" => "glm-4.5",
        _ => DEFAULT_PROVIDER_MODEL,
    }
}

fn provider_profile_default_wire_api(profile: &str) -> &'static str {
    match profile {
        "glm" => "chat",
        _ => DEFAULT_PROVIDER_WIRE_API,
    }
}

fn openai_compatible_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return trimmed;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with("/v1") || lower.contains("/api/") {
        trimmed
    } else {
        format!("{trimmed}/v1")
    }
}

fn provider_env_file(workspace: &str, core_root: &Path) -> Option<PathBuf> {
    provider_env_file_candidates(workspace, core_root)
        .into_iter()
        .find(|path| path.exists())
}

fn provider_env_file_for_write(workspace: &str, core_root: &Path) -> PathBuf {
    if let Some(existing) = provider_env_file(workspace, core_root) {
        return existing;
    }
    if !workspace.trim().is_empty() {
        return PathBuf::from(workspace)
            .join(".openagent")
            .join("openagent.env");
    }
    app_root().join(".openagent").join("openagent.env")
}

fn provider_env_file_candidates(workspace: &str, core_root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["OPENAGENT_PROVIDER_ENV_FILE", "OPENAGENT_ENV_FILE"] {
        if let Some(path) = env::var_os(key) {
            candidates.push(PathBuf::from(path));
        }
    }
    if !workspace.trim().is_empty() {
        candidates.push(
            PathBuf::from(workspace)
                .join(".openagent")
                .join("openagent.env"),
        );
    }
    candidates.push(app_root().join(".openagent").join("openagent.env"));
    candidates.push(core_root.join(".openagent").join("openagent.env"));
    candidates.push(openagent_home().join("openagent.env"));
    candidates
}

fn app_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn read_provider_env_file(path: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(path)
        .map(|content| parse_provider_env_content(&content))
        .unwrap_or_default()
}

fn parse_provider_env_content(content: &str) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for line in content.lines() {
        let Some((key, value)) = parse_provider_env_line(line) else {
            continue;
        };
        if PROVIDER_ENV_KEYS.contains(&key.as_str()) && !value.trim().is_empty() {
            values.insert(key, value);
        }
    }
    values
}

fn parse_provider_env_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let trimmed = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
    let (key, raw_value) = trimmed.split_once('=')?;
    let key = key.trim().to_string();
    if key.is_empty() {
        return None;
    }
    let value = strip_env_value_comment(raw_value.trim());
    Some((key, unquote_env_value(value.trim()).to_string()))
}

fn strip_env_value_comment(value: &str) -> &str {
    let mut quote: Option<char> = None;
    for (index, ch) in value.char_indices() {
        match ch {
            '"' | '\'' if quote == Some(ch) => quote = None,
            '"' | '\'' if quote.is_none() => quote = Some(ch),
            '#' if quote.is_none() => {
                let prefix = &value[..index];
                if prefix.chars().next_back().is_some_and(char::is_whitespace) {
                    return prefix.trim_end();
                }
            }
            _ => {}
        }
    }
    value
}

fn unquote_env_value(value: &str) -> &str {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return &value[1..value.len() - 1];
        }
    }
    value
}

fn provider_config_payload(options: ProviderConfigOptions) -> ProviderConfigPayload {
    let core_root = core_workspace_root_from_option(options.core_root);
    let workspace = non_empty(options.workspace).unwrap_or_else(default_workspace);
    let config = provider_env_config(&workspace, &core_root);
    let profile = normalize_provider_profile(
        config
            .value("OPENAGENT_PROVIDER_PROFILE")
            .or_else(|| {
                infer_provider_profile(
                    config.value("OPENAI_BASE_URL").as_deref(),
                    config.value("OPENAI_MODEL").as_deref(),
                )
            })
            .as_deref(),
    );
    let base_url = config
        .value("OPENAI_BASE_URL")
        .or_else(|| {
            config
                .value("ANTHROPIC_BASE_URL")
                .map(|value| openai_compatible_base_url(&value))
        })
        .unwrap_or_else(|| provider_profile_default_base_url(&profile).to_string());
    let model = config
        .value("OPENAGENT_MODEL")
        .or_else(|| config.value("OPENAI_MODEL"))
        .unwrap_or_else(|| provider_profile_default_model(&profile).to_string());
    let wire_api = config
        .value("OPENAI_WIRE_API")
        .unwrap_or_else(|| provider_profile_default_wire_api(&profile).to_string());
    let api_key_configured = config.value("OPENAI_API_KEY").is_some()
        || config.value("ANTHROPIC_AUTH_TOKEN").is_some()
        || config.value("ANTHROPIC_API_KEY").is_some();
    let env_file = provider_env_file_for_write(&workspace, &core_root);
    ProviderConfigPayload {
        profile: profile.clone(),
        profile_label: provider_profile_label(&profile).to_string(),
        base_url: base_url.clone(),
        model: model.clone(),
        wire_api: wire_api.clone(),
        api_key_configured,
        env_file: env_file.display().to_string(),
        env_preview: provider_env_preview(
            &profile,
            &base_url,
            api_key_configured,
            &model,
            &wire_api,
        ),
    }
}

fn provider_env_preview(
    profile: &str,
    base_url: &str,
    api_key_configured: bool,
    model: &str,
    wire_api: &str,
) -> Vec<ProviderEnvPreview> {
    vec![
        ProviderEnvPreview {
            key: "OPENAGENT_PROVIDER_PROFILE".to_string(),
            value: profile.to_string(),
            secret: false,
        },
        ProviderEnvPreview {
            key: "OPENAI_BASE_URL".to_string(),
            value: base_url.to_string(),
            secret: false,
        },
        ProviderEnvPreview {
            key: "OPENAI_API_KEY".to_string(),
            value: if api_key_configured {
                "••••••••".to_string()
            } else {
                "".to_string()
            },
            secret: true,
        },
        ProviderEnvPreview {
            key: "OPENAI_MODEL".to_string(),
            value: model.to_string(),
            secret: false,
        },
        ProviderEnvPreview {
            key: "OPENAGENT_MODEL".to_string(),
            value: model.to_string(),
            secret: false,
        },
        ProviderEnvPreview {
            key: "OPENAI_WIRE_API".to_string(),
            value: wire_api.to_string(),
            secret: false,
        },
        ProviderEnvPreview {
            key: "OPENAGENT_PROVIDER_STREAM".to_string(),
            value: "1".to_string(),
            secret: false,
        },
    ]
}

fn provider_api_key_from_request(
    request_key: Option<String>,
    workspace: &str,
    core_root: &Path,
) -> Option<String> {
    request_key
        .and_then(|value| non_empty(Some(value)))
        .or_else(|| {
            let config = provider_env_config(workspace, core_root);
            config
                .value("OPENAI_API_KEY")
                .or_else(|| config.value("ANTHROPIC_AUTH_TOKEN"))
                .or_else(|| config.value("ANTHROPIC_API_KEY"))
        })
        .and_then(|value| normalize_api_key(&value))
}

fn normalize_api_key(value: &str) -> Option<String> {
    let mut key = value.trim().to_string();
    if key.len() >= 2
        && ((key.starts_with('"') && key.ends_with('"'))
            || (key.starts_with('\'') && key.ends_with('\'')))
    {
        key = key[1..key.len() - 1].trim().to_string();
    }
    if let Some(rest) = key
        .strip_prefix("Bearer ")
        .or_else(|| key.strip_prefix("bearer "))
    {
        key = rest.trim().to_string();
    }
    key = key.replace(['\r', '\n'], "");
    (!key.trim().is_empty()).then_some(key)
}

fn write_provider_config(
    request: ProviderConfigWriteRequest,
) -> Result<ProviderConfigPayload, String> {
    let core_root = core_workspace_root_from_option(request.core_root.clone());
    let workspace = non_empty(request.workspace.clone()).unwrap_or_else(default_workspace);
    let profile = normalize_provider_profile(request.profile.as_deref());
    let base_url = openai_compatible_base_url(&request.base_url);
    let model = non_empty(Some(request.model))
        .unwrap_or_else(|| provider_profile_default_model(&profile).to_string());
    let wire_api = normalize_wire_api(&request.wire_api)
        .unwrap_or_else(|| provider_profile_default_wire_api(&profile).to_string());
    let existing = provider_env_config(&workspace, &core_root);
    let api_key = request
        .api_key
        .and_then(|value| non_empty(Some(value)))
        .or_else(|| existing.value("OPENAI_API_KEY"))
        .or_else(|| existing.value("ANTHROPIC_AUTH_TOKEN"))
        .or_else(|| existing.value("ANTHROPIC_API_KEY"));
    let env_file = provider_env_file_for_write(&workspace, &core_root);
    let content = render_provider_env_file(
        &profile,
        &base_url,
        api_key.as_deref(),
        &model,
        &wire_api,
        existing.value("OPENAGENT_BRIDGE_MAX_STEPS").as_deref(),
    );
    write_secret_file(&env_file, &content)?;
    Ok(provider_config_payload(ProviderConfigOptions {
        workspace: Some(workspace),
        core_root: Some(core_root.display().to_string()),
    }))
}

fn normalize_wire_api(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "chat" | "chat.completions" | "chat_completions" => Some("chat".to_string()),
        "responses" | "response" => Some("responses".to_string()),
        _ => None,
    }
}

fn render_provider_env_file(
    profile: &str,
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    wire_api: &str,
    max_steps: Option<&str>,
) -> String {
    let mut lines = vec![
        "# OpenAgent Desktop provider config. This file is local and should not be committed."
            .to_string(),
        format!("OPENAGENT_PROVIDER_PROFILE={}", quote_env_value(profile)),
        format!("OPENAI_BASE_URL={}", quote_env_value(base_url)),
    ];
    if let Some(api_key) = api_key.filter(|value| !value.trim().is_empty()) {
        lines.push(format!("OPENAI_API_KEY={}", quote_env_value(api_key)));
    }
    lines.extend([
        format!("OPENAI_MODEL={}", quote_env_value(model)),
        format!("OPENAGENT_MODEL={}", quote_env_value(model)),
        format!("OPENAI_WIRE_API={}", quote_env_value(wire_api)),
        "OPENAGENT_PROVIDER_STREAM=1".to_string(),
    ]);
    if let Some(max_steps) = max_steps.filter(|value| !value.trim().is_empty()) {
        lines.push(format!(
            "OPENAGENT_BRIDGE_MAX_STEPS={}",
            quote_env_value(max_steps)
        ));
    }
    lines.join("\n")
}

fn quote_env_value(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

fn validate_provider_config(
    request: ProviderConfigValidateRequest,
) -> Result<ProviderValidationResult, String> {
    let core_root = core_workspace_root_from_option(request.core_root.clone());
    let workspace = non_empty(request.workspace.clone()).unwrap_or_else(default_workspace);
    let profile = normalize_provider_profile(request.profile.as_deref());
    let base_url = openai_compatible_base_url(&request.base_url);
    let model = non_empty(Some(request.model))
        .unwrap_or_else(|| provider_profile_default_model(&profile).to_string());
    let wire_api = normalize_wire_api(&request.wire_api)
        .unwrap_or_else(|| provider_profile_default_wire_api(&profile).to_string());
    let Some(api_key) = provider_api_key_from_request(request.api_key, &workspace, &core_root)
    else {
        return Ok(ProviderValidationResult {
            ok: false,
            profile,
            base_url,
            model,
            wire_api,
            models_ok: false,
            response_ok: false,
            model_available: None,
            model_count: None,
            models_status: None,
            response_status: None,
            message: "API Key 未配置，无法验证 Provider。".to_string(),
            sample: None,
        });
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|error| format!("failed to build provider validation client: {error}"))?;

    let mut messages = Vec::new();
    let mut models_ok = false;
    let mut response_ok = false;
    let mut model_available = None;
    let mut model_count = None;
    let mut models_status = None;
    let mut response_status = None;
    let mut sample = None;

    match provider_get_json(&client, &join_provider_url(&base_url, "models"), &api_key) {
        Ok((status, value)) => {
            models_status = Some(status);
            models_ok = (200..300).contains(&status);
            if models_ok {
                let (count, found) = inspect_models_payload(&value, &model);
                model_count = count;
                model_available = found;
                messages.push(match found {
                    Some(true) => format!("/models OK，已找到模型 {model}。"),
                    Some(false) => format!("/models OK，但列表里没有 {model}。"),
                    None => "/models OK，但返回结构无法判断模型列表。".to_string(),
                });
            } else {
                messages.push(format!(
                    "/models 返回 HTTP {status}：{}",
                    provider_error_summary(&value)
                ));
            }
        }
        Err(error) => {
            messages.push(format!(
                "/models 失败：{}",
                sanitize_secret(&error, &api_key)
            ));
        }
    }

    match provider_post_json(
        &client,
        &join_provider_url(
            &base_url,
            if wire_api == "chat" {
                "chat/completions"
            } else {
                "responses"
            },
        ),
        &api_key,
        &provider_validation_body(&wire_api, &model),
    ) {
        Ok((status, value)) => {
            response_status = Some(status);
            response_ok = (200..300).contains(&status);
            if response_ok {
                sample = extract_provider_sample(&value);
                messages.push("最小响应请求 OK。".to_string());
            } else {
                messages.push(format!(
                    "最小响应请求返回 HTTP {status}：{}",
                    provider_error_summary(&value)
                ));
            }
        }
        Err(error) => {
            messages.push(format!(
                "最小响应请求失败：{}",
                sanitize_secret(&error, &api_key)
            ));
        }
    }

    Ok(ProviderValidationResult {
        ok: models_ok && response_ok,
        profile,
        base_url,
        model,
        wire_api,
        models_ok,
        response_ok,
        model_available,
        model_count,
        models_status,
        response_status,
        message: messages.join(" "),
        sample,
    })
}

fn provider_get_json(
    client: &reqwest::blocking::Client,
    url: &str,
    api_key: &str,
) -> Result<(u16, Value), String> {
    match client.get(url).bearer_auth(api_key).send() {
        Ok(response) => parse_reqwest_json_response(response),
        Err(error) => {
            let reqwest_detail = reqwest_error_detail(&error);
            curl_json_request("GET", url, api_key, None)
                .map_err(|curl_error| format!("{reqwest_detail}; curl fallback: {curl_error}"))
        }
    }
}

fn provider_post_json(
    client: &reqwest::blocking::Client,
    url: &str,
    api_key: &str,
    body: &Value,
) -> Result<(u16, Value), String> {
    let response = match client.post(url).bearer_auth(api_key).json(body).send() {
        Ok(response) => response,
        Err(error) => {
            let reqwest_detail = reqwest_error_detail(&error);
            return curl_json_request("POST", url, api_key, Some(body))
                .map_err(|curl_error| format!("{reqwest_detail}; curl fallback: {curl_error}"));
        }
    };
    parse_reqwest_json_response(response)
}

fn parse_reqwest_json_response(
    response: reqwest::blocking::Response,
) -> Result<(u16, Value), String> {
    let status = response.status().as_u16();
    let text = response.text().map_err(|error| error.to_string())?;
    let value = serde_json::from_str::<Value>(&text)
        .unwrap_or_else(|_| json!({ "raw": truncate_text(&text, 800) }));
    Ok((status, value))
}

fn curl_json_request(
    method: &str,
    url: &str,
    api_key: &str,
    body: Option<&Value>,
) -> Result<(u16, Value), String> {
    let mut command = Command::new("curl");
    command
        .arg("-sS")
        .arg("--connect-timeout")
        .arg("8")
        .arg("--max-time")
        .arg("25")
        .arg("-X")
        .arg(method)
        .arg("-H")
        .arg("accept: application/json")
        .arg("-H")
        .arg(format!("authorization: Bearer {api_key}"))
        .arg("-w")
        .arg("\n__OPENAGENT_HTTP_STATUS__:%{http_code}")
        .arg(url);
    if let Some(body) = body {
        command
            .arg("-H")
            .arg("content-type: application/json")
            .arg("-d")
            .arg(body.to_string());
    }
    let output = command
        .output()
        .map_err(|error| format!("failed to run curl fallback: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() && !stdout.contains("__OPENAGENT_HTTP_STATUS__:") {
        return Err(truncate_text(stderr.trim(), 800));
    }
    parse_curl_json_output(&stdout).map_err(|error| {
        let stderr = stderr.trim();
        if stderr.is_empty() {
            error
        } else {
            format!("{error}; stderr: {}", truncate_text(stderr, 400))
        }
    })
}

fn parse_curl_json_output(output: &str) -> Result<(u16, Value), String> {
    let Some((body, status_text)) = output.rsplit_once("__OPENAGENT_HTTP_STATUS__:") else {
        return Err("curl fallback did not return an HTTP status".to_string());
    };
    let status = status_text
        .trim()
        .parse::<u16>()
        .map_err(|error| format!("invalid curl fallback HTTP status: {error}"))?;
    let body = body.trim();
    let value = serde_json::from_str::<Value>(body)
        .unwrap_or_else(|_| json!({ "raw": truncate_text(body, 800) }));
    Ok((status, value))
}

fn reqwest_error_detail(error: &reqwest::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(cause) = source {
        parts.push(cause.to_string());
        source = cause.source();
    }
    parts.dedup();
    parts.join(": ")
}

fn provider_error_summary(value: &Value) -> String {
    if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
        return truncate_text(message, 500);
    }
    if let Some(message) = value.get("message").and_then(Value::as_str) {
        if let Some(code) = value.get("code").and_then(Value::as_str) {
            return truncate_text(&format!("{code}: {message}"), 500);
        }
        return truncate_text(message, 500);
    }
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return truncate_text(error, 500);
    }
    if let Some(raw) = value.get("raw").and_then(Value::as_str) {
        return truncate_text(raw, 500);
    }
    "provider returned a non-success response".to_string()
}

fn provider_validation_body(wire_api: &str, model: &str) -> Value {
    if wire_api == "chat" {
        json!({
            "model": model,
            "messages": [{"role": "user", "content": "Reply exactly: pong"}],
            "stream": false,
            "max_tokens": 16
        })
    } else {
        json!({
            "model": model,
            "input": "Reply exactly: pong",
            "stream": false,
            "max_output_tokens": 16
        })
    }
}

fn inspect_models_payload(value: &Value, model: &str) -> (Option<usize>, Option<bool>) {
    let Some(items) = value.get("data").and_then(Value::as_array) else {
        return (None, None);
    };
    let found = items.iter().any(|item| {
        item.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id == model)
    });
    (Some(items.len()), Some(found))
}

fn extract_provider_sample(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(truncate_text(text, 240));
    }
    if let Some(text) = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
    {
        return Some(truncate_text(text, 240));
    }
    value
        .get("output")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                item.get("content")
                    .and_then(Value::as_array)
                    .and_then(|content| {
                        content.iter().find_map(|part| {
                            part.get("text")
                                .or_else(|| part.get("content"))
                                .and_then(Value::as_str)
                        })
                    })
            })
        })
        .map(|text| truncate_text(text, 240))
}

fn join_provider_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim().trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("...");
    }
    truncated
}

fn sanitize_secret(value: &str, secret: &str) -> String {
    if secret.is_empty() {
        truncate_text(value, 800)
    } else {
        truncate_text(&value.replace(secret, "••••••••"), 800)
    }
}

#[tauri::command]
fn desktop_diagnostics() -> DesktopDiagnostics {
    let bridge_default_url = default_bridge_url();
    let core_root = default_core_workspace_root();
    let candidates = bridge_binary_candidates(&core_root);
    let bridge_binary = candidates
        .iter()
        .find(|candidate| candidate.exists)
        .cloned();
    let mut warnings = Vec::new();
    if bridge_binary.is_none() {
        warnings.push(
            "openagent-http-runtime not found in env, bundle, repo target, or PATH".to_string(),
        );
    }

    DesktopDiagnostics {
        runtime: "tauri".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        bridge_default_url,
        bridge_url_env: env::var("OPENAGENT_BRIDGE_URL")
            .or_else(|_| env::var("OPENAGENT_APP_BRIDGE_URL"))
            .ok(),
        bridge_binary,
        bridge_binary_candidates: candidates,
        core_root_default: core_root.display().to_string(),
        core_root_default_source: if env::var_os("OPENAGENT_CORE_ROOT").is_some() {
            "env".to_string()
        } else {
            "app-default".to_string()
        },
        workspace_default: default_workspace(),
        workspace_default_source: if env::var_os("OPENAGENT_WORKSPACE").is_some() {
            "env".to_string()
        } else {
            "cwd".to_string()
        },
        session_root_default: default_session_root().display().to_string(),
        provider: provider_env_config(&default_workspace(), &core_root).summary(),
        warnings,
    }
}

#[tauri::command]
fn bridge_status(state: tauri::State<'_, BridgeProcess>) -> BridgeStatus {
    state.status()
}

#[tauri::command]
fn bridge_start(
    options: BridgeStartOptions,
    state: tauri::State<'_, BridgeProcess>,
) -> Result<BridgeStatus, String> {
    state.start(options)
}

#[tauri::command]
fn bridge_stop(state: tauri::State<'_, BridgeProcess>) -> Result<BridgeStatus, String> {
    state.stop()
}

#[tauri::command]
fn bridge_restart(
    options: BridgeStartOptions,
    state: tauri::State<'_, BridgeProcess>,
) -> Result<BridgeStatus, String> {
    state.restart(options)
}

#[tauri::command]
fn provider_config_read(options: ProviderConfigOptions) -> ProviderConfigPayload {
    provider_config_payload(options)
}

#[tauri::command]
fn provider_config_apply(
    request: ProviderConfigWriteRequest,
) -> Result<ProviderConfigPayload, String> {
    write_provider_config(request)
}

#[tauri::command]
fn provider_config_validate(
    request: ProviderConfigValidateRequest,
) -> Result<ProviderValidationResult, String> {
    validate_provider_config(request)
}

#[tauri::command]
fn desktop_auth_token() -> Result<DesktopAuthToken, String> {
    let path = desktop_auth_token_path();
    if let Ok(existing) = fs::read_to_string(&path) {
        let token = existing.trim().to_string();
        if !token.is_empty() {
            return Ok(DesktopAuthToken {
                token,
                path: path.display().to_string(),
                created: false,
            });
        }
    }

    let token = generate_bridge_token()?;
    write_secret_file(&path, &token)?;
    Ok(DesktopAuthToken {
        token,
        path: path.display().to_string(),
        created: true,
    })
}

#[tauri::command]
fn project_path_info(request: ProjectPathRequest) -> ProjectPathInfo {
    project_path_info_for_input(request.path)
}

#[tauri::command]
fn choose_project_folder() -> Option<ProjectPathInfo> {
    rfd::FileDialog::new()
        .set_title("Choose OpenAgent project")
        .pick_folder()
        .map(|path| project_path_info_for_input(path.display().to_string()))
}

#[tauri::command]
fn choose_attachment_files() -> Vec<DesktopAttachment> {
    let Some(paths) = rfd::FileDialog::new()
        .set_title("Attach files to OpenAgent")
        .pick_files()
    else {
        return Vec::new();
    };

    paths
        .into_iter()
        .take(MAX_DESKTOP_ATTACHMENTS)
        .map(|path| desktop_attachment_from_file(&path, true))
        .collect()
}

#[tauri::command]
fn choose_attachment_folders() -> Vec<DesktopAttachment> {
    let Some(paths) = rfd::FileDialog::new()
        .set_title("Attach folders to OpenAgent")
        .pick_folders()
    else {
        return Vec::new();
    };

    let mut attachments = Vec::new();
    let mut skipped = 0usize;
    let mut scanned = 0usize;
    for path in paths {
        collect_folder_attachments(&path, &mut attachments, &mut skipped, &mut scanned);
        if attachments.len() >= MAX_DESKTOP_ATTACHMENTS || scanned >= MAX_FOLDER_SCAN_ENTRIES {
            break;
        }
    }
    if attachments.is_empty() && skipped > 0 {
        attachments.push(DesktopAttachment {
            kind: "file".to_string(),
            path: String::new(),
            name: "folder".to_string(),
            size_bytes: 0,
            content_type: "text/plain".to_string(),
            content: String::new(),
            error: Some("no readable text files found in selected folder".to_string()),
        });
    }
    attachments
}

fn desktop_attachment_from_file(path: &Path, report_read_errors: bool) -> DesktopAttachment {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .to_string();
    let path_text = path.display().to_string();
    let size_bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size_bytes > MAX_DESKTOP_ATTACHMENT_BYTES {
        return DesktopAttachment {
            kind: "file".to_string(),
            path: path_text,
            name,
            size_bytes,
            content_type: "text/plain".to_string(),
            content: String::new(),
            error: format!("file is larger than {} bytes", MAX_DESKTOP_ATTACHMENT_BYTES).into(),
        };
    }

    match fs::read_to_string(path) {
        Ok(content) => DesktopAttachment {
            kind: "file".to_string(),
            path: path_text,
            name,
            size_bytes,
            content_type: "text/plain".to_string(),
            content,
            error: None,
        },
        Err(error) => DesktopAttachment {
            kind: "file".to_string(),
            path: path_text,
            name,
            size_bytes,
            content_type: "text/plain".to_string(),
            content: String::new(),
            error: report_read_errors.then(|| format!("failed to read text file: {error}")),
        },
    }
}

fn collect_folder_attachments(
    root: &Path,
    attachments: &mut Vec<DesktopAttachment>,
    skipped: &mut usize,
    scanned: &mut usize,
) {
    let mut pending = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = pending.pop_front() {
        if attachments.len() >= MAX_DESKTOP_ATTACHMENTS || *scanned >= MAX_FOLDER_SCAN_ENTRIES {
            return;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            *skipped += 1;
            continue;
        };
        let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path());
        for entry in entries {
            if attachments.len() >= MAX_DESKTOP_ATTACHMENTS || *scanned >= MAX_FOLDER_SCAN_ENTRIES {
                return;
            }
            *scanned += 1;
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                *skipped += 1;
                continue;
            };
            if file_type.is_symlink() {
                *skipped += 1;
                continue;
            }
            if file_type.is_dir() {
                if should_skip_attachment_dir(&path) {
                    *skipped += 1;
                } else {
                    pending.push_back(path);
                }
                continue;
            }
            if !file_type.is_file() {
                *skipped += 1;
                continue;
            }
            let attachment = desktop_attachment_from_file(&path, false);
            if attachment.error.is_some() {
                *skipped += 1;
                continue;
            }
            attachments.push(attachment);
        }
    }
}

fn should_skip_attachment_dir(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    matches!(
        name,
        ".git" | ".next" | ".openagent" | "build" | "dist" | "node_modules" | "target" | "vendor"
    )
}

fn project_path_info_for_input(input: String) -> ProjectPathInfo {
    let trimmed = input.trim().to_string();
    if trimmed.is_empty() {
        return ProjectPathInfo {
            input: trimmed,
            path: String::new(),
            name: String::new(),
            exists: false,
            is_dir: false,
            canonical: None,
            error: Some("project path is required".to_string()),
        };
    }

    let path = expand_user_path(&trimmed);
    let metadata = fs::metadata(&path);
    let exists = metadata.is_ok();
    let is_dir = metadata.as_ref().is_ok_and(|metadata| metadata.is_dir());
    let canonical = fs::canonicalize(&path)
        .ok()
        .map(|path| path.display().to_string());
    let display_path = canonical
        .clone()
        .unwrap_or_else(|| path.display().to_string());
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| display_path.clone());
    let error = match metadata {
        Ok(metadata) if !metadata.is_dir() => Some("project path is not a directory".to_string()),
        Ok(_) => None,
        Err(error) => Some(error.to_string()),
    };

    ProjectPathInfo {
        input: trimmed,
        path: display_path,
        name,
        exists,
        is_dir,
        canonical,
        error,
    }
}

fn bridge_binary_candidates(core_root: &Path) -> Vec<DiagnosticPath> {
    let binary = binary_name("openagent-http-runtime");
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("OPENAGENT_HTTP_RUNTIME") {
        candidates.push(diagnostic_path("env", PathBuf::from(path)));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(diagnostic_path("bundle-next-to-exe", dir.join(binary)));
            candidates.push(diagnostic_path(
                "bundle-resources",
                dir.join("../Resources").join(binary),
            ));
        }
    }
    if !development_runtime_fallback_enabled() {
        return candidates;
    }
    candidates.push(diagnostic_path(
        "core-target-debug",
        core_root.join("target").join("debug").join(binary),
    ));
    candidates.push(diagnostic_path(
        "core-target-release",
        core_root.join("target").join("release").join(binary),
    ));
    candidates.push(diagnostic_path(
        "repo-target-debug",
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("target")
            .join("debug")
            .join(binary),
    ));
    candidates.push(diagnostic_path(
        "repo-target-release",
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("target")
            .join("release")
            .join(binary),
    ));
    candidates.extend(path_candidates(binary));
    candidates
}

fn default_core_workspace_root() -> PathBuf {
    env::var_os("OPENAGENT_CORE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .join("openharness")
        })
}

fn core_workspace_root_from_option(core_root: Option<String>) -> PathBuf {
    non_empty(core_root)
        .map(|value| expand_user_path(&value))
        .unwrap_or_else(default_core_workspace_root)
}

fn path_candidates(binary: &str) -> Vec<DiagnosticPath> {
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths)
                .map(|path| diagnostic_path("path", path.join(binary)))
                .collect()
        })
        .unwrap_or_default()
}

fn diagnostic_path(source: &str, path: PathBuf) -> DiagnosticPath {
    DiagnosticPath {
        source: source.to_string(),
        exists: path.exists(),
        path: path.display().to_string(),
    }
}

fn find_bridge_binary(core_root: &Path) -> Option<DiagnosticPath> {
    bridge_binary_candidates(core_root)
        .into_iter()
        .find(|candidate| candidate.exists)
}

fn wait_for_bridge_port(child: &mut Child, port: u16) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "openagent-http-runtime exited during startup with {status}"
                ));
            }
            Ok(None) => {}
            Err(error) => {
                return Err(format!("failed to inspect bridge startup: {error}"));
            }
        }

        if TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "openagent-http-runtime did not listen on 127.0.0.1:{port} within startup timeout"
            ));
        }
        thread::sleep(Duration::from_millis(60));
    }
}

fn stopped_bridge_status(error: Option<String>) -> BridgeStatus {
    let workspace = default_workspace();
    let core_root = default_core_workspace_root();
    BridgeStatus {
        running: false,
        pid: None,
        url: default_bridge_url(),
        port: default_bridge_port(),
        workspace: workspace.clone(),
        core_root: core_root.display().to_string(),
        session_root: default_session_root().display().to_string(),
        binary: find_bridge_binary(&core_root).map(|binary| binary.path),
        provider: provider_env_config(&workspace, &core_root).summary(),
        error,
    }
}

fn default_bridge_url() -> String {
    env::var("OPENAGENT_BRIDGE_URL")
        .or_else(|_| env::var("OPENAGENT_APP_BRIDGE_URL"))
        .unwrap_or_else(|_| format!("http://127.0.0.1:{}", default_bridge_port()))
}

fn default_bridge_port() -> u16 {
    env::var("OPENAGENT_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(8787)
}

fn development_runtime_fallback_enabled() -> bool {
    env::var("OPENAGENT_DESKTOP_DISABLE_DEV_RUNTIME_FALLBACK")
        .ok()
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(true)
}

fn default_workspace() -> String {
    env::var("OPENAGENT_WORKSPACE")
        .ok()
        .and_then(|value| non_empty(Some(value)))
        .unwrap_or_else(|| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .display()
                .to_string()
        })
}

fn desktop_auth_token_path() -> PathBuf {
    env::var_os("OPENAGENT_DESKTOP_AUTH_TOKEN_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| openagent_home().join("desktop").join("bridge-auth-token"))
}

fn openagent_home() -> PathBuf {
    env::var_os("OPENAGENT_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| Path::new(&home).join(".openagent")))
        .or_else(|| env::var_os("USERPROFILE").map(|home| Path::new(&home).join(".openagent")))
        .unwrap_or_else(|| PathBuf::from(".openagent"))
}

fn generate_bridge_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("failed to generate auth token: {error}"))?;
    let mut token = String::with_capacity("oa_desktop_".len() + bytes.len() * 2);
    token.push_str("oa_desktop_");
    for byte in bytes {
        token.push_str(&format!("{byte:02x}"));
    }
    Ok(token)
}

fn write_secret_file(path: &Path, token: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create auth token directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| {
        format!(
            "failed to open auth token file `{}`: {error}",
            path.display()
        )
    })?;
    file.write_all(token.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| {
            format!(
                "failed to write auth token file `{}`: {error}",
                path.display()
            )
        })
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn expand_user_path(input: &str) -> PathBuf {
    if input == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    if let Some(rest) = input
        .strip_prefix("~/")
        .or_else(|| input.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(input)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn binary_name(name: &'static str) -> &'static str {
    if cfg!(windows) {
        "openagent-http-runtime.exe"
    } else {
        name
    }
}

fn default_session_root() -> PathBuf {
    env::var_os("OPENAGENT_SESSION_ROOT")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(|home| Path::new(&home).join(".openagent").join("sessions"))
        })
        .unwrap_or_else(|| PathBuf::from(".openagent").join("sessions"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BridgeProcess::default())
        .invoke_handler(tauri::generate_handler![
            desktop_diagnostics,
            bridge_status,
            bridge_start,
            bridge_stop,
            bridge_restart,
            provider_config_read,
            provider_config_apply,
            provider_config_validate,
            desktop_auth_token,
            project_path_info,
            choose_project_folder,
            choose_attachment_files,
            choose_attachment_folders
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OpenAgent Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Read,
        net::TcpListener,
        sync::OnceLock,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn environment_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn temp_root(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        env::temp_dir().join(format!("{name}-{}-{millis}", std::process::id()))
    }

    fn free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind free port");
        listener.local_addr().expect("addr").port()
    }

    fn http_get(port: u16, path: &str, token: Option<&str>) -> std::io::Result<String> {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        let auth = token
            .map(|value| format!("Authorization: Bearer {value}\r\n"))
            .unwrap_or_default();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\n{auth}Connection: close\r\n\r\n"
        )?;
        let mut response = String::new();
        stream.read_to_string(&mut response)?;
        Ok(response)
    }

    #[test]
    fn desktop_auth_token_persists_with_override() {
        let _environment_guard = environment_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let root = env::temp_dir().join(format!(
            "openagent-desktop-auth-token-{}",
            std::process::id()
        ));
        let path = root.join("bridge-auth-token");
        let _ = fs::remove_dir_all(&root);
        env::set_var("OPENAGENT_DESKTOP_AUTH_TOKEN_PATH", &path);

        let first = desktop_auth_token().expect("first token");
        let second = desktop_auth_token().expect("second token");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(first.path, path.display().to_string());
        assert_eq!(first.token, second.token);
        assert!(first.token.starts_with("oa_desktop_"));
        assert!(first.token.len() >= 32);

        env::remove_var("OPENAGENT_DESKTOP_AUTH_TOKEN_PATH");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn folder_attachments_collect_readable_text_and_skip_heavy_dirs() {
        let root = temp_root("openagent-desktop-folder-attachments");
        let docs = root.join("docs");
        let nested = docs.join("nested");
        let node_modules = docs.join("node_modules");
        fs::create_dir_all(&nested).expect("nested");
        fs::create_dir_all(&node_modules).expect("node_modules");
        fs::write(docs.join("README.md"), "# Hello\n").expect("readme");
        fs::write(nested.join("notes.txt"), "nested note\n").expect("notes");
        fs::write(node_modules.join("ignored.txt"), "ignored\n").expect("ignored");

        let mut attachments = Vec::new();
        let mut skipped = 0usize;
        let mut scanned = 0usize;
        collect_folder_attachments(&docs, &mut attachments, &mut skipped, &mut scanned);

        let names = attachments
            .iter()
            .map(|attachment| attachment.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["README.md", "notes.txt"]);
        assert!(attachments
            .iter()
            .all(|attachment| attachment.error.is_none()));
        assert!(attachments
            .iter()
            .any(|attachment| attachment.content.contains("# Hello")));
        assert!(skipped >= 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn provider_env_parser_filters_and_unquotes_local_config() {
        let values = parse_provider_env_content(
            r#"
            # comments are ignored
            export OPENAI_API_KEY="secret"
            OPENAI_BASE_URL='https://example.invalid/v1'
            OPENAI_MODEL=gpt-5.5 # inline comment
            RANDOM_KEY=ignored
            OPENAI_WIRE_API=responses
            "#,
        );

        assert_eq!(
            values.get("OPENAI_API_KEY").map(String::as_str),
            Some("secret")
        );
        assert_eq!(
            values.get("OPENAI_BASE_URL").map(String::as_str),
            Some("https://example.invalid/v1")
        );
        assert_eq!(
            values.get("OPENAI_MODEL").map(String::as_str),
            Some("gpt-5.5")
        );
        assert_eq!(
            values.get("OPENAI_WIRE_API").map(String::as_str),
            Some("responses")
        );
        assert!(!values.contains_key("RANDOM_KEY"));

        let mut defaults = vec![("OPENAI_MODEL".to_string(), "gpt-5.5".to_string())];
        ensure_provider_defaults(&mut defaults);
        assert_eq!(
            env_pair_value(&defaults, "OPENAGENT_MODEL").as_deref(),
            Some("gpt-5.5")
        );
        assert_eq!(
            env_pair_value(&defaults, "OPENAI_WIRE_API").as_deref(),
            Some(DEFAULT_PROVIDER_WIRE_API)
        );
        assert_eq!(
            env_pair_value(&defaults, "OPENAGENT_PROVIDER_STREAM").as_deref(),
            Some("1")
        );
    }

    #[test]
    fn managed_bridge_starts_restarts_and_stops_runtime() {
        let _environment_guard = environment_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let root = temp_root("openagent-desktop-managed-bridge");
        let workspace_a = root.join("workspace-a");
        let workspace_b = root.join("workspace-b");
        let session_root = root.join("sessions");
        fs::create_dir_all(&workspace_a).expect("workspace a");
        fs::create_dir_all(&workspace_b).expect("workspace b");
        let port = free_port();
        let token = "oa_desktop_test_managed_bridge";
        let token_path = root.join("bridge-auth-token");
        env::set_var("OPENAGENT_DESKTOP_AUTH_TOKEN_PATH", &token_path);
        let process = BridgeProcess::default();

        let started = process
            .start(BridgeStartOptions {
                workspace: Some(workspace_a.display().to_string()),
                core_root: None,
                session_root: Some(session_root.display().to_string()),
                port: Some(port),
                auth_token: Some(token.to_string()),
            })
            .expect("start bridge");
        assert!(started.running);
        assert_eq!(started.port, port);
        assert_eq!(started.workspace, workspace_a.display().to_string());
        assert!(started.pid.is_some());
        assert_eq!(
            fs::read_to_string(&token_path)
                .expect("managed token file")
                .trim(),
            token
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&token_path)
                    .expect("managed token metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            let command_line = Command::new("ps")
                .args([
                    "-p",
                    &started.pid.expect("managed pid").to_string(),
                    "-o",
                    "command=",
                ])
                .output()
                .expect("inspect managed process args");
            let command_line = String::from_utf8_lossy(&command_line.stdout);
            assert!(!command_line.contains(token));
            assert!(!command_line.contains("--auth-token"));
        }

        let unauthorized = http_get(port, "/api/health", None).expect("unauthorized health");
        assert!(unauthorized.contains("401 Unauthorized"));
        let authorized = http_get(port, "/api/health", Some(token)).expect("authorized health");
        assert!(authorized.contains("200 OK"));
        assert!(authorized.contains("\"ok\""));
        assert!(authorized.contains("true"));

        let status = process.status();
        assert!(status.running);
        assert_eq!(status.workspace, workspace_a.display().to_string());

        let restarted = process
            .restart(BridgeStartOptions {
                workspace: Some(workspace_b.display().to_string()),
                core_root: None,
                session_root: Some(session_root.display().to_string()),
                port: Some(port),
                auth_token: Some(token.to_string()),
            })
            .expect("restart bridge");
        assert!(restarted.running);
        assert_eq!(restarted.workspace, workspace_b.display().to_string());
        let authorized_after_restart =
            http_get(port, "/api/health", Some(token)).expect("authorized health after restart");
        assert!(authorized_after_restart.contains("200 OK"));
        assert!(authorized_after_restart.contains("\"ok\""));
        assert!(authorized_after_restart.contains("true"));

        let stopped = process.stop().expect("stop bridge");
        assert!(!stopped.running);
        let final_status = process.status();
        assert!(!final_status.running);
        assert!(final_status.pid.is_none());
        assert!(http_get(port, "/api/health", Some(token)).is_err());

        env::remove_var("OPENAGENT_DESKTOP_AUTH_TOKEN_PATH");
        let _ = fs::remove_dir_all(&root);
    }
}
