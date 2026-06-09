// AIMEAT Desktop — Ollama Chat bridge management.
//
// Registers the desktop chat as the owner's OWN AIMEAT agent (device-auth, RFC 8628)
// and manages the long-lived "agent bridge" child process (bundled node.exe running
// agent-bridge.mjs). The bridge connects to the node's MCP surface AS that agent and
// runs the Ollama tool-loop. This module relays the bridge's stdout JSON events to the
// webview via Tauri events ("chat-event") and forwards UI commands to its stdin.

use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read_dir, read_to_string, remove_file, write};
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

// ── Persisted chat sessions (one transcript per host + owner + model) ────────────────
// The bridge writes the transcript file ({base_url, owner, model, updated_at, messages}) after each
// turn; these commands let the UI list, resume, and delete them. We persist only the CONVERSATION —
// the model still re-reads live data via MCP, so nothing here can go stale and mislead an answer.

#[derive(Serialize)]
pub struct ChatSessionMeta {
    pub key: String, // file stem — stable handle for open/delete
    pub base_url: String,
    pub owner: String,
    pub model: String,
    pub updated_at: String,
    pub message_count: usize,
    pub preview: String,
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = strip_verbatim(app.path().app_data_dir().map_err(|e| e.to_string())?).join("chat-sessions");
    create_dir_all(&dir).map_err(|e| format!("Failed to create chat-sessions dir: {}", e))?;
    Ok(dir)
}
fn session_key(base: &str, owner: &str, model: &str) -> String {
    format!("{}__{}__{}", sanitize(base.trim_end_matches('/')), sanitize(owner), sanitize(model))
}
fn session_path(app: &AppHandle, base: &str, owner: &str, model: &str) -> Result<PathBuf, String> {
    Ok(sessions_dir(app)?.join(format!("{}.json", session_key(base, owner, model))))
}

/// The persisted transcript for a (host, owner, model), or null. Full JSON incl. `messages`.
#[tauri::command]
pub fn get_chat_session(app: AppHandle, base_url: String, owner: String, model: String) -> Result<Option<serde_json::Value>, String> {
    let f = session_path(&app, &base_url, &owner, &model)?;
    if !f.exists() {
        return Ok(None);
    }
    let content = read_to_string(&f).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map(Some).map_err(|e| e.to_string())
}

/// Every saved session across all host/owner/model combinations, newest first, with a short preview.
#[tauri::command]
pub fn list_chat_sessions(app: AppHandle) -> Result<Vec<ChatSessionMeta>, String> {
    let dir = sessions_dir(&app)?;
    let mut out: Vec<ChatSessionMeta> = Vec::new();
    for entry in read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) else { continue };
        let messages = v.get("messages").and_then(|m| m.as_array()).cloned().unwrap_or_default();
        let count = messages
            .iter()
            .filter(|m| matches!(m.get("role").and_then(|r| r.as_str()), Some("user") | Some("assistant")))
            .count();
        let preview = messages
            .iter()
            .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
            .and_then(|m| m.get("content").and_then(|c| c.as_str()))
            .unwrap_or("")
            .chars()
            .take(80)
            .collect::<String>();
        out.push(ChatSessionMeta {
            key: path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string(),
            base_url: v.get("base_url").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            owner: v.get("owner").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            model: v.get("model").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            updated_at: v.get("updated_at").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            message_count: count,
            preview,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

/// Delete one saved session by its key (file stem from list_chat_sessions).
#[tauri::command]
pub fn delete_chat_session(app: AppHandle, key: String) -> Result<(), String> {
    if key.contains('/') || key.contains('\\') || key.contains("..") {
        return Err("Invalid session key".into());
    }
    let f = sessions_dir(&app)?.join(format!("{}.json", key));
    if f.exists() {
        remove_file(&f).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    owner: String,
    surface: String,
    model: String,
    resume: bool,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let _ = chat_stop(app.clone()); // single instance

    let agent = get_chat_agent(app.clone(), base_url.clone())?
        .ok_or_else(|| "No chat agent registered for this node yet.".to_string())?;
    let (node_bin, entry, cwd) = resolve_bridge(&app)?;

    // Per (host, owner, model) transcript file. The bridge loads it if present and rewrites it after
    // each turn; "start fresh" deletes it first so the bridge begins with an empty conversation.
    let session = session_path(&app, &base_url, &owner, &model)?;
    if !resume {
        let _ = remove_file(&session);
    }

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&entry)
        .current_dir(&cwd)
        .env("AIMEAT_BASE", base_url.trim_end_matches('/'))
        .env("AIMEAT_AGENT_TOKEN", &agent.token)
        .env("AIMEAT_MCP_PATH", format!("/v2/mcp/{}", surface))
        .env("OLLAMA_MODEL", &model)
        .env("AIMEAT_OWNER", &owner)
        .env("AIMEAT_AGENT_GAII", &agent.gaii)
        .env("AIMEAT_SESSION_FILE", session.to_string_lossy().to_string())
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

/// Clear the running conversation (and its persisted transcript) without disconnecting.
#[tauri::command]
pub fn chat_clear() -> Result<(), String> {
    send_cmd(serde_json::json!({ "type": "clear" }))
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
