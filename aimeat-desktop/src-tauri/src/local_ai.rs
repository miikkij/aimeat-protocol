// AIMEAT Desktop — The AI server on this computer, as a node-level provider in local-network mode
//
// The AI a person chooses in the desktop's AI section is saved on their account (ai_connector.rs,
// the owner's `custom` provider). When the node is open to the local network it runs with the
// public profile, and there an owner's provider cannot be on the node's own machine, so that choice
// stops working. The node has a node-level way for exactly this: a provider of the node itself in
// AIMEAT_AI_PROVIDERS, and its one exact address in AIMEAT_AI_PROVIDER_EGRESS, which only the node's
// own providers may reach (aimeat/src/services/ai/providers.ts). An ordinary account cannot set
// either; they are in this computer's .env.
//
// So the desktop keeps the person's local AI choice in the .env (DESKTOP_LOCAL_AI_URL and
// DESKTOP_LOCAL_AI_MODEL, which the node does not read), and sync_env writes the node provider and
// its one address while the node listens on the local network, and removes them when it does not
// or when the choice goes away. Only what the desktop wrote is ever removed: its provider has the id
// PROVIDER_ID, and the address it added is recorded in DESKTOP_LOCAL_AI_EGRESS, so an operator's own
// providers and addresses stay as they are. The node reads the .env when it starts, so a change takes
// effect the next time it starts, as every other setting here does.
//
// 2026-10-27: initial (secaudit2026oct26, local-profile-from-default-baseurl-on-network-reachable-listener).

use crate::node_manager::{make_private, parse_env, resolve_env_file};
use tauri::AppHandle;

/// The id of the node provider the desktop writes. Nothing else with this id is the desktop's.
pub const PROVIDER_ID: &str = "desktop-local-ai";
const KEY_URL: &str = "DESKTOP_LOCAL_AI_URL";
const KEY_MODEL: &str = "DESKTOP_LOCAL_AI_MODEL";
/// The egress address the desktop added itself (empty when the operator already listed it).
const KEY_ADDED: &str = "DESKTOP_LOCAL_AI_EGRESS";
const KEY_PROVIDERS: &str = "AIMEAT_AI_PROVIDERS";
const KEY_EGRESS: &str = "AIMEAT_AI_PROVIDER_EGRESS";

/// A local AI server: its API root, the model, and its origin (scheme, host and port).
#[derive(Debug, PartialEq)]
pub struct LocalAi {
    pub base_url: String,
    pub model: String,
    pub origin: String,
}

/// The model id as a provider names it (the node's MODEL_RE).
fn model_ok(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 200
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./:@+-".contains(c))
}

/// Some when `base_url` is an http(s) address on this computer (localhost, 127.x, ::1) with no
/// credentials and `model` is a model id; None for anything else, which the node provider never is.
pub fn local_ai_of(base_url: &str, model: &str) -> Option<LocalAi> {
    let url = reqwest::Url::parse(base_url.trim()).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    // The .env holds the address inside quotes, so it carries none of its own.
    if url.as_str().chars().any(|c| c == '\'' || c == '"' || c == '`' || c.is_whitespace()) {
        return None;
    }
    let host = url.host_str()?.trim_start_matches('[').trim_end_matches(']');
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if !loopback || !model_ok(model.trim()) {
        return None;
    }
    let origin = url.origin().ascii_serialization();
    let base = url.as_str().trim_end_matches('/').to_string();
    Some(LocalAi { base_url: base, model: model.trim().to_string(), origin })
}

/// Replace every `key=` line with one `key=value` line (where the first was), append it when there
/// was none, or remove them all when `value` is None. Comments and other lines stay as they are.
fn set_line(text: &str, key: &str, value: Option<&str>) -> String {
    let prefix = format!("{}=", key);
    let mut out = String::with_capacity(text.len() + 64);
    let mut done = false;
    for line in text.lines() {
        if line.trim_start().starts_with(&prefix) {
            if let (Some(v), false) = (value, done) {
                out.push_str(&format!("{}={}\n", key, v));
                done = true;
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if let (Some(v), false) = (value, done) {
        out.push_str(&format!("{}={}\n", key, v));
    }
    out
}

/// True when the .env opens the node beyond this computer.
fn on_network(vars: &std::collections::HashMap<String, String>) -> bool {
    vars.get("AIMEAT_BIND_HOST").map(|h| h.trim() == "0.0.0.0").unwrap_or(false)
}

/// The .env with the desktop's node provider and its one egress address present exactly when the
/// node listens on the local network and a local AI server is chosen; absent otherwise. An
/// AIMEAT_AI_PROVIDERS that is not a JSON array is the operator's and is not touched: the change is
/// refused with a message instead.
pub fn sync_env(existing: &str) -> Result<String, String> {
    let vars = parse_env(existing);
    let chosen = match (vars.get(KEY_URL), vars.get(KEY_MODEL)) {
        (Some(u), Some(m)) => local_ai_of(u, m),
        _ => None,
    };
    let wanted = if on_network(&vars) { chosen } else { None };

    // Providers: the operator's as they are, without the desktop's own.
    let providers_line_was_ours = !vars.contains_key(KEY_PROVIDERS) || provider_only_ours(&vars);
    // A value that is not a JSON list is the operator's and stays exactly as it is; it holds nothing
    // of the desktop's, and only adding to it is refused.
    let mut keep_providers_line = false;
    let mut providers: Vec<serde_json::Value> = match vars.get(KEY_PROVIDERS).map(|s| s.trim()) {
        None | Some("") => Vec::new(),
        Some(raw) => match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(serde_json::Value::Array(list)) => list,
            _ if wanted.is_none() => {
                keep_providers_line = true;
                Vec::new()
            }
            _ => {
                return Err(format!(
                    "{} in the .env is not a JSON list, so the AI server on this computer was not added to it. Correct it or remove it, then save again.",
                    KEY_PROVIDERS
                ))
            }
        },
    };
    providers.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(PROVIDER_ID));

    // Egress: the operator's addresses as they are, without the one the desktop added.
    let added = vars.get(KEY_ADDED).cloned().unwrap_or_default();
    let original_egress: Vec<String> = vars
        .get(KEY_EGRESS)
        .map(|s| s.split(',').map(|e| e.trim().to_string()).filter(|e| !e.is_empty()).collect())
        .unwrap_or_default();
    let mut egress = original_egress.clone();
    if !added.is_empty() {
        if let Some(i) = egress.iter().position(|e| *e == added) {
            egress.remove(i);
        }
    }
    // The line is the desktop's when there was none, or it held only the address the desktop added.
    let egress_line_was_ours = !vars.contains_key(KEY_EGRESS)
        || (!added.is_empty() && original_egress == vec![added.clone()]);

    let mut now_added = String::new();
    if let Some(ai) = &wanted {
        providers.push(serde_json::json!({
            "id": PROVIDER_ID,
            "title": "AI on this computer",
            "type": "local",
            "baseUrl": ai.base_url,
            "auth": { "type": "none" },
            "capabilities": { "text": { "enabled": true, "pool": true, "model": ai.model } },
        }));
        if !egress.contains(&ai.origin) {
            egress.push(ai.origin.clone());
            now_added = ai.origin.clone();
        }
    }

    let providers_line = if providers.is_empty() && providers_line_was_ours {
        None
    } else {
        // Single quotes: the JSON's own double quotes stay as they are in the node's .env reader.
        Some(format!("'{}'", serde_json::Value::Array(providers)))
    };
    let egress_line = if egress.is_empty() && egress_line_was_ours {
        None
    } else {
        Some(format!("\"{}\"", egress.join(",")))
    };

    let mut text = if keep_providers_line {
        existing.to_string()
    } else {
        set_line(existing, KEY_PROVIDERS, providers_line.as_deref())
    };
    text = set_line(&text, KEY_EGRESS, egress_line.as_deref());
    text = set_line(&text, KEY_ADDED, if now_added.is_empty() { None } else { Some(now_added.as_str()) });
    Ok(text)
}

/// True when the AIMEAT_AI_PROVIDERS line holds nothing but the desktop's own provider, so removing
/// that provider removes the line the desktop added.
fn provider_only_ours(vars: &std::collections::HashMap<String, String>) -> bool {
    match vars.get(KEY_PROVIDERS).map(|s| serde_json::from_str::<serde_json::Value>(s.trim())) {
        Some(Ok(serde_json::Value::Array(list))) => {
            !list.is_empty() && list.iter().all(|p| p.get("id").and_then(|v| v.as_str()) == Some(PROVIDER_ID))
        }
        _ => false,
    }
}

/// The .env with the person's local AI choice recorded (or cleared, for an AI elsewhere), then
/// synced with the node-level entries.
pub fn remember_env(existing: &str, base_url: &str, model: &str) -> Result<String, String> {
    let text = match local_ai_of(base_url, model) {
        Some(ai) => {
            let t = set_line(existing, KEY_URL, Some(&format!("\"{}\"", ai.base_url)));
            set_line(&t, KEY_MODEL, Some(&format!("\"{}\"", ai.model)))
        }
        None => {
            let t = set_line(existing, KEY_URL, None);
            set_line(&t, KEY_MODEL, None)
        }
    };
    sync_env(&text)
}

/// The AI section chose an AI: record it for the node-level provider. Answers whether the node now
/// carries it as its own provider (local-network mode with a server on this computer), which takes
/// effect the next time the node starts.
#[tauri::command]
pub fn remember_local_ai(app: AppHandle, base_url: String, model: String) -> Result<bool, String> {
    let env_file = resolve_env_file(&app)?;
    let existing = std::fs::read_to_string(&env_file).map_err(|e| format!("Failed to read config: {}", e))?;
    let updated = remember_env(&existing, &base_url, &model)?;
    let carried = parse_env(&updated)
        .get(KEY_PROVIDERS)
        .map(|p| p.contains(PROVIDER_ID))
        .unwrap_or(false);
    std::fs::write(&env_file, updated).map_err(|e| format!("Failed to write config: {}", e))?;
    make_private(&env_file, 0o600)?;
    Ok(carried)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NETWORK: &str = "AIMEAT_PORT=41050\nAIMEAT_BIND_HOST=\"0.0.0.0\"\nAIMEAT_ENCRYPTION_KEY=\"k\"\n";
    const THIS_COMPUTER: &str = "AIMEAT_PORT=41050\nAIMEAT_BIND_HOST=\"127.0.0.1\"\nAIMEAT_ENCRYPTION_KEY=\"k\"\n";

    fn providers_of(text: &str) -> Vec<serde_json::Value> {
        parse_env(text)
            .get(KEY_PROVIDERS)
            .map(|s| serde_json::from_str::<Vec<serde_json::Value>>(s).unwrap())
            .unwrap_or_default()
    }

    fn egress_of(text: &str) -> Vec<String> {
        parse_env(text)
            .get(KEY_EGRESS)
            .map(|s| s.split(',').map(|e| e.trim().to_string()).filter(|e| !e.is_empty()).collect())
            .unwrap_or_default()
    }

    #[test]
    fn local_network_mode_with_a_local_ai_server_writes_exactly_that_provider_and_address() {
        let text = remember_env(NETWORK, "http://localhost:1234/v1", "qwen3-8b").unwrap();
        let providers = providers_of(&text);
        assert_eq!(providers.len(), 1, "{}", text);
        assert_eq!(providers[0]["id"], PROVIDER_ID);
        assert_eq!(providers[0]["type"], "local");
        assert_eq!(providers[0]["baseUrl"], "http://localhost:1234/v1");
        assert_eq!(providers[0]["capabilities"]["text"]["model"], "qwen3-8b");
        assert_eq!(egress_of(&text), vec!["http://localhost:1234".to_string()]);
        assert_eq!(parse_env(&text).get("AIMEAT_ENCRYPTION_KEY").map(String::as_str), Some("k"));
    }

    #[test]
    fn no_other_loopback_address_is_opened() {
        let text = remember_env(NETWORK, "http://127.0.0.1:11434", "llama3.2:3b").unwrap();
        assert_eq!(egress_of(&text), vec!["http://127.0.0.1:11434".to_string()]);
        // Saving again, and changing the server, never leaves a second address behind.
        let again = sync_env(&text).unwrap();
        assert_eq!(egress_of(&again), vec!["http://127.0.0.1:11434".to_string()]);
        let moved = remember_env(&again, "http://127.0.0.1:1234/v1", "qwen3-8b").unwrap();
        assert_eq!(egress_of(&moved), vec!["http://127.0.0.1:1234".to_string()]);
        assert_eq!(providers_of(&moved).len(), 1);
        // An address elsewhere, or a path or credentials, is never a node provider or an address.
        for url in ["http://192.168.1.20:1234/v1", "https://api.example.org/v1", "http://user:pw@localhost:1234/v1", "file:///etc"] {
            let t = remember_env(NETWORK, url, "m").unwrap();
            assert!(egress_of(&t).is_empty(), "{} gave {}", url, t);
            assert!(providers_of(&t).is_empty(), "{} gave {}", url, t);
        }
        assert!(local_ai_of("http://localhost:1234/v1", "m'; rm -rf").is_none());
    }

    #[test]
    fn this_computer_only_writes_nothing_and_going_back_removes_what_the_desktop_wrote() {
        let local = remember_env(THIS_COMPUTER, "http://localhost:1234/v1", "qwen3-8b").unwrap();
        assert!(providers_of(&local).is_empty());
        assert!(!local.contains(KEY_PROVIDERS) && !local.contains(KEY_EGRESS), "{}", local);
        // Opening to the network carries the remembered choice.
        let open = sync_env(&local.replace("127.0.0.1", "0.0.0.0")).unwrap();
        assert_eq!(egress_of(&open), vec!["http://localhost:1234".to_string()]);
        // Going back to this computer only removes the provider, the address and their lines.
        let closed = sync_env(&open.replace("AIMEAT_BIND_HOST=\"0.0.0.0\"", "AIMEAT_BIND_HOST=\"127.0.0.1\"")).unwrap();
        assert!(!closed.contains(KEY_PROVIDERS) && !closed.contains(KEY_EGRESS) && !closed.contains(KEY_ADDED), "{}", closed);
        // Choosing an AI elsewhere removes them too.
        let elsewhere = remember_env(&open, "https://api.example.org/v1", "m").unwrap();
        assert!(!elsewhere.contains(KEY_PROVIDERS) && !elsewhere.contains(KEY_EGRESS), "{}", elsewhere);
    }

    #[test]
    fn an_operators_own_providers_and_addresses_stay() {
        let operator = format!(
            "{}AIMEAT_AI_PROVIDERS='[{{\"id\":\"lab\",\"type\":\"openai-compatible\",\"baseUrl\":\"http://laya:8000/v1\"}}]'\nAIMEAT_AI_PROVIDER_EGRESS=\"http://laya:8000,http://localhost:1234\"\n",
            NETWORK
        );
        let open = remember_env(&operator, "http://localhost:1234/v1", "qwen3-8b").unwrap();
        let ids: Vec<String> = providers_of(&open).iter().map(|p| p["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec!["lab".to_string(), PROVIDER_ID.to_string()]);
        // The operator already listed the address, so the desktop added none and records none.
        assert_eq!(egress_of(&open), vec!["http://laya:8000".to_string(), "http://localhost:1234".to_string()]);
        assert!(!open.contains(KEY_ADDED));
        let closed = sync_env(&open.replace("AIMEAT_BIND_HOST=\"0.0.0.0\"", "AIMEAT_BIND_HOST=\"127.0.0.1\"")).unwrap();
        let ids: Vec<String> = providers_of(&closed).iter().map(|p| p["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec!["lab".to_string()]);
        assert_eq!(egress_of(&closed), vec!["http://laya:8000".to_string(), "http://localhost:1234".to_string()]);
    }

    #[test]
    fn an_operator_value_that_is_not_a_list_is_not_touched() {
        let broken = format!("{}AIMEAT_AI_PROVIDERS='not json'\n", NETWORK);
        assert!(remember_env(&broken, "http://localhost:1234/v1", "qwen3-8b").is_err());
        // Saving the settings with nothing to add leaves it exactly as it is.
        let local = broken.replace("0.0.0.0", "127.0.0.1");
        assert_eq!(sync_env(&local).unwrap(), local);
    }
}
