//! Standard age passphrase envelopes around the portable Desktop ZIP format.
pub use age::secrecy::SecretString;
use age::secrecy::ExposeSecret;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Mutex;

const AGE_PREFIX: &[u8] = b"age-encryption.org/v1\n";
const MAX_HEADER: usize = 4096;
// age scrypt uses r=8, p=1: N=2^18 bounds its working memory to about 256 MiB.
// Serialize key derivation so parallel IPC calls cannot multiply that allocation.
const WORK_FACTOR: u8 = 18;
static KEY_DERIVATION: Mutex<()> = Mutex::new(());
const DECRYPT_ERROR: &str = "BACKUP_PASSWORD_INVALID";

pub fn validate_password(password: &SecretString, creating: bool) -> Result<(), String> {
    let value = password.expose_secret();
    if value.len() > 1024 { return Err("BACKUP_PASSWORD_LENGTH".into()); }
    if value.is_empty() || (creating && (value.chars().count() < 12 || value.trim().is_empty())) {
        return Err("BACKUP_PASSWORD_LENGTH".into());
    }
    Ok(())
}

pub fn encrypted(path: &Path) -> Result<bool, String> {
    let metadata = super::regular_metadata(path)?;
    if !metadata.is_file() || metadata.len() > super::MAX_ARCHIVE {
        return Err("BACKUP_TOO_LARGE".into());
    }
    let mut file = File::open(path).map_err(|e| super::io_error("Cannot open backup", e))?;
    let mut prefix = [0; AGE_PREFIX.len()];
    let read = file.read(&mut prefix).map_err(|e| super::io_error("Cannot read backup", e))?;
    Ok(read == AGE_PREFIX.len() && prefix == AGE_PREFIX)
}

/// Bound attacker-controlled header bytes before asking age to allocate its stanza index.
/// age itself validates the grammar, single scrypt recipient, header MAC and ciphertext.
fn bounded_header(file: &mut BufReader<File>) -> Result<(), String> {
    let mut total = 0;
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = file.by_ref().take((MAX_HEADER + 1 - total) as u64)
            .read_until(b'\n', &mut line).map_err(|_| DECRYPT_ERROR)?;
        total += read;
        if total > MAX_HEADER { return Err("BACKUP_TOO_LARGE".into()); }
        if read == 0 || !line.ends_with(b"\n") { return Err(DECRYPT_ERROR.into()); }
        if line.starts_with(b"--- ") { break; }
    }
    file.seek(SeekFrom::Start(0)).map_err(|e| super::io_error("Cannot read encrypted backup", e))?;
    Ok(())
}

pub enum ArchiveReader {
    Plain(File),
    Encrypted(Box<age::stream::StreamReader<BufReader<File>>>),
}
impl Read for ArchiveReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        match self { Self::Plain(file) => file.read(bytes), Self::Encrypted(file) => file.read(bytes) }
    }
}
impl Seek for ArchiveReader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        match self { Self::Plain(file) => file.seek(position), Self::Encrypted(file) => file.seek(position) }
    }
}

pub fn reader(path: &Path, password: Option<&SecretString>) -> Result<ArchiveReader, String> {
    let is_encrypted = encrypted(path)?;
    let file = File::open(path).map_err(|e| super::io_error("Cannot open backup", e))?;
    if !is_encrypted { return Ok(ArchiveReader::Plain(file)); }
    let password = password.ok_or("BACKUP_PASSWORD_REQUIRED")?;
    validate_password(password, false)?;
    let mut file = BufReader::new(file);
    bounded_header(&mut file)?;
    let decryptor = age::Decryptor::new_buffered(file).map_err(|_| DECRYPT_ERROR)?;
    if !decryptor.is_scrypt() { return Err("BACKUP_UNSUPPORTED".into()); }
    let mut reader = {
        let _guard = KEY_DERIVATION.lock().map_err(|_| "Backup encryption is unavailable.")?;
        let mut identity = age::scrypt::Identity::new(password.clone());
        identity.set_max_work_factor(WORK_FACTOR);
        decryptor.decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|error| match error {
                age::DecryptError::ExcessiveWork { .. } => "BACKUP_TOO_LARGE",
                _ => DECRYPT_ERROR,
            })?
    };
    // Authenticate every block, including the final marker, before any restore staging write.
    // ZIP seeks alone can skip padding; corrupt encrypted padding must still be refused.
    super::stream_hash(&mut reader, io::sink(), super::MAX_ARCHIVE).map_err(|_| DECRYPT_ERROR)?;
    reader.seek(SeekFrom::Start(0)).map_err(|_| DECRYPT_ERROR)?;
    Ok(ArchiveReader::Encrypted(Box::new(reader)))
}

pub struct BoundedOutput { file: File, written: u64 }
impl Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.written.checked_add(bytes.len() as u64).is_none_or(|n| n > super::MAX_ARCHIVE) {
            return Err(io::Error::other("The encrypted backup exceeds its size limit."));
        }
        let count = self.file.write(bytes)?;
        self.written += count as u64;
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> { self.file.flush() }
}
impl BoundedOutput {
    pub fn sync_all(&self) -> io::Result<()> { self.file.sync_all() }
}

pub fn writer(file: File, password: &SecretString) -> Result<age::stream::StreamWriter<BoundedOutput>, String> {
    validate_password(password, true)?;
    let encryptor = {
        let _guard = KEY_DERIVATION.lock().map_err(|_| "Backup encryption is unavailable.")?;
        let mut recipient = age::scrypt::Recipient::new(password.clone());
        recipient.set_work_factor(WORK_FACTOR);
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| "Cannot initialize backup encryption.")?
    };
    encryptor.wrap_output(BoundedOutput { file, written: 0 })
        .map_err(|e| super::io_error("Cannot write encrypted backup", e))
}

pub enum ArchiveOutput {
    Plain(File),
    Encrypted(Box<age::stream::StreamWriter<BoundedOutput>>),
}
impl Write for ArchiveOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self { Self::Plain(file) => file.write(bytes), Self::Encrypted(file) => file.write(bytes) }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self { Self::Plain(file) => file.flush(), Self::Encrypted(file) => file.flush() }
    }
}
impl ArchiveOutput {
    pub fn finish(self) -> io::Result<()> {
        match self {
            Self::Plain(file) => file.sync_all(),
            Self::Encrypted(file) => (*file).finish()?.sync_all(),
        }
    }
}
