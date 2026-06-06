// AIMEAT Desktop — Tauri build script.
// Runs tauri-build codegen: reads tauri.conf.json, generates capabilities/permissions,
// embeds the Windows resource (icon), and sets OUT_DIR for generate_context!().
fn main() {
    tauri_build::build()
}
