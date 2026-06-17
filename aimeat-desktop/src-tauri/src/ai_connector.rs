// AIMEAT Desktop — AI Service Auto-Detection
// Scans local ports for LM Studio, Ollama, and OpenAI-compatible endpoints.

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

#[tauri::command]
pub fn connect_ai_service(service: AIService) -> Result<(), String> {
    // In production: write the AI service configuration to the AIMEAT node config
    // For now: validate the service is reachable
    if service.status != "available" {
        return Err(format!("Service {} is not available", service.service_type));
    }
    Ok(())
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

/// Owner login against the local node by port (AI Setup tab).
#[tauri::command]
pub async fn node_login(port: u16, username: String, password: String) -> Result<String, String> {
    login_at(&format!("http://localhost:{}", port), &username, &password).await
}

/// Owner login against any node by base URL (Chat tab: localhost or https://aimeat.io).
#[tauri::command]
pub async fn node_login_at(base_url: String, username: String, password: String) -> Result<String, String> {
    login_at(&base_url, &username, &password).await
}

/// Register a new owner on the LOCAL node and return the owner JWT — the Home wizard's one-step
/// "create account & continue" (no browser). POST {base}/v1/ghii { username, display_name, password }.
/// If the name already exists, that's fine — we just sign in (so the same button works for a
/// returning user with the right password). Returns the owner token via login.
#[tauri::command]
pub async fn node_register(port: u16, username: String, password: String) -> Result<String, String> {
    let base = format!("http://localhost:{}", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/v1/ghii", base))
        .json(&serde_json::json!({ "username": username, "display_name": username, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {}", base, e))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);

    // Success → sign in. Name taken → also fine (existing account) → sign in and let the password
    // decide. Any other failure (e.g. weak password) → surface it.
    if !status.is_success() {
        let code = body.pointer("/error/code").and_then(|c| c.as_str()).unwrap_or("");
        let msg = body.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("Registration failed");
        let name_taken = status.as_u16() == 409 || code == "NAME_TAKEN" || msg.to_lowercase().contains("already");
        if !name_taken {
            return Err(msg.to_string());
        }
    }
    login_at(&base, &username, &password).await
}

/// Queue a task for a local agent — the Home wizard's "Give it this task" button. POSTs to
/// {base}/v1/agents/{agent}/tasks with the owner JWT. The running crew picks it up and works it;
/// the result streams back through the agent's Activity events. (A Rust command, not a webview
/// fetch, so there is no localhost CORS dependency.)
#[tauri::command]
pub async fn queue_agent_task(
    port: u16,
    agent: String,
    owner_token: String,
    title: String,
    description: String,
) -> Result<(), String> {
    let url = format!("http://localhost:{}/v1/agents/{}/tasks", port, agent);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&serde_json::json!({ "title": title, "description": description }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach the node: {}", e))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = body
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("Could not queue the task");
        return Err(msg.to_string());
    }
    Ok(())
}

/// The AI settings currently stored for the signed-in owner (for display).
#[derive(Serialize)]
pub struct AiSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

/// Read the owner's current AI settings. GET /v1/openrouter/settings (Bearer token).
#[tauri::command]
pub async fn get_ai_settings(port: u16, token: String) -> Result<AiSettings, String> {
    let url = format!("http://localhost:{}/v1/openrouter/settings", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Cannot reach node on port {}: {}", port, e))?;

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let msg = body
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("Failed to read AI settings");
        return Err(msg.to_string());
    }

    Ok(AiSettings {
        provider: body
            .pointer("/data/provider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        base_url: body
            .pointer("/data/baseUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        model: body
            .pointer("/data/model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        has_api_key: body
            .pointer("/data/hasApiKey")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// Save the chosen AI endpoint to the owner's account settings on the node.
/// PUT /v1/openrouter/settings (Bearer token) { provider: "custom", baseUrl, model }.
#[tauri::command]
pub async fn save_ai_endpoint(
    port: u16,
    token: String,
    base_url: String,
    model: String,
) -> Result<(), String> {
    let url = format!("http://localhost:{}/v1/openrouter/settings", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .put(&url)
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "provider": "custom",
            "baseUrl": base_url,
            "model": model,
        }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach node on port {}: {}", port, e))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    let msg = body
        .pointer("/error/message")
        .and_then(|m| m.as_str())
        .unwrap_or("Failed to save AI settings");
    Err(msg.to_string())
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
