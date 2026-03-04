// AIMEAT Desktop — Node Process Manager
// Starts, stops, and monitors the AIMEAT Node.js server as a child process.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;

static NODE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
static NODE_START_TIME: Mutex<Option<Instant>> = Mutex::new(None);

/// Path to the node log file (relative to aimeat/ directory).
const LOG_FILE_PATH: &str = "../aimeat/aimeat-node.log";

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

    // Open (or create) the log file to capture stdout/stderr
    let log_file_stdout = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(LOG_FILE_PATH)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let log_file_stderr = log_file_stdout
        .try_clone()
        .map_err(|e| format!("Failed to clone log file handle: {}", e))?;

    let child = Command::new("node")
        .args(["--env-file", &config_path, "dist/index.js"])
        .current_dir("../aimeat")
        .stdout(Stdio::from(log_file_stdout))
        .stderr(Stdio::from(log_file_stderr))
        .spawn()
        .map_err(|e| format!("Failed to start node: {}", e))?;

    let pid = child.id();
    *process = Some(child);

    // Record start time for uptime tracking
    if let Ok(mut start_time) = NODE_START_TIME.lock() {
        *start_time = Some(Instant::now());
    }

    Ok(pid)
}

#[tauri::command]
pub fn stop_node(pid: u32) -> Result<(), String> {
    let mut process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *process {
        if child.id() == pid {
            child.kill().map_err(|e| format!("Failed to stop node: {}", e))?;
            *process = None;

            // Clear start time on stop
            if let Ok(mut start_time) = NODE_START_TIME.lock() {
                *start_time = None;
            }

            return Ok(());
        }
    }
    Err("No matching node process found".to_string())
}

#[tauri::command]
pub fn get_node_status() -> Result<NodeStatus, String> {
    let process = NODE_PROCESS.lock().map_err(|e| e.to_string())?;
    let uptime = NODE_START_TIME
        .lock()
        .ok()
        .and_then(|guard| guard.map(|start| start.elapsed().as_secs()));

    match &*process {
        Some(child) => Ok(NodeStatus {
            running: true,
            pid: Some(child.id()),
            port: 40050,
            uptime_seconds: uptime,
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
    // Read existing .env to preserve non-managed variables
    let env_path = "../aimeat/.env";
    let existing = std::fs::read_to_string(env_path).unwrap_or_default();

    // Parse existing lines that we do NOT manage
    let managed_keys = [
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
            // Keep lines whose key is not in managed_keys
            !managed_keys
                .iter()
                .any(|k| trimmed.starts_with(&format!("{}=", k)))
        })
        .collect();

    let mut env_content = String::new();

    // Write managed config at top
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

    // Append preserved lines
    if !preserved.is_empty() {
        env_content.push('\n');
        for line in preserved {
            env_content.push_str(line);
            env_content.push('\n');
        }
    }

    std::fs::write(env_path, env_content)
        .map_err(|e| format!("Failed to write config: {}", e))
}

/// Read the last N lines from the node log file.
#[tauri::command]
pub fn read_node_logs(lines: Option<usize>) -> Result<Vec<String>, String> {
    let max_lines = lines.unwrap_or(200);

    let file =
        File::open(LOG_FILE_PATH).map_err(|e| format!("Failed to open log file: {}", e))?;

    let reader = BufReader::new(file);
    let all_lines: Vec<String> = reader
        .lines()
        .filter_map(|line| line.ok())
        .collect();

    // Return the last N lines
    let start = if all_lines.len() > max_lines {
        all_lines.len() - max_lines
    } else {
        0
    };

    Ok(all_lines[start..].to_vec())
}

/// Clear the node log file.
#[tauri::command]
pub fn clear_node_logs() -> Result<(), String> {
    // Truncate by overwriting with empty content
    std::fs::write(LOG_FILE_PATH, "")
        .map_err(|e| format!("Failed to clear log file: {}", e))
}

/// Read the AIMEAT .env configuration and return parsed values.
#[tauri::command]
pub fn read_config() -> Result<NodeConfig, String> {
    let env_path = "../aimeat/.env";
    let content =
        std::fs::read_to_string(env_path).map_err(|e| format!("Failed to read config: {}", e))?;

    let vars = parse_env(&content);

    Ok(NodeConfig {
        node_id: vars
            .get("AIMEAT_NODE_ID")
            .cloned()
            .unwrap_or_else(|| "aimeat-local-001-dev".to_string()),
        port: vars
            .get("AIMEAT_PORT")
            .and_then(|v| v.parse().ok())
            .unwrap_or(40050),
        federation_role: vars
            .get("AIMEAT_FEDERATION_ROLE")
            .cloned()
            .unwrap_or_else(|| "standalone".to_string()),
        genesis_url: vars.get("AIMEAT_GENESIS_URL").cloned(),
        ai_endpoint: vars.get("AIMEAT_AI_ENDPOINT").cloned(),
    })
}

/// Parse a .env file content into a key-value map.
/// Strips surrounding quotes from values.
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
            // Strip surrounding quotes
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
