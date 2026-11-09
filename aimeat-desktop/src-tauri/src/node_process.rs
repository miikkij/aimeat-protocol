// AIMEAT Desktop: child ownership, readiness, graceful shutdown and bounded logs.
// The lifecycle lock serializes starts, stops, configuration writes and offline backups.
// The state lock is short-lived, so status and the child monitor stay responsive while stopping.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub static LIFECYCLE: Mutex<()> = Mutex::new(());
static STATE: LazyLock<Mutex<ProcessState>> = LazyLock::new(|| Mutex::new(ProcessState::default()));
static LOG_WRITE: Mutex<()> = Mutex::new(());
const STOP_TIMEOUT: Duration = Duration::from_secs(35);
const START_TIMEOUT: Duration = Duration::from_secs(120);
const LOG_LIMIT: u64 = 10 * 1024 * 1024;
const TAIL_LIMIT: u64 = 1024 * 1024;

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Stopped,
    Starting,
    Ready,
    Stopping,
    Failed,
}

#[derive(Default)]
struct ProcessState {
    child: Option<Child>,
    data_lock: Option<Arc<File>>,
    port: Option<u16>,
    configured: Option<(u16, HashMap<String, String>)>,
    bound: bool,
    became_ready: bool,
    phase: Phase,
    started: Option<Instant>,
    last_error: Option<String>,
    exit_code: Option<i32>,
}

#[derive(Serialize, Clone)]
pub struct NodeStatus {
    /// A process exists, including while it starts or stops. Use `ready` to enable clients.
    pub running: bool,
    pub ready: bool,
    pub state: Phase,
    pub pid: Option<u32>,
    /// The actual child port while running; the configured port otherwise.
    pub port: u16,
    pub configured_port: u16,
    pub restart_required: bool,
    pub uptime_seconds: Option<u64>,
    pub last_error: Option<String>,
    pub exit_code: Option<i32>,
}

fn configured(app: &AppHandle) -> (u16, HashMap<String, String>) {
    let env = super::resolve_runtime(app).ok()
        .and_then(|rt| std::fs::read_to_string(rt.env_file).ok()).unwrap_or_default();
    let vars = super::parse_env(&env);
    (vars.get("AIMEAT_PORT").and_then(|v| v.parse().ok()).unwrap_or(super::DEFAULT_PORT), vars)
}

fn snapshot(state: &ProcessState, config: &(u16, HashMap<String, String>)) -> NodeStatus {
    NodeStatus {
        running: state.child.is_some(),
        ready: state.phase == Phase::Ready && state.child.is_some(),
        state: state.phase,
        pid: state.child.as_ref().map(Child::id),
        port: state.port.unwrap_or(config.0),
        configured_port: config.0,
        restart_required: state.child.is_some() && state.configured.as_ref().is_some_and(|c| c != config),
        uptime_seconds: state.started.map(|s| s.elapsed().as_secs()),
        last_error: state.last_error.clone(),
        exit_code: state.exit_code,
    }
}

fn reap(state: &mut ProcessState) -> Result<(), String> {
    let exit = state.child.as_mut().map(Child::try_wait).transpose()
        .map_err(|e| format!("Could not check the node process: {}", e))?.flatten();
    if let Some(exit) = exit {
        let was_stopping = state.phase == Phase::Stopping;
        state.child = None;
        state.data_lock = None;
        state.port = None;
        state.bound = false;
        state.started = None;
        state.exit_code = exit.code();
        if was_stopping && exit.success() {
            state.phase = Phase::Stopped;
        } else {
            state.phase = Phase::Failed;
            state.last_error.get_or_insert_with(|| format!(
                "The node stopped unexpectedly ({}). Open the log for its last message.", exit
            ));
        }
    }
    Ok(())
}

pub fn status(app: &AppHandle) -> Result<NodeStatus, String> {
    let config = configured(app);
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    reap(&mut state)?;
    Ok(snapshot(&state, &config))
}

pub fn publish(app: &AppHandle) {
    if let Ok(status) = status(app) {
        crate::tray::refresh_tray_state(app, &status);
        let _ = app.emit("node-status", &status);
    }
}

pub fn record_failure(app: &AppHandle, message: &str) {
    if let Ok(mut state) = STATE.lock() {
        if state.child.is_none() {
            state.phase = Phase::Failed;
            state.last_error = Some(message.to_string());
        }
    }
    publish(app);
}

pub fn ensure_owned(port: u16) -> Result<(), String> {
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    reap(&mut state)?;
    if state.child.is_none() {
        return Err(super::NODE_NOT_RUNNING.to_string());
    }
    if state.port != Some(port) {
        return Err(format!("The running node uses port {}. Restart it to apply the saved port.", state.port.unwrap_or(0)));
    }
    if state.phase != Phase::Ready || !state.bound {
        return Err("The node is not ready yet. Wait until its status is Ready, then try again.".into());
    }
    Ok(())
}

pub fn ensure_stopped() -> Result<(), String> {
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    reap(&mut state)?;
    if state.child.is_some() {
        return Err("Stop the node before backing up or restoring its data.".into());
    }
    Ok(())
}

pub fn running() -> bool {
    STATE.lock().map(|mut s| { let _ = reap(&mut s); s.child.is_some() }).unwrap_or(false)
}

/// The caller holds LIFECYCLE from before it reads configuration until this returns.
pub fn start(app: &AppHandle, rt: &super::Runtime, data_lock: File) -> Result<u32, String> {
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    reap(&mut state)?;
    if state.child.is_some() { return Err("The node is already running.".into()); }
    *state = ProcessState::default();
    let config = configured(app);
    let port = config.0;
    // An occupied port is a user-visible error before a second node can touch the database.
    let probe = TcpListener::bind(("127.0.0.1", port))
        .map_err(|_| format!("Port {} is already in use. Choose another port in Settings.", port));
    if let Err(message) = probe {
        state.phase = Phase::Failed;
        state.last_error = Some(message.clone());
        return Err(message);
    }
    drop(probe);
    let preload = rt.server_entry.parent().and_then(Path::parent).and_then(Path::parent)
        .map(|p| p.join("desktop-parent.mjs")).filter(|p| p.exists())
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../runtime/desktop-parent.mjs"));
    if !preload.is_file() { return Err("The Desktop lifecycle adapter is missing. Reinstall the app.".into()); }
    let preload_url = reqwest::Url::from_file_path(&preload)
        .map_err(|_| "The Desktop lifecycle adapter path is invalid.".to_string())?;
    let token = super::gen_hex_key();
    super::log_marker(&rt.log_file, "AIMEAT node starting");
    let mut command = Command::new(&rt.node_bin);
    command.args(["--env-file", &rt.env_file.to_string_lossy(), "--import", preload_url.as_str()])
        .arg(&rt.server_entry).arg("start").current_dir(&rt.data_dir)
        .envs(&config.1)
        .env("AIMEAT_DESKTOP_PARENT_TOKEN", &token)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("Could not start the node: {}", e))?;
    let child_pid = child.id();
    let stdout = child.stdout.take().ok_or("The node output pipe is missing.")?;
    let stderr = child.stderr.take().ok_or("The node error pipe is missing.")?;
    state.child = Some(child);
    state.data_lock = Some(Arc::new(data_lock));
    state.port = Some(port);
    state.configured = Some(config);
    state.started = Some(Instant::now());
    state.phase = Phase::Starting;
    drop(state);
    for source in [Box::new(stdout) as Box<dyn Read + Send>, Box::new(stderr) as Box<dyn Read + Send>] {
        let log = rt.log_file.clone();
        let token = token.clone();
        std::thread::spawn(move || read_output(source, &log, child_pid, port, &token));
    }
    publish(app);
    let monitor_app = app.clone();
    std::thread::spawn(move || monitor(monitor_app, child_pid));
    Ok(child_pid)
}

fn accept_control(line: &str, token: &str, port: u16) -> bool {
    let Some(json) = line.strip_prefix("AIMEAT_DESKTOP_CONTROL:") else { return false; };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json.trim()) else { return false; };
    value["token"].as_str() == Some(token) && value["type"].as_str() == Some("listening")
        && value["port"].as_u64() == Some(u64::from(port))
}

fn read_output(source: Box<dyn Read + Send>, path: &Path, pid: u32, port: u16, token: &str) {
    // read_until alone allocates without limit for an unterminated line. Each chunk here is bounded.
    let mut reader = BufReader::new(source);
    let mut pending = Vec::new();
    loop {
        let chunk = match reader.fill_buf() { Ok([]) | Err(_) => break, Ok(b) => b };
        let count = chunk.iter().position(|b| *b == b'\n').map(|i| i + 1).unwrap_or(chunk.len());
        pending.extend_from_slice(&chunk[..count]);
        reader.consume(count);
        if pending.last() == Some(&b'\n') || pending.len() >= 64 * 1024 {
            let line = String::from_utf8_lossy(&pending);
            if accept_control(&line, token, port) {
                if let Ok(mut state) = STATE.lock() {
                    if state.child.as_ref().map(Child::id) == Some(pid) { state.bound = true; }
                }
            } else if !line.starts_with("AIMEAT_DESKTOP_CONTROL:") {
                let _ = append_log(path, &pending, LOG_LIMIT);
            }
            pending.clear();
        }
    }
    if !pending.is_empty() { let _ = append_log(path, &pending, LOG_LIMIT); }
}

fn ready(port: u16) -> bool {
    let address: SocketAddr = ([127, 0, 0, 1], port).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if write!(stream, "GET /v1/health/ready HTTP/1.1\r\nHost: localhost:{}\r\nConnection: close\r\n\r\n", port).is_err() { return false; }
    let mut bytes = [0u8; 128];
    match stream.read(&mut bytes) {
        Ok(n) => bytes[..n].starts_with(b"HTTP/1.1 200 ") || bytes[..n].starts_with(b"HTTP/1.0 200 "),
        Err(_) => false,
    }
}

fn monitor(app: AppHandle, pid: u32) {
    let mut last = String::new();
    loop {
        let (port, probe, timed_out) = match STATE.lock() {
            Ok(mut state) => {
                let _ = reap(&mut state);
                if state.child.as_ref().map(Child::id) != Some(pid) { publish_after_unlock(state, &app); return; }
                (state.port.unwrap_or(0), state.bound && state.phase != Phase::Stopping,
                    !state.became_ready && state.phase == Phase::Starting && state.started.is_some_and(|s| s.elapsed() > START_TIMEOUT))
            }
            Err(_) => return,
        };
        if timed_out {
            if let Ok(mut state) = STATE.lock() { state.last_error = Some("The node did not become ready. Open the log for details.".into()); }
            let _ = stop(&app, Some(pid));
            if let Ok(mut state) = STATE.lock() { state.phase = Phase::Failed; }
            publish(&app);
            return;
        }
        let healthy = probe && ready(port);
        if let Ok(mut state) = STATE.lock() {
            if state.child.as_ref().map(Child::id) == Some(pid) && state.phase != Phase::Stopping {
                if healthy {
                    state.phase = Phase::Ready;
                    state.became_ready = true;
                    state.last_error = None;
                } else if state.became_ready {
                    state.phase = Phase::Failed;
                    state.last_error = Some("The running node is not answering its readiness check. Open the log for details.".into());
                }
            }
        }
        if let Ok(mut status) = status(&app) {
            status.uptime_seconds = None; // events report changes; a UI may tick its own duration.
            let current = serde_json::to_string(&status).unwrap_or_default();
            if current != last { publish(&app); last = current; }
        }
        std::thread::sleep(Duration::from_millis(750));
    }
}

fn publish_after_unlock(state: std::sync::MutexGuard<'_, ProcessState>, app: &AppHandle) {
    drop(state);
    publish(app);
}

/// Serialize the whole graceful stop, but release STATE between child exit checks.
pub fn stop(app: &AppHandle, expected: Option<u32>) -> Result<(), String> {
    let _operation = LIFECYCLE.lock().map_err(|e| e.to_string())?;
    {
        let mut state = STATE.lock().map_err(|e| e.to_string())?;
        reap(&mut state)?;
        if let Some(pid) = expected {
            if state.child.as_ref().map(Child::id) != Some(pid) { return Err("The selected node process is no longer running.".into()); }
        }
        if state.child.is_none() { return Ok(()); }
        state.phase = Phase::Stopping;
        if let Some(input) = state.child.as_mut().and_then(|c| c.stdin.as_mut()) {
            let _ = input.write_all(b"aimeat-desktop:stop\n");
            let _ = input.flush();
        }
        // EOF is a second, independent stop request, and leaves no pipe behind on exit.
        if let Some(child) = state.child.as_mut() { child.stdin.take(); }
    }
    publish(app);
    let until = Instant::now() + STOP_TIMEOUT;
    loop {
        {
            let mut state = STATE.lock().map_err(|e| e.to_string())?;
            reap(&mut state)?;
            if state.child.is_none() { break; }
            if Instant::now() >= until {
                if let Some(child) = state.child.as_mut() {
                    child.kill().map_err(|e| format!("Could not stop the node: {}", e))?;
                    let _ = child.wait();
                }
                state.child = None;
                state.data_lock = None;
                state.port = None;
                state.started = None;
                state.bound = false;
                state.phase = Phase::Failed;
                state.last_error = Some("The node did not finish stopping, so Desktop forced it to stop. Check the log before restarting.".into());
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if let Ok(rt) = super::resolve_runtime(app) { super::log_marker(&rt.log_file, "AIMEAT node stopped"); }
    publish(app);
    Ok(())
}

/// A second Desktop process must not start or restore the same SQLite data. The lock lives
/// beside the data folder so a restore can rename that folder on Windows while holding it.
pub fn lock_data(root: &Path) -> Result<File, String> {
    let parent = root.parent().ok_or("The Desktop data folder must have a parent folder.")?;
    let name = root.file_name().ok_or("The Desktop data folder must have a name.")?.to_string_lossy();
    std::fs::create_dir_all(parent).map_err(|e| format!("Could not prepare the data folder: {}", e))?;
    let path = parent.join(format!(".{}.aimeat-desktop.lock", name));
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&path)
        .map_err(|e| format!("Could not open the Desktop data lock: {}", e))?;
    super::make_private(&path, 0o600)?;
    file.try_lock().map_err(|_| "Another Desktop process is using this data folder. Stop its AIMEAT before continuing.".to_string())?;
    Ok(file)
}

/// Keep the child's lease alive even if the monitor reaps it during a settings write.
/// Otherwise take a temporary lease before configuration preparation can modify any files.
pub fn config_lock(root: &Path) -> Result<Arc<File>, String> {
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    reap(&mut state)?;
    if let Some(lease) = state.data_lock.as_ref().filter(|_| state.child.is_some()) {
        return Ok(Arc::clone(lease));
    }
    drop(state);
    lock_data(root).map(Arc::new)
}

fn append_log(path: &Path, bytes: &[u8], limit: u64) -> Result<(), String> {
    let _write = LOG_WRITE.lock().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size.saturating_add(bytes.len() as u64) > limit {
        let previous = path.with_extension("log.1");
        if previous.exists() { std::fs::remove_file(&previous).map_err(|e| e.to_string())?; }
        if path.exists() { std::fs::rename(path, previous).map_err(|e| e.to_string())?; }
    }
    let mut file = OpenOptions::new().append(true).create(true).open(path).map_err(|e| e.to_string())?;
    super::make_private(path, 0o600)?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

pub fn tail(path: &Path, lines: usize) -> Result<Vec<String>, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not read the log: {}", e)),
    };
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    let from = length.saturating_sub(TAIL_LIMIT);
    file.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(TAIL_LIMIT).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    let mut all: Vec<String> = text.lines().skip(usize::from(from > 0)).map(str::to_string).collect();
    let start = all.len().saturating_sub(lines.min(2000));
    Ok(all.drain(start..).collect())
}

pub fn clear_log(path: &Path) -> Result<(), String> {
    let _write = LOG_WRITE.lock().map_err(|e| e.to_string())?;
    std::fs::write(path, "").map_err(|e| format!("Could not clear the log: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_port_does_not_replace_the_running_port() {
        let state = ProcessState { port: Some(41050), phase: Phase::Ready, ..Default::default() };
        let s = snapshot(&state, &(41051, HashMap::new()));
        assert_eq!(s.port, 41050);
        assert_eq!(s.configured_port, 41051);
    }

    #[test]
    fn another_listener_cannot_attest_the_childs_port() {
        let proof = "AIMEAT_DESKTOP_CONTROL:{\"token\":\"secret\",\"type\":\"listening\",\"port\":41050}\n";
        assert!(accept_control(proof, "secret", 41050));
        assert!(!accept_control(proof, "foreign", 41050));
        assert!(!accept_control(proof, "secret", 41051));
        assert!(!accept_control("HTTP/1.1 200 OK", "secret", 41050));
    }

    #[test]
    fn the_log_tail_is_bounded_and_rotation_keeps_one_previous_file() {
        let root = std::env::temp_dir().join(format!("aimeat-log-test-{}-{}", std::process::id(), super::super::gen_hex_key()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("node.log");
        append_log(&path, b"one\ntwo\n", 12).unwrap();
        assert_eq!(tail(&path, 1).unwrap(), vec!["two"]);
        append_log(&path, b"three\nfour\n", 12).unwrap();
        assert_eq!(tail(&path, 10).unwrap(), vec!["three", "four"]);
        assert_eq!(std::fs::read_to_string(path.with_extension("log.1")).unwrap(), "one\ntwo\n");
        std::fs::write(&path, vec![b'x'; (TAIL_LIMIT * 2) as usize]).unwrap();
        assert!(tail(&path, 500).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn another_desktop_cannot_start_or_restore_the_same_data_until_the_first_releases_it() {
        let root = std::env::temp_dir().join(format!("aimeat-lock-test-{}", super::super::gen_hex_key()));
        std::fs::create_dir_all(&root).unwrap();
        let data = root.join("data");
        let first = lock_data(&data).unwrap();
        assert!(lock_data(&data).is_err());
        assert!(config_lock(&data).is_err());
        drop(first);
        drop(config_lock(&data).unwrap());
        drop(lock_data(&data).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
