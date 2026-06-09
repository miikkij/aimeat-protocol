// AIMEAT Desktop — Ollama Chat bridge management.
//
// Registers the desktop chat as the owner's OWN AIMEAT agent (device-auth, RFC 8628)
// and manages the long-lived "agent bridge" child process (bundled node.exe running
// agent-bridge.mjs). The bridge connects to the node's MCP surface AS that agent and
// runs the Ollama tool-loop. This module relays the bridge's stdout JSON events to the
// webview via Tauri events ("chat-event") and forwards UI commands to its stdin.

use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read_to_string, write};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::node_manager::strip_verbatim;

static CHAT_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static CHAT_STDIN: Mutex<Option<ChildStdin>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatAgent {
    pub base_url: String,
    pub agent_name: String,
    pub gaii: String,
    /// Agent JWT (Bearer for MCP). Stored locally so registration is one-time per node.
    pub token: String,
}

fn sanitize(base: &str) -> String {
    base.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

fn agent_file(app: &AppHandle, base: &str) -> Result<PathBuf, String> {
    let dir = strip_verbatim(app.path().app_data_dir().map_err(|e| e.to_string())?).join("chat-agents");
    create_dir_all(&dir).map_err(|e| format!("Failed to create chat-agents dir: {}", e))?;
    Ok(dir.join(format!("{}.json", sanitize(base))))
}

/// Return the stored chat-agent for a node base URL, if already registered.
#[tauri::command]
pub fn get_chat_agent(app: AppHandle, base_url: String) -> Result<Option<ChatAgent>, String> {
    let f = agent_file(&app, base_url.trim_end_matches('/'))?;
    if !f.exists() {
        return Ok(None);
    }
    let content = read_to_string(&f).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map(Some).map_err(|e| e.to_string())
}

/// Register the desktop chat as the owner's own agent via device-auth, then store its token.
/// The owner is already signed in (owner_token), so we auto-approve the request ourselves.
#[tauri::command]
pub async fn register_chat_agent(
    app: AppHandle,
    base_url: String,
    owner: String,
    owner_token: String,
    agent_name: String,
) -> Result<ChatAgent, String> {
    let base = base_url.trim_end_matches('/').to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Start the device-authorization flow.
    let da: serde_json::Value = client
        .post(format!("{}/v1/agents/device-authorize", base))
        .json(&serde_json::json!({ "agent_name": agent_name, "owner": owner, "mode": "interactive" }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {}", base, e))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let device_code = da
        .pointer("/data/device_code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            da.pointer("/error/message")
                .and_then(|m| m.as_str())
                .unwrap_or("device-authorize failed")
                .to_string()
        })?
        .to_string();
    let user_code = da
        .pointer("/data/user_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 2. Auto-approve as the owner (we hold a valid owner JWT).
    let ver: serde_json::Value = client
        .post(format!("{}/v1/agents/verify", base))
        .json(&serde_json::json!({ "user_code": user_code, "action": "approve", "owner_token": owner_token }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if ver.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let msg = ver
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("Approval failed");
        return Err(msg.to_string());
    }
    let gaii = ver
        .pointer("/data/gaii")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 3. Poll for the agent access token (OAuth shape: { access_token }).
    let mut token = String::new();
    for _ in 0..6 {
        let tk: serde_json::Value = client
            .post(format!("{}/v1/agents/device-token", base))
            .json(&serde_json::json!({ "device_code": device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        if let Some(t) = tk.get("access_token").and_then(|v| v.as_str()) {
            token = t.to_string();
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    }
    if token.is_empty() {
        return Err("Did not receive an agent token. Please try again.".to_string());
    }

    let agent = ChatAgent { base_url: base.clone(), agent_name, gaii, token };
    write(
        agent_file(&app, &base)?,
        serde_json::to_string_pretty(&agent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to store agent token: {}", e))?;
    Ok(agent)
}

/// Resolve (node_bin, bridge_entry, cwd) for spawning the bundled agent bridge.
fn resolve_bridge(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let entry = app
        .path()
        .resolve("resources/server/agent-bridge.mjs", tauri::path::BaseDirectory::Resource)
        .ok()
        .map(strip_verbatim)
        .filter(|p| p.exists())
        .ok_or_else(|| "Chat bridge not found. Run `pnpm stage` (dev) or reinstall.".to_string())?;
    let cwd = entry
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Invalid bridge path".to_string())?;
    let node_bin = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|d| strip_verbatim(d.join(if cfg!(windows) { "node.exe" } else { "node" })))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("node"));
    Ok((node_bin, entry, cwd))
}

/// Start (or restart) the chat bridge for a node, surface, and model.
#[tauri::command]
pub fn chat_start(
    app: AppHandle,
    base_url: String,
    surface: String,
    model: String,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let _ = chat_stop(app.clone()); // single instance

    let agent = get_chat_agent(app.clone(), base_url.clone())?
        .ok_or_else(|| "No chat agent registered for this node yet.".to_string())?;
    let (node_bin, entry, cwd) = resolve_bridge(&app)?;

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&entry)
        .current_dir(&cwd)
        .env("AIMEAT_BASE", base_url.trim_end_matches('/'))
        .env("AIMEAT_AGENT_TOKEN", &agent.token)
        .env("AIMEAT_MCP_PATH", format!("/v2/mcp/{}", surface))
        .env("OLLAMA_MODEL", &model)
        .env("OLLAMA_URL", ollama_url.unwrap_or_else(|| "http://localhost:11434".to_string()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Windows: don't pop a console window for the spawned node.exe (CREATE_NO_WINDOW).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start chat bridge ({}): {}", node_bin.display(), e))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    *CHAT_STDIN.lock().map_err(|e| e.to_string())? = Some(stdin);

    // Relay bridge stdout (JSON lines) → webview Tauri events.
    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(val) => {
                    let _ = handle.emit("chat-event", val);
                }
                Err(_) => {
                    let _ = handle.emit("chat-event", serde_json::json!({ "type": "log", "text": line }));
                }
            }
        }
        let _ = handle.emit("chat-event", serde_json::json!({ "type": "closed" }));
    });

    if let Some(stderr) = child.stderr.take() {
        let h2 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = h2.emit("chat-event", serde_json::json!({ "type": "stderr", "text": line }));
            }
        });
    }

    *CHAT_CHILD.lock().map_err(|e| e.to_string())? = Some(child);
    Ok(())
}

fn send_cmd(value: serde_json::Value) -> Result<(), String> {
    let mut guard = CHAT_STDIN.lock().map_err(|e| e.to_string())?;
    let stdin = guard.as_mut().ok_or("Chat is not running")?;
    writeln!(stdin, "{}", value).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn chat_send(text: String) -> Result<(), String> {
    send_cmd(serde_json::json!({ "type": "user", "text": text }))
}

#[tauri::command]
pub fn chat_approve(id: String, approved: bool) -> Result<(), String> {
    send_cmd(serde_json::json!({ "type": "approval", "id": id, "approved": approved }))
}

#[tauri::command]
pub fn chat_set_auto_approve(value: bool) -> Result<(), String> {
    send_cmd(serde_json::json!({ "type": "set_auto_approve", "value": value }))
}

#[tauri::command]
pub fn chat_stop(_app: AppHandle) -> Result<(), String> {
    if let Ok(mut guard) = CHAT_STDIN.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = CHAT_CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
    Ok(())
}
