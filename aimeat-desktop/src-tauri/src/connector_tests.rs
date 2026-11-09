// Regressions use documents and isolated temporary files, never a person's client settings.
use super::*;
use serde_json::json;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;

fn endpoint(raw: &str) -> String { parse_address(raw).unwrap().mcp_url }

#[test]
fn a_pasted_host_or_complete_endpoint_is_canonicalized() {
    assert_eq!(endpoint("aimeat.io"), "https://aimeat.io/v1/mcp");
    assert_eq!(endpoint("https://AIMEAT.io/v1/mcp/"), "https://aimeat.io/v1/mcp");
    assert_eq!(endpoint("http://localhost:41050"), "http://localhost:41050/v1/mcp");
    assert_eq!(endpoint("localhost:41050/v1/mcp"), "http://localhost:41050/v1/mcp");
    assert_eq!(endpoint("https://node.example/Team/"), "https://node.example/Team/v1/mcp");
}

#[test]
fn invalid_or_credential_bearing_addresses_are_refused() {
    for raw in ["", "https://", "https://a.example?q=1", "https://a.example/#x", "https://user:secret@a.example", "file:///etc/file", "javascript:alert(1)", "https://a.example/\nnext", "http://a.example"] {
        assert!(parse_address(raw).is_err(), "accepted {:?}", raw);
    }
}

#[test]
fn address_matching_keeps_paths_case_sensitive_and_normalizes_hosts() {
    assert!(is_same_node("https://AIMEAT.io/v1/mcp/", "https://aimeat.io"));
    assert!(!is_same_node("https://a.example/Team/v1/mcp", "https://a.example/team"));
    assert!(!is_same_node("https://aimeat.io/v1/other", "https://aimeat.io"));
}

#[test]
fn public_ipv6_is_not_mistaken_for_a_local_address() {
    assert!(!is_local_address("https://[2606:4700:4700::1111]"));
    for raw in ["http://[::1]:41050", "http://192.168.1.20", "http://10.0.0.1", "http://172.16.1.1", "http://desktop.local", "http://aimeat"] { assert!(is_local_address(raw), "{}", raw); }
}

#[test]
fn claude_code_follows_the_config_directory_override() {
    assert_eq!(claude_code_config_in(Some(PathBuf::from("custom")), Some(PathBuf::from("home"))), Some(PathBuf::from("custom").join(".claude.json")));
    assert_eq!(claude_code_config_in(None, Some(PathBuf::from("home"))), Some(PathBuf::from("home").join(".claude.json")));
}

#[test]
fn an_existing_codex_toml_connection_is_detected() {
    let text = "# My tools\n[mcp_servers.personal]\nurl = \"https://aimeat.io/v1/mcp\"\n";
    let config = config::Config::parse(text, "mcp_servers").unwrap();
    assert_eq!(config.entries("mcp_servers"), vec![("personal".into(), "https://aimeat.io/v1/mcp".into())]);
}

#[test]
fn adding_preserves_another_connection_and_uses_a_free_name() {
    let before = r#"{"theme":"dark","mcpServers":{"aimeat":{"url":"https://work.example/v1/mcp","headers":{"x-own-setting":"keep"}},"aimeat-2":{"command":"other"}}}"#;
    let after = add_to_config(before, spec("claude-code").unwrap(), "https://aimeat.io/v1/mcp", "aimeat", None).unwrap();
    let value: Value = serde_json::from_str(&after).unwrap();
    assert_eq!(value["theme"], "dark");
    assert_eq!(value["mcpServers"]["aimeat"]["headers"]["x-own-setting"], "keep");
    assert_eq!(value["mcpServers"]["aimeat"]["url"], "https://work.example/v1/mcp");
    assert_eq!(value["mcpServers"]["aimeat-3"]["url"], "https://aimeat.io/v1/mcp");
    assert_eq!(value["mcpServers"]["aimeat-3"]["type"], "http");
}

#[test]
fn removing_a_custom_name_leaves_the_default_and_other_nodes_untouched() {
    let before = r#"{"mcpServers":{"my-aimeat":{"url":"https://aimeat.io/v1/mcp"},"aimeat":{"url":"https://work.example/v1/mcp"}}}"#;
    let mut doc = config::Config::parse(before, "mcpServers").unwrap();
    assert_eq!(doc.remove_exact("mcpServers", "aimeat", "https://aimeat.io").unwrap_err(), "CONNECTION_CHANGED");
    doc.remove_exact("mcpServers", "my-aimeat", "https://aimeat.io").unwrap();
    assert_eq!(doc.entries("mcpServers"), vec![("aimeat".into(), "https://work.example/v1/mcp".into())]);
    assert!(doc.remove_exact("mcpServers", "my-aimeat", "https://aimeat.io").is_err());
}

#[test]
fn replacement_checks_the_previous_url_and_drops_only_its_credentials() {
    let before = r#"{"mcpServers":{"work":{"url":"https://work.example/v1/mcp","headers":{"Authorization":"secret"}},"other":{"command":"keep"}}}"#;
    let s = spec("cursor").unwrap();
    assert!(add_to_config(before, s, "https://aimeat.io/v1/mcp", "unused", Some(("work", "https://changed.example"))).is_err());
    let after = add_to_config(before, s, "https://aimeat.io/v1/mcp", "unused", Some(("work", "https://work.example"))).unwrap();
    let value: Value = serde_json::from_str(&after).unwrap();
    assert_eq!(value["mcpServers"]["work"], json!({"url":"https://aimeat.io/v1/mcp"}));
    assert_eq!(value["mcpServers"]["other"]["command"], "keep");
}

#[test]
fn adding_the_same_url_preserves_every_client_specific_option() {
    let before = r#"{"mcpServers":{"mine":{"url":"https://aimeat.io/v1/mcp","disabled":true,"headers":{"x-test":"keep"}}}}"#;
    assert_eq!(add_to_config(before, spec("cursor").unwrap(), "https://aimeat.io/v1/mcp", "aimeat", None).unwrap(), before);
}

#[test]
fn codex_edits_keep_comments_settings_and_other_servers() {
    let before = "# My model\nmodel = \"chosen\" # keep\n\n[mcp_servers.work]\nurl = \"https://work.example/v1/mcp\" # work\n\n[mcp_servers.other]\ncommand = \"helper\"\n";
    let after = add_to_config(before, spec("codex").unwrap(), "https://aimeat.io/v1/mcp", "personal", None).unwrap();
    assert!(after.contains("# My model\nmodel = \"chosen\" # keep"));
    assert!(after.contains("url = \"https://work.example/v1/mcp\" # work"));
    assert!(after.contains("command = \"helper\""));
    assert!(!after.contains("experimental_use_rmcp_client"));
    let mut doc = config::Config::parse(&after, "mcp_servers").unwrap();
    doc.remove_exact("mcp_servers", "personal", "https://aimeat.io").unwrap();
    assert!(doc.text().contains("# work"));
    assert!(!doc.contains("mcp_servers", "personal"));
}

#[test]
fn codex_inline_tables_remain_valid_after_an_addition() {
    let before = "mcp_servers = { old = { url = \"https://work.example/v1/mcp\" } }\n";
    let after = add_to_config(before, spec("codex").unwrap(), "https://aimeat.io/v1/mcp", "new", None).unwrap();
    assert_eq!(config::Config::parse(&after, "mcp_servers").unwrap().entries("mcp_servers").len(), 2);
}

#[test]
fn invalid_settings_are_refused_without_starting_a_replacement() {
    for text in ["// comment\n{}", "[]", "{broken", "{\"mcpServers\":[]}"] { assert!(config::Config::parse(text, "mcpServers").is_err()); }
    assert!(config::Config::parse("[broken", "mcp_servers").is_err());
    assert!(config::Config::parse("mcp_servers = 4", "mcp_servers").is_err());
}

fn temp_dir() -> PathBuf {
    let path = std::env::temp_dir().join(format!("aimeat-connector-test-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
    fs::create_dir(&path).unwrap(); path
}

#[test]
fn writes_keep_the_first_backup_and_refuse_changed_snapshots() {
    let dir = temp_dir(); let path = dir.join("settings.json");
    fs::write(&path, "first").unwrap();
    config::write(&path, Some("first"), "second").unwrap();
    config::write(&path, Some("second"), "third").unwrap();
    assert_eq!(fs::read_to_string(path.with_extension("json.aimeat-backup")).unwrap(), "first");
    assert_eq!(config::write(&path, Some("second"), "lost").unwrap_err(), "CONFIG_CHANGED");
    assert_eq!(fs::read_to_string(&path).unwrap(), "third");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_unreadable_file_never_becomes_an_empty_config() {
    let dir = temp_dir(); let path = dir.join("invalid.json");
    fs::write(&path, [0xff, 0xfe]).unwrap();
    assert!(config::read(&path).unwrap_err().starts_with("CONFIG_READ"));
    assert_eq!(fs::read(&path).unwrap(), [0xff, 0xfe]);
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn files_and_backups_keep_private_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir(); let path = dir.join("settings.json");
    config::write(&path, None, "first").unwrap();
    config::write(&path, Some("first"), "second").unwrap();
    for file in [&path, &path.with_extension("json.aimeat-backup")] { assert_eq!(fs::metadata(file).unwrap().permissions().mode() & 0o777, 0o600); }
    fs::remove_dir_all(dir).unwrap();
}

fn respond(status: &str, body: String, extra: &str) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n{}", status, body.len(), extra, body);
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut bytes = [0; 4096]; let size = stream.read(&mut bytes).unwrap();
        let _ = stream.write_all(response.as_bytes()); String::from_utf8_lossy(&bytes[..size]).into()
    });
    (address, thread)
}

#[test]
fn reachability_checks_only_public_discovery_and_requires_aimeat_identity() {
    let (address, server) = respond("200 OK", json!({"data":{"protocol":"aimeat","node_id":"test-node","endpoints":{"mcp":"/v1/mcp"}}}).to_string(), "");
    let checked = tauri::async_runtime::block_on(check_address(&address)).unwrap();
    assert_eq!(checked.base_url, address);
    let request = server.join().unwrap();
    assert!(request.starts_with("GET /.well-known/aimeat HTTP/1.1"));
    assert!(!request.to_lowercase().contains("authorization:"));
    let (address, server) = respond("200 OK", "{\"status\":\"ok\"}".into(), "");
    assert!(tauri::async_runtime::block_on(check_address(&address)).unwrap_err().starts_with("ADDRESS_NOT_AIMEAT"));
    server.join().unwrap();
}

#[test]
fn reachability_refuses_redirects_and_oversized_responses() {
    for (status, body, extra) in [("302 Found", "".into(), "Location: http://127.0.0.1:1/private\r\n"), ("200 OK", "x".repeat(65537), "")] {
        let (address, server) = respond(status, body, extra);
        assert!(tauri::async_runtime::block_on(check_address(&address)).unwrap_err().starts_with("ADDRESS_NOT_AIMEAT"));
        server.join().unwrap();
    }
}

#[test]
fn snippets_are_valid_for_the_clients_and_escape_toml_values() {
    let vscode = connector_snippet("vscode".into(), "aimeat.io".into(), None).unwrap();
    let value: Value = serde_json::from_str(&vscode).unwrap();
    assert_eq!(value["servers"]["aimeat"]["type"], "http");
    let codex = connector_snippet("codex".into(), "aimeat.io".into(), Some("My Node!".into())).unwrap();
    assert_eq!(config::Config::parse(&codex, "mcp_servers").unwrap().entries("mcp_servers")[0].0, "my-node");
    assert_eq!(connector_snippet("claude-desktop".into(), "aimeat.io".into(), None).unwrap(), "https://aimeat.io/v1/mcp");
    assert!(connector_snippet("codex".into(), "https://a.example\"\n[other]\nx=1".into(), None).is_err());
}
