// AIMEAT Desktop — auto-updater commands (tauri-plugin-updater).
//
// Checks a `latest.json` published on the GitHub Release (endpoint in tauri.conf.json
// `plugins.updater`) and, on the user's click, downloads + installs the new installer.
// Uses the Tauri updater's own minisign signature (NOT Authenticode — that is separate).
// Compile-check with `cargo check` / `pnpm tauri build`.

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Returns Some(version) if a newer release is available, else None.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| u.version))
}

/// Downloads and installs the available update (NSIS installer). On success the app
/// relaunches into the new version. Returns false if there was nothing to install.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}
