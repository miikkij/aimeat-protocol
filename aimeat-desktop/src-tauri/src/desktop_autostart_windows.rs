// Current-user startup only. auto-launch's default mode and disable() also touch HKLM;
// Desktop instead enables CurrentUser explicitly and reads/removes only its HKCU value.
use std::path::Path;
use windows_registry::{Key, CURRENT_USER};

const RUN: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const ENTRY: &str = "AIMEAT Desktop";

fn optional<T>(result: windows_registry::Result<T>) -> Result<Option<T>, String> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code().0 as u32 == 0x80070002 => Ok(None),
        Err(error) => Err(format!("Could not access this account's login startup setting: {error}")),
    }
}

fn command(executable: &Path) -> Result<String, String> {
    if !executable.is_absolute() || !executable.is_file() {
        return Err("The Desktop executable is not available for login startup.".into());
    }
    // Windows paths cannot contain a quote. Explicit quoting also handles Program Files installs.
    Ok(format!("\"{}\" {}", executable.display(), crate::desktop_lifecycle::LOGIN_ARGUMENT))
}

fn registered(root: &Key, name: &str) -> Result<Option<String>, String> {
    optional(root.open(RUN).and_then(|key| key.get_string(name)))
}

fn enabled(name: &str) -> Result<bool, String> {
    if registered(CURRENT_USER, name)?.is_none() { return Ok(false); }
    let approved = optional(CURRENT_USER.open(APPROVED).and_then(|key| key.get_value(name)))?;
    // Task Manager marks disabled entries as 3 (or 7 for a delayed-start entry).
    Ok(!approved.as_ref().is_some_and(|value| matches!(value.first(), Some(3 | 7))))
}

fn remove_current_user(path: &str, name: &str) -> Result<(), String> {
    optional(CURRENT_USER.options().write().open(path).and_then(|key| key.remove_value(name)))?;
    Ok(())
}

fn change(name: &str, executable: &Path, enable: bool) -> Result<(), String> {
    if enable {
        let expected = command(executable)?;
        let quoted_path = format!("\"{}\"", executable.display());
        let launcher = auto_launch::AutoLaunch::new(name, &quoted_path,
            auto_launch::WindowsEnableMode::CurrentUser, &[crate::desktop_lifecycle::LOGIN_ARGUMENT]);
        launcher.enable().map_err(|e| format!("Could not enable login startup for this account: {e}"))?;
        if registered(CURRENT_USER, name)?.as_deref() != Some(&expected) {
            return Err("Windows did not confirm the Desktop startup command.".into());
        }
    } else {
        remove_current_user(RUN, name)?;
    }
    if enabled(name)? != enable { return Err("Windows did not confirm the login startup change.".into()); }
    Ok(())
}

pub fn is_enabled() -> Result<bool, String> { enabled(ENTRY) }

pub fn set_enabled(enable: bool) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    change(ENTRY, &executable, enable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_startup_command_quotes_the_whole_executable_path() {
        let executable = std::env::current_exe().unwrap();
        let value = command(&executable).unwrap();
        assert_eq!(value, format!("\"{}\" --from-autostart", executable.display()));
    }

    struct TestEntry { name: String, expected: String }
    impl TestEntry {
        fn cleanup(&self) -> Result<(), String> {
            if registered(CURRENT_USER, &self.name)?.is_some_and(|value| value != self.expected) {
                return Err("The test entry changed owner; refusing to remove it.".into());
            }
            remove_current_user(RUN, &self.name)?;
            remove_current_user(APPROVED, &self.name)
        }
    }
    impl Drop for TestEntry {
        fn drop(&mut self) { if let Err(error) = self.cleanup() { eprintln!("Autostart test cleanup failed: {error}"); } }
    }

    #[test]
    #[ignore = "requires explicit AIMEAT_DESKTOP_TEST_AUTOSTART=1; creates and removes one unique HKCU test entry"]
    fn windows_autostart_roundtrip_uses_only_a_unique_test_entry() {
        assert_eq!(std::env::var("AIMEAT_DESKTOP_TEST_AUTOSTART").as_deref(), Ok("1"));
        let mut random = [0u8; 16];
        getrandom::getrandom(&mut random).unwrap();
        let suffix = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let name = format!("AIMEAT Desktop test {suffix}");
        // Check the exact random name in both scopes before creating the cleanup guard.
        for root in [CURRENT_USER, windows_registry::LOCAL_MACHINE] {
            for path in [RUN, APPROVED] {
                assert!(optional(root.open(path).and_then(|key| key.get_value(&name))).unwrap().is_none());
            }
        }
        let executable = std::env::current_exe().unwrap();
        let entry = TestEntry { name, expected: command(&executable).unwrap() };
        assert!(!enabled(&entry.name).unwrap());
        change(&entry.name, &executable, true).unwrap();
        assert!(enabled(&entry.name).unwrap());
        assert_eq!(registered(CURRENT_USER, &entry.name).unwrap().as_deref(), Some(entry.expected.as_str()));
        assert!(registered(windows_registry::LOCAL_MACHINE, &entry.name).unwrap().is_none());
        change(&entry.name, &executable, false).unwrap();
        assert!(!enabled(&entry.name).unwrap());
        entry.cleanup().unwrap();
        assert!(optional(CURRENT_USER.open(APPROVED).and_then(|key| key.get_value(&entry.name))).unwrap().is_none());
        println!("Windows current-user startup registration enabled, read back and removed; test metadata removed; no AIMEAT production entry touched.");
    }
}
