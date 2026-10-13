// AIMEAT Desktop — AI Service Auto-Detection
// Scans local ports for LM Studio, Ollama, and OpenAI-compatible endpoints, and reads and saves
// the owner's AI connection on the node through the provider routes (/v1/ai/providers).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct AIService {
    pub service_type: String,  // "lm-studio" | "ollama" | "openai-compatible" | "unknown"
    pub url: String,
    pub port: u16,
    pub status: String,        // "available" | "unavailable"
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn detect_ai_services() -> Result<Vec<AIService>, String> {
    let mut services = Vec::new();

    // Check LM Studio (default: localhost:1234)
    match check_openai_compatible("http://localhost:1234").await {
        Ok(models) => services.push(AIService {
            service_type: "lm-studio".to_string(),
            url: "http://localhost:1234".to_string(),
            port: 1234,
            status: "available".to_string(),
            models,
        }),
        Err(_) => services.push(AIService {
            service_type: "lm-studio".to_string(),
            url: "http://localhost:1234".to_string(),
            port: 1234,
            status: "unavailable".to_string(),
            models: vec![],
        }),
    }

    // Check Ollama (default: localhost:11434)
    match check_ollama("http://localhost:11434").await {
        Ok(models) => services.push(AIService {
            service_type: "ollama".to_string(),
            url: "http://localhost:11434".to_string(),
            port: 11434,
            status: "available".to_string(),
            models,
        }),
        Err(_) => services.push(AIService {
            service_type: "ollama".to_string(),
            url: "http://localhost:11434".to_string(),
            port: 11434,
            status: "unavailable".to_string(),
            models: vec![],
        }),
    }

    Ok(services)
}

/// Log in to a node (by base URL) as an owner and return the owner JWT.
/// POST {base}/v1/ghii/login { username, password } -> { data: { token } }.
pub async fn login_at(base_url: &str, username: &str, password: &str) -> Result<String, String> {
    let url = format!("{}/v1/ghii/login", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {}", base_url, e))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected response from node: {}", e))?;

    if !status.is_success() {
        let msg = body
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("Login failed");
        return Err(msg.to_string());
    }

    body.pointer("/data/token")
        .and_then(|t| t.as_str())
        .map(|t| t.to_string())
        .ok_or_else(|| {
            "Login succeeded but no token was returned (this account may require a TOTP code).".to_string()
        })
}

/// Owner login against the AIMEAT on this machine, by port (the machine room's AI section).
#[tauri::command]
pub async fn node_login(port: u16, username: String, password: String) -> Result<String, String> {
    login_at(&format!("http://localhost:{}", port), &username, &password).await
}

/// The AI settings currently stored for the signed-in owner (for display).
#[derive(Serialize)]
pub struct AiSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

// ── The owner's AI connection, through the provider routes ──────────────────────────────────
//
// The connection is one of the owner's AI providers (GET /v1/ai/providers): the id `openrouter`,
// `lmstudio` or `custom`, as the node migrates the setting from before providers into one. The
// OpenRouter settings route this app read and wrote until 2026-10-13 answers 410 GONE from node
// 4.0.0 (AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN in aimeat/src/config-ai-models.ts). The
// provider routes exist on every node this app bundles (since 2026-09-28), so it uses them on 3.x
// and on 4.0.0 alike. The web screens do the same through aimeat/public/js/services/ai-connection.js.

/// The provider ids the setting from before providers becomes on the node.
const CONNECTION_IDS: [&str; 3] = ["openrouter", "lmstudio", "custom"];

/// The provider this app writes: an address on this computer the person chose.
const DESKTOP_PROVIDER: &str = "custom";

/// The capability fields a provider view adds and a PUT does not take back.
const VIEW_ONLY_FIELDS: [&str; 2] = ["model_status", "model_retires_at"];

fn node_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// The node's own message from a refusal, or `fallback`.
fn node_message(body: &serde_json::Value, fallback: &str) -> String {
    body.pointer("/error/message")
        .and_then(|m| m.as_str())
        .unwrap_or(fallback)
        .to_string()
}

fn str_at<'a>(v: &'a serde_json::Value, pointer: &str) -> &'a str {
    v.pointer(pointer).and_then(|s| s.as_str()).unwrap_or("")
}

fn trimmed_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

/// Whether the node routes calls to this provider: migrated from the old setting, or with a
/// capability in the owner's pool.
fn in_use(p: &serde_json::Value) -> bool {
    p.get("migrated_from").is_some()
        || p.get("capabilities")
            .and_then(|c| c.as_object())
            .map(|caps| caps.values().any(|c| c.get("pool").and_then(|b| b.as_bool()) == Some(true)))
            .unwrap_or(false)
}

/// The owner's connection among the providers of GET /v1/ai/providers, or None: the provider this
/// app writes when it is in use, then the migrated one, then one in use or with a key, then one that
/// needs no key, then any. The node's own providers are never the owner's connection.
fn connection_of(view: &serde_json::Value) -> Option<&serde_json::Value> {
    let own: Vec<&serde_json::Value> = view
        .pointer("/data/providers")
        .and_then(|p| p.as_array())
        .map(|list| {
            list.iter()
                .filter(|p| str_at(p, "/source") == "owner" && CONNECTION_IDS.contains(&str_at(p, "/id")))
                .collect()
        })
        .unwrap_or_default();
    let has_key = |p: &serde_json::Value| p.pointer("/auth/has_key").and_then(|b| b.as_bool()) == Some(true);
    own.iter().find(|p| str_at(p, "/id") == DESKTOP_PROVIDER && in_use(p))
        .or_else(|| own.iter().find(|p| p.get("migrated_from").is_some()))
        .or_else(|| own.iter().find(|p| in_use(p) || has_key(p)))
        .or_else(|| own.iter().find(|p| str_at(p, "/auth/type") == "none"))
        .or_else(|| own.first())
        .copied()
}

/// The connection in the fields the machine room shows. No connection reads as empty: the node's
/// own default answers.
fn settings_of(p: Option<&serde_json::Value>) -> AiSettings {
    let Some(p) = p else {
        return AiSettings { provider: String::new(), base_url: String::new(), model: String::new(), has_api_key: false };
    };
    AiSettings {
        provider: str_at(p, "/id").to_string(),
        base_url: if str_at(p, "/type") == "openrouter" { String::new() } else { str_at(p, "/base_url").to_string() },
        model: str_at(p, "/capabilities/text/model").to_string(),
        has_api_key: p.pointer("/auth/has_key").and_then(|b| b.as_bool()) == Some(true),
    }
}

/// The PUT /v1/ai/providers/custom body for an address and a text model. `existing` is the owner's
/// `custom` provider as GET /v1/ai/providers shows it. At the same address its other capabilities
/// and its key setting stay; at a new address they go, because they belonged to another server.
/// Text is on and, with a model, in the owner's pool: the node routes a call to an owner's provider
/// only for a capability in the pool with a model (aimeat/src/services/ai/route-plan.ts inPool).
fn provider_body(existing: Option<&serde_json::Value>, base_url: &str, model: &str) -> serde_json::Value {
    let base = trimmed_url(base_url);
    let same = existing.filter(|p| {
        str_at(p, "/type") == "openai-compatible" && trimmed_url(str_at(p, "/base_url")) == base
    });
    let mut capabilities = serde_json::Map::new();
    if let Some(caps) = same.and_then(|p| p.get("capabilities")).and_then(|c| c.as_object()) {
        for (name, cfg) in caps {
            let mut cfg = cfg.clone();
            if let Some(obj) = cfg.as_object_mut() {
                for field in VIEW_ONLY_FIELDS {
                    obj.remove(field);
                }
            }
            capabilities.insert(name.clone(), cfg);
        }
    }
    let mut text = capabilities
        .remove("text")
        .and_then(|t| t.as_object().cloned())
        .unwrap_or_default();
    let model = model.trim();
    text.insert("enabled".into(), serde_json::Value::Bool(true));
    text.insert("pool".into(), serde_json::Value::Bool(!model.is_empty()));
    if model.is_empty() {
        text.remove("model");
    } else {
        text.insert("model".into(), serde_json::Value::String(model.to_string()));
    }
    capabilities.insert("text".into(), serde_json::Value::Object(text));
    let keyed = same.map(|p| str_at(p, "/auth/type") == "key").unwrap_or(false);
    let title = existing.map(|p| str_at(p, "/title")).filter(|t| !t.is_empty()).unwrap_or("Custom provider");
    serde_json::json!({
        "title": title,
        "type": "openai-compatible",
        "baseUrl": base,
        "auth": { "type": if keyed { "key" } else { "none" } },
        "capabilities": capabilities,
    })
}

/// GET /v1/ai/providers as the signed-in owner.
async fn providers_view(client: &reqwest::Client, base: &str, token: &str) -> Result<serde_json::Value, String> {
    let resp = client
        .get(format!("{}/v1/ai/providers", base))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Cannot reach node at {}: {}", base, e))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(node_message(&body, "Failed to read AI settings"));
    }
    Ok(body)
}

/// Read the owner's current AI connection. GET /v1/ai/providers (Bearer token).
#[tauri::command]
pub async fn get_ai_settings(port: u16, token: String) -> Result<AiSettings, String> {
    let base = format!("http://localhost:{}", port);
    let view = providers_view(&node_client()?, &base, &token).await?;
    Ok(settings_of(connection_of(&view)))
}

/// Save the chosen AI endpoint as the owner's `custom` provider, in use for text:
/// PUT /v1/ai/providers/custom { type: "openai-compatible", baseUrl, auth, capabilities }, then,
/// when the node has not tested its text capability yet, POST /v1/ai/providers/custom/test once, as
/// the node routes to an owner's provider only once its capability was tested (under the rule
/// "only tested providers"). The test is one short call to the chosen server and costs nothing
/// (accept_cost false); a failed test is not an error here, because the AI page's providers table
/// shows it.
#[tauri::command]
pub async fn save_ai_endpoint(
    port: u16,
    token: String,
    base_url: String,
    model: String,
) -> Result<(), String> {
    let base = format!("http://localhost:{}", port);
    let client = node_client()?;
    let view = providers_view(&client, &base, &token).await?;
    let existing = view
        .pointer("/data/providers")
        .and_then(|p| p.as_array())
        .and_then(|list| {
            list.iter()
                .find(|p| str_at(p, "/source") == "owner" && str_at(p, "/id") == DESKTOP_PROVIDER)
        });

    let resp = client
        .put(format!("{}/v1/ai/providers/{}", base, DESKTOP_PROVIDER))
        .bearer_auth(&token)
        .json(&provider_body(existing, &base_url, &model))
        .send()
        .await
        .map_err(|e| format!("Cannot reach node on port {}: {}", port, e))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(node_message(&body, "Failed to save AI settings"));
    }

    let tested = matches!(
        body.pointer("/data/provider/health/text/status").and_then(|s| s.as_str()),
        Some(s) if s != "untested"
    );
    if !model.trim().is_empty() && !tested {
        // Best effort: the outcome is recorded on the node and shown on the AI page.
        let _ = client
            .post(format!("{}/v1/ai/providers/{}/test", base, DESKTOP_PROVIDER))
            .bearer_auth(&token)
            .json(&serde_json::json!({ "capability": "text", "accept_cost": false }))
            .send()
            .await;
    }
    Ok(())
}

async fn check_openai_compatible(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/v1/models", base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err("Not available".to_string());
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let models: Vec<String> = body["data"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect();

    Ok(models)
}

async fn check_ollama(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err("Not available".to_string());
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let models: Vec<String> = body["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| m["name"].as_str().map(String::from))
        .collect();

    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// One request the stub node received: method, path and body.
    #[derive(Clone, Debug)]
    struct Seen {
        method: String,
        path: String,
        body: serde_json::Value,
    }

    /// A node on a free local port that answers each request with `answer(method, path)` and
    /// records what it received. Every response closes its connection, so a request is one connection.
    fn stub_node(
        answer: impl Fn(&str, &str) -> (u16, serde_json::Value) + Send + 'static,
    ) -> (u16, Arc<Mutex<Vec<Seen>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let mut length = 0usize;
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).is_err() || header == "\r\n" || header.is_empty() {
                        break;
                    }
                    let lower = header.to_ascii_lowercase();
                    if let Some(v) = lower.strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut raw = vec![0u8; length];
                if length > 0 && reader.read_exact(&mut raw).is_err() {
                    continue;
                }
                let body = serde_json::from_slice(&raw).unwrap_or(serde_json::Value::Null);
                log.lock().unwrap().push(Seen { method: method.clone(), path: path.clone(), body });
                let (status, reply) = answer(&method, &path);
                let text = reply.to_string();
                let _ = write!(
                    stream,
                    "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    text.len(),
                    text
                );
                let _ = stream.flush();
            }
        });
        (port, seen)
    }

    fn not_found() -> (u16, serde_json::Value) {
        (404, serde_json::json!({ "error": { "code": "NOT_FOUND", "message": "No such route on the stub node." } }))
    }

    /// GET /v1/ai/providers as a 3.x or 4.0.0 node answers it: the node's own OpenRouter key, the
    /// owner's migrated OpenRouter connection with a key, and the owner's custom provider in use.
    fn providers_view() -> serde_json::Value {
        serde_json::json!({ "data": { "providers": [
            { "id": "openrouter", "title": "OpenRouter", "type": "openrouter", "source": "owner",
              "base_url": "https://openrouter.ai/api/v1", "auth": { "type": "key", "has_key": true },
              "capabilities": { "text": { "enabled": true, "pool": false, "model": "openai/gpt-5" } },
              "health": {}, "migrated_from": "openrouter.settings" },
            { "id": "custom", "title": "Custom provider", "type": "openai-compatible", "source": "owner",
              "base_url": "http://localhost:1234/v1", "auth": { "type": "none" },
              "capabilities": { "text": { "enabled": true, "pool": true, "model": "qwen3-8b" } },
              "health": { "text": { "status": "ok" } } },
            { "id": "node-openrouter", "title": "This node's OpenRouter key", "type": "openrouter",
              "source": "node", "base_url": "https://openrouter.ai/api/v1", "auth": { "type": "env" },
              "capabilities": { "text": { "enabled": true, "pool": true, "model": "x" } }, "health": {} }
        ] } })
    }

    #[test]
    fn the_current_ai_is_read_from_the_provider_routes() {
        let (port, seen) = stub_node(|method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, providers_view()),
            _ => not_found(),
        });
        let got = tauri::async_runtime::block_on(get_ai_settings(port, "jwt".into())).expect("read");
        assert_eq!(got.provider, "custom");
        assert_eq!(got.base_url, "http://localhost:1234/v1");
        assert_eq!(got.model, "qwen3-8b");
        assert!(!got.has_api_key);
        let seen = seen.lock().unwrap();
        assert!(seen.iter().all(|s| !s.path.starts_with("/v1/openrouter")), "{:?}", *seen);
    }

    #[test]
    fn the_chosen_ai_is_saved_as_the_custom_provider_in_the_pool_and_tested() {
        let (port, seen) = stub_node(|method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, serde_json::json!({ "data": { "providers": [] } })),
            ("PUT", "/v1/ai/providers/custom") => (200, serde_json::json!({ "data": { "provider": {
                "id": "custom", "type": "openai-compatible", "source": "owner", "health": {} } } })),
            ("POST", "/v1/ai/providers/custom/test") => (200, serde_json::json!({ "data": { "ok": true } })),
            _ => not_found(),
        });
        tauri::async_runtime::block_on(save_ai_endpoint(
            port,
            "jwt".into(),
            "http://localhost:11434/v1/".into(),
            "llama3.2".into(),
        ))
        .expect("save");
        let seen = seen.lock().unwrap().clone();
        let put = seen
            .iter()
            .find(|s| s.method == "PUT")
            .unwrap_or_else(|| panic!("no PUT: {:?}", seen));
        assert_eq!(put.path, "/v1/ai/providers/custom");
        assert_eq!(put.body["type"], "openai-compatible");
        assert_eq!(put.body["baseUrl"], "http://localhost:11434/v1");
        assert_eq!(put.body["auth"]["type"], "none");
        assert_eq!(put.body["capabilities"]["text"]["enabled"], true);
        assert_eq!(put.body["capabilities"]["text"]["pool"], true);
        assert_eq!(put.body["capabilities"]["text"]["model"], "llama3.2");
        let test = seen.iter().find(|s| s.method == "POST").expect("the text capability is tested once");
        assert_eq!(test.path, "/v1/ai/providers/custom/test");
        assert_eq!(test.body["capability"], "text");
        assert_eq!(test.body["accept_cost"], false);
        assert!(seen.iter().all(|s| !s.path.starts_with("/v1/openrouter")), "{:?}", seen);
    }

    #[test]
    fn the_same_address_keeps_its_other_capabilities_and_a_new_one_drops_them() {
        let existing = serde_json::json!({
            "id": "custom", "title": "My box", "type": "openai-compatible", "source": "owner",
            "base_url": "http://localhost:1234/v1", "auth": { "type": "key", "has_key": true },
            "capabilities": {
                "text": { "enabled": true, "pool": false, "model": "old", "params": { "temperature": 0.2 } },
                "vision": { "enabled": true, "pool": true, "model": "llava", "model_status": "active" }
            }
        });
        let same = provider_body(Some(&existing), "http://localhost:1234/v1/", "new");
        assert_eq!(same["title"], "My box");
        assert_eq!(same["auth"]["type"], "key");
        assert_eq!(same["capabilities"]["text"]["model"], "new");
        assert_eq!(same["capabilities"]["text"]["pool"], true);
        assert_eq!(same["capabilities"]["text"]["params"]["temperature"], 0.2);
        assert_eq!(same["capabilities"]["vision"]["model"], "llava");
        assert!(same["capabilities"]["vision"].get("model_status").is_none());

        let moved = provider_body(Some(&existing), "http://localhost:11434/v1", "llama3.2");
        assert_eq!(moved["auth"]["type"], "none");
        assert!(moved["capabilities"].get("vision").is_none());
        assert_eq!(moved["capabilities"]["text"], serde_json::json!({ "enabled": true, "pool": true, "model": "llama3.2" }));

        // The node refuses a pool entry with no model, so a text capability without one stays out.
        let bare = provider_body(None, "http://localhost:1234/v1", " ");
        assert_eq!(bare["capabilities"]["text"], serde_json::json!({ "enabled": true, "pool": false }));
        assert_eq!(bare["title"], "Custom provider");
    }

    #[test]
    fn no_connection_of_the_owners_reads_as_the_node_default() {
        let only_node = serde_json::json!({ "data": { "providers": [
            { "id": "node-openrouter", "type": "openrouter", "source": "node", "auth": { "type": "env" } }
        ] } });
        let s = settings_of(connection_of(&only_node));
        assert_eq!((s.provider.as_str(), s.base_url.as_str(), s.model.as_str(), s.has_api_key), ("", "", "", false));
        // A migrated OpenRouter connection shows no address: OpenRouter's is fixed.
        let migrated = serde_json::json!({ "data": { "providers": [
            { "id": "openrouter", "type": "openrouter", "source": "owner", "base_url": "https://openrouter.ai/api/v1",
              "auth": { "type": "key", "has_key": true }, "migrated_from": "openrouter.settings",
              "capabilities": { "text": { "enabled": true, "pool": false, "model": "openai/gpt-5" } } }
        ] } });
        let s = settings_of(connection_of(&migrated));
        assert_eq!((s.provider.as_str(), s.base_url.as_str(), s.model.as_str(), s.has_api_key), ("openrouter", "", "openai/gpt-5", true));
    }

    #[test]
    fn a_refused_save_returns_the_nodes_own_words() {
        let (port, _seen) = stub_node(|method, path| match (method, path) {
            ("GET", "/v1/ai/providers") => (200, serde_json::json!({ "data": { "providers": [] } })),
            ("PUT", "/v1/ai/providers/custom") => (403, serde_json::json!({ "error": {
                "code": "PROVIDER_NOT_ALLOWED", "message": "AI provider host \"example.org\" is not in this node's allowlist." } })),
            _ => not_found(),
        });
        let err = tauri::async_runtime::block_on(save_ai_endpoint(
            port,
            "jwt".into(),
            "https://example.org/v1".into(),
            "m".into(),
        ))
        .expect_err("refused");
        assert!(err.contains("allowlist"), "{}", err);
    }
}
