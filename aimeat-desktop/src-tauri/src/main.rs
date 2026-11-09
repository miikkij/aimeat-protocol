// AIMEAT Desktop — Tauri Application Entry Point
// Manages the AIMEAT personal node as a child process with GUI.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod node_manager;
mod opener;
mod ai_connector;
mod local_ai;
mod connectors;
mod updater;
mod tray;
mod backup_archive;
mod backup;
#[cfg(test)]
mod webview_policy;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            node_manager::start_node,
            node_manager::stop_node,
            node_manager::get_node_status,
            node_manager::write_config,
            node_manager::read_config,
            node_manager::read_node_logs,
            node_manager::clear_node_logs,
            node_manager::open_portal,
            node_manager::open_external,
            connectors::detect_connectors,
            connectors::check_connector_address,
            connectors::connect_connector,
            connectors::disconnect_connector,
            connectors::connector_snippet,
            ai_connector::detect_ai_services,
            ai_connector::node_login_with_code,
            ai_connector::save_ai_endpoint,
            ai_connector::get_ai_settings,
            local_ai::remember_local_ai,
            updater::check_update,
            updater::get_update_status,
            updater::install_update,
            updater::restart_desktop,
            backup::backup_status,
            backup::create_backup,
            backup::inspect_backup,
            backup::restore_backup,
        ])
        .setup(|app| {
            // Initialize system tray
            tray::setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AIMEAT Desktop")
        .run(|app_handle, event| {
            // Keep the window available if shutdown fails, including when the title-bar X is used.
            if let tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::CloseRequested { ref api, .. }, .. } = event {
                api.prevent_close();
                app_handle.exit(0);
            }
            // Keep the event loop responsive while the child flushes its existing SIGTERM handlers.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // Tauri cannot prevent a restart. restart_desktop has already drained the child.
                if code == Some(tauri::RESTART_EXIT_CODE) { return; }
                static QUITTING: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
                if QUITTING.load(std::sync::atomic::Ordering::SeqCst) != 2 {
                    api.prevent_exit();
                }
                if QUITTING.compare_exchange(0, 1, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst).is_ok() {
                    let app = app_handle.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = node_manager::shutdown_node(&app) {
                            use tauri::{Emitter, Manager};
                            use tauri_plugin_dialog::DialogExt;
                            QUITTING.store(0, std::sync::atomic::Ordering::SeqCst);
                            let _ = app.emit("node-error", &error);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            app.dialog().message(error).title("AIMEAT Desktop")
                                .kind(tauri_plugin_dialog::MessageDialogKind::Error).show(|_| {});
                            return;
                        }
                        QUITTING.store(2, std::sync::atomic::Ordering::SeqCst);
                        app.exit(code.unwrap_or(0));
                    });
                }
            }
        });
}
