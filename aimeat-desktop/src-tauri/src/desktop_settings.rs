// Desktop-only preferences. These never enter the node's .env or change AI configuration.
// The shared data lease keeps atomic saves separate from node start and backup/restore.

use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(windows))]
use tauri_plugin_autostart::ManagerExt;

const FILE_NAME: &str = "desktop-preferences.json";
const MAX_BYTES: u64 = 16 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Fi,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DesktopPreferences {
    pub keep_running_on_close: bool,
    pub start_at_login: bool,
    pub start_local_node: bool,
    pub language: Language,
    pub backup_reminder_days: u16,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self { keep_running_on_close: false, start_at_login: false, start_local_node: false,
            language: Language::En, backup_reminder_days: 7 }
    }
}

impl DesktopPreferences {
    fn validate(&self) -> Result<(), String> {
        if ![0, 7, 30].contains(&self.backup_reminder_days) {
            return Err("Choose a backup reminder of 7 days, 30 days, or Off.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
pub struct DesktopPreferencesView {
    pub preferences: DesktopPreferences,
    pub autostart_available: bool,
    pub autostart_enabled: Option<bool>,
    pub isolated: bool,
    pub warning: Option<String>,
}

struct SettingsState(Mutex<DesktopPreferences>);

/// Every explicit data-root override is a review profile. No opt-out can touch real OS startup.
pub fn isolated() -> bool {
    std::env::var_os("AIMEAT_DESKTOP_DATA_DIR").is_some()
}

pub fn current(app: &AppHandle) -> DesktopPreferences {
    app.try_state::<SettingsState>().and_then(|state| state.0.lock().ok().map(|value| value.clone()))
        .unwrap_or_default()
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    app.manage(SettingsState(Mutex::new(DesktopPreferences::default())));
    let preferences = crate::node_manager::with_desktop_data(app, read_preferences)?;
    update_memory(app, &preferences)
}

fn update_memory(app: &AppHandle, preferences: &DesktopPreferences) -> Result<(), String> {
    *app.state::<SettingsState>().0.lock().map_err(|e| e.to_string())? = preferences.clone();
    Ok(())
}

fn read_preferences(root: &Path) -> Result<DesktopPreferences, String> {
    let path = root.join(FILE_NAME);
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(DesktopPreferences::default()),
        Err(error) => return Err(format!("Could not read Desktop preferences: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read Desktop preferences: {error}"))?;
    if bytes.len() as u64 > MAX_BYTES { return Err("The Desktop preferences file is too large.".into()); }
    let preferences: DesktopPreferences = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Desktop preferences are not valid. The file was left unchanged: {error}"))?;
    preferences.validate()?;
    Ok(preferences)
}

fn write_preferences(root: &Path, preferences: &DesktopPreferences) -> Result<(), String> {
    preferences.validate()?;
    std::fs::create_dir_all(root).map_err(|e| format!("Could not prepare Desktop preferences: {e}"))?;
    crate::node_manager::make_private(root, 0o700)?;
    let mut random = [0u8; 12];
    getrandom::getrandom(&mut random).map_err(|e| e.to_string())?;
    let suffix = random.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let temporary = root.join(format!(".{FILE_NAME}.{suffix}.tmp"));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)
        .map_err(|e| format!("Could not prepare Desktop preferences: {e}"))?;
    let result = (|| {
        crate::node_manager::make_private(&temporary, 0o600)?;
        let bytes = serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?;
        file.write_all(&bytes).and_then(|_| file.sync_all())
            .map_err(|e| format!("Could not save Desktop preferences: {e}"))?;
        drop(file);
        std::fs::rename(&temporary, root.join(FILE_NAME))
            .map_err(|e| format!("Could not replace Desktop preferences: {e}"))?;
        Ok(())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

fn read_autostart(app: &AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    { let _ = app; crate::desktop_autostart_windows::is_enabled() }
    #[cfg(not(windows))]
    app.autolaunch().is_enabled().map_err(|e| format!("Could not check login startup: {e}"))
}

fn change_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    { let _ = app; return crate::desktop_autostart_windows::set_enabled(enabled); }
    #[cfg(not(windows))]
    {
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }
        .map_err(|e| format!("Could not change login startup: {e}"))?;
    if read_autostart(app)? != enabled {
        return Err("The operating system did not confirm the login startup change.".into());
    }
    Ok(())
    }
}

fn view(app: &AppHandle, preferences: DesktopPreferences) -> DesktopPreferencesView {
    let isolated = isolated();
    let (enabled, warning) = if isolated { (None, None) } else {
        match read_autostart(app) {
            Ok(enabled) => (Some(enabled), if enabled == preferences.start_at_login { None } else {
                Some("The operating system's login startup setting differs from the saved preference. Save your choice to apply it.".into())
            }),
            Err(error) => (None, Some(error)),
        }
    };
    DesktopPreferencesView { preferences, autostart_available: !isolated,
        autostart_enabled: enabled, isolated, warning }
}

fn publish(app: &AppHandle, preferences: DesktopPreferences) -> DesktopPreferencesView {
    let result = view(app, preferences);
    let _ = app.emit("desktop-preferences", &result);
    if let Ok(status) = crate::node_manager::get_node_status(app.clone()) {
        crate::tray::refresh_tray_state(app, &status);
    }
    result
}

#[tauri::command]
pub async fn get_desktop_preferences(app: AppHandle) -> Result<DesktopPreferencesView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let preferences = crate::node_manager::with_desktop_data(&app, |root| {
            let preferences = read_preferences(root)?;
            update_memory(&app, &preferences)?;
            Ok(preferences)
        })?;
        Ok(view(&app, preferences))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_desktop_preferences(app: AppHandle, preferences: DesktopPreferences) -> Result<DesktopPreferencesView, String> {
    preferences.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::node_manager::with_desktop_data(&app, |root| {
            // Do not silently replace corrupt or unreadable settings.
            read_preferences(root)?;
            crate::desktop_policy::save_with_autostart(preferences.start_at_login, !isolated(),
                || read_autostart(&app), |enabled| change_autostart(&app, enabled),
                || write_preferences(root, &preferences))?;
            update_memory(&app, &preferences)
        })?;
        Ok(publish(&app, preferences))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_desktop_language(app: AppHandle, language: Language) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let preferences = crate::node_manager::with_desktop_data(&app, |root| {
            let mut preferences = read_preferences(root)?;
            if preferences.language != language {
                preferences.language = language;
                write_preferences(root, &preferences)?;
            }
            update_memory(&app, &preferences)?;
            Ok(preferences)
        })?;
        publish(&app, preferences);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "desktop_settings_tests.rs"]
mod tests;
