// AIMEAT Desktop — System Tray Integration
// Provides status icon, tooltip, and quick-action menu in the system tray.
// Uses Tauri 2.0 tray API: TrayIconBuilder, Menu, MenuItem, PredefinedMenuItem.
//
// There must be exactly ONE tray icon. The `app.trayIcon` config in
// tauri.conf.json is intentionally absent so Tauri does not auto-create a second,
// menu-less tray — this module builds the single tray (with icon + menu) here.
//
// refresh_tray() takes the running state explicitly so node_manager can call it
// while holding the NODE_PROCESS lock without deadlocking (it must NOT re-lock).

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::node_manager;

/// Tray icon ID used to look up the tray for dynamic updates.
const TRAY_ID: &str = "aimeat_tray";

/// Menu item IDs used for matching click events.
const ID_OPEN_DASHBOARD: &str = "open_dashboard";
const ID_TOGGLE_NODE: &str = "toggle_node";
const ID_QUIT: &str = "quit";

/// Build the system tray icon with menu and event handlers.
/// Called once during app setup in main.rs.
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let running = node_manager::is_node_running();
    let menu = build_tray_menu(app.handle(), running)?;
    let tooltip = tray_tooltip_text(running);

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(&tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_icon_event);

    // Use the app icon (heart) for the tray. Without this the tray shows a blank square.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Construct the tray context menu. The toggle item shows "Start Node" or
/// "Stop Node" based on the supplied running state.
fn build_tray_menu(
    handle: &AppHandle,
    running: bool,
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let open_dashboard =
        MenuItem::with_id(handle, ID_OPEN_DASHBOARD, "Open Window", true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(handle)?;

    let toggle_label = if running { "Stop Node" } else { "Start Node" };
    let toggle_node =
        MenuItem::with_id(handle, ID_TOGGLE_NODE, toggle_label, true, None::<&str>)?;

    let sep2 = PredefinedMenuItem::separator(handle)?;

    let quit = MenuItem::with_id(handle, ID_QUIT, "Quit AIMEAT", true, None::<&str>)?;

    let menu = Menu::with_items(handle, &[&open_dashboard, &sep1, &toggle_node, &sep2, &quit])?;
    Ok(menu)
}

/// Tooltip text reflecting the supplied node state.
fn tray_tooltip_text(running: bool) -> String {
    if running {
        "AIMEAT \u{2014} Running".to_string()
    } else {
        "AIMEAT \u{2014} Stopped".to_string()
    }
}

/// Handle clicks on tray menu items.
fn handle_menu_event(handle: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id();
    if id == ID_OPEN_DASHBOARD {
        show_main_window(handle);
    } else if id == ID_TOGGLE_NODE {
        toggle_node(handle);
    } else if id == ID_QUIT {
        quit_app(handle);
    }
}

/// Handle tray icon click events (left-click opens/focuses the window).
fn handle_tray_icon_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main_window(tray.app_handle());
    }
}

/// Show and focus the main application window.
fn show_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Toggle the node process: start if stopped, stop if running.
/// start_node / stop_node refresh the tray themselves, so no extra refresh here.
fn toggle_node(handle: &AppHandle) {
    if node_manager::is_node_running() {
        if let Some(pid) = node_manager::get_node_pid() {
            if let Err(e) = node_manager::stop_node(handle.clone(), pid) {
                eprintln!("Failed to stop node: {}", e);
            }
        }
    } else if let Err(e) = node_manager::start_node(handle.clone()) {
        eprintln!("Failed to start node: {}", e);
    }
}

/// Rebuild the tray menu + tooltip for the given state.
/// IMPORTANT: must not lock NODE_PROCESS — callers may hold that lock. The state
/// is passed in explicitly for exactly this reason.
pub fn refresh_tray(handle: &AppHandle, running: bool) {
    if let Ok(menu) = build_tray_menu(handle, running) {
        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
            let _ = tray.set_tooltip(Some(tray_tooltip_text(running)));
        }
    }
}

/// Cleanly quit the application. Stops the node if running, then exits.
fn quit_app(handle: &AppHandle) {
    if let Some(pid) = node_manager::get_node_pid() {
        let _ = node_manager::stop_node(handle.clone(), pid);
    }
    handle.exit(0);
}
