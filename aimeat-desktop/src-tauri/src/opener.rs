// AIMEAT Desktop — opening a web address in the person's default browser.
//
// EVERY ADDRESS THE APP OPENS OUTSIDE ITS WINDOW COMES THROUGH `open_url`: the help links, the
// portal button, the signed-in hand-off to the portal, and a link in a chat answer. A model writes
// that last one, so an address can hold anything, and every caller is treated the same way.
//
// Two rules hold for every address. It is parsed, only http and https are accepted, and what goes
// on is the parser's own serialisation, checked again: nothing the parser did not understand gets
// through, and nothing outside RFC 3986 reaches the operating system. And it never meets a command
// line: Windows receives it through ShellExecuteW, which opens it with the browser registered for
// http and https, and macOS and Linux receive `open` or `xdg-open` with the address as one argument
// of its own.

use reqwest::Url;
use std::process::Command;

/// Which operating system's opener to plan for. A value rather than `cfg!`, so one test run on
/// any machine can check the plan of all three.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Platform {
    Windows,
    MacOs,
    Other,
}

impl Platform {
    fn current() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOs
        } else {
            Platform::Other
        }
    }
}

/// How an address is handed to the operating system.
#[derive(Debug, PartialEq, Eq)]
enum Launch {
    /// Windows: ShellExecuteW opens the address with the registered browser.
    ShellExecute(String),
    /// Run `program` with `args`, each one argument of its own.
    Program {
        program: &'static str,
        args: Vec<String>,
    },
}

/// Whether an ASCII byte may stand in a URI as RFC 3986 writes one: unreserved, a general or a
/// sub-delimiter. `%` is checked apart, because it must start a two-digit escape.
fn is_uri_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=".contains(&b)
}

/// Why `text` is refused, if it is. Refused: a character outside RFC 3986, a quote of either kind,
/// a `%` that does not start a two-digit escape, and an escape that stands for a control
/// character. `non_ascii` lets a letter outside ASCII through, for what a caller passed: the parser
/// then percent-encodes it, and the serialised form is checked again with `non_ascii` false.
/// Whitespace and control characters are refused either way.
fn refusal(text: &str, non_ascii: bool) -> Option<&'static str> {
    // `text` with each escape decoded, to find the control characters an escape can stand for.
    let mut decoded: Vec<u8> = Vec::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hi = chars.next().and_then(|h| h.to_digit(16));
            let lo = chars.next().and_then(|l| l.to_digit(16));
            match (hi, lo) {
                (Some(hi), Some(lo)) => decoded.push((hi * 16 + lo) as u8),
                _ => return Some("a % sign that does not start an escape"),
            }
        } else if c == '"' || c == '\'' {
            return Some("a quote");
        } else if c.is_ascii() {
            if !is_uri_byte(c as u8) {
                return Some("a character a web address may not carry");
            }
            decoded.push(c as u8);
        } else {
            if !non_ascii || c.is_whitespace() || c.is_control() {
                return Some("a character a web address may not carry");
            }
            decoded.extend_from_slice(c.encode_utf8(&mut [0u8; 4]).as_bytes());
        }
    }
    if String::from_utf8_lossy(&decoded).chars().any(char::is_control) {
        return Some("an escape that stands for a control character");
    }
    None
}

/// The address in the one form the operating system may receive, or why it is not opened.
fn checked_url(raw: &str) -> Result<String, String> {
    let refused = |why: &str| format!("This link was not opened: it contains {}.", why);
    // Checked as written first: the parser drops a tab or a line break without a word and encodes
    // a space or a quote, and an address that needed repairing is not one to open.
    if let Some(why) = refusal(raw, true) {
        return Err(refused(why));
    }
    let url = Url::parse(raw)
        .map_err(|_| "This link was not opened: it is not a web address.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http(s) URLs are allowed".to_string());
    }
    // Then as it will be sent: the parser also maps some letters outside ASCII onto ASCII ones.
    if let Some(why) = refusal(url.as_str(), false) {
        return Err(refused(why));
    }
    Ok(url.into())
}

/// What the app does to open `raw` on `platform`.
fn launch_plan(raw: &str, platform: Platform) -> Result<Launch, String> {
    let url = checked_url(raw)?;
    Ok(match platform {
        Platform::Windows => Launch::ShellExecute(url),
        Platform::MacOs => Launch::Program {
            program: "open",
            args: vec![url],
        },
        Platform::Other => Launch::Program {
            program: "xdg-open",
            args: vec![url],
        },
    })
}

/// Open an http(s) address in the default browser.
pub fn open_url(raw: &str) -> Result<(), String> {
    match launch_plan(raw, Platform::current())? {
        Launch::ShellExecute(url) => shell_execute(&url),
        Launch::Program { program, args } => {
            Command::new(program)
                .args(&args)
                .spawn()
                .map_err(|e| format!("Failed to open browser: {}", e))?;
            Ok(())
        }
    }
}

/// Hand the address to the Windows shell, which opens it with the browser registered for http and
/// https. Both commands that reach this are synchronous, so it runs on the thread that owns the
/// window, where the window has already initialised OLE, as ShellExecuteW asks.
#[cfg(windows)]
fn shell_execute(url: &str) -> Result<(), String> {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
        ) -> *mut c_void;
    }
    const SW_SHOWNORMAL: i32 = 1;

    fn wide(text: &str) -> Vec<u16> {
        OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
    }
    let operation = wide("open");
    let file = wide(url);
    // SAFETY: `operation` and `file` are NUL-terminated UTF-16 strings that live until the call
    // returns; a null window, parameter list and directory are the documented "none" values.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // The result is typed as a handle only for compatibility: above 32 means the browser was
    // started, 32 or below is an error code.
    let code = result as isize;
    if code > 32 {
        Ok(())
    } else {
        Err(format!("Failed to open browser (Windows error {})", code))
    }
}

#[cfg(not(windows))]
fn shell_execute(_url: &str) -> Result<(), String> {
    Err("ShellExecuteW is only on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVERY_PLATFORM: [Platform; 3] = [Platform::Windows, Platform::MacOs, Platform::Other];

    /// Programs that read their arguments as commands to run rather than as data.
    const INTERPRETERS: [&str; 8] = [
        "cmd",
        "cmd.exe",
        "powershell",
        "powershell.exe",
        "pwsh",
        "sh",
        "bash",
        "zsh",
    ];

    fn reaches_an_interpreter(plan: &Launch) -> bool {
        match plan {
            Launch::Program { program, .. } => {
                INTERPRETERS.contains(&program.to_ascii_lowercase().as_str())
            }
            Launch::ShellExecute(_) => false,
        }
    }

    #[test]
    fn an_ampersand_in_a_link_reaches_no_command_interpreter() {
        for platform in EVERY_PLATFORM {
            if let Ok(plan) = launch_plan("https://a.example/&calc", platform) {
                assert!(
                    !reaches_an_interpreter(&plan),
                    "{:?} hands the link to {:?}",
                    platform,
                    plan
                );
            }
        }
    }

    #[test]
    fn the_address_reaches_each_opener_whole_and_as_one_argument() {
        let url = "https://a.example/&calc";
        assert_eq!(
            launch_plan(url, Platform::Windows).unwrap(),
            Launch::ShellExecute(url.to_string())
        );
        assert_eq!(
            launch_plan(url, Platform::MacOs).unwrap(),
            Launch::Program {
                program: "open",
                args: vec![url.to_string()]
            }
        );
        assert_eq!(
            launch_plan(url, Platform::Other).unwrap(),
            Launch::Program {
                program: "xdg-open",
                args: vec![url.to_string()]
            }
        );
    }

    #[test]
    fn only_web_addresses_are_opened() {
        for refused in [
            "",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:display",
            "mailto:someone@a.example",
            "ftp://a.example/",
            "C:\\Windows\\System32\\calc.exe",
            "\\\\server\\share\\x.exe",
            "//a.example/",
            "a.example",
            "https:",
            "https://",
        ] {
            assert!(checked_url(refused).is_err(), "{:?} was accepted", refused);
        }
    }

    #[test]
    fn characters_a_command_line_would_read_are_refused() {
        for refused in [
            "https://a.example/ x",
            " https://a.example/",
            "https://a.example/\tx",
            "https://a.example/\nx",
            "https://a.example/\rx",
            "https://a.example/\u{0}x",
            "https://a.example/\u{a0}x",
            "https://a.example/\u{2028}x",
            "https://a.example/\"x",
            "https://a.example/'x",
            "https://a.example/^x",
            "https://a.example/`x",
            "https://a.example/<x>",
            "https://a.example/|x",
            "https://a.example/{x}",
            "https://a.example/\\x",
            "https://a.example/%",
            "https://a.example/%zz",
            "https://a.example/%+1",
            "https://a.example/%0Ax",
            "https://a.example/%00",
            "https://a.example/%7f",
            "https://a.example/%1b[31m",
            "https://a.example/%C2%85",
            // Full-width quotes, which the host's mapping turns into ASCII ones.
            "https://a\u{FF02}b.example/",
            "https://a\u{FF07}b.example/",
        ] {
            assert!(checked_url(refused).is_err(), "{:?} was accepted", refused);
        }
    }

    #[test]
    fn what_is_opened_is_the_parsed_address() {
        for (given, opened) in [
            ("HTTPS://A.Example", "https://a.example/"),
            (
                "http://localhost:41050/v1/portal",
                "http://localhost:41050/v1/portal",
            ),
            (
                "https://a.example/a%20b?q=1&r=(2)#top",
                "https://a.example/a%20b?q=1&r=(2)#top",
            ),
            ("http://[::1]:41050/", "http://[::1]:41050/"),
            (
                "https://fi.wikipedia.org/wiki/Äänestys",
                "https://fi.wikipedia.org/wiki/%C3%84%C3%A4nestys",
            ),
            // The signed-in hand-off legacy.html builds: base64 through encodeURIComponent.
            (
                "http://localhost:41050/v1/profile?tab=agents#handoff=eyJvIjoiYSJ9%2B%2F%3D",
                "http://localhost:41050/v1/profile?tab=agents#handoff=eyJvIjoiYSJ9%2B%2F%3D",
            ),
        ] {
            assert_eq!(checked_url(given).as_deref(), Ok(opened), "{:?}", given);
        }
    }
}
