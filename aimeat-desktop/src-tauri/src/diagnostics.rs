//! Explicit, local diagnostics. Raw settings, paths, errors and model names never enter a report.
use crate::{connectors::Connector, node_manager::{NodeStatus, Phase}};
use serde::Serialize;
use std::io::Read;
use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status { Ok, Info, Warning, Error }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Subject { Runtime, Settings, Node, Port, ClaudeCode, ClaudeDesktop, Cursor, Vscode, Codex, LmStudio, Ollama, Tools }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action { None, OpenServer, OpenConnections, OpenSettings, OpenLog, ReinstallDesktop, StartNode, Wait, RestartNode, OpenAi, Retry }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    RuntimePresent, RuntimeMissing, ConfigReadable, ConfigMissing, ConfigUnreadable, PortInvalid,
    NodeReady, NodeStopped, NodeStarting, NodeStopping, NodeFailed, NodeUnknown, RestartPending,
    PortAvailable, PortOccupied, PortUnchecked, ToolReadable, ToolNotAdded, ToolConfigProblem,
    ToolCloudManual, ToolsNotFound, ToolsUnchecked, AiModelsAvailable, AiNoModels, AiNotRunning,
    AiUnrecognized, AiUnchecked,
}

#[derive(Serialize)]
pub struct Check {
    pub subject: Subject,
    pub code: Code,
    pub status: Status,
    pub action: Action,
    pub count: Option<u32>,
}

#[derive(Default, Serialize)]
pub struct Summary { pub ok: u16, pub info: u16, pub warning: u16, pub error: u16 }

#[derive(Serialize)]
struct ReportData {
    schema_version: u8,
    desktop_version: &'static str,
    server_version: Option<String>,
    platform: &'static str,
    arch: &'static str,
    checks: Vec<Check>,
    summary: Summary,
}

#[derive(Serialize)]
pub struct DiagnosticReport {
    #[serde(flatten)]
    data: ReportData,
    pub report_text: String,
}

struct RuntimeFacts { present: bool, server_version: Option<String> }
#[derive(Clone, Copy)]
enum ConfigFacts { Missing, Unreadable, Readable { port: Option<u16> } }
#[derive(Clone, Copy)]
enum PortFacts { Available, Occupied, Unchecked, Owned }
#[derive(Clone, Copy)]
enum AiProbe { Models(u32), NotRunning, Unrecognized, Unchecked }
#[derive(Clone, Copy)]
enum AiKind { LmStudio, Ollama }

const MAX_ENV: u64 = 1024 * 1024;
const MAX_RESPONSE: usize = 64 * 1024;
const MAX_COUNT: u32 = 10_000;
static RUNNING: AtomicBool = AtomicBool::new(false);

struct RunGuard;
impl Drop for RunGuard {
    fn drop(&mut self) { RUNNING.store(false, Ordering::Release); }
}

fn check(subject: Subject, code: Code, status: Status, action: Action) -> Check {
    Check { subject, code, status, action, count: None }
}

/// Only the release's numeric version is shareable; a custom package label can contain a name.
fn release_version(value: &str) -> Option<String> {
    let parts: Vec<_> = value.split('.').collect();
    (parts.len() == 3 && parts.iter().all(|part| !part.is_empty() && part.len() <= 5
        && part.bytes().all(|byte| byte.is_ascii_digit()))).then(|| value.to_string())
}

fn assemble(runtime: RuntimeFacts, config: ConfigFacts, node: Result<NodeStatus, String>,
    port: PortFacts, tools: Result<Vec<Connector>, String>, ai: [AiProbe; 2]) -> DiagnosticReport {
    let mut checks = vec![if runtime.present {
        check(Subject::Runtime, Code::RuntimePresent, Status::Ok, Action::None)
    } else {
        check(Subject::Runtime, Code::RuntimeMissing, Status::Error, Action::ReinstallDesktop)
    }];
    checks.push(match config {
        ConfigFacts::Missing => check(Subject::Settings, Code::ConfigMissing, Status::Info, Action::OpenServer),
        ConfigFacts::Unreadable => check(Subject::Settings, Code::ConfigUnreadable, Status::Warning, Action::OpenSettings),
        ConfigFacts::Readable { port: None } => check(Subject::Settings, Code::PortInvalid, Status::Error, Action::OpenSettings),
        ConfigFacts::Readable { port: Some(_) } => check(Subject::Settings, Code::ConfigReadable, Status::Ok, Action::None),
    });
    checks.push(match node.as_ref() {
        Ok(state) if state.ready && state.running => check(Subject::Node, Code::NodeReady, Status::Ok, Action::None),
        Ok(state) if state.state == Phase::Starting && state.running => check(Subject::Node, Code::NodeStarting, Status::Info, Action::Wait),
        Ok(state) if state.state == Phase::Stopping && state.running => check(Subject::Node, Code::NodeStopping, Status::Info, Action::Wait),
        Ok(state) if state.state == Phase::Failed => check(Subject::Node, Code::NodeFailed, Status::Error, Action::OpenLog),
        Ok(state) if !state.running => check(Subject::Node, Code::NodeStopped, Status::Info, Action::StartNode),
        _ => check(Subject::Node, Code::NodeUnknown, Status::Warning, Action::Retry),
    });
    if node.as_ref().is_ok_and(|state| state.running && state.restart_required) {
        checks.push(check(Subject::Settings, Code::RestartPending, Status::Info, Action::RestartNode));
    }
    // A port owned by the running child is already covered by its readiness check.
    match port {
        PortFacts::Available => checks.push(check(Subject::Port, Code::PortAvailable, Status::Ok, Action::None)),
        PortFacts::Occupied => checks.push(check(Subject::Port, Code::PortOccupied, Status::Warning, Action::OpenSettings)),
        PortFacts::Unchecked => checks.push(check(Subject::Port, Code::PortUnchecked, Status::Info, Action::Retry)),
        PortFacts::Owned => {},
    }
    append_tools(&mut checks, tools);
    for (subject, result) in [Subject::LmStudio, Subject::Ollama].into_iter().zip(ai) {
        let mut row = match result {
            AiProbe::Models(0) => check(subject, Code::AiNoModels, Status::Info, Action::OpenAi),
            AiProbe::Models(_) => check(subject, Code::AiModelsAvailable, Status::Ok, Action::None),
            AiProbe::NotRunning => check(subject, Code::AiNotRunning, Status::Info, Action::OpenAi),
            AiProbe::Unrecognized => check(subject, Code::AiUnrecognized, Status::Warning, Action::OpenAi),
            AiProbe::Unchecked => check(subject, Code::AiUnchecked, Status::Info, Action::Retry),
        };
        if let AiProbe::Models(count) = result { row.count = Some(count.min(MAX_COUNT)); }
        checks.push(row);
    }
    let mut summary = Summary::default();
    for row in &checks {
        match row.status {
            Status::Ok => summary.ok += 1, Status::Info => summary.info += 1,
            Status::Warning => summary.warning += 1, Status::Error => summary.error += 1,
        }
    }
    let data = ReportData {
        schema_version: 1, desktop_version: env!("CARGO_PKG_VERSION"),
        server_version: runtime.server_version.as_deref().and_then(release_version),
        platform: std::env::consts::OS, arch: std::env::consts::ARCH, checks, summary,
    };
    // The same allowlist feeds the preview and clipboard. No raw source object is serialized.
    let report_text = serde_json::to_string_pretty(&data).expect("diagnostic scalar fields serialize");
    DiagnosticReport { data, report_text }
}

fn append_tools(checks: &mut Vec<Check>, tools: Result<Vec<Connector>, String>) {
    let Ok(tools) = tools else {
        checks.push(check(Subject::Tools, Code::ToolsUnchecked, Status::Warning, Action::Retry)); return;
    };
    let mut found = 0;
    // A fixed list bounds the output and prevents names or unknown ids from reaching the report.
    for (id, subject) in [("claude-code", Subject::ClaudeCode), ("claude-desktop", Subject::ClaudeDesktop),
        ("cursor", Subject::Cursor), ("vscode", Subject::Vscode), ("codex", Subject::Codex)] {
        let Some(tool) = tools.iter().find(|tool| tool.id == id) else { continue; };
        if !tool.installed && tool.config_error.is_none() { continue; }
        found += 1;
        let mut row = if tool.config_error.is_some() {
            check(subject, Code::ToolConfigProblem, Status::Warning, Action::OpenConnections)
        } else if id == "claude-desktop" {
            check(subject, Code::ToolCloudManual, Status::Info, Action::OpenConnections)
        } else if tool.entries.is_empty() {
            check(subject, Code::ToolNotAdded, Status::Info, Action::OpenConnections)
        } else {
            check(subject, Code::ToolReadable, Status::Ok, Action::None)
        };
        if row.code == Code::ToolReadable { row.count = Some(tool.entries.len().min(MAX_COUNT as usize) as u32); }
        checks.push(row);
    }
    if found == 0 { checks.push(check(Subject::Tools, Code::ToolsNotFound, Status::Info, Action::OpenConnections)); }
}

/// Bound reads before parsing, including when a file grows while it is being read.
fn bounded_file(path: &Path, limit: u64) -> Result<Vec<u8>, std::io::Error> {
    let file = std::fs::File::open(path)?;
    if !file.metadata()?.is_file() { return Err(std::io::ErrorKind::InvalidData.into()); }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit { return Err(std::io::ErrorKind::InvalidData.into()); }
    Ok(bytes)
}

fn config_facts(path: &Path) -> ConfigFacts {
    let bytes = match bounded_file(path, MAX_ENV) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return ConfigFacts::Missing,
        Err(_) => return ConfigFacts::Unreadable,
    };
    let Ok(text) = String::from_utf8(bytes) else { return ConfigFacts::Unreadable; };
    let settings = crate::node_manager::parse_env(&text);
    let port = settings.get("AIMEAT_PORT").map(String::as_str).unwrap_or("41050")
        .parse::<u16>().ok().filter(|port| *port >= 1024);
    ConfigFacts::Readable { port }
}

fn binary_present(path: &Path) -> bool {
    if path.is_absolute() { return path.is_file(); }
    let Some(paths) = std::env::var_os("PATH") else { return false; };
    std::env::split_paths(&paths).any(|folder| {
        let candidate = folder.join(path);
        candidate.is_file() || cfg!(windows) && candidate.with_extension("exe").is_file()
    })
}

fn runtime_facts(node: &Path, entry: &Path, dev_adapter: &Path) -> RuntimeFacts {
    let package = entry.parent().and_then(Path::parent).and_then(Path::parent).map(|root| root.join("package.json"));
    let version = package.and_then(|path| bounded_file(&path, MAX_RESPONSE as u64).ok())
        .and_then(|body| serde_json::from_slice::<serde_json::Value>(&body).ok())
        .and_then(|package| package.get("version").and_then(|version| version.as_str()).and_then(release_version));
    // Match node_process::start: prefer the staged adapter, then the source-tree dev fallback.
    let adapter = entry.parent().and_then(Path::parent).and_then(Path::parent)
        .map(|root| root.join("desktop-parent.mjs")).filter(|path| path.exists())
        .unwrap_or_else(|| dev_adapter.to_path_buf());
    RuntimeFacts { present: binary_present(node) && entry.is_file() && adapter.is_file(), server_version: version }
}

fn inspect_port(config: ConfigFacts, node: &Result<NodeStatus, String>) -> PortFacts {
    let ConfigFacts::Readable { port: Some(port) } = config else { return PortFacts::Unchecked; };
    if node.as_ref().is_ok_and(|state| state.running && state.port == port) { return PortFacts::Owned; }
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => { drop(listener); PortFacts::Available },
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => PortFacts::Occupied,
        Err(_) => PortFacts::Unchecked,
    }
}

fn model_count(body: &[u8], kind: AiKind) -> AiProbe {
    if body.len() > MAX_RESPONSE { return AiProbe::Unrecognized; }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else { return AiProbe::Unrecognized; };
    let (key, name) = match kind { AiKind::LmStudio => ("data", "id"), AiKind::Ollama => ("models", "name") };
    let Some(models) = value.get(key).and_then(|list| list.as_array()) else { return AiProbe::Unrecognized; };
    if models.iter().any(|model| model.get(name).and_then(|name| name.as_str()).is_none_or(str::is_empty)) {
        return AiProbe::Unrecognized;
    }
    AiProbe::Models(models.len().min(MAX_COUNT as usize) as u32)
}

/// The port is an internal constant (or an ephemeral test port), never a caller-supplied host.
/// No model prompt, credential, cookie, proxy or redirect can leave these two listing requests.
async fn probe_ai(port: u16, kind: AiKind) -> AiProbe {
    let client = match reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(1)).timeout(Duration::from_secs(3)).build() {
        Ok(client) => client, Err(_) => return AiProbe::Unchecked,
    };
    let path = match kind { AiKind::LmStudio => "/v1/models", AiKind::Ollama => "/api/tags" };
    let mut response = match client.get(format!("http://127.0.0.1:{port}{path}"))
        .header("Accept", "application/json").send().await {
        Ok(response) => response, Err(_) => return AiProbe::NotRunning,
    };
    if !response.status().is_success() { return AiProbe::Unrecognized; }
    if response.content_length().is_some_and(|size| size > MAX_RESPONSE as u64) { return AiProbe::Unrecognized; }
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= MAX_RESPONSE => bytes.extend_from_slice(&chunk),
            Ok(None) => break,
            _ => return AiProbe::Unrecognized,
        }
    }
    model_count(&bytes, kind)
}

#[tauri::command]
pub async fn run_diagnostics(app: AppHandle) -> Result<DiagnosticReport, String> {
    if RUNNING.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
        return Err("DIAGNOSTICS_BUSY".into());
    }
    let _run = RunGuard;
    let facts = tauri::async_runtime::spawn_blocking(move || {
        let dev_adapter = Path::new(env!("CARGO_MANIFEST_DIR")).join("../runtime/desktop-parent.mjs");
        let (runtime, config) = match crate::node_manager::diagnostic_runtime(&app) {
            Ok((node, entry, env)) => (runtime_facts(&node, &entry, &dev_adapter), config_facts(&env)),
            Err(_) => (RuntimeFacts { present: false, server_version: None }, ConfigFacts::Unreadable),
        };
        // The status reader also reads the managed settings, so skip it if their bounded read failed.
        let node = if matches!(config, ConfigFacts::Unreadable) { Err(String::new()) }
            else { crate::node_manager::get_node_status(app) };
        let port = inspect_port(config, &node);
        // This function only inspects client files. The address comparison is unused here.
        let tools = crate::connectors::detect_connectors("http://localhost".into());
        (runtime, config, node, port, tools)
    }).await.map_err(|_| "DIAGNOSTICS_UNAVAILABLE".to_string())?;
    let lm = tauri::async_runtime::spawn(probe_ai(1234, AiKind::LmStudio));
    let ollama = probe_ai(11434, AiKind::Ollama).await;
    let lm = lm.await.unwrap_or(AiProbe::Unchecked);
    Ok(assemble(facts.0, facts.1, facts.2, facts.3, facts.4, [lm, ollama]))
}

#[cfg(test)]
#[path = "diagnostics_tests.rs"]
mod tests;
