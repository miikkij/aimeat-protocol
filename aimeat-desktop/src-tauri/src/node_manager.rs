// AIMEAT Desktop — Node Process Manager
// Starts, stops, and monitors the bundled AIMEAT Node.js server as a child process.
//
// Runtime layout differs between a packaged install and `tauri dev`:
//   * Packaged: the server lives in the app's resource dir ("resources/server/dist"),
//     Node ships as a sidecar binary next to the app executable, and all writable
//     state (.env, SQLite DB, logs) lives in the OS app-data dir.
//   * Dev: the server is the sibling `../aimeat/dist` tree and Node comes from PATH.
// Storage is always persistent SQLite (AIMEAT_STORAGE=sqlite).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Manager};

static NODE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
static NODE_START_TIME: Mutex<Option<Instant>> = Mutex::new(None);

/// Default port the AIMEAT server listens on.
const DEFAULT_PORT: u16 = 40050;
/// Default node id used when none has been configured yet.
const DEFAULT_NODE_ID: &str = "aimeat-local-001-dev";

#[derive(Serialize, Deserialize, Clone)]
pub struct NodeStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub uptime_seconds: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct NodeConfig {
    pub node_id: String,
    pub port: u16,
    pub federation_role: String,
    pub genesis_url: Option<String>,
    pub ai_endpoint: Option<String>,
    /// Storage backend — always "sqlite" for the desktop personal node.
    /// Output-only: populated by read_config, ignored (and optional) on write_config.
    #[serde(default)]
    pub storage: String,
    /// Absolute path to the writable data directory (for display in the UI).
    /// Output-only: populated by read_config, ignored (and optional) on write_config.
    #[serde(default)]
    pub data_dir: String,
    /// Whether an encryption key is configured (enables OpenRouter / TOTP secret storage).
    /// Output-only: populated by read_config, ignored (and optional) on write_config.
    #[serde(default)]
    pub encryption_configured: bool,
}

/// Resolved runtime paths, differing between a bundled install and `tauri dev`.
struct Runtime {
    /// Node.js executable (bundled sidecar when packaged, PATH `node` in dev).
    node_bin: PathBuf,
    /// Path to the server entry point (`dist/src/index.js`).
    server_entry: PathBuf,
    /// Writable data directory (holds `.env`, `data/aimeat.db`, log file).
    data_dir: PathBuf,
    /// Path to the managed `.env` file.
    env_file: PathBuf,
    /// Path to the node log file.
    log_file: PathBuf,
}

/// Platform-specific name of the bundled Node sidecar binary.
fn node_exe_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// Strip the Windows extended-length / verbatim prefix (`\\?\`) from a path.
/// Tauri's resource resolver (and current_exe / app_data_dir) can return verbatim
/// paths, and Node's CJS main-module resolver chokes on them — `realpathSync`
/// fails with `EISDIR: illegal operation on a directory, lstat 'C:'`, so the node
/// crashes before loading a single module. UNC verbatim (`\\?\UNC\srv\share`)
/// maps back to `\\srv\share`. No-op on non-verbatim paths and on non-Windows.
pub fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

/// Resolve runtime paths, preferring the bundled server resource and falling back
/// to the sibling repo tree when running under `tauri dev`.
fn resolve_runtime(app: &AppHandle) -> Result<Runtime, String> {
    // Writable runtime state always lives in the OS app-data dir.
    // strip_verbatim: paths passed to / used by Node must not carry the `\\?\` prefix.
    let data_dir = strip_verbatim(
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?,
    );
    let env_file = data_dir.join(".env");
    let log_file = data_dir.join("aimeat-node.log");

    // Prefer the bundled server resource (packaged install / local release build).
    let bundled_entry = app
        .path()
        .resolve(
            "resources/server/dist/src/index.js",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .map(strip_verbatim)
        .filter(|p| p.exists());

    if let Some(server_entry) = bundled_entry {
        let exe_dir = strip_verbatim(
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .ok_or_else(|| "Failed to resolve executable directory".to_string())?,
        );
        return Ok(Runtime {
            node_bin: exe_dir.join(node_exe_name()),
            server_entry,
            data_dir,
            env_file,
            log_file,
        });
    }

    // Dev fallback: server in the sibling repo, Node from PATH.
    // CARGO_MANIFEST_DIR is <repo>/aimeat-desktop/src-tauri at build time.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let server_entry = manifest
        .join("..")
        .join("..")
        .join("aimeat")
        .join("dist")
        .join("src")
        .join("index.js");

    Ok(Runtime {
        node_bin: PathBuf::from("node"),
        server_entry,
        data_dir,
        env_file,
        log_file,
    })
}

/// Generate a 256-bit secret as a 64-char lowercase hex string, from the OS CSPRNG.
/// The server requires encryption keys to be exactly 32 bytes hex (see
/// aimeat/src/services/encryption.ts). Used for AIMEAT_ENCRYPTION_KEY / TOTP key.
fn gen_hex_key() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS random number generator unavailable");
    let mut out = String::with_capacity(64);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Default `.env` contents for a fresh personal node (persistent SQLite).
/// The SQLite path is relative to the working dir (the data dir) so the DB file
/// lands in `<data_dir>/data/aimeat.db` with no platform-specific path escaping.
/// Encryption keys are generated once here so OpenRouter (and TOTP) work out of the box.
fn default_env(node_id: &str) -> String {
    format!(
        "AIMEAT_STORAGE=\"sqlite\"\n\
         AIMEAT_SQLITE_PATH=\"./data/aimeat.db\"\n\
         AIMEAT_PORT={port}\n\
         AIMEAT_NODE_ID=\"{node_id}\"\n\
         AIMEAT_FEDERATION_ROLE=\"standalone\"\n\
         \n\
         # Security keys — auto-generated once. Keep secret; do not share or regenerate.\n\
         # Enables encrypted storage of your OpenRouter API key and TOTP secrets.\n\
         AIMEAT_ENCRYPTION_KEY=\"{enc}\"\n\
         AIMEAT_TOTP_ENCRYPTION_KEY=\"{totp}\"\n",
        port = DEFAULT_PORT,
        node_id = node_id,
        enc = gen_hex_key(),
        totp = gen_hex_key(),
    )
}

/// Append a dated, human-readable marker line to the node log file. Bookends each
/// session so the log carries date/time context even across crashes (node's own
/// crash stack traces are otherwise untimestamped).
fn log_marker(log_file: &Path, message: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_file) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "\n========== {ts} — {message} ==========");
    }
}

/// Ensure the data dir exists, a default SQLite `.env` is present, and the security
/// keys are set. Keys are generated ONCE: a fresh `.env` includes them; an existing
/// `.env` missing them is backfilled without touching any value already set.
fn ensure_env_file(rt: &Runtime) -> Result<(), String> {
    std::fs::create_dir_all(&rt.data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    if !rt.env_file.exists() {
        std::fs::write(&rt.env_file, default_env(DEFAULT_NODE_ID))
            .map_err(|e| format!("Failed to write default .env: {}", e))?;
        return Ok(());
    }

    // Backfill missing security keys into an existing .env (idempotent).
    let content = std::fs::read_to_string(&rt.env_file).unwrap_or_default();
    let vars = parse_env(&content);
    let mut additions = String::new();
    if !vars.contains_key("AIMEAT_ENCRYPTION_KEY") {
        additions.push_str(&format!("AIMEAT_ENCRYPTION_KEY=\"{}\"\n", gen_hex_key()));
    }
    if !vars.contains_key("AIMEAT_TOTP_ENCRYPTION_KEY") {
        additions.push_str(&format!("AIMEAT_TOTP_ENCRYPTION_KEY=\"{}\"\n", gen_hex_key()));
    }
    if !additions.is_empty() {
        let mut updated = content;
        if !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(
            "\n# Security keys — auto-generated once. Keep secret; do not share or regenerate.\n",
        );
        updated.push_str(&additions);
        std::fs::write(&rt.env_file, updated)
            .map_err(|e| format!("Failed to update .env with security keys: {}", e))?;
    }
    Ok(())
}

/// True if a valid (64-char hex) encryption key is configured under either env var.
fn encryption_configured(vars: &HashMap<String, String>) -> bool {
    let valid = |k: &str| {
        vars.get(k)
            .map(|v| v.len() == 64 && v.chars().all(|c| c.is_ascii_hexdigit()))
            .unwrap_or(false)
    };
    valid("AIMEAT_ENCRYPTION_KEY") || valid("AIMEAT_TOTP_ENCRYPTION_KEY")
}

#[tauri::command]
pub fn start_node(app: AppHandle) -> Result<u32, String> {
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    if process.is_some() {
        return Err("Node is already running".to_string());
    }

    let rt = resolve_runtime(&app)?;
    ensure_env_file(&rt)?;
    std::fs::create_dir_all(rt.data_dir.join("data"))
        .map_err(|e| format!("Failed to create data subdir: {}", e))?;

    if !rt.server_entry.exists() {
        return Err(format!(
            "Server entry not found at {}. In dev, run `pnpm stage` first; in a packaged app, reinstall.",
            rt.server_entry.display()
        ));
    }

    // Dated session header so the log carries date/time even if the node crashes.
    log_marker(&rt.log_file, "AIMEAT node starting");
    // Diagnostic: record the resolved spawn paths (these must NOT carry a `\\?\` prefix).
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&rt.log_file) {
        let _ = writeln!(f, "  node:  {}", rt.node_bin.display());
        let _ = writeln!(f, "  entry: {}", rt.server_entry.display());
        let _ = writeln!(f, "  cwd:   {}", rt.data_dir.display());
        let _ = writeln!(f, "  env:   {}", rt.env_file.display());
    }

    // Capture stdout/stderr to the log file.
    let log_stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&rt.log_file)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    let log_stderr = log_stdout
        .try_clone()
        .map_err(|e| format!("Failed to clone log file handle: {}", e))?;

    // Spawn:  node --env-file <env> <entry> start    (cwd = writable data dir)
    let child = Command::new(&rt.node_bin)
        .arg("--env-file")
        .arg(&rt.env_file)
        .arg(&rt.server_entry)
        .arg("start")
        .current_dir(&rt.data_dir)
        .stdout(Stdio::from(log_stdout))
        .stderr(Stdio::from(log_stderr))
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start node ({}): {}",
                rt.node_bin.display(),
                e
            )
        })?;

    let pid = child.id();
    *process = Some(child);

    if let Ok(mut start_time) = NODE_START_TIME.lock() {
        *start_time = Some(Instant::now());
    }

    // Keep the tray icon in sync (running). refresh_tray must not lock NODE_PROCESS.
    crate::tray::refresh_tray(&app, true);

    Ok(pid)
}

#[tauri::command]
pub fn stop_node(app: AppHandle, pid: u32) -> Result<(), String> {
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *process {
        if child.id() == pid {
            child
                .kill()
                .map_err(|e| format!("Failed to stop node: {}", e))?;
            *process = None;

            if let Ok(mut start_time) = NODE_START_TIME.lock() {
                *start_time = None;
            }

            if let Ok(rt) = resolve_runtime(&app) {
                log_marker(&rt.log_file, "AIMEAT node stopped");
            }

            crate::tray::refresh_tray(&app, false);
            return Ok(());
        }
    }
    Err("No matching node process found".to_string())
}

#[tauri::command]
pub fn get_node_status(app: AppHandle) -> Result<NodeStatus, String> {
    let port = read_configured_port(&app);
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;

    // Reap a process that exited on its own (e.g. crashed at startup) so the UI
    // doesn't keep reporting "running" for a dead node.
    let exited = matches!(
        process.as_mut().map(|child| child.try_wait()),
        Some(Ok(Some(_)))
    );
    if exited {
        *process = None;
        if let Ok(mut start_time) = NODE_START_TIME.lock() {
            *start_time = None;
        }
        // The node died on its own — reflect "stopped" in the tray.
        crate::tray::refresh_tray(&app, false);
    }

    let uptime = NODE_START_TIME
        .lock()
        .ok()
        .and_then(|guard| guard.map(|start| start.elapsed().as_secs()));

    match &*process {
        Some(child) => Ok(NodeStatus {
            running: true,
            pid: Some(child.id()),
            port,
            uptime_seconds: uptime,
        }),
        None => Ok(NodeStatus {
            running: false,
            pid: None,
            port,
            uptime_seconds: None,
        }),
    }
}

/// Read the configured AIMEAT_PORT from the managed `.env`, falling back to the default.
fn read_configured_port(app: &AppHandle) -> u16 {
    if let Ok(rt) = resolve_runtime(app) {
        if let Ok(content) = std::fs::read_to_string(&rt.env_file) {
            if let Some(port) = parse_env(&content)
                .get("AIMEAT_PORT")
                .and_then(|v| v.parse().ok())
            {
                return port;
            }
        }
    }
    DEFAULT_PORT
}

#[tauri::command]
pub fn write_config(app: AppHandle, config: NodeConfig) -> Result<(), String> {
    let rt = resolve_runtime(&app)?;
    ensure_env_file(&rt)?;

    let existing = std::fs::read_to_string(&rt.env_file).unwrap_or_default();

    // Keys this app manages — everything else in the file is preserved as-is.
    let managed_keys = [
        "AIMEAT_STORAGE",
        "AIMEAT_SQLITE_PATH",
        "AIMEAT_NODE_ID",
        "AIMEAT_PORT",
        "AIMEAT_FEDERATION_ROLE",
        "AIMEAT_GENESIS_URL",
        "AIMEAT_AI_ENDPOINT",
    ];
    let preserved: Vec<&str> = existing
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return true; // keep comments and blanks
            }
            !managed_keys
                .iter()
                .any(|k| trimmed.starts_with(&format!("{}=", k)))
        })
        .collect();

    let mut env_content = String::new();

    // Storage is fixed to persistent SQLite for the desktop personal node.
    env_content.push_str("AIMEAT_STORAGE=\"sqlite\"\n");
    env_content.push_str("AIMEAT_SQLITE_PATH=\"./data/aimeat.db\"\n");
    env_content.push_str(&format!("AIMEAT_NODE_ID=\"{}\"\n", config.node_id));
    env_content.push_str(&format!("AIMEAT_PORT={}\n", config.port));
    env_content.push_str(&format!(
        "AIMEAT_FEDERATION_ROLE=\"{}\"\n",
        config.federation_role
    ));
    if let Some(ref url) = config.genesis_url {
        if !url.is_empty() {
            env_content.push_str(&format!("AIMEAT_GENESIS_URL=\"{}\"\n", url));
        }
    }
    if let Some(ref ep) = config.ai_endpoint {
        if !ep.is_empty() {
            env_content.push_str(&format!("AIMEAT_AI_ENDPOINT=\"{}\"\n", ep));
        }
    }

    if !preserved.is_empty() {
        env_content.push('\n');
        for line in preserved {
            env_content.push_str(line);
            env_content.push('\n');
        }
    }

    std::fs::write(&rt.env_file, env_content)
        .map_err(|e| format!("Failed to write config: {}", e))
}

/// Read the AIMEAT `.env` configuration and return parsed values.
#[tauri::command]
pub fn read_config(app: AppHandle) -> Result<NodeConfig, String> {
    let rt = resolve_runtime(&app)?;
    ensure_env_file(&rt)?;

    let content = std::fs::read_to_string(&rt.env_file)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let vars = parse_env(&content);

    Ok(NodeConfig {
        node_id: vars
            .get("AIMEAT_NODE_ID")
            .cloned()
            .unwrap_or_else(|| DEFAULT_NODE_ID.to_string()),
        port: vars
            .get("AIMEAT_PORT")
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_PORT),
        federation_role: vars
            .get("AIMEAT_FEDERATION_ROLE")
            .cloned()
            .unwrap_or_else(|| "standalone".to_string()),
        genesis_url: vars.get("AIMEAT_GENESIS_URL").cloned(),
        ai_endpoint: vars.get("AIMEAT_AI_ENDPOINT").cloned(),
        storage: vars
            .get("AIMEAT_STORAGE")
            .cloned()
            .unwrap_or_else(|| "sqlite".to_string()),
        data_dir: rt.data_dir.to_string_lossy().to_string(),
        encryption_configured: encryption_configured(&vars),
    })
}

/// Read the last N lines from the node log file.
#[tauri::command]
pub fn read_node_logs(app: AppHandle, lines: Option<usize>) -> Result<Vec<String>, String> {
    let rt = resolve_runtime(&app)?;
    let max_lines = lines.unwrap_or(200);

    let file =
        File::open(&rt.log_file).map_err(|e| format!("Failed to open log file: {}", e))?;

    let reader = BufReader::new(file);
    let all_lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

    let start = all_lines.len().saturating_sub(max_lines);
    Ok(all_lines[start..].to_vec())
}

/// Clear the node log file.
#[tauri::command]
pub fn clear_node_logs(app: AppHandle) -> Result<(), String> {
    let rt = resolve_runtime(&app)?;
    std::fs::write(&rt.log_file, "")
        .map_err(|e| format!("Failed to clear log file: {}", e))
}

/// Open the node's web portal in the user's default browser (uses the configured port).
#[tauri::command]
pub fn open_portal(app: AppHandle) -> Result<(), String> {
    let port = read_configured_port(&app);
    let url = format!("http://localhost:{}/v1/portal", port);
    open_url(&url)
}

/// Open an external http(s) URL in the user's default browser (used for help links).
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http(s) URLs are allowed".to_string());
    }
    open_url(&url)
}

#[cfg(windows)]
fn open_url(url: &str) -> Result<(), String> {
    // `cmd /C start "" <url>` opens the default browser; the empty "" is the window title.
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

#[cfg(not(windows))]
fn open_url(url: &str) -> Result<(), String> {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    Command::new(opener)
        .arg(url)
        .spawn()
        .map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

/// Parse a `.env` file content into a key-value map. Strips surrounding quotes.
fn parse_env(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim().to_string();
            let mut val = value.trim().to_string();
            if (val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\''))
            {
                val = val[1..val.len() - 1].to_string();
            }
            map.insert(key, val);
        }
    }
    map
}

/// Check whether the node process is currently running.
/// Used by the tray module to determine menu state and tooltip text.
pub fn is_node_running() -> bool {
    NODE_PROCESS
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

/// Get the PID of the running node process, if any.
/// Used by the tray module to call stop_node with the correct PID.
pub fn get_node_pid() -> Option<u32> {
    NODE_PROCESS
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|child| child.id()))
}
