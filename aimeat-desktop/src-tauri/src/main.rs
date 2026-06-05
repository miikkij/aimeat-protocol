// AIMEAT Desktop — Tauri Application Entry Point
// Manages the AIMEAT personal node as a child process with GUI.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod node_manager;
mod ai_connector;
mod tray;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            node_manager::start_node,
            node_manager::stop_node,
            node_manager::get_node_status,
            node_manager::write_config,
            node_manager::read_config,
            node_manager::read_node_logs,
            node_manager::clear_node_logs,
            node_manager::open_portal,
            ai_connector::detect_ai_services,
            ai_connector::connect_ai_service,
        ])
        .setup(|app| {
            // Initialize system tray
            tray::setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AIMEAT Desktop");
}
