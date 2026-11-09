use super::*;
use std::fs;
use std::io::{Read, Write};
use zip::write::SimpleFileOptions;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut id = [0_u8; 12];
        getrandom::getrandom(&mut id).unwrap();
        let id: String = id.iter().map(|b| format!("{b:02x}")).collect();
        let root = std::env::temp_dir().join(format!("aimeat-backup-test-{id}"));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn node(&self) -> PathBuf {
        let root = self.0.join("node");
        fs::create_dir_all(root.join("data/storage/empty")).unwrap();
        fs::write(root.join(".env"), b"AIMEAT_STORAGE=sqlite\nAIMEAT_SQLITE_PATH=./data/aimeat.db\nAIMEAT_ENCRYPTION_KEY=keep-this-key\n").unwrap();
        fs::write(root.join("data/aimeat.db"), b"SQLite format 3\0original database bytes").unwrap();
        fs::write(root.join("data/aimeat.db-wal"), b"write ahead log").unwrap();
        fs::write(root.join("data/storage/tiedot.txt"), "Tallennettu tieto: ääkköset").unwrap();
        root
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // The fixture creates this one random folder and never links anything outside it.
        if self.0.parent() == Some(std::env::temp_dir().as_path())
            && self.0.file_name().unwrap().to_string_lossy().starts_with("aimeat-backup-test-")
        {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

#[test]
fn restoring_a_backup_keeps_keys_database_files_and_empty_folders_together() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("backup.zip");
    let manifest = create(&root, &archive, "0.8.0").unwrap();
    assert_eq!(manifest.files.len(), 4);
    assert_eq!(inspect(&archive).unwrap().total_bytes, manifest.total_bytes);
    fs::write(root.join("data/aimeat.db"), b"SQLite format 3\0newer data").unwrap();
    fs::write(root.join("newer-only.txt"), b"preserve in recovery").unwrap();
    fs::write(root.join(".env"), b"AIMEAT_STORAGE=sqlite\nAIMEAT_ENCRYPTION_KEY=newer-key\n").unwrap();
    let (_, recovery) = restore(&root, &archive).unwrap();
    assert_eq!(fs::read(root.join("data/aimeat.db")).unwrap(), b"SQLite format 3\0original database bytes");
    assert!(fs::read_to_string(root.join(".env")).unwrap().contains("keep-this-key"));
    assert_eq!(fs::read(root.join("data/aimeat.db-wal")).unwrap(), b"write ahead log");
    assert_eq!(fs::read_to_string(root.join("data/storage/tiedot.txt")).unwrap(), "Tallennettu tieto: ääkköset");
    assert!(root.join("data/storage/empty").is_dir());
    assert!(!root.join("newer-only.txt").exists());
    assert_eq!(fs::read(recovery.join("data/aimeat.db")).unwrap(), b"SQLite format 3\0newer data");
    assert_eq!(fs::read(recovery.join("newer-only.txt")).unwrap(), b"preserve in recovery");
    assert!(fs::read_to_string(recovery.join(".env")).unwrap().contains("newer-key"));
}

#[test]
fn a_backup_cannot_be_written_inside_the_data_it_copies_or_over_an_existing_file() {
    let fixture = Fixture::new();
    let root = fixture.node();
    assert!(create(&root, &root.join("backup.zip"), "0.8.0").is_err());
    assert!(!root.join("backup.zip").exists());
    let archive = fixture.0.join("backup.zip");
    fs::write(&archive, b"older backup").unwrap();
    assert!(create(&root, &archive, "0.8.0").is_err());
    assert_eq!(fs::read(&archive).unwrap(), b"older backup");
}

#[test]
fn corrupt_archives_leave_the_current_data_unchanged() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("broken.zip");
    fs::write(&archive, b"not a zip").unwrap();
    assert!(restore(&root, &archive).is_err());
    assert_eq!(fs::read(root.join("data/aimeat.db")).unwrap(), b"SQLite format 3\0original database bytes");
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[test]
fn paths_that_escape_or_alias_other_files_are_refused_before_restore() {
    let fixture = Fixture::new();
    let root = fixture.node();
    for (i, path) in ["../outside", "data/../../outside", "/absolute", "data/C:/outside", "data/a/../b", "data/file:stream", "data/NUL", "data/trailing."].iter().enumerate() {
        let archive = fixture.0.join(format!("bad-{i}.zip"));
        let file = fs::File::create(&archive).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(*path, SimpleFileOptions::default()).unwrap();
        zip.write_all(b"bad").unwrap();
        zip.finish().unwrap();
        assert!(restore(&root, &archive).is_err(), "accepted {path}");
        assert_eq!(fs::read(root.join("data/aimeat.db")).unwrap(), b"SQLite format 3\0original database bytes");
    }
    assert!(!fixture.0.join("outside").exists());
}

#[test]
fn an_external_database_path_cannot_be_called_a_complete_backup() {
    let fixture = Fixture::new();
    let root = fixture.node();
    fs::write(root.join(".env"), b"AIMEAT_STORAGE=sqlite\nAIMEAT_SQLITE_PATH=../other.db\n").unwrap();
    assert!(create(&root, &fixture.0.join("backup.zip"), "0.8.0").is_err());
}

fn archive_entries(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    (0..archive.len()).map(|index| {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().unwrap().into_owned();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        (name, bytes)
    }).collect()
}

fn write_entries(path: &Path, entries: Vec<(String, Vec<u8>)>, symlink: Option<&str>) {
    let mut archive = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        if name.ends_with('/') {
            archive.add_directory(name, SimpleFileOptions::default()).unwrap();
        } else if symlink == Some(name.as_str()) {
            archive.add_symlink(name, "../../outside", SimpleFileOptions::default()).unwrap();
        } else {
            archive.start_file(name, SimpleFileOptions::default()).unwrap();
            archive.write_all(&bytes).unwrap();
        }
    }
    archive.finish().unwrap();
}

fn assert_current_untouched(root: &Path) {
    assert_eq!(fs::read(root.join("data/aimeat.db")).unwrap(), b"SQLite format 3\0original database bytes");
    assert!(fs::read_to_string(root.join(".env")).unwrap().contains("keep-this-key"));
    assert!(fs::read_dir(root.parent().unwrap()).unwrap().all(|entry| {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        !name.starts_with(".aimeat-restore-") && !name.contains("-recovery-")
    }));
}

#[test]
fn valid_manifest_cannot_hide_tampered_or_missing_files_or_symlinks() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let clean = fixture.0.join("clean.zip");
    create(&root, &clean, "0.8.0").unwrap();
    let target = "data/data/storage/tiedot.txt";
    for scenario in ["changed", "missing", "unexpected", "symlink"] {
        let archive = fixture.0.join(format!("{scenario}.zip"));
        let mut entries = archive_entries(&clean);
        match scenario {
            "changed" => entries.iter_mut().find(|(name, _)| name == target).unwrap().1[0] ^= 1,
            "missing" => entries.retain(|(name, _)| name != target),
            "unexpected" => entries.push(("data/unlisted.txt".into(), b"unexpected".to_vec())),
            _ => (),
        }
        write_entries(&archive, entries, (scenario == "symlink").then_some(target));
        let error = restore(&root, &archive).unwrap_err();
        if scenario == "changed" { assert!(error.contains("checksum")); }
        assert_current_untouched(&root);
    }
}

#[test]
fn unsafe_manifest_paths_and_case_aliases_cannot_replace_data() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let clean = fixture.0.join("clean.zip");
    create(&root, &clean, "0.8.0").unwrap();
    for (i, path) in ["../outside", "/absolute", "C:/drive", "file:stream", "NUL.txt", "trailing.", "data\\escape", ".ENV"].iter().enumerate() {
        let archive = fixture.0.join(format!("unsafe-{i}.zip"));
        let mut entries = archive_entries(&clean);
        let (_, bytes) = entries.iter_mut().find(|(name, _)| name == MANIFEST).unwrap();
        let mut manifest: BackupManifest = serde_json::from_slice(bytes).unwrap();
        let file = manifest.files.iter_mut().find(|file| file.path == "data/storage/tiedot.txt").unwrap();
        file.path = path.to_string();
        *bytes = serde_json::to_vec(&manifest).unwrap();
        let (name, _) = entries.iter_mut().find(|(name, _)| name == "data/data/storage/tiedot.txt").unwrap();
        *name = format!("data/{path}");
        write_entries(&archive, entries, None);
        assert!(restore(&root, &archive).is_err(), "accepted unsafe path {path}");
        assert_current_untouched(&root);
    }
    assert!(!fixture.0.join("outside").exists());
}

#[test]
fn oversized_manifest_is_rejected_and_confirmation_identifies_exact_archive() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("backup.zip");
    create(&root, &archive, "0.8.0").unwrap();
    let confirmed_digest = archive_digest(&archive).unwrap();
    assert!(restore_verified(&root, &archive, &"0".repeat(64)).unwrap_err().contains("changed"));
    assert_current_untouched(&root);
    let mut entries = archive_entries(&archive);
    let (_, bytes) = entries.iter_mut().find(|(name, _)| name == MANIFEST).unwrap();
    let mut manifest: BackupManifest = serde_json::from_slice(bytes).unwrap();
    manifest.files[0].bytes = MAX_FILE + 1;
    manifest.total_bytes = MAX_FILE + 1;
    *bytes = serde_json::to_vec(&manifest).unwrap();
    write_entries(&archive, entries, None);
    assert_ne!(archive_digest(&archive).unwrap(), confirmed_digest);
    assert!(restore(&root, &archive).is_err());
    assert_current_untouched(&root);
}

#[test]
fn uninitialized_or_non_sqlite_folder_cannot_be_switched() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("backup.zip");
    create(&root, &archive, "0.8.0").unwrap();
    let unrelated = fixture.0.join("unrelated");
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("personal.txt"), b"keep").unwrap();
    assert!(restore(&unrelated, &archive).is_err());
    assert_eq!(fs::read(unrelated.join("personal.txt")).unwrap(), b"keep");
}

#[test]
fn oversized_zip_directory_is_refused_before_allocating_its_index() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("backup.zip");
    create(&root, &archive, "0.8.0").unwrap();
    let mut bytes = fs::read(&archive).unwrap();
    let end = bytes.windows(4).rposition(|window| window == b"PK\x05\x06").unwrap();
    bytes[end + 12..end + 16].copy_from_slice(&((MAX_CENTRAL_DIRECTORY + 1) as u32).to_le_bytes());
    fs::write(&archive, bytes).unwrap();
    let error = restore(&root, &archive).unwrap_err();
    assert!(error.contains("safe backup limits"));
    assert_current_untouched(&root);
}

#[test]
fn a_damaged_current_database_can_be_recovered_without_discarding_it() {
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("backup.zip");
    create(&root, &archive, "0.8.0").unwrap();
    fs::write(root.join("data/aimeat.db"), b"damaged database").unwrap();
    assert!(create(&root, &fixture.0.join("damaged.zip"), "0.8.0").is_err());
    let (_, recovery) = restore(&root, &archive).unwrap();
    assert_eq!(fs::read(root.join("data/aimeat.db")).unwrap(), b"SQLite format 3\0original database bytes");
    assert_eq!(fs::read(recovery.join("data/aimeat.db")).unwrap(), b"damaged database");
}

#[cfg(unix)]
#[test]
fn backups_and_restored_files_have_owner_only_permissions() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let fixture = Fixture::new();
    let root = fixture.node();
    let archive = fixture.0.join("backup.zip");
    create(&root, &archive, "0.8.0").unwrap();
    assert_eq!(fs::metadata(&archive).unwrap().permissions().mode() & 0o777, 0o600);
    restore(&root, &archive).unwrap();
    assert_eq!(fs::metadata(&root).unwrap().permissions().mode() & 0o777, 0o700);
    assert_eq!(fs::metadata(root.join(".env")).unwrap().permissions().mode() & 0o777, 0o600);
    symlink(&archive, root.join("linked-backup")).unwrap();
    assert!(create(&root, &fixture.0.join("linked.zip"), "0.8.0").is_err());
}
