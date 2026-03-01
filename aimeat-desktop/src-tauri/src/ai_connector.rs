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
