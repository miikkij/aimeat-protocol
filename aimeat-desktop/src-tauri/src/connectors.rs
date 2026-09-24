// AIMEAT Desktop — MCP connectors: which AIs on this machine are attached to the node.
//
// This is the app's front door. A person installs one program and their own AI is attached to
// their node, without a terminal and without walking a settings menu. The web cannot do this:
// only a program on the machine can see which tools are installed and edit their config files.
//
// NOTHING HERE HOLDS A SECRET. The node speaks OAuth 2.1 with dynamic client registration
// (aimeat/src/mcp/oauth.ts), so a client needs the endpoint URL and nothing else: it registers
// itself, opens a browser, and the person signs in as themselves. That is why connecting is a
// four-line edit rather than a token dance, and why the same edit is safe for every client.
//
// THE SHAPES COME FROM THE NODE, NOT FROM GUESSWORK. aimeat/src/services/mcp-install.ts is the
// one place that says what each client accepts: Claude Code and Cursor key on `mcpServers`,
// VS Code on `servers`; VS Code needs `type`, Cursor rejects it. Those three are written here.
// A client whose file shape this project has not verified is reported as `manual` with a snippet
// to paste, because a file a client loads and silently ignores is the failure this path exists
// to remove.
//
// EVERY WRITE KEEPS A COPY. Before the first change to a config file the original is copied to
// `<file>.aimeat-backup`, and the new content is written to a temporary file in the same folder
// and renamed over the original, so a crash mid-write cannot leave a half-file behind.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// One AI tool on this machine, as the front screen shows it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Connector {
    /// Stable id used by the frontend and by connect/disconnect.
    pub id: String,
    /// What the tool calls itself.
    pub name: String,
    /// Whether this machine has the tool at all.
    pub installed: bool,
    /// Whether it is attached to the node that was asked about.
    pub connected: bool,
    /// The AIMEAT endpoint it is attached to, when that is a different node.
    pub connected_url: Option<String>,
    /// "file" — this app writes the tool's own config · "manual" — the person pastes the lines
    /// into a file on this machine · "cloud" — the tool is attached in its own settings and
    /// reaches the address from somewhere else, so there is nothing on this machine to read.
    pub method: String,
    /// The config file, whether or not it exists yet. None for a cloud tool.
    pub config_path: Option<String>,
    /// True when the address the person gave answers only on this machine. It is what decides
    /// whether a cloud tool can reach their AIMEAT at all.
    pub address_is_local: bool,
}

/// What a client accepts, and where it keeps it.
struct ClientSpec {
    id: &'static str,
    name: &'static str,
    /// The object the servers live under: `mcpServers` or `servers`.
    key: &'static str,
    /// Whether the entry carries `"type": "http"`. VS Code requires it, Cursor rejects it.
    with_type: bool,
    /// How this tool is attached: see Connector::method.
    method: &'static str,
    /// Why this one is not written here. It reaches a person only through the refusal below, as
    /// a safety net; the words the screen shows are the frontend's, in the person's language.
    note: Option<&'static str>,
}

const SPECS: &[ClientSpec] = &[
    ClientSpec {
        id: "claude-code",
        name: "Claude Code",
        key: "mcpServers",
        with_type: true,
        method: "file",
        note: None,
    },
    // Claude Desktop takes a remote MCP server as a CUSTOM CONNECTOR, added in its own settings,
    // on every plan including the free one. There is no file here to write and no bridge to build:
    // "When you add a custom connector, Claude connects to your remote MCP server from Anthropic's
    // cloud infrastructure, rather than from your local device", and "Servers hosted on a private
    // corporate network, behind a VPN, or blocked by a firewall won't connect, even if you can
    // reach them from your own machine" (support.claude.com article 11175166, read 2026-09-18).
    // So this row's real question is not which file to edit; it is whether the person's AIMEAT
    // answers from the internet at all, which is what `address_is_local` tells the screen.
    ClientSpec {
        id: "claude-desktop",
        name: "Claude Desktop",
        key: "mcpServers",
        with_type: true,
        method: "cloud",
        note: Some("Claude Desktop is attached in its own connector settings, and it reaches the address from Anthropic's cloud rather than from this machine."),
    },
    ClientSpec {
        id: "cursor",
        name: "Cursor",
        key: "mcpServers",
        with_type: false,
        method: "file",
        note: None,
    },
    ClientSpec {
        id: "vscode",
        name: "VS Code",
        key: "servers",
        with_type: true,
        method: "file",
        note: None,
    },
    ClientSpec {
        id: "codex",
        name: "Codex",
        key: "mcp_servers",
        with_type: false,
        method: "manual",
        note: Some("Codex keeps its servers in a TOML file, and a URL server also needs its client feature switched on. Paste the lines below into it; this app does not edit TOML yet."),
    },
];

fn spec(id: &str) -> Option<&'static ClientSpec> {
    SPECS.iter().find(|s| s.id == id)
}

// ── Where each client keeps its file ────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(key).map(PathBuf::from)
}

/// The per-user application-data folder, per platform.
fn app_data_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        return std::env::var_os("APPDATA").map(PathBuf::from);
    }
    let home = home_dir()?;
    if cfg!(target_os = "macos") {
        Some(home.join("Library").join("Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| Some(home.join(".config")))
    }
}

/// Claude Code keeps its user-scope servers in `~/.claude.json`, under the top-level `mcpServers`
/// key, and reads that file at session start; the `claude mcp add` command writes the same place,
/// and a hand-written entry needs no index anywhere else. CLAUDE_CONFIG_DIR moves the file, and a
/// person who has set it would otherwise get an edit to a file nothing reads.
fn claude_code_config_in(config_dir: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    config_dir.or(home).map(|d| d.join(".claude.json"))
}

fn claude_code_config() -> Option<PathBuf> {
    claude_code_config_in(
        std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from),
        home_dir(),
    )
}

/// The config file for a client, whether or not it exists yet.
fn config_path(id: &str) -> Option<PathBuf> {
    let home = home_dir();
    let data = app_data_dir();
    match id {
        "claude-code" => claude_code_config(),
        "claude-desktop" => data.map(|d| d.join("Claude").join("claude_desktop_config.json")),
        "cursor" => home.map(|h| h.join(".cursor").join("mcp.json")),
        "vscode" => data.map(|d| d.join("Code").join("User").join("mcp.json")),
        "codex" => home.map(|h| h.join(".codex").join("config.toml")),
        _ => None,
    }
}

/// Whether the tool is on this machine at all. A tool that has never been configured has no
/// config file, so the folder it makes on first run is what answers this, not the file.
fn is_installed(id: &str) -> bool {
    let home = home_dir();
    let data = app_data_dir();
    let marks: Vec<PathBuf> = match id {
        "claude-code" => {
            let mut marks = Vec::new();
            if let Some(h) = home {
                marks.push(h.join(".claude"));
            }
            if let Some(file) = claude_code_config() {
                marks.push(file);
            }
            marks
        }
        "claude-desktop" => data.map(|d| vec![d.join("Claude")]).unwrap_or_default(),
        "cursor" => home.map(|h| vec![h.join(".cursor")]).unwrap_or_default(),
        "vscode" => data
            .map(|d| vec![d.join("Code").join("User")])
            .unwrap_or_default(),
        "codex" => home.map(|h| vec![h.join(".codex")]).unwrap_or_default(),
        _ => vec![],
    };
    marks.iter().any(|p| p.exists())
}

// ── The node's endpoint, and what counts as the same node ───────────────────

/// The MCP endpoint of a node, from the base URL a person typed.
pub fn mcp_url(node_url: &str) -> String {
    format!("{}/v1/mcp", node_url.trim().trim_end_matches('/'))
}

/// Whether an address answers only on this machine or on a private network. A tool that reaches
/// the address from somebody else's cloud cannot use one, however well it works in a browser here.
/// A bare hostname with no dot counts: it resolves on a local network and nowhere else.
pub fn is_local_address(node_url: &str) -> bool {
    let rest = node_url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("")
        .to_lowercase();
    // Strip the port, but leave an IPv6 literal's colons alone.
    let host = if host.starts_with('[') {
        host.split(']').next().unwrap_or("").trim_start_matches('[').to_string()
    } else {
        host.split(':').next().unwrap_or("").to_string()
    };
    if host.is_empty() || host == "localhost" || host == "::1" || host.ends_with(".localhost") {
        return true;
    }
    if host.ends_with(".local") || host.ends_with(".internal") || host.ends_with(".home") {
        return true;
    }
    if !host.contains('.') {
        return true;
    }
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() == 4 && octets.iter().all(|o| o.parse::<u8>().is_ok()) {
        let n: Vec<u8> = octets.iter().map(|o| o.parse::<u8>().unwrap()).collect();
        return match (n[0], n[1]) {
            (127, _) | (10, _) | (0, _) => true,
            (192, 168) => true,
            (169, 254) => true,
            (172, b) if (16..=31).contains(&b) => true,
            _ => false,
        };
    }
    false
}

/// Whether a configured URL points at this node. Compared whole and case-insensitively, so
/// `https://AIMEAT.io/v1/mcp/` and `https://aimeat.io/v1/mcp` are one node, and a different
/// host or a different path is a different node.
fn is_same_node(configured: &str, node_url: &str) -> bool {
    let a = configured.trim().trim_end_matches('/').to_lowercase();
    let b = mcp_url(node_url).to_lowercase();
    a == b
}

/// The server name the node appears under in the client's own list.
fn server_name(raw: Option<String>) -> String {
    let cleaned: String = raw
        .unwrap_or_default()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "aimeat".to_string()
    } else {
        trimmed.chars().take(32).collect()
    }
}

/// A TOML basic string: `text` in double quotes, with the quote, the backslash and every control
/// character escaped, so nothing in `text` can end the string or start a line of its own.
fn toml_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A TOML key: bare when TOML allows it bare, a basic string otherwise.
fn toml_key(name: &str) -> String {
    let bare = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if bare {
        name.to_string()
    } else {
        toml_string(name)
    }
}

// ── Reading and editing a client's JSON, as pure functions ──────────────────

/// Every `url` under the client's servers object, in file order.
fn configured_urls(text: &str, key: &str) -> Vec<String> {
    let root: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let servers = match root.get(key).and_then(|v| v.as_object()) {
        Some(m) => m,
        None => return vec![],
    };
    servers
        .values()
        .filter_map(|entry| entry.get("url").and_then(|u| u.as_str()))
        .map(|s| s.to_string())
        .collect()
}

/// The entry a client accepts for this node.
fn server_entry(with_type: bool, url: &str) -> Value {
    if with_type {
        json!({ "type": "http", "url": url })
    } else {
        json!({ "url": url })
    }
}

/// The client's file with this node added under `name`, everything else left as it was.
/// An empty file becomes a new one. A file that is not a JSON object is refused rather than
/// replaced, because the person's own settings live in it.
fn merge_entry(text: &str, key: &str, name: &str, entry: Value) -> Result<String, String> {
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(text)
            .map_err(|e| format!("This file is not valid JSON, so it was left alone: {}", e))?
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| "This file does not hold a JSON object, so it was left alone.".to_string())?;
    let servers = obj.entry(key).or_insert_with(|| json!({}));
    let servers = servers.as_object_mut().ok_or_else(|| {
        format!("`{}` in this file is not a JSON object, so it was left alone.", key)
    })?;
    servers.insert(name.to_string(), entry);
    serde_json::to_string_pretty(&root).map_err(|e| format!("Could not write the JSON: {}", e))
}

/// The client's file with this node removed. Absent is not an error.
fn remove_entry(text: &str, key: &str, name: &str) -> Result<String, String> {
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(text)
            .map_err(|e| format!("This file is not valid JSON, so it was left alone: {}", e))?
    };
    if let Some(obj) = root.as_object_mut() {
        if let Some(servers) = obj.get_mut(key).and_then(|v| v.as_object_mut()) {
            servers.remove(name);
        }
    }
    serde_json::to_string_pretty(&root).map_err(|e| format!("Could not write the JSON: {}", e))
}

// ── Writing the file safely ─────────────────────────────────────────────────

/// Replace a file's content, keeping one copy of the original and never leaving a half-file.
fn write_config(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not make the folder {}: {}", parent.display(), e))?;
    }
    if path.exists() {
        let backup = path.with_extension(format!(
            "{}.aimeat-backup",
            path.extension().and_then(|e| e.to_str()).unwrap_or("bak")
        ));
        fs::copy(path, &backup)
            .map_err(|e| format!("Could not keep a copy of {}: {}", path.display(), e))?;
    }
    let temp = path.with_extension("aimeat-tmp");
    fs::write(&temp, content).map_err(|e| format!("Could not write {}: {}", temp.display(), e))?;
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Could not replace {}: {}", path.display(), e)
    })
}

// ── What the frontend calls ─────────────────────────────────────────────────

/// Build one connector's current state.
///
/// A cloud tool keeps nothing on this machine, so there is no file to read and no honest way to
/// say whether it is attached: that answer lives in the person's Claude account. It is reported
/// as not connected and the screen says where to look, rather than inventing a state.
fn read_connector(s: &ClientSpec, node_url: &str) -> Connector {
    let cloud = s.method == "cloud";
    let path = if cloud { None } else { config_path(s.id) };
    let text = path
        .as_ref()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default();
    let urls = configured_urls(&text, s.key);
    let connected = urls.iter().any(|u| is_same_node(u, node_url));
    let other = urls
        .iter()
        .find(|u| u.to_lowercase().ends_with("/v1/mcp"))
        .cloned();

    Connector {
        id: s.id.to_string(),
        name: s.name.to_string(),
        installed: is_installed(s.id),
        connected,
        connected_url: if connected { None } else { other },
        method: s.method.to_string(),
        config_path: path.map(|p| p.display().to_string()),
        address_is_local: is_local_address(node_url),
    }
}

/// Every AI tool this app knows, with its current state against the given node.
#[tauri::command]
pub fn detect_connectors(node_url: String) -> Result<Vec<Connector>, String> {
    Ok(SPECS.iter().map(|s| read_connector(s, &node_url)).collect())
}

/// Attach one tool to the node by editing its own config file.
#[tauri::command]
pub fn connect_connector(
    id: String,
    node_url: String,
    name: Option<String>,
) -> Result<Connector, String> {
    let s = spec(&id).ok_or_else(|| format!("Unknown tool: {}", id))?;
    if s.method != "file" {
        return Err(s
            .note
            .unwrap_or("This tool is attached by hand.")
            .to_string());
    }
    let path = config_path(&id).ok_or_else(|| {
        format!("Could not work out where {} keeps its settings.", s.name)
    })?;
    let text = fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_entry(
        &text,
        s.key,
        &server_name(name),
        server_entry(s.with_type, &mcp_url(&node_url)),
    )?;
    write_config(&path, &merged)?;
    Ok(read_connector(s, &node_url))
}

/// Detach one tool from the node.
#[tauri::command]
pub fn disconnect_connector(
    id: String,
    node_url: String,
    name: Option<String>,
) -> Result<Connector, String> {
    let s = spec(&id).ok_or_else(|| format!("Unknown tool: {}", id))?;
    if s.method != "file" {
        return Err(s
            .note
            .unwrap_or("This tool is attached by hand.")
            .to_string());
    }
    let path = config_path(&id).ok_or_else(|| {
        format!("Could not work out where {} keeps its settings.", s.name)
    })?;
    if !path.exists() {
        return Ok(read_connector(s, &node_url));
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {}", path.display(), e))?;
    let stripped = remove_entry(&text, s.key, &server_name(name))?;
    write_config(&path, &stripped)?;
    Ok(read_connector(s, &node_url))
}

/// What a person copies for a tool this app does not write: the address itself for a cloud tool,
/// and the lines to paste for the others.
#[tauri::command]
pub fn connector_snippet(
    id: String,
    node_url: String,
    name: Option<String>,
) -> Result<String, String> {
    let s = spec(&id).ok_or_else(|| format!("Unknown tool: {}", id))?;
    let name = server_name(name);
    let url = mcp_url(&node_url);
    // A custom connector asks for one address in a form. Anything else copied into that field is
    // a mistake the person then has to find.
    if s.method == "cloud" {
        return Ok(url);
    }
    if s.id == "codex" {
        // The URL entry does nothing on its own: Codex reaches an HTTP server through its RMCP
        // client, which is behind a feature switch. Newer builds spell it `[features] rmcp_client`
        // and older ones `experimental_use_rmcp_client`, so both lines are given and the extra one
        // is ignored by whichever build reads it. The name and the address are written as TOML
        // values, never pasted in as they are: the address is what the person typed.
        return Ok(format!(
            "experimental_use_rmcp_client = true\n\n[features]\nrmcp_client = true\n\n[mcp_servers.{}]\nurl = {}\n",
            toml_key(&name),
            toml_string(&url)
        ));
    }
    let mut servers = serde_json::Map::new();
    servers.insert(name, server_entry(s.with_type, &url));
    let mut root = serde_json::Map::new();
    root.insert(s.key.to_string(), Value::Object(servers));
    serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("Could not write the JSON: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_url_is_the_base_plus_the_endpoint() {
        assert_eq!(mcp_url("https://aimeat.io"), "https://aimeat.io/v1/mcp");
        assert_eq!(mcp_url("https://aimeat.io/"), "https://aimeat.io/v1/mcp");
        assert_eq!(mcp_url(" http://localhost:41050 "), "http://localhost:41050/v1/mcp");
    }

    #[test]
    fn the_same_node_survives_a_slash_and_a_capital() {
        assert!(is_same_node("https://AIMEAT.io/v1/mcp/", "https://aimeat.io"));
        assert!(!is_same_node("https://other.example/v1/mcp", "https://aimeat.io"));
        assert!(!is_same_node("https://aimeat.io/v1/other", "https://aimeat.io"));
    }

    #[test]
    fn claude_code_follows_its_config_dir_when_one_is_set() {
        let home = Some(PathBuf::from("C:\\Users\\someone"));
        let moved = Some(PathBuf::from("D:\\claude"));
        assert_eq!(
            claude_code_config_in(None, home.clone()).unwrap(),
            PathBuf::from("C:\\Users\\someone\\.claude.json")
        );
        assert_eq!(
            claude_code_config_in(moved, home).unwrap(),
            PathBuf::from("D:\\claude\\.claude.json")
        );
        assert!(claude_code_config_in(None, None).is_none());
    }

    #[test]
    fn a_name_is_reduced_to_something_a_client_accepts() {
        assert_eq!(server_name(None), "aimeat");
        assert_eq!(server_name(Some("".to_string())), "aimeat");
        assert_eq!(server_name(Some("---".to_string())), "aimeat");
        assert_eq!(server_name(Some("My Node!".to_string())), "my-node");
    }

    #[test]
    fn merging_keeps_every_other_setting() {
        let before = r#"{"theme":"dark","mcpServers":{"other":{"url":"https://x/v1/mcp"}}}"#;
        let after = merge_entry(
            before,
            "mcpServers",
            "aimeat",
            server_entry(true, "https://aimeat.io/v1/mcp"),
        )
        .unwrap();
        let v: Value = serde_json::from_str(&after).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcpServers"]["other"]["url"], "https://x/v1/mcp");
        assert_eq!(v["mcpServers"]["aimeat"]["url"], "https://aimeat.io/v1/mcp");
        assert_eq!(v["mcpServers"]["aimeat"]["type"], "http");
    }

    #[test]
    fn merging_into_an_empty_file_makes_a_whole_one() {
        let after = merge_entry("", "servers", "aimeat", server_entry(true, "https://aimeat.io/v1/mcp"))
            .unwrap();
        let v: Value = serde_json::from_str(&after).unwrap();
        assert_eq!(v["servers"]["aimeat"]["type"], "http");
    }

    #[test]
    fn cursor_gets_no_type_field() {
        let after = merge_entry("", "mcpServers", "aimeat", server_entry(false, "https://aimeat.io/v1/mcp"))
            .unwrap();
        let v: Value = serde_json::from_str(&after).unwrap();
        assert!(v["mcpServers"]["aimeat"].get("type").is_none());
    }

    #[test]
    fn a_file_that_is_not_json_is_refused_rather_than_replaced() {
        let err = merge_entry("// comments\n{\"a\":1}", "mcpServers", "aimeat", json!({})).unwrap_err();
        assert!(err.contains("not valid JSON"));
    }

    #[test]
    fn removing_leaves_the_rest_alone_and_absent_is_fine() {
        let before = r#"{"theme":"dark","mcpServers":{"aimeat":{"url":"u"},"other":{"url":"v"}}}"#;
        let after = remove_entry(before, "mcpServers", "aimeat").unwrap();
        let v: Value = serde_json::from_str(&after).unwrap();
        assert!(v["mcpServers"].get("aimeat").is_none());
        assert_eq!(v["mcpServers"]["other"]["url"], "v");
        assert_eq!(v["theme"], "dark");

        let again = remove_entry(&after, "mcpServers", "aimeat").unwrap();
        let v2: Value = serde_json::from_str(&again).unwrap();
        assert!(v2["mcpServers"].get("aimeat").is_none());
    }

    #[test]
    fn urls_are_read_from_the_clients_own_key() {
        let text = r#"{"servers":{"a":{"url":"https://aimeat.io/v1/mcp"}},"mcpServers":{"b":{"url":"https://x/v1/mcp"}}}"#;
        assert_eq!(configured_urls(text, "servers"), vec!["https://aimeat.io/v1/mcp"]);
        assert_eq!(configured_urls(text, "mcpServers"), vec!["https://x/v1/mcp"]);
        assert!(configured_urls("not json", "servers").is_empty());
    }

    #[test]
    fn the_snippet_matches_what_the_client_accepts() {
        let vscode = connector_snippet("vscode".into(), "https://aimeat.io".into(), None).unwrap();
        assert!(vscode.contains("\"servers\""));
        assert!(vscode.contains("\"type\": \"http\""));

        let cursor = connector_snippet("cursor".into(), "https://aimeat.io".into(), None).unwrap();
        assert!(cursor.contains("\"mcpServers\""));
        assert!(!cursor.contains("\"type\""));

        // Codex needs its RMCP client switched on, under either spelling, or the url is ignored.
        let codex = connector_snippet("codex".into(), "https://aimeat.io".into(), None).unwrap();
        assert!(codex.contains("experimental_use_rmcp_client = true"));
        assert!(codex.contains("rmcp_client = true"));
        assert!(codex.contains("[mcp_servers.aimeat]"));
        assert!(codex.contains("url = \"https://aimeat.io/v1/mcp\""));
    }

    #[test]
    fn the_codex_lines_keep_a_typed_address_inside_its_string() {
        // A quote and a line break typed into the address stay part of the url's value.
        let typed = "https://a.example\"\n[other]\nx = \"1";
        let codex = connector_snippet("codex".into(), typed.into(), None).unwrap();
        assert!(
            codex.contains(r#"url = "https://a.example\"\n[other]\nx = \"1/v1/mcp""#),
            "{}",
            codex
        );
        assert!(!codex.lines().any(|l| l.trim_start().starts_with("[other]")), "{}", codex);
    }

    #[test]
    fn a_toml_value_escapes_what_toml_reads_as_syntax() {
        assert_eq!(toml_string("https://aimeat.io/v1/mcp"), r#""https://aimeat.io/v1/mcp""#);
        assert_eq!(toml_string("a\"b\\c"), r#""a\"b\\c""#);
        assert_eq!(toml_string("a\nb\rc\td"), r#""a\nb\rc\td""#);
        assert_eq!(toml_string("\u{0}\u{1b}\u{7f}"), r#""\u0000\u001B\u007F""#);
        assert_eq!(toml_string("äö"), "\"äö\"");
        assert_eq!(toml_key("aimeat"), "aimeat");
        assert_eq!(toml_key("my_node-2"), "my_node-2");
        assert_eq!(toml_key(""), r#""""#);
        assert_eq!(toml_key("a.b]\n[c"), r#""a.b]\n[c""#);
    }

    #[test]
    fn a_cloud_tool_copies_the_address_and_nothing_else() {
        // Its settings ask for one address in a form; a JSON block pasted there is a mistake the
        // person then has to find.
        let desktop =
            connector_snippet("claude-desktop".into(), "https://aimeat.io".into(), None).unwrap();
        assert_eq!(desktop, "https://aimeat.io/v1/mcp");
    }

    #[test]
    fn a_tool_this_app_does_not_edit_is_refused_with_its_reason() {
        let err = connect_connector("claude-desktop".into(), "https://aimeat.io".into(), None)
            .unwrap_err();
        assert!(err.contains("own connector settings"));
        let err = disconnect_connector("codex".into(), "https://aimeat.io".into(), None)
            .unwrap_err();
        assert!(err.contains("TOML"));
    }

    #[test]
    fn a_cloud_tool_has_no_file_on_this_machine() {
        let list = detect_connectors("https://aimeat.io".to_string()).unwrap();
        let desktop = list.iter().find(|c| c.id == "claude-desktop").unwrap();
        assert_eq!(desktop.method, "cloud");
        assert!(desktop.config_path.is_none());
        assert!(!desktop.connected);
        let code = list.iter().find(|c| c.id == "claude-code").unwrap();
        assert_eq!(code.method, "file");
        assert!(code.config_path.is_some());
    }

    #[test]
    fn an_address_only_this_machine_answers_is_named_as_one() {
        for local in [
            "http://localhost:41050",
            "http://127.0.0.1:41050",
            "https://LOCALHOST",
            "http://192.168.1.20:41050",
            "http://10.0.0.5",
            "http://172.16.4.4",
            "http://172.31.0.1",
            "http://169.254.1.1",
            "https://desktop.local",
            "https://aimeat",
            "http://[::1]:41050",
        ] {
            assert!(is_local_address(local), "{} should read as local", local);
        }
        for public in [
            "https://aimeat.io",
            "https://node.example.com/",
            "https://172.32.0.1",
            "https://8.8.8.8",
        ] {
            assert!(!is_local_address(public), "{} should read as public", public);
        }
    }

    #[test]
    fn the_local_address_travels_with_every_tool() {
        let list = detect_connectors("http://localhost:41050".to_string()).unwrap();
        assert!(list.iter().all(|c| c.address_is_local));
        let list = detect_connectors("https://aimeat.io".to_string()).unwrap();
        assert!(list.iter().all(|c| !c.address_is_local));
    }

    #[test]
    fn writing_keeps_a_copy_and_lands_whole() {
        let dir = std::env::temp_dir().join(format!("aimeat-connectors-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("mcp.json");
        fs::write(&file, r#"{"a":1}"#).unwrap();

        write_config(&file, r#"{"a":2}"#).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), r#"{"a":2}"#);
        let backup = file.with_extension("json.aimeat-backup");
        assert_eq!(fs::read_to_string(&backup).unwrap(), r#"{"a":1}"#);
        assert!(!file.with_extension("aimeat-tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
