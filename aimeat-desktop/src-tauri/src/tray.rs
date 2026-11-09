// AIMEAT Desktop — System Tray Integration
// Provides status icon, tooltip, and quick-action menu in the system tray.
// Uses Tauri 2.0 tray API: TrayIconBuilder, Menu, MenuItem, PredefinedMenuItem.
//
// There must be exactly ONE tray icon. The `app.trayIcon` config in
// tauri.conf.json is intentionally absent so Tauri does not auto-create a second,
// menu-less tray — this module builds the single tray (with icon + menu) here.
//
// The lifecycle monitor supplies a snapshot; drawing the tray never locks child state.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

use crate::{desktop_settings::{self, Language}, node_manager};

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
    let menu = build_tray_menu(app.handle(), running, true)?;
    let tooltip = format!("AIMEAT: {}", state_label(desktop_settings::current(app.handle()).language,
        if running { node_manager::Phase::Starting } else { node_manager::Phase::Stopped }));

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

/// Build labels from the person's saved Desktop language, including while its window is hidden.
fn build_tray_menu(
    handle: &AppHandle,
    running: bool,
    toggle_enabled: bool,
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let labels = menu_labels(desktop_settings::current(handle).language, running);
    let open_dashboard =
        MenuItem::with_id(handle, ID_OPEN_DASHBOARD, labels.0, true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(handle)?;

    let toggle_node =
        MenuItem::with_id(handle, ID_TOGGLE_NODE, labels.1, toggle_enabled, None::<&str>)?;

    let sep2 = PredefinedMenuItem::separator(handle)?;

    let quit = MenuItem::with_id(handle, ID_QUIT, labels.2, true, None::<&str>)?;

    let menu = Menu::with_items(handle, &[&open_dashboard, &sep1, &toggle_node, &sep2, &quit])?;
    Ok(menu)
}

fn menu_labels(language: Language, running: bool) -> (&'static str, &'static str, &'static str) {
    match language {
        Language::Fi => ("Avaa Desktop", if running { "Pysäytä oma AIMEAT" } else { "Käynnistä oma AIMEAT" }, "Lopeta Desktop"),
        Language::En => ("Open Desktop", if running { "Stop my AIMEAT" } else { "Start my AIMEAT" }, "Quit Desktop"),
    }
}

fn state_label(language: Language, state: node_manager::Phase) -> &'static str {
    use node_manager::Phase::*;
    match (language, state) {
        (Language::Fi, Stopped) => "pysäytetty",
        (Language::Fi, Starting) => "käynnistyy",
        (Language::Fi, Ready) => "valmis",
        (Language::Fi, Stopping) => "pysähtyy",
        (Language::Fi, Failed) => "virhe, avaa Desktop",
        (Language::En, Stopped) => "stopped",
        (Language::En, Starting) => "starting",
        (Language::En, Ready) => "ready",
        (Language::En, Stopping) => "stopping",
        (Language::En, Failed) => "error, open Desktop",
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
    crate::desktop_lifecycle::show_main_window(handle);
}

/// Toggle the node process: start if stopped, stop if running.
/// start_node / stop_node refresh the tray themselves, so no extra refresh here.
fn toggle_node(handle: &AppHandle) {
    let handle = handle.clone();
    std::thread::spawn(move || {
        let result = if node_manager::is_node_running() {
            node_manager::shutdown_node(&handle)
        } else {
            node_manager::start_node(handle.clone()).map(|_| ())
        };
        if let Err(message) = result {
            use tauri::Emitter;
            let _ = handle.emit("node-error", message);
            show_main_window(&handle);
        }
    });
}

/// The monitor calls this even while the server page is closed, including after a crash.
pub fn refresh_tray_state(handle: &AppHandle, status: &node_manager::NodeStatus) {
    let label = state_label(desktop_settings::current(handle).language, status.state);
    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_tray_menu(handle, status.running, status.state != node_manager::Phase::Stopping) {
            let _ = tray.set_menu(Some(menu));
        }
        let _ = tray.set_tooltip(Some(format!("AIMEAT: {}", label)));
    }
}

/// Cleanly quit the application. Stops the node if running, then exits.
fn quit_app(handle: &AppHandle) {
    // The application's exit handler owns the asynchronous drain for every way of quitting.
    handle.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tray_uses_the_saved_language_and_distinguishes_stop_from_quit() {
        assert_eq!(menu_labels(Language::Fi, true), ("Avaa Desktop", "Pysäytä oma AIMEAT", "Lopeta Desktop"));
        assert_eq!(menu_labels(Language::En, false), ("Open Desktop", "Start my AIMEAT", "Quit Desktop"));
        assert_eq!(state_label(Language::Fi, node_manager::Phase::Starting), "käynnistyy");
        assert_eq!(state_label(Language::En, node_manager::Phase::Ready), "ready");
    }
}
