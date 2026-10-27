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
/// The port the node in NODE_PROCESS was started on, while it runs. The owner's password and token
/// go only to that port, and only while that node runs (ensure_own_node).
static NODE_PORT: Mutex<Option<u16>> = Mutex::new(None);

/// What the owner sees when a sign-in or an AI setting would reach a port where this app's node is
/// not running: whatever answers there is not their node.
const NODE_NOT_RUNNING: &str =
    "The AIMEAT node on this computer is not running. Start it, then try again.";

/// Ok when the node this app started is running and listens on `port`; a plain refusal otherwise,
/// before any connection is opened. Another account on the same computer can listen on the port
/// while this node is stopped or failed to start, so the port alone does not say whose node it is.
pub fn ensure_own_node(port: u16) -> Result<(), String> {
    if stands_in_for_own_node(port) {
        return Ok(());
    }
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    let running = matches!(process.as_mut().map(|child| child.try_wait()), Some(Ok(None)));
    if !running {
        return Err(NODE_NOT_RUNNING.to_string());
    }
    match NODE_PORT.lock().ok().and_then(|guard| *guard) {
        Some(started) if started == port => Ok(()),
        Some(started) => Err(format!(
            "The AIMEAT node on this computer was started on port {}. Stop it and start it again to use port {}.",
            started, port
        )),
        None => Err(NODE_NOT_RUNNING.to_string()),
    }
}

/// In a normal build, nothing stands in for the node this app started.
#[cfg(not(test))]
fn stands_in_for_own_node(_port: u16) -> bool {
    false
}

#[cfg(test)]
fn stands_in_for_own_node(port: u16) -> bool {
    test_support::is_stand_in(port)
}

/// Tests run a stub node on a port of their own; registering that port makes the stub stand in for
/// the node this app started, for that port only. Every other port still meets the real check.
#[cfg(test)]
pub mod test_support {
    use std::sync::Mutex;

    static STAND_INS: Mutex<Vec<u16>> = Mutex::new(Vec::new());

    pub fn stand_in_for_own_node(port: u16) {
        if let Ok(mut ports) = STAND_INS.lock() {
            ports.push(port);
        }
    }

    pub(super) fn is_stand_in(port: u16) -> bool {
        STAND_INS.lock().map(|ports| ports.contains(&port)).unwrap_or(false)
    }
}

/// On macOS and Linux, give a file or folder this mode, so only the person's own account can read
/// it (0600 for a file, 0700 for a folder). Windows keeps the per-user profile's access list.
#[cfg(unix)]
pub(crate) fn make_private(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|e| format!("Failed to restrict {}: {}", path.display(), e))
}

#[cfg(not(unix))]
pub(crate) fn make_private(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

/// Default port the AIMEAT server listens on. Deliberately NOT 40050 — that is the dev
/// server's default, and a desktop node sharing it collides with anyone running `pnpm dev`
/// (port-bind failure, then the agent talks to the wrong node and its token is rejected).
/// The desktop personal node uses its own dedicated port.
const DEFAULT_PORT: u16 = 41050;
/// Legacy desktop port (== the dev-server default). Existing installs still pinned to this
/// value are migrated to DEFAULT_PORT on startup so the desktop stops colliding with dev.
const LEGACY_PORT: u16 = 40050;
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
    /// Where the node answers (AIMEAT_BIND_HOST): "127.0.0.1" for this computer only, "0.0.0.0" for
    /// the local network too. None when the .env has no such line (an install from before this
    /// setting, which answers on every address); on write, None or "" leaves the line as it is.
    #[serde(default)]
    pub bind_host: Option<String>,
}

/// The two listen addresses the settings offer.
const BIND_HOSTS: [&str; 2] = ["127.0.0.1", "0.0.0.0"];

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
         # The node answers on this computer only. To reach it from other devices on your local\n\
         # network, choose that in the app's settings (it writes 0.0.0.0 here).\n\
         AIMEAT_BIND_HOST=\"127.0.0.1\"\n\
         \n\
         # App origin isolation (security finding H-2): user-published apps run on a\n\
         # SEPARATE origin from the authenticated UI so they can never reach your session.\n\
         # `*.localhost` resolves to loopback in the WebView automatically, so this needs\n\
         # NO DNS and NO TLS on the desktop — it just works. (Hosted nodes on a real domain\n\
         # use apps.<domain> + a wildcard cert instead — see docs/internal/app-origin-deployment.md.)\n\
         AIMEAT_APP_HOST=\"apps.localhost\"\n\
         AIMEAT_APP_ORIGIN_ENABLED=true\n\
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

/// Rewrite `AIMEAT_PORT=40050` (the legacy desktop default, shared with the dev server) to the
/// current DEFAULT_PORT. Idempotent and conservative: only an exact match of the old default is
/// changed, so a port the user deliberately set is preserved.
fn migrate_legacy_port(env_file: &Path) -> Result<(), String> {
    let content = std::fs::read_to_string(env_file).unwrap_or_default();
    let from = format!("AIMEAT_PORT={}", LEGACY_PORT);
    let to = format!("AIMEAT_PORT={}", DEFAULT_PORT);
    if !content.lines().any(|l| l.trim() == from.as_str()) {
        return Ok(());
    }
    let body = content
        .lines()
        .map(|l| if l.trim() == from.as_str() { to.as_str() } else { l })
        .collect::<Vec<_>>()
        .join("\n");
    let migrated = if content.ends_with('\n') { format!("{}\n", body) } else { body };
    std::fs::write(env_file, migrated)
        .map_err(|e| format!("Failed to migrate .env port: {}", e))
}

/// Ensure the data dir exists, a default SQLite `.env` is present, and the security
/// keys are set. Keys are generated ONCE: a fresh `.env` includes them; an existing
/// `.env` missing them is backfilled without touching any value already set.
fn ensure_env_file(rt: &Runtime) -> Result<(), String> {
    std::fs::create_dir_all(&rt.data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    // The folder holds the .env keys, the database and the log: this account only.
    make_private(&rt.data_dir, 0o700)?;

    if !rt.env_file.exists() {
        std::fs::write(&rt.env_file, default_env(DEFAULT_NODE_ID))
            .map_err(|e| format!("Failed to write default .env: {}", e))?;
        return make_private(&rt.env_file, 0o600);
    }
    // An existing install keeps its file and its keys; only who may read it changes.
    make_private(&rt.env_file, 0o600)?;

    // Migrate the legacy desktop port (40050 — the dev-server default) to the dedicated desktop
    // port so a running `pnpm dev` no longer collides. Only the old default is touched; a custom
    // port the user chose is left alone. Done before backfill so later reads see the new value.
    migrate_legacy_port(&rt.env_file)?;

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

    // Backfill app-origin isolation (H-2) into older installs whose `.env` predates it, so they
    // get the same out-of-the-box isolation as fresh installs. Only added when ABSENT — a value
    // the user set themselves is left untouched. `apps.localhost` needs no DNS/TLS in the WebView.
    let content = std::fs::read_to_string(&rt.env_file).unwrap_or_default();
    let vars = parse_env(&content);
    if !vars.contains_key("AIMEAT_APP_ORIGIN_ENABLED") && !vars.contains_key("AIMEAT_APP_HOST") {
        let mut updated = content;
        if !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(
            "\n# App origin isolation (H-2): apps run on a separate origin so they can't reach\n\
             # your session. `*.localhost` resolves to loopback in the WebView — no DNS/TLS needed.\n\
             AIMEAT_APP_HOST=\"apps.localhost\"\n\
             AIMEAT_APP_ORIGIN_ENABLED=true\n",
        );
        std::fs::write(&rt.env_file, updated)
            .map_err(|e| format!("Failed to update .env with app origin: {}", e))?;
    }
    // std::fs::write keeps the mode of a file that exists, so the rewrites above stay 0600.
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
    make_private(&rt.data_dir.join("data"), 0o700)?;

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
    make_private(&rt.log_file, 0o600)?;
    let log_stderr = log_stdout
        .try_clone()
        .map_err(|e| format!("Failed to clone log file handle: {}", e))?;

    // Spawn:  node --env-file <env> <entry> start    (cwd = writable data dir)
    let mut cmd = Command::new(&rt.node_bin);
    cmd.arg("--env-file")
        .arg(&rt.env_file)
        .arg(&rt.server_entry)
        .arg("start")
        .current_dir(&rt.data_dir)
        .stdout(Stdio::from(log_stdout))
        .stderr(Stdio::from(log_stderr));
    // Windows: suppress the spawned node.exe console window (CREATE_NO_WINDOW).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let child = cmd.spawn().map_err(|e| {
        format!("Failed to start node ({}): {}", rt.node_bin.display(), e)
    })?;

    let pid = child.id();
    *process = Some(child);
    // The port this node was started on, from the .env it was started with.
    let started_port = std::fs::read_to_string(&rt.env_file)
        .ok()
        .and_then(|content| parse_env(&content).get("AIMEAT_PORT").and_then(|v| v.parse().ok()))
        .unwrap_or(DEFAULT_PORT);
    if let Ok(mut port) = NODE_PORT.lock() {
        *port = Some(started_port);
    }

    if let Ok(mut start_time) = NODE_START_TIME.lock() {
        *start_time = Some(Instant::now());
    }

    // Keep the tray icon in sync (running). refresh_tray must not lock NODE_PROCESS.
    crate::tray::refresh_tray(&app, true);

    Ok(pid)
}

/// Kill the node sidecar unconditionally (used by the app's exit handler so the server doesn't
/// linger and lock node.exe / better_sqlite3.node for the next install).
pub fn kill_node() {
    if let Ok(mut process) = NODE_PROCESS.lock() {
        if let Some(mut child) = process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut start_time) = NODE_START_TIME.lock() {
        *start_time = None;
    }
    if let Ok(mut port) = NODE_PORT.lock() {
        *port = None;
    }
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
            if let Ok(mut port) = NODE_PORT.lock() {
                *port = None;
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
        if let Ok(mut port) = NODE_PORT.lock() {
            *port = None;
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
    // The node-level entries for the AI server on this computer follow the listen address
    // (local_ai.rs): written in local-network mode, removed otherwise.
    let env_content = crate::local_ai::sync_env(&compose_env(&existing, &config)?)?;
    std::fs::write(&rt.env_file, env_content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    make_private(&rt.env_file, 0o600)
}

/// The .env `write_config` writes: the keys this app manages from `config`, then every other line of
/// `existing` as it was.
fn compose_env(existing: &str, config: &NodeConfig) -> Result<String, String> {
    // The listen address is written only when the person chose one; otherwise the line (or its
    // absence, on an install from before this setting) stays as it is.
    let bind_host = config.bind_host.as_deref().map(str::trim).filter(|h| !h.is_empty());
    if let Some(h) = bind_host {
        if !BIND_HOSTS.contains(&h) {
            return Err(format!("\"{}\" is not a listen address this app offers.", h));
        }
    }

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
            if bind_host.is_some() && trimmed.starts_with("AIMEAT_BIND_HOST=") {
                return false; // replaced below with the address the person chose
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
    if let Some(h) = bind_host {
        env_content.push_str(&format!("AIMEAT_BIND_HOST=\"{}\"\n", h));
    }

    if !preserved.is_empty() {
        env_content.push('\n');
        for line in preserved {
            env_content.push_str(line);
            env_content.push('\n');
        }
    }
    Ok(env_content)
}

/// The managed `.env`, made ready the way every settings write makes it (local_ai.rs writes it too).
pub(crate) fn resolve_env_file(app: &AppHandle) -> Result<PathBuf, String> {
    let rt = resolve_runtime(app)?;
    ensure_env_file(&rt)?;
    Ok(rt.env_file)
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
        bind_host: vars.get("AIMEAT_BIND_HOST").cloned(),
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
    crate::opener::open_url(&url)
}

/// Open an external http(s) URL in the user's default browser (help links, and links in a chat
/// answer). The opener decides what may be opened; see opener.rs.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    crate::opener::open_url(&url)
}

/// Parse a `.env` file content into a key-value map. Strips surrounding quotes.
pub(crate) fn parse_env(content: &str) -> HashMap<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A Runtime whose writable folder is a fresh temp folder of its own.
    fn temp_runtime(name: &str) -> Runtime {
        let data_dir = std::env::temp_dir().join(format!("aimeat-desktop-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&data_dir);
        Runtime {
            node_bin: PathBuf::from("node"),
            server_entry: PathBuf::from("index.js"),
            env_file: data_dir.join(".env"),
            log_file: data_dir.join("aimeat-node.log"),
            data_dir,
        }
    }

    fn config(bind_host: Option<&str>) -> NodeConfig {
        NodeConfig {
            node_id: "aimeat-local-001-dev".into(),
            port: DEFAULT_PORT,
            federation_role: "standalone".into(),
            genesis_url: None,
            ai_endpoint: None,
            storage: String::new(),
            data_dir: String::new(),
            encryption_configured: false,
            bind_host: bind_host.map(String::from),
        }
    }

    // secaudit2026oct26, local-profile-from-default-baseurl-on-network-reachable-listener.

    #[test]
    fn a_new_install_answers_on_this_computer_only() {
        let vars = parse_env(&default_env(DEFAULT_NODE_ID));
        assert_eq!(vars.get("AIMEAT_BIND_HOST").map(String::as_str), Some("127.0.0.1"));
    }

    #[test]
    fn saving_the_settings_without_a_choice_keeps_an_existing_install_as_it_is() {
        let before = "AIMEAT_PORT=41050\nAIMEAT_ENCRYPTION_KEY=\"k\"\n";
        let after = compose_env(before, &config(None)).unwrap();
        assert!(!after.contains("AIMEAT_BIND_HOST"), "{}", after);
        let after = compose_env(before, &config(Some(""))).unwrap();
        assert!(!after.contains("AIMEAT_BIND_HOST"), "{}", after);
        let with_line = "AIMEAT_BIND_HOST=\"127.0.0.1\"\nAIMEAT_ENCRYPTION_KEY=\"k\"\n";
        let after = compose_env(with_line, &config(None)).unwrap();
        assert_eq!(parse_env(&after).get("AIMEAT_BIND_HOST").map(String::as_str), Some("127.0.0.1"));
        assert_eq!(parse_env(&after).get("AIMEAT_ENCRYPTION_KEY").map(String::as_str), Some("k"));
    }

    #[test]
    fn the_person_can_open_it_to_the_local_network_and_close_it_again() {
        let new_install = default_env(DEFAULT_NODE_ID);
        let open = compose_env(&new_install, &config(Some("0.0.0.0"))).unwrap();
        assert_eq!(open.matches("AIMEAT_BIND_HOST=").count(), 1, "{}", open);
        assert_eq!(parse_env(&open).get("AIMEAT_BIND_HOST").map(String::as_str), Some("0.0.0.0"));
        let closed = compose_env(&open, &config(Some("127.0.0.1"))).unwrap();
        assert_eq!(closed.matches("AIMEAT_BIND_HOST=").count(), 1, "{}", closed);
        assert_eq!(parse_env(&closed).get("AIMEAT_BIND_HOST").map(String::as_str), Some("127.0.0.1"));
        // The keys made at install are still there.
        assert_eq!(
            parse_env(&closed).get("AIMEAT_ENCRYPTION_KEY"),
            parse_env(&new_install).get("AIMEAT_ENCRYPTION_KEY")
        );
    }

    #[test]
    fn a_listen_address_the_settings_do_not_offer_is_refused() {
        assert!(compose_env("", &config(Some("10.0.0.5"))).is_err());
        assert!(compose_env("", &config(Some("0.0.0.0\"\nAIMEAT_SECURITY_PROFILE=\"local"))).is_err());
    }

    // secaudit2026oct26, data-dir-default-file-mode.

    #[test]
    fn an_existing_install_starts_with_the_same_keys_and_values() {
        let rt = temp_runtime("existing");
        std::fs::create_dir_all(&rt.data_dir).unwrap();
        let before = "AIMEAT_PORT=41050\nAIMEAT_ENCRYPTION_KEY=\"aaaa\"\nAIMEAT_TOTP_ENCRYPTION_KEY=\"bbbb\"\nAIMEAT_APP_HOST=\"apps.localhost\"\n";
        std::fs::write(&rt.env_file, before).unwrap();
        ensure_env_file(&rt).unwrap();
        assert_eq!(std::fs::read_to_string(&rt.env_file).unwrap(), before);
        let _ = std::fs::remove_dir_all(&rt.data_dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_this_account_can_read_the_keys_and_the_data() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;

        let rt = temp_runtime("fresh");
        ensure_env_file(&rt).unwrap();
        assert_eq!(mode(&rt.data_dir), 0o700);
        assert_eq!(mode(&rt.env_file), 0o600);

        // An install from before: a world-readable .env is tightened, its content unchanged.
        let rt = temp_runtime("upgraded");
        std::fs::create_dir_all(&rt.data_dir).unwrap();
        std::fs::set_permissions(&rt.data_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let before = "AIMEAT_ENCRYPTION_KEY=\"aaaa\"\nAIMEAT_TOTP_ENCRYPTION_KEY=\"bbbb\"\nAIMEAT_APP_HOST=\"apps.localhost\"\n";
        std::fs::write(&rt.env_file, before).unwrap();
        std::fs::set_permissions(&rt.env_file, std::fs::Permissions::from_mode(0o644)).unwrap();
        ensure_env_file(&rt).unwrap();
        assert_eq!(mode(&rt.data_dir), 0o700);
        assert_eq!(mode(&rt.env_file), 0o600);
        assert_eq!(std::fs::read_to_string(&rt.env_file).unwrap(), before);
        let _ = std::fs::remove_dir_all(&rt.data_dir);
    }
}
