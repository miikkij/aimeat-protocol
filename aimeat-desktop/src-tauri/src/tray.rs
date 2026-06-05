// AIMEAT Desktop — System Tray Integration
// Provides status icon, tooltip, and quick-action menu in the system tray.
// Uses Tauri 2.0 tray API: TrayIconBuilder, Menu, MenuItem, PredefinedMenuItem.

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
    let menu = build_tray_menu(app.handle())?;
    let tooltip = tray_tooltip_text();

    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(&tooltip)
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_icon_event)
        .build(app)?;

    Ok(())
}

/// Construct the tray context menu.
/// The node toggle item shows "Start Node" or "Stop Node" depending on current state.
fn build_tray_menu(handle: &AppHandle) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let open_dashboard =
        MenuItem::with_id(handle, ID_OPEN_DASHBOARD, "Open Dashboard", true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(handle)?;

    let toggle_label = if node_manager::is_node_running() {
        "Stop Node"
    } else {
        "Start Node"
    };
    let toggle_node =
        MenuItem::with_id(handle, ID_TOGGLE_NODE, toggle_label, true, None::<&str>)?;

    let sep2 = PredefinedMenuItem::separator(handle)?;

    let quit = MenuItem::with_id(handle, ID_QUIT, "Quit AIMEAT", true, None::<&str>)?;

    let menu = Menu::with_items(
        handle,
        &[&open_dashboard, &sep1, &toggle_node, &sep2, &quit],
    )?;

    Ok(menu)
}

/// Generate tooltip text reflecting current node status.
fn tray_tooltip_text() -> String {
    if node_manager::is_node_running() {
        "AIMEAT \u{2014} Running on port 40050".to_string()
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
        let handle = tray.app_handle();
        show_main_window(handle);
    }
}

/// Show and focus the main application window.
fn show_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        // Un-minimize if minimized, then show and bring to front
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Toggle the node process: start if stopped, stop if running.
/// After toggling, rebuild the tray menu and update the tooltip to reflect new state.
fn toggle_node(handle: &AppHandle) {
    if node_manager::is_node_running() {
        // Stop the running node
        if let Some(pid) = node_manager::get_node_pid() {
            if let Err(e) = node_manager::stop_node(pid) {
                eprintln!("Failed to stop node: {}", e);
            }
        }
    } else {
        // Start the node (paths/config resolved from the app handle)
        if let Err(e) = node_manager::start_node(handle.clone()) {
            eprintln!("Failed to start node: {}", e);
        }
    }

    // Refresh the tray menu and tooltip to reflect new state
    refresh_tray(handle);
}

/// Rebuild the tray menu and update tooltip after a state change.
fn refresh_tray(handle: &AppHandle) {
    if let Ok(menu) = build_tray_menu(handle) {
        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
            let tooltip = tray_tooltip_text();
            let _ = tray.set_tooltip(Some(tooltip));
        }
    }
}

/// Cleanly quit the application. Stops the node if running, then exits.
fn quit_app(handle: &AppHandle) {
    // Stop the node process before exiting
    if let Some(pid) = node_manager::get_node_pid() {
        let _ = node_manager::stop_node(pid);
    }
    handle.exit(0);
}
