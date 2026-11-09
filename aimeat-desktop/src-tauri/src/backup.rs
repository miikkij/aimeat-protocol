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

#[derive(Clone)]
struct PendingRestore {
    ticket: String,
    path: PathBuf,
    sha256: String,
    selected_at: Instant,
    encrypted: bool,
    inspected: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BackupReport {
    #[serde(default)]
    pub encrypted: bool,
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
    pub encrypted: bool,
    pub password_required: bool,
    pub created_at: Option<String>,
    pub desktop_version: Option<String>,
    pub files: Option<usize>,
    pub total_bytes: Option<u64>,
}

#[derive(Serialize)]
pub struct BackupStatus {
    pub last_backup: Option<BackupReport>,
}

fn report(path: &std::path::Path, manifest: backup_archive::BackupManifest, encrypted: bool) -> BackupReport {
    BackupReport {
        encrypted,
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
pub async fn create_backup(app: AppHandle, lang: Option<String>, password: String) -> Result<Option<BackupReport>, String> {
    let password = backup_archive::SecretString::from(password);
    backup_archive::validate_backup_password(&password)?;
    tauri::async_runtime::spawn_blocking(move || {
        let title = if lang.as_deref() == Some("fi") { "Tallenna AIMEAT-varmuuskopio" } else { "Save AIMEAT backup" };
        let selected = app.dialog().file()
            .set_title(title)
            .add_filter("Encrypted AIMEAT backup", &["age"])
            .set_file_name(format!("aimeat-desktop-{}.zip.age", chrono::Utc::now().format("%Y%m%d-%H%M%S")))
            .blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| format!("Choose a local backup file: {e}"))?;
        node_manager::with_stopped_node(&app, |root| {
            let manifest = backup_archive::create_encrypted(root, &path, env!("CARGO_PKG_VERSION"), &password)?;
            let mut report = report(&path, manifest, true);
            remember(root, &mut report);
            Ok(Some(report))
        })
    }).await.map_err(|e| format!("Backup task failed: {e}"))?
}

#[tauri::command]
pub async fn inspect_backup(app: AppHandle, lang: Option<String>, ticket: Option<String>, password: Option<String>) -> Result<Option<BackupPreview>, String> {
    let password = password.map(backup_archive::SecretString::from);
    tauri::async_runtime::spawn_blocking(move || {
        let pending = if let Some(ticket) = ticket {
            // The frontend can refer only to a native selection, never provide an arbitrary path.
            let selection = PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")?;
            let pending = selection.as_ref().ok_or("Choose a backup before entering its password.")?;
            validate_ticket(pending, &ticket)?;
            pending.clone()
        } else {
            // A new selection invalidates any older confirmation, including after cancellation.
            *PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")? = None;
            let title = if lang.as_deref() == Some("fi") { "Valitse palautettava AIMEAT-varmuuskopio" } else { "Choose AIMEAT backup to restore" };
            let selected = app.dialog().file().set_title(title)
                .add_filter("AIMEAT backup", &["age", "zip"]).blocking_pick_file();
            let Some(selected) = selected else { return Ok(None); };
            let path = selected.into_path().map_err(|e| format!("Choose a local backup file: {e}"))?;
            let pending = PendingRestore {
                ticket: backup_archive::random_id()?,
                sha256: backup_archive::archive_digest(&path)?,
                encrypted: backup_archive::is_encrypted(&path)?,
                path, selected_at: Instant::now(), inspected: false,
            };
            *PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")? = Some(pending.clone());
            pending
        };
        if pending.encrypted && password.is_none() {
            return Ok(Some(BackupPreview {
                ticket: pending.ticket, path: pending.path.to_string_lossy().into_owned(),
                encrypted: true, password_required: true,
                created_at: None, desktop_version: None, files: None, total_bytes: None,
            }));
        }
        if backup_archive::archive_digest(&pending.path)? != pending.sha256 {
            return Err("The selected backup changed. Choose it again before restoring.".into());
        }
        let manifest = backup_archive::inspect_with_password(&pending.path, password.as_ref())?;
        if backup_archive::archive_digest(&pending.path)? != pending.sha256 {
            return Err("The backup changed during inspection. Select it again.".into());
        }
        let preview = BackupPreview {
            ticket: pending.ticket.clone(), path: pending.path.to_string_lossy().into_owned(),
            encrypted: pending.encrypted, password_required: false,
            created_at: Some(manifest.created_at), desktop_version: Some(manifest.desktop_version),
            files: Some(manifest.files.len()), total_bytes: Some(manifest.total_bytes),
        };
        let mut selection = PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")?;
        let selected = selection.as_mut().ok_or("The backup selection was cancelled.")?;
        validate_ticket(selected, &pending.ticket)?;
        selected.inspected = true;
        Ok(Some(preview))
    }).await.map_err(|e| format!("Backup inspection failed: {e}"))?
}

#[tauri::command]
pub async fn restore_backup(app: AppHandle, ticket: String, confirmed: bool, password: Option<String>) -> Result<BackupReport, String> {
    let password = password.map(backup_archive::SecretString::from);
    if !confirmed { return Err("Confirm replacement of the current Desktop data before restoring.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let pending = {
            let mut selection = PENDING_RESTORE.lock().map_err(|_| "Restore selection is unavailable")?;
            let pending = selection.as_ref().ok_or("Choose and inspect a backup before restoring.")?;
            validate_ticket(pending, &ticket)?;
            if !pending.inspected { return Err("Inspect the backup before confirming restoration.".into()); }
            selection.take().ok_or("Choose a backup before restoring.")?
        };
        node_manager::with_stopped_node(&app, |root| {
            let (manifest, recovery) = backup_archive::restore_encrypted(root, &pending.path, &pending.sha256, password.as_ref())?;
            let mut report = report(&pending.path, manifest, pending.encrypted);
            report.recovery_path = Some(recovery.to_string_lossy().into_owned());
            remember(root, &mut report);
            Ok(report)
        })
    }).await.map_err(|e| format!("Restore task failed: {e}"))?
}

fn validate_ticket(pending: &PendingRestore, ticket: &str) -> Result<(), String> {
    if pending.ticket != ticket || pending.selected_at.elapsed() > Duration::from_secs(600) {
        return Err("The restore confirmation has expired. Choose the backup again.".into());
    }
    Ok(())
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
