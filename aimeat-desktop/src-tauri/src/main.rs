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
mod diagnostics;
mod desktop_policy;
mod desktop_settings;
mod desktop_lifecycle;
#[cfg(windows)]
mod desktop_autostart_windows;
#[cfg(test)]
mod webview_policy;

fn main() {
    let mut context = tauri::generate_context!();
    // Isolated review profiles get their own native instance identity, without registering at login.
    if let Some(root) = std::env::var_os("AIMEAT_DESKTOP_DATA_DIR") {
        context.config_mut().identifier = desktop_lifecycle::isolated_identifier(
            &context.config().identifier, std::path::Path::new(&root));
    }
    // The native single-instance plugin must be registered before every other plugin.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop_lifecycle::show_main_window(app);
        }));
    #[cfg(not(windows))]
    if !desktop_settings::isolated() {
        builder = builder.plugin(tauri_plugin_autostart::Builder::new()
            .arg(desktop_lifecycle::LOGIN_ARGUMENT).build());
    }
    builder
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
            diagnostics::run_diagnostics,
            desktop_settings::get_desktop_preferences,
            desktop_settings::save_desktop_preferences,
            desktop_settings::set_desktop_language,
            desktop_lifecycle::quit_desktop,
        ])
        .setup(|app| {
            if let Err(error) = desktop_settings::initialize(app.handle()) {
                desktop_lifecycle::show_error(app.handle(), error);
            }
            tray::setup_tray(app)?;
            desktop_lifecycle::on_launch(app.handle());
            Ok(())
        })
        .build(context)
        .expect("error while building AIMEAT Desktop")
        .run(desktop_lifecycle::handle_event);
}
