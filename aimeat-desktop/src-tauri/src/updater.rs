// AIMEAT Desktop — auto-updater commands (tauri-plugin-updater).
//
// Checks a `latest.json` published on the GitHub Release (endpoint in tauri.conf.json
// `plugins.updater`) and, on the user's click, downloads + installs the new installer.
// Uses the Tauri updater's own minisign signature (NOT Authenticode — that is separate).
// Compile-check with `cargo check` / `pnpm tauri build`.
//
// THE VERSION IS READ FROM WHAT IS SIGNED. latest.json itself carries no signature, so its
// `version` is only what the manifest says. The installer's minisign signature carries a trusted
// comment, and tauri's signer writes the installer's file name into it, a name that holds the
// version the installer was built as (`AIMEAT Personal Node_0.5.0_x64-setup.exe`). An update is
// offered only when that signed name holds the version the manifest announces. The updater then
// verifies the comment together with the download, because minisign signs the two together, so
// the name read here is the name the key signed.

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Returns Some(version) if a newer release is available, else None.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| e.to_string())?;
    found
        .map(|u| offered_version(&u.version, &u.signature))
        .transpose()
}

/// Downloads and installs the available update (NSIS installer). On success the app
/// relaunches into the new version. Returns false if there was nothing to install.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        offered_version(&update.version, &update.signature)?;
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// The version to offer for an update the manifest announces, or why it is not offered: the
/// installer's signed file name must hold that version, as tauri names an installer
/// `<product>_<version>_<arch>-setup.exe`.
fn offered_version(version: &str, signature: &str) -> Result<String, String> {
    let file = signed_file_name(signature)
        .ok_or_else(|| "The update's signature names no installer, so it is not offered.".to_string())?;
    if file.contains(&format!("_{}_", version)) {
        Ok(version.to_string())
    } else {
        Err(format!(
            "The update announces version {}, but its signature was made for {}, so it is not offered.",
            version, file
        ))
    }
}

/// The `file:` field of the signature's trusted comment, read the way the updater reads the
/// signature when it verifies it: the base64 decoded strictly, the comment on the third line after
/// `trusted comment: `, its fields separated by tabs.
fn signed_file_name(signature: &str) -> Option<String> {
    let text = String::from_utf8(base64_decode(signature)?).ok()?;
    let comment = text.lines().nth(2)?.strip_prefix("trusted comment: ")?;
    comment
        .split('\t')
        .find_map(|field| field.strip_prefix("file:"))
        .map(str::to_string)
}

/// Standard base64 with padding, the form the updater decodes. Anything else is refused rather
/// than guessed at: a length that is not a multiple of four, a character outside the alphabet,
/// padding anywhere but at the end, and bits after the last byte that are not zero.
fn base64_decode(text: &str) -> Option<Vec<u8>> {
    fn value(b: u8) -> Option<u32> {
        match b {
            b'A'..=b'Z' => Some(u32::from(b - b'A')),
            b'a'..=b'z' => Some(u32::from(b - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(b - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes = text.as_bytes();
    if bytes.len() % 4 != 0 {
        return None;
    }
    let groups = bytes.len() / 4;
    let mut out = Vec::with_capacity(groups * 3);
    for (i, group) in bytes.chunks(4).enumerate() {
        let padding = group.iter().rev().take_while(|&&b| b == b'=').count();
        if padding > 2 || (padding > 0 && i + 1 != groups) {
            return None;
        }
        let mut n: u32 = 0;
        for &b in &group[..4 - padding] {
            n = (n << 6) | value(b)?;
        }
        n <<= 6 * padding as u32;
        if n & ((1u32 << (8 * padding as u32)) - 1) != 0 {
            return None;
        }
        out.extend_from_slice(&n.to_be_bytes()[1..4 - padding]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The installer signature published for 0.5.0 in desktop-latest/latest.json, as read on
    /// 2026-09-24. Its trusted comment names `AIMEAT Personal Node_0.5.0_x64-setup.exe`.
    const SIGNATURE_0_5_0: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSWEZYbng1KzJjMGQ0Q3N5L3RKYlVSMHMvYmtxVVJ4ckxQbFk2ZHdTZlhoT3p2NkExWENRR2l5ZEIzZmlPdUczWXJnYURuUm1hdEI5elBEeHpsZE5YMm0vZDJhZWsvUGdVPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5NzY2NDM3CWZpbGU6QUlNRUFUIFBlcnNvbmFsIE5vZGVfMC41LjBfeDY0LXNldHVwLmV4ZQovMTJxQ3VrRWUvRzdkQkkzK2lQQmtrVStUTGExQkZJek9NTUIySHU3cE4wZk0yUzRjUTRtYmRCVkRObUdNMzR6dm8xYTdwcjhBNXRHM3VydDRtVStEQT09Cg==";

    /// Standard base64 with padding, for building signatures in a test.
    fn encode(data: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in data.chunks(3) {
            let n = chunk
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
            for i in 0..4 {
                if i <= chunk.len() {
                    out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    #[test]
    fn an_update_is_offered_only_as_the_version_its_signature_names() {
        assert_eq!(
            offered_version("0.5.0", SIGNATURE_0_5_0),
            Ok("0.5.0".to_string())
        );
        // The same genuine installer and signature, announced as a higher version.
        let refused = offered_version("99.0.0", SIGNATURE_0_5_0);
        assert!(refused.is_err(), "{:?}", refused);
        // A version is matched whole, between the underscores of the file name.
        for near in ["0.5", "5.0", "0.5.0-beta", "10.5.0", ""] {
            assert!(offered_version(near, SIGNATURE_0_5_0).is_err(), "{:?}", near);
        }
    }

    #[test]
    fn only_the_comment_minisign_verifies_is_read() {
        let signed = |text: &str| encode(text.as_bytes());
        // The third line is the one minisign checks; a version anywhere else counts for nothing.
        let elsewhere = signed(
            "untrusted comment: file:A_9.9.9_x64-setup.exe\nRUQ=\ntrusted comment: timestamp:1\tfile:A_0.4.0_x64-setup.exe\nAAAA\nfile:A_9.9.9_x64-setup.exe\n",
        );
        assert!(offered_version("9.9.9", &elsewhere).is_err());
        assert_eq!(offered_version("0.4.0", &elsewhere), Ok("0.4.0".to_string()));
        // A comment with no file field, or no comment at all, offers nothing.
        let no_file = signed("untrusted comment: x\nRUQ=\ntrusted comment: timestamp:1\nAAAA\n");
        assert!(offered_version("0.4.0", &no_file).is_err());
        assert!(offered_version("0.4.0", &signed("untrusted comment: x\n")).is_err());
        assert!(offered_version("0.4.0", "").is_err());
        assert!(offered_version("0.4.0", "not base64!").is_err());
    }

    #[test]
    fn base64_is_decoded_as_the_standard_writes_it() {
        for (text, plain) in [
            ("", ""),
            ("Zg==", "f"),
            ("Zm8=", "fo"),
            ("Zm9v", "foo"),
            ("Zm9vYg==", "foob"),
            ("Zm9vYmE=", "fooba"),
            ("Zm9vYmFy", "foobar"),
        ] {
            assert_eq!(base64_decode(text), Some(plain.as_bytes().to_vec()), "{}", text);
            assert_eq!(encode(plain.as_bytes()), text);
        }
        for refused in ["Zg", "Zg=", "Zh==", "Zm9=", "Zg==Zg==", "Z===", "Zm9v\n", "Zm 9v", "Zm-v"] {
            assert_eq!(base64_decode(refused), None, "{:?}", refused);
        }
        let bytes: Vec<u8> = (0..=255).collect();
        assert_eq!(base64_decode(&encode(&bytes)), Some(bytes));
    }
}
