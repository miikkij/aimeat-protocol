// Window close, explicit quit and login launch are separate actions. Every exit drains the child.

use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

static QUITTING: AtomicU8 = AtomicU8::new(0);
pub const LOGIN_ARGUMENT: &str = "--from-autostart";

/// Review profiles cannot focus a real installed app or block another isolated profile.
/// Two launches with the same explicit data root still use the native single-instance plugin.
pub fn isolated_identifier(base: &str, root: &Path) -> String {
    let path = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let normalized = crate::node_manager::strip_verbatim(path).to_string_lossy().into_owned();
    #[cfg(windows)]
    let normalized = normalized.to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let suffix = digest[..12].iter().map(|b| format!("{b:02x}")).collect::<String>();
    format!("{base}.review.profile{suffix}")
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn show_error(app: &AppHandle, error: String) {
    let _ = app.emit("node-error", &error);
    show_main_window(app);
    app.dialog().message(error).title("AIMEAT Desktop")
        .kind(tauri_plugin_dialog::MessageDialogKind::Error).show(|_| {});
}

pub fn on_launch(app: &AppHandle) {
    let preferences = crate::desktop_settings::current(app);
    if preferences.keep_running_on_close && std::env::args().any(|arg| arg == LOGIN_ARGUMENT) {
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = window.hide() { show_error(app, error.to_string()); }
        }
    }
    // Starting the app, registering it at login and starting its local server are separate choices.
    if preferences.start_local_node {
        let app = app.clone();
        std::thread::spawn(move || {
            if let Err(error) = crate::node_manager::start_node(app.clone()) { show_error(&app, error); }
        });
    }
}

#[tauri::command]
pub fn quit_desktop(app: AppHandle) {
    app.exit(0);
}

pub fn handle_event(app: &AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
            api.prevent_close();
            let keep_running = crate::desktop_settings::current(app).keep_running_on_close;
            if crate::desktop_policy::hide_on_close(keep_running, QUITTING.load(Ordering::SeqCst) != 0) {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.hide() { show_error(app, error.to_string()); }
                }
            } else { app.exit(0); }
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            // Tauri restarts cannot be prevented. The updater has already drained the child.
            if code == Some(tauri::RESTART_EXIT_CODE) { return; }
            if QUITTING.load(Ordering::SeqCst) != 2 { api.prevent_exit(); }
            if QUITTING.compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Err(error) = crate::node_manager::shutdown_node(&app) {
                        QUITTING.store(0, Ordering::SeqCst);
                        show_error(&app, error);
                        return;
                    }
                    QUITTING.store(2, Ordering::SeqCst);
                    app.exit(code.unwrap_or(0));
                });
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show_main_window(app),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_single_instance_identity_is_stable_and_does_not_reach_the_installed_app() {
        let root = std::env::temp_dir().join("aimeat-review-policy-test");
        let first = isolated_identifier("example.aimeat", &root);
        assert_eq!(first, isolated_identifier("example.aimeat", &root));
        assert_ne!(first, "example.aimeat");
        assert_ne!(first, isolated_identifier("example.aimeat", &root.join("another")));
    }
}
