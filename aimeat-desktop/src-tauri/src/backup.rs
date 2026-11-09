//! Native file selection and explicit approval for complete Desktop backups.
use crate::{backup_archive, node_manager};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const STATE_FILE: &str = ".desktop-backup-state.json";
static PENDING_RESTORE: Mutex<Option<PendingRestore>> = Mutex::new(None);

struct PendingRestore {
    ticket: String,
    path: PathBuf,
    sha256: String,
    selected_at: Instant,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BackupReport {
    pub path: String,
    pub created_at: String,
    pub desktop_version: String,
    pub files: usize,
    pub total_bytes: u64,
    pub recovery_path: Option<String>,
    pub warning: Option<String>,
}

#[derive(Serialize)]
pub struct BackupPreview {
    pub ticket: String,
    pub path: String,
    pub created_at: String,
    pub desktop_version: String,
    pub files: usize,
    pub total_bytes: u64,
}

#[derive(Serialize)]
pub struct BackupStatus {
    pub last_backup: Option<BackupReport>,
}

fn report(path: &std::path::Path, manifest: backup_archive::BackupManifest) -> BackupReport {
    BackupReport {
        path: path.to_string_lossy().into_owned(),
        created_at: manifest.created_at,
        desktop_version: manifest.desktop_version,
        files: manifest.files.len(),
        total_bytes: manifest.total_bytes,
        recovery_path: None,
        warning: None,
    }
}

fn remember(root: &std::path::Path, report: &mut BackupReport) {
    let result = serde_json::to_vec_pretty(report)
        .map_err(|e| e.to_string())
        .and_then(|bytes| backup_archive::write_state(&root.join(STATE_FILE), &bytes));
    if let Err(error) = result {
        report.warning = Some(format!("Backup completed, but its history could not be saved: {error}"));
    }
}

#[tauri::command]
pub async fn create_backup(app: AppHandle, lang: Option<String>) -> Result<Option<BackupReport>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let title = if lang.as_deref() == Some("fi") { "Tallenna AIMEAT-varmuuskopio" } else { "Save AIMEAT backup" };
        let selected = app.dialog().file()
            .set_title(title)
            .add_filter("AIMEAT backup", &["zip"])
            .set_file_name(format!("aimeat-desktop-{}.zip", chrono::Utc::now().format("%Y%m%d-%H%M%S")))
            .blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| format!("Choose a local backup file: {e}"))?;
        node_manager::with_stopped_node(&app, |root| {
            let manifest = backup_archive::create(root, &path, env!("CARGO_PKG_VERSION"))?;
            let mut report = report(&path, manifest);
            remember(root, &mut report);
            Ok(Some(report))
        })
    }).await.map_err(|e| format!("Backup task failed: {e}"))?
}

#[tauri::command]
pub async fn inspect_backup(app: AppHandle, lang: Option<String>) -> Result<Option<BackupPreview>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // A new selection invalidates any older confirmation, including after cancellation.
        *PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")? = None;
        let title = if lang.as_deref() == Some("fi") { "Valitse palautettava AIMEAT-varmuuskopio" } else { "Choose AIMEAT backup to restore" };
        let selected = app.dialog().file().set_title(title)
            .add_filter("AIMEAT backup", &["zip"]).blocking_pick_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| format!("Choose a local backup file: {e}"))?;
        let before = backup_archive::archive_digest(&path)?;
        let manifest = backup_archive::inspect(&path)?;
        if backup_archive::archive_digest(&path)? != before {
            return Err("The backup changed during inspection. Select it again.".into());
        }
        let ticket = backup_archive::random_id()?;
        let preview = BackupPreview {
            ticket: ticket.clone(),
            path: path.to_string_lossy().into_owned(),
            created_at: manifest.created_at,
            desktop_version: manifest.desktop_version,
            files: manifest.files.len(),
            total_bytes: manifest.total_bytes,
        };
        *PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")? = Some(PendingRestore {
            ticket, path, sha256: before, selected_at: Instant::now(),
        });
        Ok(Some(preview))
    }).await.map_err(|e| format!("Backup inspection failed: {e}"))?
}

#[tauri::command]
pub async fn restore_backup(app: AppHandle, ticket: String, confirmed: bool) -> Result<BackupReport, String> {
    if !confirmed { return Err("Confirm replacement of the current Desktop data before restoring.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let pending = {
            let mut selection = PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")?;
            let pending = selection.as_ref().ok_or("Choose and inspect a backup before restoring.")?;
            if pending.ticket != ticket || pending.selected_at.elapsed() > Duration::from_secs(600) {
                return Err("The restore confirmation has expired. Choose the backup again.".into());
            }
            selection.take().ok_or("Choose a backup before restoring.")?
        };
        node_manager::with_stopped_node(&app, |root| {
            let (manifest, recovery) = backup_archive::restore_verified(root, &pending.path, &pending.sha256)?;
            let mut report = report(&pending.path, manifest);
            report.recovery_path = Some(recovery.to_string_lossy().into_owned());
            remember(root, &mut report);
            Ok(report)
        })
    }).await.map_err(|e| format!("Restore task failed: {e}"))?
}

#[tauri::command]
pub fn backup_status(app: AppHandle) -> Result<BackupStatus, String> {
    let path = node_manager::data_dir(&app)?.join(STATE_FILE);
    let last_backup = match std::fs::File::open(&path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(64 * 1024 + 1).read_to_end(&mut bytes)
                .map_err(|e| format!("Backup history could not be read: {e}"))?;
            if bytes.len() > 64 * 1024 { return Err("Backup history is too large to read.".into()); }
            Some(serde_json::from_slice(&bytes).map_err(|e| format!("Backup history could not be read: {e}"))?)
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Backup history could not be read: {e}")),
    };
    Ok(BackupStatus { last_backup })
}
