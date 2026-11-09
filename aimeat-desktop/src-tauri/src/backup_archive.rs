// AIMEAT Desktop backup format and filesystem operations. The command layer supplies only the
// app-managed data root, while the process manager holds its stopped-node lock.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

const FORMAT: &str = "aimeat.desktop-backup";
const MANIFEST: &str = "aimeat-backup.json";
const MAX_ENTRIES: usize = 100_000;
const MAX_MANIFEST: u64 = 8 * 1024 * 1024;
const MAX_FILE: u64 = 32 * 1024 * 1024 * 1024;
const MAX_TOTAL: u64 = 100 * 1024 * 1024 * 1024;
const MAX_ARCHIVE: u64 = MAX_TOTAL + 1024 * 1024 * 1024;
const MAX_ENV: u64 = 1024 * 1024;
const MAX_CENTRAL_DIRECTORY: u64 = 128 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub created_at: String,
    pub desktop_version: String,
    pub files: Vec<BackupFile>,
    pub directories: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

fn io_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("{action}: {error}")
}

pub fn random_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|e| io_error("Cannot create a secure operation ID", e))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn regular_metadata(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| io_error("Cannot inspect backup data", e))?;
    #[allow(unused_mut)]
    let mut linked = metadata.file_type().is_symlink();
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junctions and other reparse points can redirect reads outside the managed folder.
        linked |= metadata.file_attributes() & 0x400 != 0;
    }
    if linked || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(format!("Linked or special files cannot be backed up: {}", path.display()));
    }
    Ok(metadata)
}

/// Restrict a newly created empty object before writing keys into it. All extracted children
/// inherit the private Windows directory ACL; Unix permissions are set at creation as well.
fn make_private(path: &Path, directory: bool) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }))
            .map_err(|e| io_error("Cannot protect backup permissions", e))?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32");
        let output = Command::new(system.join("whoami.exe"))
            .args(["/user", "/fo", "csv", "/nh"]).creation_flags(0x08000000)
            .output().map_err(|e| io_error("Cannot determine backup owner", e))?;
        let owner_output = String::from_utf8_lossy(&output.stdout);
        let sid = owner_output.trim().rsplit(',').next().unwrap_or("").trim_matches('"');
        if !output.status.success() || !sid.starts_with("S-1-")
            || !sid.bytes().all(|c| c.is_ascii_digit() || c == b'S' || c == b'-')
        {
            return Err("Cannot determine the Windows account for private backup permissions.".into());
        }
        let grant = format!("*{sid}:{}", if directory { "(OI)(CI)F" } else { "F" });
        let output = Command::new(system.join("icacls.exe"))
            .arg(path).args(["/inheritance:r", "/grant:r", &grant, "/q"])
            .creation_flags(0x08000000).output()
            .map_err(|e| io_error("Cannot protect backup permissions", e))?;
        if !output.status.success() {
            return Err("Cannot make this backup private. Choose a local drive that supports Windows file permissions.".into());
        }
    }
    Ok(())
}

fn new_file(path: &Path, restrict_acl: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true).read(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|e| io_error("Cannot create backup file (existing files are never overwritten)", e))?;
    if restrict_acl {
        if let Err(error) = make_private(path, false) {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(error);
        }
    }
    Ok(file)
}

fn new_directory(path: &Path, restrict_acl: bool) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|e| io_error("Cannot create private restore folder", e))?;
    if restrict_acl {
        if let Err(error) = make_private(path, true) {
            let _ = fs::remove_dir(path);
            return Err(error);
        }
    }
    Ok(())
}

fn valid_relative(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 1024 || path.contains('\\') || path.contains(':')
        || path.chars().any(char::is_control)
    {
        return Err("The backup contains an unsafe file path.".into());
    }
    for part in path.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if part.is_empty() || matches!(part, "." | "..") || part.ends_with(['.', ' '])
            || part.contains(['<', '>', '"', '|', '?', '*']) || reserved
        {
            return Err("The backup contains an unsafe or nonportable file path.".into());
        }
    }
    Ok(())
}

fn managed_root(root: &Path) -> Result<PathBuf, String> {
    if !root.is_absolute() || !regular_metadata(root)?.is_dir() {
        return Err("Desktop data must be an existing absolute directory.".into());
    }
    let root = fs::canonicalize(root).map_err(|e| io_error("Cannot resolve Desktop data folder", e))?;
    if root.parent().is_none() || root.file_name().is_none() {
        return Err("A filesystem root cannot be replaced by a backup.".into());
    }
    Ok(root)
}

fn configured_database(root: &Path) -> Result<PathBuf, String> {
    let env_path = root.join(".env");
    let metadata = regular_metadata(&env_path)?;
    if !metadata.is_file() || metadata.len() > MAX_ENV { return Err("Desktop settings are missing or too large.".into()); }
    let contents = fs::read_to_string(&env_path).map_err(|e| io_error("Cannot read Desktop settings", e))?;
    let values = crate::node_manager::parse_env(&contents);
    if values.get("AIMEAT_STORAGE").map(String::as_str) != Some("sqlite") {
        return Err("Complete Desktop backup requires the local SQLite database.".into());
    }
    let configured = values.get("AIMEAT_SQLITE_PATH").map(String::as_str).unwrap_or("./data/aimeat.db");
    let relative = configured.strip_prefix("./").unwrap_or(configured);
    valid_relative(relative).map_err(|_| "The SQLite database must be inside the Desktop data folder.".to_string())?;
    Ok(root.join(relative))
}

fn local_database(root: &Path) -> Result<(), String> {
    let database = configured_database(root)?;
    if !regular_metadata(&database)?.is_file() {
        return Err("The Desktop SQLite database does not exist yet.".into());
    }
    let actual = fs::canonicalize(&database).map_err(|e| io_error("Cannot locate Desktop database", e))?;
    if !actual.starts_with(root) { return Err("The SQLite database is outside the Desktop data folder.".into()); }
    let mut header = [0_u8; 16];
    File::open(database).and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| "The Desktop database is not an initialized SQLite file.")?;
    if header != *b"SQLite format 3\0" {
        return Err("The Desktop database is not a SQLite file.".into());
    }
    Ok(())
}

fn stream_hash(mut source: impl Read, mut target: impl Write, limit: u64) -> Result<(u64, String), String> {
    let mut hash = Sha256::new();
    let mut count = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let len = source.read(&mut buffer).map_err(|e| io_error("Cannot read backup data", e))?;
        if len == 0 { break; }
        count = count.checked_add(len as u64).filter(|n| *n <= limit)
            .ok_or("The backup exceeds its allowed size.")?;
        hash.update(&buffer[..len]);
        target.write_all(&buffer[..len]).map_err(|e| io_error("Cannot write backup data", e))?;
    }
    Ok((count, format!("{:x}", hash.finalize())))
}

pub fn archive_digest(path: &Path) -> Result<String, String> {
    let metadata = regular_metadata(path)?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE { return Err("The backup archive is too large or is not a file.".into()); }
    let file = File::open(path).map_err(|e| io_error("Cannot open backup", e))?;
    Ok(stream_hash(file, std::io::sink(), MAX_ARCHIVE)?.1)
}

fn inventory(root: &Path, current: &Path, files: &mut Vec<(String, u64)>, directories: &mut Vec<String>) -> Result<(), String> {
    let mut entries = fs::read_dir(current).map_err(|e| io_error("Cannot list Desktop data", e))?
        .collect::<Result<Vec<_>, _>>().map_err(|e| io_error("Cannot list Desktop data", e))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if files.len() + directories.len() >= MAX_ENTRIES { return Err("There are too many files for one Desktop backup.".into()); }
        let path = entry.path();
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?
            .to_str().ok_or("A filename is not valid UTF-8.")?.replace('\\', "/");
        valid_relative(&relative)?;
        let metadata = regular_metadata(&path)?;
        if metadata.is_dir() {
            directories.push(relative);
            inventory(root, &path, files, directories)?;
        } else {
            if metadata.len() > MAX_FILE { return Err("A file exceeds the 32 GiB Desktop backup limit.".into()); }
            files.push((relative, metadata.len()));
        }
    }
    Ok(())
}

pub fn create(root: &Path, destination: &Path, version: &str) -> Result<BackupManifest, String> {
    let root = managed_root(root)?;
    local_database(&root)?;
    let parent = destination.parent().ok_or("Choose a backup destination folder.")?;
    let parent = fs::canonicalize(parent).map_err(|e| io_error("Cannot resolve backup destination", e))?;
    if parent.starts_with(&root) { return Err("Save the backup outside the Desktop data folder.".into()); }
    let destination = parent.join(destination.file_name().ok_or("Choose a backup filename.")?);
    let mut source_files = Vec::new();
    let mut directories = Vec::new();
    inventory(&root, &root, &mut source_files, &mut directories)?;
    let total_bytes = source_files.iter().try_fold(0_u64, |sum, (_, len)| sum.checked_add(*len))
        .filter(|total| *total <= MAX_TOTAL).ok_or("Desktop data exceeds the 100 GiB backup limit.")?;
    let destination_file = new_file(&destination, true)?;
    let result = (|| {
        let mut writer = zip::ZipWriter::new(destination_file);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600).large_file(true);
        for directory in &directories {
            writer.add_directory(format!("data/{directory}/"), SimpleFileOptions::default().unix_permissions(0o700))
                .map_err(|e| io_error("Cannot archive a folder", e))?;
        }
        let mut files = Vec::with_capacity(source_files.len());
        for (relative, expected_size) in &source_files {
            let path = root.join(relative);
            regular_metadata(&path)?;
            let source = File::open(&path).map_err(|e| io_error("Cannot open Desktop data", e))?;
            writer.start_file(format!("data/{relative}"), options).map_err(|e| io_error("Cannot archive a file", e))?;
            let (bytes, sha256) = stream_hash(source, &mut writer, *expected_size)?;
            if bytes != *expected_size { return Err("Desktop data changed during backup. Stop the node and try again.".into()); }
            files.push(BackupFile { path: relative.clone(), bytes, sha256 });
        }
        let manifest = BackupManifest {
            format: FORMAT.into(), version: 1, created_at: chrono::Utc::now().to_rfc3339(),
            desktop_version: version.into(), files, directories, total_bytes,
        };
        let bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_MANIFEST { return Err("The backup file list is too large.".into()); }
        writer.start_file(MANIFEST, options).map_err(|e| io_error("Cannot write backup manifest", e))?;
        writer.write_all(&bytes).map_err(|e| io_error("Cannot write backup manifest", e))?;
        let file = writer.finish().map_err(|e| io_error("Cannot finish backup", e))?;
        file.sync_all().map_err(|e| io_error("Cannot save backup to disk", e))?;
        drop(file);
        // A completed backup has been read back and its file checksums verified.
        inspect(&destination)?;
        Ok(manifest)
    })();
    if result.is_err() { let _ = fs::remove_file(&destination); }
    result
}

fn validate_manifest(manifest: &BackupManifest) -> Result<HashMap<String, bool>, String> {
    if manifest.format != FORMAT || manifest.version != 1 {
        return Err("This is not a supported AIMEAT Desktop backup.".into());
    }
    chrono::DateTime::parse_from_rfc3339(&manifest.created_at).map_err(|_| "The backup date is invalid.")?;
    if manifest.files.len() + manifest.directories.len() > MAX_ENTRIES || manifest.total_bytes > MAX_TOTAL {
        return Err("The backup exceeds Desktop restore limits.".into());
    }
    let mut expected = HashMap::new();
    let mut aliases = HashSet::new();
    for (path, directory) in manifest.files.iter().map(|file| (&file.path, false))
        .chain(manifest.directories.iter().map(|directory| (directory, true)))
    {
        valid_relative(path)?;
        if !aliases.insert(path.to_lowercase()) { return Err("The backup contains duplicate or conflicting file paths.".into()); }
        expected.insert(format!("data/{path}{}", if directory { "/" } else { "" }), directory);
    }
    let directory_names: HashSet<String> = manifest.directories.iter().map(|path| path.to_lowercase()).collect();
    for path in aliases.iter() {
        let mut ancestor = path.as_str();
        while let Some((parent, _)) = ancestor.rsplit_once('/') {
            if !directory_names.contains(parent) {
                return Err("A backup file has a missing or conflicting parent folder.".into());
            }
            ancestor = parent;
        }
    }
    let mut sum = 0_u64;
    for file in &manifest.files {
        if file.bytes > MAX_FILE || file.sha256.len() != 64 || !file.sha256.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("A backup file has an invalid size or checksum.".into());
        }
        sum = sum.checked_add(file.bytes).filter(|n| *n <= MAX_TOTAL).ok_or("The backup is too large.")?;
    }
    if sum != manifest.total_bytes || !manifest.files.iter().any(|file| file.path == ".env") {
        return Err("The backup is incomplete or its file totals are invalid.".into());
    }
    Ok(expected)
}

/// Bound ZIP metadata before the ZIP library allocates its central-directory index. Payload
/// limits alone do not stop an archive that advertises millions of empty files. The count also
/// detects duplicate names that an archive library's map could otherwise silently collapse.
fn directory_entry_count(file: &mut File) -> Result<usize, String> {
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    let tail_len = length.min(65_557) as usize;
    file.seek(SeekFrom::End(-(tail_len as i64))).map_err(|e| e.to_string())?;
    let mut tail = vec![0; tail_len];
    file.read_exact(&mut tail).map_err(|e| e.to_string())?;
    let end = (0..tail_len.saturating_sub(21)).rev().find(|&at| {
        tail[at..at + 4] == *b"PK\x05\x06"
            && at + 22 + u16::from_le_bytes([tail[at + 20], tail[at + 21]]) as usize == tail_len
    }).ok_or("The ZIP directory is missing or has trailing data.")?;
    let u16_at = |at: usize| u16::from_le_bytes(tail[at..at + 2].try_into().unwrap());
    let u32_at = |at: usize| u32::from_le_bytes(tail[at..at + 4].try_into().unwrap());
    if u16_at(end + 4) != 0 || u16_at(end + 6) != 0 || u16_at(end + 8) != u16_at(end + 10) {
        return Err("Multi-disk backups are not supported.".into());
    }
    let mut count = u64::from(u16_at(end + 10));
    let mut size = u64::from(u32_at(end + 12));
    let mut offset = u64::from(u32_at(end + 16));
    let mut directory_end = length - tail_len as u64 + end as u64;
    if count == 0xffff || size == 0xffff_ffff || offset == 0xffff_ffff {
        if end < 20 || tail[end - 20..end - 16] != *b"PK\x06\x07"
            || u32_at(end - 16) != 0 || u32_at(end - 4) != 1
        { return Err("The ZIP64 backup directory is invalid.".into()); }
        let zip64_offset = u64::from_le_bytes(tail[end - 12..end - 4].try_into().unwrap());
        if zip64_offset.checked_add(56).is_none_or(|end64| end64 > directory_end - 20) {
            return Err("The ZIP64 directory is outside the archive.".into());
        }
        file.seek(SeekFrom::Start(zip64_offset)).map_err(|e| e.to_string())?;
        let mut record = [0; 56];
        file.read_exact(&mut record).map_err(|e| e.to_string())?;
        let u64_at = |at: usize| u64::from_le_bytes(record[at..at + 8].try_into().unwrap());
        if record[..4] != *b"PK\x06\x06" || u64_at(4) < 44 || u64_at(4) > 1024 * 1024
            || record[16..24] != [0; 8] || u64_at(24) != u64_at(32)
        { return Err("The ZIP64 backup directory is invalid.".into()); }
        count = u64_at(32);
        size = u64_at(40);
        offset = u64_at(48);
        directory_end = zip64_offset;
    }
    if count > (MAX_ENTRIES + 1) as u64 || size > MAX_CENTRAL_DIRECTORY
        || offset.checked_add(size).is_none_or(|end| end > directory_end)
    { return Err("The ZIP directory exceeds safe backup limits.".into()); }
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    Ok(count as usize)
}

fn open_archive(path: &Path) -> Result<(zip::ZipArchive<File>, BackupManifest), String> {
    let metadata = regular_metadata(path)?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE { return Err("The backup archive exceeds the supported size.".into()); }
    let mut file = File::open(path).map_err(|e| io_error("Cannot open backup", e))?;
    let entry_count = directory_entry_count(&mut file)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| io_error("Cannot read backup archive", e))?;
    if archive.len() != entry_count { return Err("The backup contains duplicate or inconsistent entries.".into()); }
    let mut names = HashMap::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| io_error("Cannot read backup entry", e))?;
        let name = entry.name().map_err(|e| io_error("Cannot read backup filename", e))?.into_owned();
        valid_relative(name.trim_end_matches('/'))?;
        let kind = entry.unix_mode().unwrap_or(0) & 0o170000;
        if entry.is_symlink() || (kind != 0 && kind != if entry.is_dir() { 0o040000 } else { 0o100000 })
            || entry.encrypted() || !matches!(entry.compression(), zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated)
        {
            return Err("Encrypted, linked, special or unsupported backup entries are not accepted.".into());
        }
        if entry.size() > MAX_FILE || (entry.size() > 1024 * 1024 && entry.size() / entry.compressed_size().max(1) > 2000) {
            return Err("A backup entry exceeds the safe extraction limits.".into());
        }
        total = total.checked_add(entry.size()).filter(|n| *n <= MAX_TOTAL + MAX_MANIFEST).ok_or("The backup expands beyond the allowed size.")?;
        if entry.is_dir() && entry.size() != 0 { return Err("A backup folder contains unexpected data.".into()); }
        if names.insert(name, entry.is_dir()).is_some() { return Err("The backup contains duplicate entries.".into()); }
    }
    let manifest = {
        let entry = archive.by_name(MANIFEST).map_err(|_| "The AIMEAT Desktop backup manifest is missing.")?;
        if entry.is_dir() || entry.size() > MAX_MANIFEST { return Err("The backup manifest is invalid or too large.".into()); }
        let mut bytes = Vec::new();
        entry.take(MAX_MANIFEST + 1).read_to_end(&mut bytes).map_err(|e| io_error("Cannot read backup manifest", e))?;
        if bytes.len() as u64 > MAX_MANIFEST { return Err("The backup manifest is too large.".into()); }
        serde_json::from_slice::<BackupManifest>(&bytes).map_err(|e| io_error("Invalid backup manifest", e))?
    };
    let mut expected = validate_manifest(&manifest)?;
    expected.insert(MANIFEST.into(), false);
    if names != expected { return Err("The archive contents do not match the backup manifest.".into()); }
    Ok((archive, manifest))
}

fn read_payload(archive: &mut zip::ZipArchive<File>, manifest: &BackupManifest, destination: Option<&Path>) -> Result<(), String> {
    if let Some(root) = destination {
        let mut directories = manifest.directories.clone();
        directories.sort();
        for directory in directories { new_directory(&root.join(directory), false)?; }
    }
    for file in &manifest.files {
        let entry = archive.by_name(&format!("data/{}", file.path)).map_err(|e| io_error("Cannot read backed-up file", e))?;
        if entry.size() != file.bytes { return Err("A backup file size does not match its manifest.".into()); }
        let (bytes, hash) = if let Some(root) = destination {
            let mut target = new_file(&root.join(&file.path), false)?;
            let result = stream_hash(entry, &mut target, file.bytes)?;
            target.sync_all().map_err(|e| io_error("Cannot save restored data", e))?;
            result
        } else { stream_hash(entry, std::io::sink(), file.bytes)? };
        if bytes != file.bytes || hash != file.sha256.to_ascii_lowercase() {
            return Err("A backup file failed its checksum. Current Desktop data has not been replaced.".into());
        }
    }
    Ok(())
}

pub fn inspect(archive: &Path) -> Result<BackupManifest, String> {
    let (mut archive, manifest) = open_archive(archive)?;
    read_payload(&mut archive, &manifest, None)?;
    Ok(manifest)
}

/// Removes only a private staging folder created by this operation; never follows a link.
struct Stage(PathBuf);
impl Drop for Stage {
    fn drop(&mut self) {
        if self.0.file_name().is_some_and(|name| name.to_string_lossy().starts_with(".aimeat-restore-"))
            && regular_metadata(&self.0).is_ok_and(|metadata| metadata.is_dir())
        {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

pub fn restore_verified(root: &Path, archive: &Path, expected_digest: &str) -> Result<(BackupManifest, PathBuf), String> {
    let root = managed_root(root)?;
    // A restore must work when the old database is damaged or missing. The managed root's
    // Desktop configuration identifies the target; only the replacement needs a valid DB.
    configured_database(&root)?;
    // Check the archive structure before creating any staging files.
    open_archive(archive)?;
    let parent = root.parent().ok_or("The Desktop data folder has no parent.")?;
    let id = random_id()?;
    let stage_path = parent.join(format!(".aimeat-restore-{id}"));
    new_directory(&stage_path, true)?;
    let stage = Stage(stage_path);
    let snapshot = stage.0.join("archive.zip");
    let source = File::open(archive).map_err(|e| io_error("Cannot open selected backup", e))?;
    let mut snapshot_file = new_file(&snapshot, false)?;
    let (_, digest) = stream_hash(source, &mut snapshot_file, MAX_ARCHIVE)?;
    if digest != expected_digest { return Err("The selected backup changed. Choose it again before restoring.".into()); }
    snapshot_file.sync_all().map_err(|e| io_error("Cannot stage backup", e))?;
    drop(snapshot_file);
    let restored = stage.0.join("data");
    new_directory(&restored, true)?;
    let (mut reader, manifest) = open_archive(&snapshot)?;
    read_payload(&mut reader, &manifest, Some(&restored))?;
    drop(reader);
    local_database(&restored)?;
    let recovery = parent.join(format!("{}-recovery-{}-{id}", root.file_name().unwrap().to_string_lossy(), chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    if recovery.exists() { return Err("The recovery folder already exists. Try restoring again.".into()); }
    fs::rename(&root, &recovery).map_err(|e| io_error("Cannot preserve current Desktop data. Close apps using its files and try again", e))?;
    if let Err(error) = fs::rename(&restored, &root) {
        if let Err(rollback) = fs::rename(&recovery, &root) {
            // Keep the validated staged data too when rollback is obstructed externally.
            let stage_path = stage.0.clone();
            std::mem::forget(stage);
            return Err(format!("Restore could not switch data ({error}) or put the old folder back ({rollback}). Original data is safe at {}; staged data is at {}. Keep the node stopped.", recovery.display(), stage_path.display()));
        }
        return Err(io_error("Restore could not switch data; the original Desktop folder has been restored", error));
    }
    Ok((manifest, recovery))
}

#[cfg(test)]
pub fn restore(root: &Path, archive: &Path) -> Result<(BackupManifest, PathBuf), String> {
    restore_verified(root, archive, &archive_digest(archive)?)
}

pub fn write_state(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = match fs::symlink_metadata(path) {
        Ok(_) => {
            if !regular_metadata(path)?.is_file() { return Err("Backup history is not a regular file.".into()); }
            OpenOptions::new().write(true).open(path).map_err(|e| io_error("Cannot open backup history", e))?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => new_file(path, true)?,
        Err(e) => return Err(io_error("Cannot inspect backup history", e)),
    };
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.set_len(bytes.len() as u64).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "backup_archive_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "backup_runtime_smoke.rs"]
mod backup_runtime_smoke;
