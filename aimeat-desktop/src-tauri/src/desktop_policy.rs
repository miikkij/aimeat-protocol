// Desktop-only lifecycle decisions and the OS-autostart/settings transaction.

pub fn hide_on_close(keep_running: bool, quitting: bool) -> bool {
    keep_running && !quitting
}

/// A failed OS change or settings write must never be reported as a successful preference save.
pub fn save_with_autostart(
    requested: bool,
    available: bool,
    read: impl FnOnce() -> Result<bool, String>,
    mut change: impl FnMut(bool) -> Result<(), String>,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if !available {
        if requested {
            return Err("[AUTOSTART_UNAVAILABLE] Login startup cannot be changed from an isolated review profile.".into());
        }
        return save();
    }
    let previous = read()?;
    if previous == requested { return save(); }
    if let Err(error) = change(requested) {
        // The OS may have applied part of a failed operation. Restore the observed state.
        return match change(previous) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error} The previous login setting could not be restored: {rollback}")),
        };
    }
    if let Err(error) = save() {
        return match change(previous) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error} The previous login setting could not be restored: {rollback}")),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn only_an_explicit_background_choice_hides_a_normal_close() {
        assert!(!hide_on_close(false, false));
        assert!(hide_on_close(true, false));
        assert!(!hide_on_close(true, true));
    }

    #[test]
    fn isolated_profiles_cannot_read_or_change_os_autostart() {
        let saved = Cell::new(false);
        let result = save_with_autostart(true, false,
            || panic!("An isolated profile must not inspect the real login registration"),
            |_| panic!("An isolated profile must not change the real login registration"),
            || { saved.set(true); Ok(()) });
        assert!(result.is_err());
        assert!(!saved.get());
        save_with_autostart(false, false, || panic!(), |_| panic!(), || Ok(())).unwrap();
    }

    #[test]
    fn an_os_failure_does_not_commit_the_preference() {
        let saved = Cell::new(false);
        let result = save_with_autostart(true, true, || Ok(false),
            |enabled| if enabled { Err("registration refused".into()) } else { Ok(()) },
            || { saved.set(true); Ok(()) });
        assert!(result.unwrap_err().contains("registration refused"));
        assert!(!saved.get());
    }

    #[test]
    fn a_failed_atomic_save_restores_the_previous_os_setting() {
        let current = Cell::new(false);
        let changes = RefCell::new(Vec::new());
        let result = save_with_autostart(true, true, || Ok(current.get()),
            |enabled| { changes.borrow_mut().push(enabled); current.set(enabled); Ok(()) },
            || Err("disk is full".into()));
        assert!(result.unwrap_err().contains("disk is full"));
        assert_eq!(*changes.borrow(), vec![true, false]);
        assert!(!current.get());
    }

    #[test]
    fn a_failed_rollback_is_reported_with_the_failed_save() {
        let result = save_with_autostart(true, true, || Ok(false),
            |enabled| if enabled { Ok(()) } else { Err("rollback denied".into()) },
            || Err("rename refused".into()));
        let message = result.unwrap_err();
        assert!(message.contains("rename refused"));
        assert!(message.contains("rollback denied"));
    }

    #[test]
    fn an_unchanged_login_setting_does_not_rewrite_os_registration() {
        save_with_autostart(true, true, || Ok(true), |_| panic!(), || Ok(())).unwrap();
    }
}
