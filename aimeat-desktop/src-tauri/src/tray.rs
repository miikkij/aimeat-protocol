// AIMEAT Desktop — System Tray Integration
// Provides status icon, tooltip, and quick-action menu in the system tray.

use tauri::{App, Manager};

pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    // System tray setup is done via tauri.conf.json
    // This module provides runtime tray state management

    // In production, this would:
    // 1. Set tray icon color based on node status (green/yellow/red)
    // 2. Update tooltip with morsel balance
    // 3. Handle tray menu actions (open dashboard, start/stop, quit)

    let _window = app.get_webview_window("main");

    Ok(())
}
