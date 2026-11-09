use super::*;
use crate::connectors::ConnectorEntry;
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;

const SECRET: &str = "private-fixture-must-never-appear";

fn runtime() -> RuntimeFacts { RuntimeFacts { present: true, server_version: Some("4.2.0".into()) } }
fn stopped() -> NodeStatus {
    NodeStatus { running: false, ready: false, state: Phase::Stopped, pid: None, port: 41050,
        configured_port: 41050, restart_required: false, uptime_seconds: None,
        last_error: Some(SECRET.into()), exit_code: None }
}
fn connector(id: &str) -> Connector {
    Connector { id: id.into(), name: SECRET.into(), installed: true, connected: true,
        connected_url: Some(format!("https://{SECRET}.example")), method: "file".into(),
        config_path: Some(format!("C:/Users/{SECRET}/config.json")), config_error: None,
        address_is_local: true, entries: vec![ConnectorEntry {
            name: SECRET.into(), url: format!("https://{SECRET}.example/v1/mcp"), matches_selected: true,
        }] }
}
fn report_with(node: NodeStatus, tools: Vec<Connector>) -> DiagnosticReport {
    assemble(runtime(), ConfigFacts::Readable { port: Some(41050) }, Ok(node),
        PortFacts::Available, Ok(tools), [AiProbe::Models(2), AiProbe::NotRunning])
}

#[test]
fn raw_private_fields_and_errors_cannot_enter_the_preview_or_copied_report() {
    let mut tool = connector("codex");
    tool.config_error = Some(format!("CONFIG_READ: C:/Users/{SECRET}/config.toml: token={SECRET}"));
    let report = report_with(stopped(), vec![tool, connector(SECRET)]);
    let preview = serde_json::to_string(&report).unwrap();
    for output in [&preview, &report.report_text] {
        assert!(!output.contains(SECRET));
        assert!(!output.contains("https://"));
        assert!(!output.contains("C:/Users"));
        assert!(!output.contains("config.toml"));
    }
    let mut copied: serde_json::Value = serde_json::from_str(&preview).unwrap();
    copied.as_object_mut().unwrap().remove("report_text");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&report.report_text).unwrap(), copied);
    let fault = report.data.checks.iter().find(|check| check.subject == Subject::Codex).unwrap();
    assert_eq!(fault.code, Code::ToolConfigProblem);
    assert_eq!(fault.action, Action::OpenConnections);
}

#[test]
fn stopped_and_missing_optional_tools_are_information_not_failures() {
    let report = report_with(stopped(), Vec::new());
    assert_eq!(report.data.summary.error, 0);
    assert_eq!(report.data.summary.warning, 0);
    let node = report.data.checks.iter().find(|check| check.subject == Subject::Node).unwrap();
    assert_eq!(node.code, Code::NodeStopped);
    assert_eq!(node.status, Status::Info);
    assert_eq!(node.action, Action::StartNode);
    assert!(report.data.checks.iter().any(|check| check.code == Code::ToolsNotFound && check.status == Status::Info));
}

#[test]
fn faults_name_a_safe_next_action_and_never_claim_authentication() {
    let mut node = stopped(); node.running = true; node.state = Phase::Failed; node.restart_required = true;
    let report = assemble(RuntimeFacts { present: false, server_version: Some(SECRET.into()) },
        ConfigFacts::Readable { port: None }, Ok(node), PortFacts::Occupied,
        Ok(vec![connector("cursor")]), [AiProbe::Unrecognized, AiProbe::Models(0)]);
    for (code, action) in [(Code::RuntimeMissing, Action::ReinstallDesktop),
        (Code::PortInvalid, Action::OpenSettings), (Code::NodeFailed, Action::OpenLog),
        (Code::RestartPending, Action::RestartNode), (Code::PortOccupied, Action::OpenSettings),
        (Code::AiNoModels, Action::OpenAi)] {
        assert!(report.data.checks.iter().any(|check| check.code == code && check.action == action), "missing action for {code:?}");
    }
    assert_eq!(report.data.server_version, None);
    let tool = report.data.checks.iter().find(|check| check.subject == Subject::Cursor).unwrap();
    assert_eq!(tool.code, Code::ToolReadable);
    assert!(!report.report_text.contains("authenticated"));
}

#[test]
fn settings_inspection_does_not_create_migrate_or_rewrite_a_file() {
    let root = scratch();
    let path = root.join(".env");
    assert!(matches!(config_facts(&path), ConfigFacts::Missing));
    assert!(!path.exists());
    let original = format!("AIMEAT_PORT=40050\nAIMEAT_STORAGE=sqlite\nAIMEAT_ENCRYPTION_KEY={SECRET}\nAIMEAT_NODE_ID={SECRET}\n");
    std::fs::write(&path, &original).unwrap();
    assert!(matches!(config_facts(&path), ConfigFacts::Readable { port: Some(40050) }));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    std::fs::write(&path, "AIMEAT_PORT=99999\n").unwrap();
    assert!(matches!(config_facts(&path), ConfigFacts::Readable { port: None }));
    std::fs::write(&path, vec![b'x'; 1024 * 1024 + 1]).unwrap();
    assert!(matches!(config_facts(&path), ConfigFacts::Unreadable));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn runtime_presence_requires_the_same_staged_or_dev_adapter_as_startup() {
    let root = scratch();
    let node = root.join("node.exe");
    let entry = root.join("server/dist/src/index.js");
    let staged = root.join("server/desktop-parent.mjs");
    let fallback = root.join("dev/desktop-parent.mjs");
    std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
    std::fs::create_dir_all(fallback.parent().unwrap()).unwrap();
    std::fs::write(&node, "fixture").unwrap();
    std::fs::write(&entry, "fixture").unwrap();
    assert!(!runtime_facts(&node, &entry, &fallback).present);
    std::fs::write(&fallback, "fixture").unwrap();
    assert!(runtime_facts(&node, &entry, &fallback).present);
    // Startup prefers an existing staged path, and rejects it if it is not a file.
    std::fs::create_dir(&staged).unwrap();
    assert!(!runtime_facts(&node, &entry, &fallback).present);
    std::fs::remove_dir(&staged).unwrap();
    std::fs::write(&staged, "fixture").unwrap();
    std::fs::remove_file(&fallback).unwrap();
    assert!(runtime_facts(&node, &entry, &fallback).present);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn model_names_are_counted_but_never_reported() {
    let body = json!({"data":[{"id":SECRET},{"id":"local-model"}],"url":SECRET}).to_string();
    assert!(matches!(model_count(body.as_bytes(), AiKind::LmStudio), AiProbe::Models(2)));
    let body = json!({"models":[{"name":SECRET}]}).to_string();
    assert!(matches!(model_count(body.as_bytes(), AiKind::Ollama), AiProbe::Models(1)));
    assert!(matches!(model_count(b"{}", AiKind::Ollama), AiProbe::Unrecognized));
}

#[test]
fn the_report_is_bounded_even_if_a_detector_repeats_a_tool() {
    let report = report_with(stopped(), vec![connector("codex"); 1000]);
    assert_eq!(report.data.checks.iter().filter(|check| check.subject == Subject::Codex).count(), 1);
    assert!(report.data.checks.len() <= 20);
    assert!(report.report_text.len() < 16_384);
}

fn scratch() -> PathBuf {
    let path = std::env::temp_dir().join(format!("aimeat-diagnostics-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
    std::fs::create_dir(&path).unwrap(); path
}

fn reply_once(reply: String) -> (u16, std::sync::mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
        let mut request = [0u8; 2048];
        let count = stream.read(&mut request).unwrap_or(0);
        let _ = send.send(String::from_utf8_lossy(&request[..count]).into_owned());
        let _ = stream.write_all(reply.as_bytes());
    }); (port, receive)
}

#[test]
fn a_local_service_cannot_redirect_the_check_elsewhere() {
    let destination = TcpListener::bind("127.0.0.1:0").unwrap();
    destination.set_nonblocking(true).unwrap();
    let (port, _) = reply_once(format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:{}/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", destination.local_addr().unwrap().port()));
    let result = tauri::async_runtime::block_on(probe_ai(port, AiKind::Ollama));
    assert!(matches!(result, AiProbe::Unrecognized));
    assert!(matches!(destination.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock));
}

#[test]
fn the_local_service_response_is_bounded() {
    let body = format!("{{\"models\":[],\"extra\":\"{}\"}}", "x".repeat(65536));
    let (port, _) = reply_once(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()));
    assert!(matches!(tauri::async_runtime::block_on(probe_ai(port, AiKind::Ollama)), AiProbe::Unrecognized));
}

#[test]
fn checks_only_list_models_and_send_no_authentication() {
    for (kind, path, body) in [(AiKind::LmStudio, "/v1/models", "{\"data\":[]}"),
        (AiKind::Ollama, "/api/tags", "{\"models\":[]}")] {
        let (port, request) = reply_once(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()));
        assert!(matches!(tauri::async_runtime::block_on(probe_ai(port, kind)), AiProbe::Models(0)));
        let request = request.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        assert!(request.starts_with(&format!("GET {path} HTTP/1.1\r\n")));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        assert!(!request.to_ascii_lowercase().contains("cookie:"));
    }
}
