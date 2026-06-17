// AIMEAT Desktop — Local agent runtime (the crewaimeat fleet on a local Ollama model).
//
// Mirrors chat.rs's pattern: spawn the bundled node.exe on the resources/agent-runtime/*.mjs
// scripts, relay their stdout JSON lines to the webview as "agent-event", and stop the daemon by
// killing the supervisor process. provision.mjs orchestrates git/uv/ollama (one-shot);
// run-agent.mjs supervises the crew daemon (long-lived). Workstream A of
// docs/plans/2026-06-17-desktop-agent-runtime-plan.md.
//
// NOTE: authored without a local Rust toolchain — compile-check with `cargo check` /
// `pnpm tauri build` before release. It deliberately reuses only APIs already used by chat.rs.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::node_manager::strip_verbatim;

static AGENT_CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// The bundled node.exe sitting next to the app executable (same resolution as chat.rs).
fn node_bin() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|d| strip_verbatim(d.join(if cfg!(windows) { "node.exe" } else { "node" })))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("node"))
}

/// Resolve a file under resources/agent-runtime/ in the bundle.
fn runtime_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            format!("resources/agent-runtime/{}", name),
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .map(strip_verbatim)
        .filter(|p| p.exists())
        .ok_or_else(|| format!("{} not found. Run `pnpm stage` (dev) or reinstall.", name))
}

fn providers_default(app: &AppHandle) -> String {
    runtime_file(app, "llm_providers.default.json")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn workdir(app: &AppHandle) -> Result<String, String> {
    let dir = strip_verbatim(app.path().app_data_dir().map_err(|e| e.to_string())?).join("agent-runtime");
    Ok(dir.to_string_lossy().to_string())
}

/// Spawn a runtime script (node.exe <script> <args...>), relaying stdout/stderr JSON lines to the
/// webview as "agent-event". `keep=true` stores the child for later kill (the long-lived daemon);
/// `keep=false` reaps it in the background (one-shot provisioning).
fn spawn_relay(app: &AppHandle, script: &str, args: Vec<String>, env: Vec<(String, String)>, keep: bool) -> Result<(), String> {
    let entry = runtime_file(app, script)?;
    let cwd = entry.parent().map(|p| p.to_path_buf()).ok_or("Invalid script path")?;
    let node = node_bin();

    let mut cmd = Command::new(&node);
    cmd.arg(&entry);
    for a in &args {
        cmd.arg(a);
    }
    cmd.current_dir(&cwd)
        .env("AIMEAT_AGENT_WORKDIR", workdir(app)?)
        .env("AIMEAT_PROVIDERS_DEFAULT", providers_default(app))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }
    // Windows: don't pop a console window for the spawned node.exe (CREATE_NO_WINDOW).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {} ({}): {}", script, node.display(), e))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(val) => {
                    let _ = handle.emit("agent-event", val);
                }
                Err(_) => {
                    let _ = handle.emit("agent-event", serde_json::json!({ "type": "log", "text": line }));
                }
            }
        }
        let _ = handle.emit("agent-event", serde_json::json!({ "type": "closed" }));
    });

    if let Some(stderr) = child.stderr.take() {
        let h2 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = h2.emit("agent-event", serde_json::json!({ "type": "stderr", "text": line }));
            }
        });
    }

    if keep {
        *AGENT_CHILD.lock().map_err(|e| e.to_string())? = Some(child);
    } else {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
    Ok(())
}

/// First-run provisioning: git clone/update crewaimeat, uv sync, write the local-Gemma provider
/// config, optionally install uv and pull the model. One-shot; progress streams as "agent-event".
#[tauri::command]
pub fn agent_provision(app: AppHandle, model: Option<String>, install_uv: bool, pull_model: bool) -> Result<(), String> {
    let mut args: Vec<String> = Vec::new();
    if install_uv {
        args.push("--install-uv".into());
    }
    if pull_model {
        args.push("--pull-model".into());
    }
    // gemma4 by default — crews need tool-calling. gemma4 supports it; gemma3 does not (see provision.mjs).
    let env = vec![("AIMEAT_AGENT_MODEL".to_string(), model.unwrap_or_else(|| "gemma4:latest".to_string()))];
    spawn_relay(&app, "provision.mjs", args, env, false)
}

/// Start (or restart) the local agent daemon for a crew module against the local node.
///
/// `owner` + `owner_token` (the owner's JWT, obtained via the existing `node_login` command) let
/// run-agent.mjs auto-approve the agent on the LOCAL node — no manual device-auth. `AIMEAT_HOME`
/// is an isolated connector home under the app data dir so the desktop's token/serve.json never
/// collide with the user's global ~/.aimeat fleet.
#[tauri::command]
pub fn agent_start(
    app: AppHandle,
    crew_module: String,
    agent_name: String,
    node_url: String,
    owner: String,
    owner_token: String,
) -> Result<(), String> {
    let _ = agent_stop(app.clone()); // single instance
    let aimeat_home = strip_verbatim(app.path().app_data_dir().map_err(|e| e.to_string())?)
        .join("agent-runtime")
        .join(".aimeat")
        .to_string_lossy()
        .to_string();
    let env = vec![
        ("AIMEAT_CREW_MODULE".to_string(), crew_module),
        ("AIMEAT_AGENT_NAME".to_string(), agent_name),
        ("AIMEAT_NODE_URL".to_string(), node_url.trim_end_matches('/').to_string()),
        ("AIMEAT_AGENT_OWNER".to_string(), owner),
        ("AIMEAT_OWNER_TOKEN".to_string(), owner_token),
        ("AIMEAT_HOME".to_string(), aimeat_home),
    ];
    spawn_relay(&app, "run-agent.mjs", Vec::new(), env, true)
}

/// Stop the running agent daemon (kills the supervisor; its child crew exits with it).
#[tauri::command]
pub fn agent_stop(_app: AppHandle) -> Result<(), String> {
    let mut guard = AGENT_CHILD.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        kill_tree(child.id()); // taskkill /T → also reaps the uv + python crew grandchildren
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Kill a process AND its whole child tree. The agent supervisor spawns `uv run python …` (the crew)
/// and the loopback serve daemon — a plain `child.kill()` would leave those grandchildren alive,
/// where they LOCK node.exe / the .venv and break the next install or provision.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output();
}
#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
}

/// Kill THIS desktop's loopback serve daemon (the one in its isolated home's serve.json). It is
/// spawned detached so it outlives the crew, so it must be reaped explicitly on shutdown.
pub fn kill_serve_daemon(app: &AppHandle) {
    let home = match app.path().app_data_dir() {
        Ok(d) => strip_verbatim(d).join("agent-runtime").join(".aimeat"),
        Err(_) => return,
    };
    if let Ok(txt) = std::fs::read_to_string(home.join("serve.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(pid) = v.get("pid").and_then(|p| p.as_u64()) {
                kill_tree(pid as u32);
            }
        }
    }
}

/// Full agent-side shutdown: kill the supervisor+crew tree and the detached serve daemon. Called
/// from the app's exit handler so nothing lingers to lock files for the next launch/install.
pub fn shutdown(app: &AppHandle) {
    let _ = agent_stop(app.clone());
    kill_serve_daemon(app);
}

/// Whether the agent daemon supervisor is currently running.
#[tauri::command]
pub fn agent_status(_app: AppHandle) -> Result<bool, String> {
    let mut guard = AGENT_CHILD.lock().map_err(|e| e.to_string())?;
    let running = match guard.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)), // no exit status yet → still running
        None => false,
    };
    Ok(running)
}
