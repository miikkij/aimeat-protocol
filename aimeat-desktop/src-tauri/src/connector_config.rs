// Edits to another program's settings are conditional, recoverable and limited to one entry.
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use toml_edit::{DocumentMut, Item, Table};

pub enum Config {
    Json(Value),
    Toml(DocumentMut),
}

impl Config {
    pub fn parse(text: &str, key: &str) -> Result<Self, String> {
        if key == "mcp_servers" {
            let doc = text.parse::<DocumentMut>().map_err(|_| "CONFIG_INVALID: expected TOML".to_string())?;
            if doc.get(key).is_some_and(|v| v.as_table_like().is_none()) {
                return Err("CONFIG_INVALID: mcp_servers must be a table".into());
            }
            Ok(Self::Toml(doc))
        } else {
            let value = if text.trim().is_empty() { json!({}) } else {
                serde_json::from_str(text).map_err(|_| "CONFIG_INVALID: expected JSON".to_string())?
            };
            if !value.is_object() || value.get(key).is_some_and(|v| !v.is_object()) {
                return Err("CONFIG_INVALID: expected a settings object".into());
            }
            Ok(Self::Json(value))
        }
    }

    pub fn entries(&self, key: &str) -> Vec<(String, String)> {
        match self {
            Self::Json(root) => root.get(key).and_then(Value::as_object).map(|m| m.iter()
                .filter_map(|(name, item)| item.get("url").and_then(Value::as_str).map(|url| (name.clone(), url.into())))
                .collect()).unwrap_or_default(),
            Self::Toml(doc) => doc.get(key).and_then(Item::as_table_like).map(|m| m.iter()
                .filter_map(|(name, item)| item.get("url").and_then(Item::as_str).map(|url| (name.into(), url.into())))
                .collect()).unwrap_or_default(),
        }
    }

    pub fn contains(&self, key: &str, name: &str) -> bool {
        match self {
            Self::Json(root) => root.get(key).and_then(|v| v.get(name)).is_some(),
            Self::Toml(doc) => doc.get(key).and_then(|v| v.get(name)).is_some(),
        }
    }

    pub fn unique_name(&self, key: &str, desired: &str) -> String {
        if !self.contains(key, desired) { return desired.into(); }
        let mut suffix = 2;
        loop {
            let candidate = format!("{}-{}", desired, suffix);
            if !self.contains(key, &candidate) { return candidate; }
            suffix += 1;
        }
    }

    pub fn put(&mut self, key: &str, name: &str, url: &str, with_type: bool) {
        match self {
            Self::Json(root) => {
                let servers = root.as_object_mut().unwrap().entry(key).or_insert_with(|| json!({}));
                let entry = if with_type { json!({"type":"http", "url":url}) } else { json!({"url":url}) };
                servers.as_object_mut().unwrap().insert(name.into(), entry);
            }
            Self::Toml(doc) => {
                if !doc.contains_key(key) {
                    let mut table = Table::new(); table.set_implicit(true); doc.insert(key, Item::Table(table));
                }
                let mut entry = Table::new(); entry["url"] = toml_edit::value(url);
                doc.get_mut(key).unwrap().as_table_like_mut().unwrap().insert(name, Item::Table(entry));
            }
        }
    }

    pub fn remove_exact(&mut self, key: &str, name: &str, expected_url: &str) -> Result<(), String> {
        let entries = self.entries(key);
        let current = entries.iter().find(|(entry_name, _)| entry_name == name)
            .ok_or_else(|| "CONNECTION_MISSING".to_string())?;
        if !super::is_same_node(&current.1, expected_url) { return Err("CONNECTION_CHANGED".into()); }
        match self {
            Self::Json(root) => { root[key].as_object_mut().unwrap().remove(name); }
            Self::Toml(doc) => { doc.get_mut(key).unwrap().as_table_like_mut().unwrap().remove(name); }
        }
        Ok(())
    }

    pub fn text(&self) -> String {
        match self {
            Self::Json(root) => serde_json::to_string_pretty(root).unwrap() + "\n",
            Self::Toml(doc) => doc.to_string(),
        }
    }
}

/// None means absent. Permission, encoding and read errors never mean an empty file.
pub fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("CONFIG_READ: {} ({})", path.display(), e)),
    }
}

fn private_file(path: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()
}

/// Serialize writes inside Desktop; reject a changed snapshot before replacement. The initial
/// backup is never overwritten by a later edit. A new private temp file has no shared fixed name.
pub fn write(path: &Path, before: Option<&str>, content: &str) -> Result<(), String> {
    // Dotfile managers commonly link settings files. Replace the target, keeping the link.
    let resolved = if fs::symlink_metadata(path).is_ok() { fs::canonicalize(path).map_err(|e| format!("CONFIG_WRITE: {}", e))? } else { path.to_path_buf() };
    let path = resolved.as_path();
    if read(path)?.as_deref() != before { return Err("CONFIG_CHANGED".into()); }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| format!("CONFIG_WRITE: {}", e))?; }
    let suffix = format!("aimeat-tmp-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let temp = path.with_extension(suffix);
    private_file(&temp, content).map_err(|e| format!("CONFIG_WRITE: {}", e))?;
    let result = (|| {
        #[cfg(unix)]
        if path.exists() { fs::set_permissions(&temp, fs::metadata(path)?.permissions())?; }
        if let Some(original) = before {
            let extension = path.extension().and_then(|v| v.to_str()).unwrap_or("bak");
            let backup = path.with_extension(format!("{}.aimeat-backup", extension));
            match private_file(&backup, original) {
                Ok(()) => {},
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {},
                Err(e) => return Err(e),
            }
        }
        Ok::<(), std::io::Error>(())
    })();
    if let Err(e) = result { let _ = fs::remove_file(&temp); return Err(format!("CONFIG_WRITE: {}", e)); }
    match read(path) {
        Ok(current) if current.as_deref() == before => {},
        Ok(_) => { let _ = fs::remove_file(&temp); return Err("CONFIG_CHANGED".into()); },
        Err(e) => { let _ = fs::remove_file(&temp); return Err(e); },
    }
    fs::rename(&temp, path).map_err(|e| { let _ = fs::remove_file(&temp); format!("CONFIG_WRITE: {}", e) })?;
    if read(path)?.as_deref() != Some(content) { return Err("CONFIG_CHANGED".into()); }
    Ok(())
}
