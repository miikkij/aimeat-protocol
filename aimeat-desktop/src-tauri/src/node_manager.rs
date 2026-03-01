// AIMEAT Desktop — Node Process Manager
// Starts, stops, and monitors the AIMEAT Node.js server as a child process.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::process::{Child, Command};

static NODE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

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
}

#[tauri::command]
pub fn start_node(config_path: String) -> Result<u32, String> {
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    if process.is_some() {
        return Err("Node is already running".to_string());
    }

    let child = Command::new("node")
        .args(["--env-file", &config_path, "dist/index.js"])
        .current_dir("../aimeat")
        .spawn()
        .map_err(|e| format!("Failed to start node: {}", e))?;

    let pid = child.id();
    *process = Some(child);
    Ok(pid)
}

#[tauri::command]
pub fn stop_node(pid: u32) -> Result<(), String> {
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *process {
        if child.id() == pid {
            child.kill().map_err(|e| format!("Failed to stop node: {}", e))?;
            *process = None;
            return Ok(());
        }
    }
    Err("No matching node process found".to_string())
}

#[tauri::command]
pub fn get_node_status() -> Result<NodeStatus, String> {
    let process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    match &*process {
        Some(child) => Ok(NodeStatus {
            running: true,
            pid: Some(child.id()),
            port: 40050,
            uptime_seconds: None, // TODO: track start time
        }),
        None => Ok(NodeStatus {
            running: false,
            pid: None,
            port: 40050,
            uptime_seconds: None,
        }),
    }
}

#[tauri::command]
pub fn write_config(config: NodeConfig) -> Result<(), String> {
    let env_content = format!(
        r#"AIMEAT_NODE_ID="{}"
AIMEAT_PORT={}
AIMEAT_FEDERATION_ROLE="{}"
{}
{}
"#,
        config.node_id,
        config.port,
        config.federation_role,
        config.genesis_url.map_or(String::new(), |url| format!("AIMEAT_GENESIS_URL=\"{}\"", url)),
        config.ai_endpoint.map_or(String::new(), |ep| format!("AIMEAT_AI_ENDPOINT=\"{}\"", ep)),
    );

    std::fs::write(".env", env_content)
        .map_err(|e| format!("Failed to write config: {}", e))
}
