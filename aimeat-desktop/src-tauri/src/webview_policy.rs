// AIMEAT Desktop — the webview's content security policy, held to the pages it governs.
//
// The app is never started in CI, so a policy that blocks something a page needs would first be
// found by a person using it. These tests read tauri.conf.json and the two pages and check them
// against each other: the policy keeps each page to the app, and what the pages are written with
// (inline scripts and handlers, style attributes, Tauri's IPC) still works under it.

use serde_json::Value;

const CONF: &str = include_str!("../tauri.conf.json");
const PAGES: [(&str, &str); 2] = [
    ("index.html", include_str!("../../src/index.html")),
    ("legacy.html", include_str!("../../src/legacy.html")),
];

fn security() -> Value {
    let conf: Value = serde_json::from_str(CONF).expect("tauri.conf.json is JSON");
    conf["app"]["security"].clone()
}

fn policy() -> String {
    security()["csp"]
        .as_str()
        .expect("app.security.csp is set")
        .to_string()
}

/// The sources one directive names, or an empty list when the policy does not name it.
fn sources(csp: &str, directive: &str) -> Vec<String> {
    csp.split(';')
        .find_map(|d| {
            let mut words = d.split_whitespace();
            (words.next() == Some(directive)).then(|| words.map(String::from).collect())
        })
        .unwrap_or_default()
}

/// Whether Tauri is told to leave a directive as written. Unless it is, Tauri adds a hash or a
/// nonce to script-src and style-src, and a browser ignores 'unsafe-inline' next to either.
fn left_as_written(directive: &str) -> bool {
    match &security()["dangerousDisableAssetCspModification"] {
        Value::Bool(all) => *all,
        Value::Array(list) => list.iter().any(|d| d == directive),
        _ => false,
    }
}

/// Whether a page has an inline event handler such as ` onclick="`.
fn has_inline_handler(html: &str) -> bool {
    html.match_indices(" on").any(|(i, _)| {
        let rest = &html[i + 3..];
        let name = rest.bytes().take_while(u8::is_ascii_lowercase).count();
        name > 0 && rest[name..].starts_with("=\"")
    })
}

#[test]
fn an_inline_handler_is_recognised() {
    assert!(has_inline_handler(r#"<button onclick="go()">"#));
    assert!(!has_inline_handler(r#"<p class="on">and so on="x"</p>"#));
}

#[test]
fn the_policy_keeps_each_page_to_the_app() {
    let csp = policy();
    assert_eq!(sources(&csp, "default-src"), ["'self'"]);
    assert_eq!(sources(&csp, "object-src"), ["'none'"]);
    assert_eq!(sources(&csp, "base-uri"), ["'none'"]);
    assert_eq!(sources(&csp, "form-action"), ["'none'"]);
    assert_eq!(sources(&csp, "frame-ancestors"), ["'none'"]);
    // The pages reach the node through the app's own commands, never with fetch, so the one
    // connection a page makes is Tauri's IPC: `ipc:` on macOS and Linux, the other on Windows.
    assert_eq!(sources(&csp, "connect-src"), ["ipc:", "http://ipc.localhost"]);
    for directive in ["script-src", "style-src"] {
        let named = sources(&csp, directive);
        assert!(
            named.iter().all(|s| s == "'self'" || s == "'unsafe-inline'"),
            "{} names {:?}",
            directive,
            named
        );
    }
}

/// An inline handler or a style attribute runs only under 'unsafe-inline', and only while Tauri
/// leaves the directive as written. The inline `<script>` and `<style>` elements then rely on the
/// same 'unsafe-inline'.
#[test]
fn what_the_pages_are_written_with_still_runs() {
    let csp = policy();
    for (page, html) in PAGES {
        if has_inline_handler(html) {
            assert!(
                sources(&csp, "script-src").contains(&"'unsafe-inline'".to_string()),
                "{} has inline handlers",
                page
            );
            assert!(left_as_written("script-src"), "{} has inline handlers", page);
        }
        if html.contains(" style=\"") {
            assert!(
                sources(&csp, "style-src").contains(&"'unsafe-inline'".to_string()),
                "{} has style attributes",
                page
            );
            assert!(left_as_written("style-src"), "{} has style attributes", page);
        }
    }
}
