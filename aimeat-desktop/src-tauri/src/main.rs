// AIMEAT Desktop — Tauri Application Entry Point
// Manages the AIMEAT personal node as a child process with GUI.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod node_manager;
mod opener;
mod ai_connector;
mod connectors;
mod updater;
mod tray;
#[cfg(test)]
mod webview_policy;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            connectors::connect_connector,
            connectors::disconnect_connector,
            connectors::connector_snippet,
            ai_connector::detect_ai_services,
            ai_connector::node_login,
            ai_connector::save_ai_endpoint,
            ai_connector::get_ai_settings,
            updater::check_update,
            updater::install_update,
        ])
        .setup(|app| {
            // Initialize system tray
            tray::setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AIMEAT Desktop")
        .run(|_app_handle, event| {
            // On quit, stop the server this app started. Otherwise it lingers and keeps node.exe
            // locked, which breaks the next install ("Error opening file for writing"). The local
            // agent runtime that also had to be reaped here was removed on 2026-09-29.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                node_manager::kill_node();
            }
        });
}
