use super::*;

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        let mut random = [0u8; 12];
        getrandom::getrandom(&mut random).unwrap();
        let name = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
        Self(std::env::temp_dir().join(format!("aimeat-preferences-test-{name}")))
    }
}
impl Drop for Directory {
    fn drop(&mut self) { if self.0.exists() { std::fs::remove_dir_all(&self.0).unwrap(); } }
}

#[test]
fn first_launch_never_opts_into_background_login_or_local_node_start() {
    let root = Directory::new();
    let preferences = read_preferences(&root.0).unwrap();
    assert!(!preferences.keep_running_on_close);
    assert!(!preferences.start_at_login);
    assert!(!preferences.start_local_node);
    assert_eq!(preferences.backup_reminder_days, 7);
    assert!(!root.0.exists());
}

#[test]
fn choices_survive_reload_without_creating_or_changing_core_configuration() {
    let root = Directory::new();
    std::fs::create_dir_all(&root.0).unwrap();
    let untouched = b"AIMEAT_AI_ENDPOINT=kept\nAIMEAT_ENCRYPTION_KEY=existing\n";
    std::fs::write(root.0.join(".env"), untouched).unwrap();
    let preferences = DesktopPreferences { keep_running_on_close: true, start_at_login: false,
        start_local_node: true, language: Language::Fi, backup_reminder_days: 30 };
    write_preferences(&root.0, &preferences).unwrap();
    assert_eq!(read_preferences(&root.0).unwrap(), preferences);
    assert_eq!(std::fs::read(root.0.join(".env")).unwrap(), untouched);
    let changed = DesktopPreferences { start_local_node: false, ..preferences };
    write_preferences(&root.0, &changed).unwrap();
    assert_eq!(read_preferences(&root.0).unwrap(), changed);
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 2);
}

#[test]
fn malformed_and_oversized_preferences_are_visible_errors() {
    let root = Directory::new();
    std::fs::create_dir_all(&root.0).unwrap();
    let path = root.0.join(FILE_NAME);
    std::fs::write(&path, b"{broken").unwrap();
    assert!(read_preferences(&root.0).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"{broken");
    std::fs::write(&path, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
    assert!(read_preferences(&root.0).unwrap_err().contains("too large"));
}

#[test]
fn invalid_reminders_and_languages_cannot_be_saved() {
    let root = Directory::new();
    let preferences = DesktopPreferences { backup_reminder_days: 1, ..Default::default() };
    assert!(write_preferences(&root.0, &preferences).is_err());
    assert!(!root.0.exists());
    assert!(serde_json::from_str::<DesktopPreferences>(r#"{"language":"xx"}"#).is_err());
}
