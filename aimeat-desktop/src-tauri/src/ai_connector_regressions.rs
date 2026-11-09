use super::{get_ai_settings, node_login_with_code, save_ai_endpoint};
use super::tests::{not_found, stub_node};
use serde_json::{json, Value};

// Exact current core refusal in services/ai/providers.ts; other refusals must stay refusals.
const LOCAL_POLICY: &str = "baseUrl: on this public node an owner's provider cannot be on the node's own machine. Your own computer connects through the desktop app, not by address.";

fn local_provider() -> Value {
    json!({"id":"desktop-local-ai", "source":"node", "type":"local",
        "base_url":"http://localhost:1234/v1", "auth":{"type":"none"},
        "capabilities":{"text":{"enabled":true,"pool":true,"model":"local-model"}},
        "health":{"text":{"status":"ok"}}})
}

#[test]
fn two_step_sign_in_forwards_only_the_supplied_code_and_returns_the_session() {
    for (totp, backup, field, expected) in [
        (Some(" 123456 "), None, "totp_code", "123456"),
        (None, Some(" backup-code "), "backup_code", "backup-code"),
    ] {
        let (port, seen) = stub_node(|method, path| match (method, path) {
            ("POST", "/v1/ghii/login") => (200, json!({"data":{"token":"test-session"}})),
            _ => not_found(),
        });
        let token = tauri::async_runtime::block_on(node_login_with_code(
            port, "owner".into(), "test-password".into(), totp.map(str::to_string), backup.map(str::to_string),
        )).expect("two-step sign-in succeeds");
        assert_eq!(token, "test-session");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].body[field], expected);
        let other = if field == "totp_code" { "backup_code" } else { "totp_code" };
        assert!(seen[0].body.get(other).is_none());
        assert_eq!(seen[0].body["username"], "owner");
        assert_eq!(seen[0].body["password"], "test-password");
    }
}

#[test]
fn two_step_refusals_keep_the_code_without_exposing_an_enrolment_token() {
    for (status, code) in [(401, "TOTP_REQUIRED"), (401, "INVALID_TOTP"), (403, "TWO_STEP_SETUP_REQUIRED")] {
        let (port, seen) = stub_node(move |method, path| match (method, path) {
            ("POST", "/v1/ghii/login") => (status, json!({"error":{
                "code":code, "message":"Complete two-step sign-in.",
                "details":{"setup_token":"private-enrolment-token"}
            }})),
            _ => not_found(),
        });
        let error = tauri::async_runtime::block_on(node_login_with_code(
            port, "owner".into(), "test-password".into(), Some(" ".into()), None,
        )).expect_err("a second-factor refusal is not a session");
        assert_eq!(error, format!("[{code}] Complete two-step sign-in."));
        assert!(!error.contains("private-enrolment-token"));
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert!(seen[0].body.get("totp_code").is_none());
    }
}

#[test]
fn an_empty_session_token_is_not_successful_sign_in() {
    for token in ["", " "] {
        let (port, _) = stub_node(move |method, path| match (method, path) {
            ("POST", "/v1/ghii/login") => (200, json!({"data":{"token":token}})),
            _ => not_found(),
        });
        assert!(tauri::async_runtime::block_on(node_login_with_code(
            port, "owner".into(), "test-password".into(), None, None,
        )).is_err());
    }
}

#[test]
fn an_invalid_provider_view_never_becomes_empty_settings_or_a_write() {
    for invalid in [Value::Null, json!({"data":{}}), json!({"data":{"providers":{}}})] {
        let (port, seen) = stub_node(move |method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, invalid.clone()),
            ("PUT", "/v1/ai/providers/custom") => (200, json!({"data":{"provider":{}}})),
            ("POST", "/v1/ai/providers/custom/test") => (200, json!({"data":{"ok":true}})),
            _ => not_found(),
        });
        let read = tauri::async_runtime::block_on(get_ai_settings(port, "test-session".into()));
        let save = tauri::async_runtime::block_on(save_ai_endpoint(
            port, "test-session".into(), "http://localhost:1234/v1".into(), "local-model".into(),
        ));
        let seen = seen.lock().unwrap();
        assert!(seen.iter().all(|request| request.method == "GET"), "an invalid read must not permit a write: {seen:?}");
        assert!(read.is_err(), "unknown settings must not be shown as empty");
        assert!(save.is_err(), "unknown settings must not be overwritten");
    }
}

#[test]
fn only_the_exact_local_policy_refusal_offers_the_local_restart_flow() {
    for (code, message, address, model, restart) in [
        ("INVALID_PROVIDER", LOCAL_POLICY, "http://localhost:1234/v1", "local-model", true),
        ("INVALID_PROVIDER", LOCAL_POLICY, "http://127.0.0.1:1234/v1", "local-model", true),
        ("INVALID_PROVIDER", LOCAL_POLICY, "http://[::1]:1234/v1", "local-model", true),
        ("PROVIDER_NOT_ALLOWED", LOCAL_POLICY, "http://localhost:1234/v1", "local-model", false),
        ("INVALID_PROVIDER", "Another provider setting is invalid.", "http://localhost:1234/v1", "local-model", false),
        ("INVALID_PROVIDER", LOCAL_POLICY, "http://192.168.1.8:1234/v1", "local-model", false),
        ("INVALID_PROVIDER", LOCAL_POLICY, "https://example.org/v1", "local-model", false),
        ("INVALID_PROVIDER", LOCAL_POLICY, "http://localhost:1234/v1", "invalid model", false),
    ] {
        let (port, seen) = stub_node(move |method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, json!({"data":{"providers":[]}})),
            ("PUT", "/v1/ai/providers/custom") => (400, json!({"error":{"code":code,"message":message}})),
            _ => not_found(),
        });
        let error = tauri::async_runtime::block_on(save_ai_endpoint(
            port, "test-session".into(), address.into(), model.into(),
        )).expect_err("the write was refused");
        assert_eq!(error.starts_with("[LOCAL_AI_RESTART_REQUIRED]"), restart, "{address}: {error}");
        if !restart { assert_eq!(error, format!("[{code}] {message}")); }
        assert!(seen.lock().unwrap().iter().all(|request| request.method != "POST"));
    }
}

#[test]
fn the_matching_carried_local_provider_is_retested_without_an_owner_write() {
    for works in [true, false] {
        let (port, seen) = stub_node(move |method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, json!({"data":{"providers":[local_provider()]}})),
            ("POST", "/v1/ai/providers/desktop-local-ai/test") => (200, json!({"data":{"ok":works}})),
            _ => not_found(),
        });
        let result = tauri::async_runtime::block_on(save_ai_endpoint(
            port, "test-session".into(), "http://localhost:1234/v1/".into(), " local-model ".into(),
        ));
        assert_eq!(result.is_ok(), works);
        if !works { assert!(result.unwrap_err().starts_with("[AI_TEST_FAILED]")); }
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[1].path, "/v1/ai/providers/desktop-local-ai/test");
        assert_eq!(seen[1].body, json!({"capability":"text","accept_cost":false}));
        assert!(seen.iter().all(|request| request.method != "PUT"));
    }
}

#[test]
fn a_different_model_address_or_owner_provider_does_not_reuse_the_node_provider() {
    for (pointer, value) in [
        ("/source", "owner"), ("/base_url", "http://localhost:11434/v1"),
        ("/capabilities/text/model", "another-model"),
    ] {
        let mut provider = local_provider();
        *provider.pointer_mut(pointer).unwrap() = value.into();
        let (port, seen) = stub_node(move |method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, json!({"data":{"providers":[provider]}})),
            ("PUT", "/v1/ai/providers/custom") => (400, json!({"error":{"code":"INVALID_PROVIDER","message":LOCAL_POLICY}})),
            _ => not_found(),
        });
        let error = tauri::async_runtime::block_on(save_ai_endpoint(
            port, "test-session".into(), "http://localhost:1234/v1".into(), "local-model".into(),
        )).expect_err("the owner write requires the local restart flow");
        assert!(error.starts_with("[LOCAL_AI_RESTART_REQUIRED]"));
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[1].method, "PUT");
        assert_eq!(seen[1].path, "/v1/ai/providers/custom");
    }
}

#[test]
fn the_routing_default_and_health_are_read_from_the_current_core_view() {
    let (port, _) = stub_node(|method, path| match (method, path) {
        ("GET", "/v1/ai/providers") => (200, json!({"data":{
            "providers":[{"id":"custom","source":"owner","capabilities":{"text":{"pool":true}}},local_provider()],
            "routing":{"defaults":{"text":["desktop-local-ai"]}}
        }})),
        _ => not_found(),
    });
    let settings = tauri::async_runtime::block_on(get_ai_settings(port, "test-session".into())).expect("read settings");
    assert_eq!(settings.provider, "desktop-local-ai");
    assert_eq!(settings.health, "ok");
    assert_eq!(settings.model, "local-model");
    assert!(settings.text_default);
}
