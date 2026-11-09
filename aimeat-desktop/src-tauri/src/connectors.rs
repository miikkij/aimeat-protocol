// AIMEAT Desktop: detect and edit the local clients' own MCP settings. An added URL does not
// prove authentication. No credentials are read from a client or sent during an address check.
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

#[path = "connector_config.rs"]
mod config;
#[cfg(test)]
#[path = "connector_tests.rs"]
mod tests;

static CONFIG_WRITE: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConnectorEntry {
    pub name: String,
    pub url: String,
    pub matches_selected: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Connector {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub connected: bool,
    pub connected_url: Option<String>,
    pub method: String,
    pub config_path: Option<String>,
    pub config_error: Option<String>,
    pub address_is_local: bool,
    pub entries: Vec<ConnectorEntry>,
}

struct ClientSpec {
    id: &'static str,
    name: &'static str,
    key: &'static str,
    with_type: bool,
    method: &'static str,
}

const SPECS: &[ClientSpec] = &[
    ClientSpec { id: "claude-code", name: "Claude Code", key: "mcpServers", with_type: true, method: "file" },
    ClientSpec { id: "claude-desktop", name: "Claude Desktop", key: "mcpServers", with_type: true, method: "cloud" },
    ClientSpec { id: "cursor", name: "Cursor", key: "mcpServers", with_type: false, method: "file" },
    ClientSpec { id: "vscode", name: "VS Code", key: "servers", with_type: true, method: "file" },
    ClientSpec { id: "codex", name: "Codex", key: "mcp_servers", with_type: false, method: "file" },
];

fn spec(id: &str) -> Result<&'static ClientSpec, String> {
    SPECS.iter().find(|s| s.id == id).ok_or_else(|| "TOOL_UNSUPPORTED".into())
}

fn home_dir() -> Option<PathBuf> {
    env_dir(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).filter(|value| !value.is_empty()).map(PathBuf::from)
}

fn app_data_dir() -> Option<PathBuf> {
    if cfg!(windows) { return env_dir("APPDATA"); }
    let home = home_dir()?;
    if cfg!(target_os = "macos") { Some(home.join("Library").join("Application Support")) }
    else { env_dir("XDG_CONFIG_HOME").or_else(|| Some(home.join(".config"))) }
}

fn claude_code_config_in(config_dir: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    config_dir.or(home).map(|d| d.join(".claude.json"))
}

fn config_path(id: &str) -> Option<PathBuf> {
    match id {
        "claude-code" => claude_code_config_in(env_dir("CLAUDE_CONFIG_DIR"), home_dir()),
        "cursor" => home_dir().map(|h| h.join(".cursor").join("mcp.json")),
        "vscode" => app_data_dir().map(|d| d.join("Code").join("User").join("mcp.json")),
        "codex" => env_dir("CODEX_HOME").or_else(|| home_dir().map(|h| h.join(".codex"))).map(|h| h.join("config.toml")),
        _ => None,
    }
}

fn is_installed(id: &str) -> bool {
    let marker = match id {
        "claude-desktop" => app_data_dir().map(|h| h.join("Claude")),
        "claude-code" => home_dir().map(|h| h.join(".claude")),
        _ => config_path(id).and_then(|p| p.parent().map(|d| d.to_path_buf())),
    };
    marker.is_some_and(|p| p.exists()) || config_path(id).is_some_and(|p| p.exists())
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorAddress {
    pub base_url: String,
    pub mcp_url: String,
}

fn local_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_lowercase();
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified(),
            IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local() || ip.is_unspecified(),
        };
    }
    host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local")
        || host.ends_with(".internal") || host.ends_with(".home") || !host.contains('.')
}

/// A person may paste either the base address or /v1/mcp. The scheme and host are normalized by
/// the URL parser; a path remains case sensitive. Credentials, queries and fragments are refused.
fn parse_address(raw: &str) -> Result<ConnectorAddress, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 2048 || raw.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("ADDRESS_INVALID".into());
    }
    let bare = !raw.contains("://");
    let candidate = if bare { format!("https://{}", raw) } else { raw.into() };
    let mut url = Url::parse(&candidate).map_err(|_| "ADDRESS_INVALID".to_string())?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("ADDRESS_INVALID".into());
    }
    let local = local_host(url.host_str().unwrap());
    if bare && local { let _ = url.set_scheme("http"); }
    if url.scheme() == "http" && !local { return Err("ADDRESS_INSECURE".into()); }
    let path = url.path().trim_end_matches('/');
    let base_path = path.strip_suffix("/v1/mcp").unwrap_or(path).to_string();
    url.set_path(&base_path);
    let base_url = url.as_str().trim_end_matches('/').to_string();
    Ok(ConnectorAddress { mcp_url: format!("{}/v1/mcp", base_url), base_url })
}

pub fn is_local_address(raw: &str) -> bool {
    parse_address(raw).ok().and_then(|a| Url::parse(&a.base_url).ok())
        .and_then(|u| u.host_str().map(local_host)).unwrap_or(true)
}

fn is_same_node(configured: &str, node_url: &str) -> bool {
    match (parse_address(configured), parse_address(node_url)) {
        (Ok(a), Ok(b)) => a.mcp_url == b.mcp_url,
        _ => false,
    }
}

/// The probe is read-only, bounded, and cannot follow a redirect to a different machine. It
/// checks discovery rather than calling any model or authenticated MCP tool.
async fn check_address(raw: &str) -> Result<ConnectorAddress, String> {
    let address = parse_address(raw)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(4)).redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_| "ADDRESS_UNREACHABLE".to_string())?;
    let mut response = client.get(format!("{}/.well-known/aimeat", address.base_url))
        .header("Accept", "application/json").send().await.map_err(|_| "ADDRESS_UNREACHABLE".to_string())?;
    if !response.status().is_success() { return Err(format!("ADDRESS_NOT_AIMEAT: HTTP {}", response.status().as_u16())); }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "ADDRESS_UNREACHABLE".to_string())? {
        if body.len() + chunk.len() > 65536 { return Err("ADDRESS_NOT_AIMEAT: response too large".into()); }
        body.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&body).map_err(|_| "ADDRESS_NOT_AIMEAT".to_string())?;
    let descriptor = value.get("data").unwrap_or(&value);
    if descriptor.get("protocol").and_then(Value::as_str) != Some("aimeat")
        || descriptor.get("node_id").and_then(Value::as_str).is_none_or(str::is_empty)
        || descriptor.pointer("/endpoints/mcp").and_then(Value::as_str) != Some("/v1/mcp") {
        return Err("ADDRESS_NOT_AIMEAT".into());
    }
    Ok(address)
}

#[tauri::command]
pub async fn check_connector_address(node_url: String) -> Result<ConnectorAddress, String> {
    check_address(&node_url).await
}

fn server_name(raw: Option<String>) -> String {
    let clean: String = raw.unwrap_or_default().to_lowercase().chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
    let name = clean.trim_matches('-');
    if name.is_empty() { "aimeat".into() } else { name.chars().take(48).collect() }
}

fn read_connector(s: &ClientSpec, node_url: &str) -> Connector {
    let path = config_path(s.id);
    let mut config_error = None;
    let mut entries = Vec::new();
    if let Some(path) = &path {
        match config::read(path).and_then(|text| config::Config::parse(text.as_deref().unwrap_or(""), s.key)) {
            Ok(config) => for (name, url) in config.entries(s.key) {
                // Only AIMEAT-shaped endpoints appear in this app's list. Other MCP settings
                // still reserve their names and survive every edit.
                if Url::parse(&url).ok().is_some_and(|u| u.path().trim_end_matches('/').ends_with("/v1/mcp")) {
                    // A manually configured URL can contain a secret. Such entries remain in
                    // the client's file, but never cross into this app's UI or diagnostics.
                    if let Ok(address) = parse_address(&url) {
                        entries.push(ConnectorEntry { matches_selected: is_same_node(&url, node_url), name, url: address.mcp_url });
                    }
                }
            },
            Err(e) => config_error = Some(e),
        }
    }
    let connected = entries.iter().any(|e| e.matches_selected);
    Connector {
        id: s.id.into(), name: s.name.into(), installed: is_installed(s.id), connected,
        connected_url: entries.iter().find(|e| !e.matches_selected).map(|e| e.url.clone()),
        method: s.method.into(), config_path: path.map(|p| p.display().to_string()), config_error,
        address_is_local: is_local_address(node_url), entries,
    }
}

#[tauri::command]
pub fn detect_connectors(node_url: String) -> Result<Vec<Connector>, String> {
    let address = parse_address(&node_url)?;
    Ok(SPECS.iter().map(|s| read_connector(s, &address.base_url)).collect())
}

/// Adding picks a free name. Replacement requires both the old name and old URL from the screen;
/// it starts a fresh URL-only entry so credentials for the former server cannot reach the new one.
fn add_to_config(text: &str, s: &ClientSpec, url: &str, name: &str, replace: Option<(&str, &str)>) -> Result<String, String> {
    let mut doc = config::Config::parse(text, s.key)?;
    if let Some((old_name, old_url)) = replace {
        doc.remove_exact(s.key, old_name, old_url)?;
        doc.put(s.key, old_name, url, s.with_type);
    } else {
        if doc.entries(s.key).iter().any(|(_, configured)| is_same_node(configured, url)) { return Ok(text.into()); }
        let name = doc.unique_name(s.key, name);
        doc.put(s.key, &name, url, s.with_type);
    }
    Ok(doc.text())
}

#[tauri::command]
pub async fn connect_connector(id: String, node_url: String, name: Option<String>, replace_name: Option<String>, replace_url: Option<String>) -> Result<Connector, String> {
    let s = spec(&id)?;
    if s.method != "file" { return Err("TOOL_UNSUPPORTED".into()); }
    let address = check_address(&node_url).await?;
    let _guard = CONFIG_WRITE.lock().map_err(|_| "CONFIG_WRITE".to_string())?;
    let path = config_path(&id).ok_or_else(|| "CONFIG_READ".to_string())?;
    let before = config::read(&path)?;
    let replace = match (replace_name.as_deref(), replace_url.as_deref()) {
        (Some(name), Some(url)) => Some((name, url)),
        (None, None) => None,
        _ => return Err("CONNECTION_CHANGED".into()),
    };
    let merged = add_to_config(before.as_deref().unwrap_or(""), s, &address.mcp_url, &server_name(name), replace)?;
    if before.as_deref() != Some(&merged) { config::write(&path, before.as_deref(), &merged)?; }
    let result = read_connector(s, &address.base_url);
    if !result.connected { return Err("CONFIG_CHANGED".into()); }
    Ok(result)
}

#[tauri::command]
pub fn disconnect_connector(id: String, node_url: String, name: String) -> Result<Connector, String> {
    let s = spec(&id)?;
    if s.method != "file" { return Err("TOOL_UNSUPPORTED".into()); }
    let address = parse_address(&node_url)?;
    let _guard = CONFIG_WRITE.lock().map_err(|_| "CONFIG_WRITE".to_string())?;
    let path = config_path(&id).ok_or_else(|| "CONFIG_READ".to_string())?;
    let before = config::read(&path)?.ok_or_else(|| "CONNECTION_MISSING".to_string())?;
    let mut doc = config::Config::parse(&before, s.key)?;
    doc.remove_exact(s.key, &name, &address.mcp_url)?;
    config::write(&path, Some(&before), &doc.text())?;
    let result = read_connector(s, &address.base_url);
    if result.entries.iter().any(|e| e.name == name) { return Err("CONFIG_CHANGED".into()); }
    Ok(result)
}

#[tauri::command]
pub fn connector_snippet(id: String, node_url: String, name: Option<String>) -> Result<String, String> {
    let s = spec(&id)?;
    let address = parse_address(&node_url)?;
    if s.method == "cloud" { return Ok(address.mcp_url); }
    let mut doc = config::Config::parse("", s.key)?;
    doc.put(s.key, &server_name(name), &address.mcp_url, s.with_type);
    Ok(doc.text())
}
