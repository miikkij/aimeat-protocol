// AIMEAT Desktop — Tauri Application Entry Point
// Manages the AIMEAT personal node as a child process with GUI.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod node_manager;
mod ai_connector;
mod chat;
mod agent_runtime;
mod updater;
mod tray;

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
            ai_connector::detect_ai_services,
            ai_connector::connect_ai_service,
            ai_connector::node_login,
            ai_connector::node_login_at,
            ai_connector::node_register,
            ai_connector::queue_agent_task,
            ai_connector::get_agent_task,
            ai_connector::get_agent_memory,
            ai_connector::save_ai_endpoint,
            ai_connector::get_ai_settings,
            chat::get_chat_agent,
            chat::register_chat_agent,
            chat::get_chat_session,
            chat::list_chat_sessions,
            chat::delete_chat_session,
            chat::chat_start,
            chat::chat_send,
            chat::chat_approve,
            chat::chat_set_auto_approve,
            chat::chat_clear,
            chat::chat_stop,
            agent_runtime::agent_provision,
            agent_runtime::agent_start,
            agent_runtime::agent_stop,
            agent_runtime::agent_status,
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
        .run(|app_handle, event| {
            // On quit, reap EVERY sidecar we spawned (node server, agent supervisor + crew tree,
            // detached serve daemon). Otherwise they linger and lock node.exe / the .venv, which
            // breaks the next install ("Error opening file for writing") and corrupts provisioning.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                node_manager::kill_node();
                agent_runtime::shutdown(app_handle);
            }
        });
}
