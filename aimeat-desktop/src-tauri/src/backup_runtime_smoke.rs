//! Opt-in staged-runtime test. It uses a claimed port and its own disposable data directory.
//! Run after `pnpm stage`: AIMEAT_DESKTOP_SMOKE_PORT=<claimed> cargo test
//! backup_runtime_smoke -- --ignored --nocapture --test-threads=1
use super::*;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct SmokeDirectory(PathBuf);
impl SmokeDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("aimeat-desktop-smoke-{}", random_id().unwrap()));
        new_directory(&path, true).unwrap();
        Self(path)
    }
}
impl Drop for SmokeDirectory {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!("Failed smoke fixture retained for diagnosis: {}", self.0.display());
            return;
        }
        if self.0.parent() == Some(std::env::temp_dir().as_path())
            && self.0.file_name().is_some_and(|name| name.to_string_lossy().starts_with("aimeat-desktop-smoke-"))
            && regular_metadata(&self.0).is_ok_and(|metadata| metadata.is_dir())
        {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

struct NodeProcess(Child);
impl NodeProcess {
    fn start(node: &Path, server: &Path, root: &Path, log: &Path, port: u16) -> Self {
        let probe = TcpListener::bind(("127.0.0.1", port)).expect("The claimed smoke port must be free");
        drop(probe);
        let adapter = server.join("desktop-parent.mjs");
        assert!(adapter.is_file(), "Run pnpm stage before the runtime smoke test");
        let adapter_url = reqwest::Url::from_file_path(adapter).unwrap();
        let stdout = OpenOptions::new().create(true).append(true).open(log).unwrap();
        let stderr = stdout.try_clone().unwrap();
        let mut command = Command::new(node);
        // Never inherit a developer's node settings, tokens, API keys or NODE_OPTIONS.
        command.env_clear();
        for name in ["SystemRoot", "WINDIR", "SystemDrive", "COMSPEC", "PATH", "TEMP", "TMP", "LANG"] {
            if let Some(value) = std::env::var_os(name) { command.env(name, value); }
        }
        command.env("HOME", root).env("USERPROFILE", root)
            .env("APPDATA", root).env("LOCALAPPDATA", root)
            .env("AIMEAT_DESKTOP_PARENT_TOKEN", format!("{}{}", random_id().unwrap(), random_id().unwrap()))
            .arg("--env-file").arg(root.join(".env"))
            .args(["--import", adapter_url.as_str()])
            .arg(server.join("dist/src/index.js")).arg("start")
            .current_dir(root).stdin(Stdio::piped()).stdout(stdout).stderr(stderr);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut process = Self(command.spawn().expect("Start staged Node runtime"));
        let client = reqwest::Client::builder().timeout(Duration::from_secs(2))
            .redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            assert!(process.0.try_wait().unwrap().is_none(), "Staged node exited before readiness; fixture log: {}", log.display());
            let ready = tauri::async_runtime::block_on(async {
                let response = client.get(format!("http://127.0.0.1:{port}/v1/health/ready")).send().await.ok()?;
                if !response.status().is_success() { return None; }
                let value: Value = response.json().await.ok()?;
                (value.pointer("/data/status").and_then(Value::as_str) == Some("ready")).then_some(())
            });
            if ready.is_some() { return process; }
            assert!(Instant::now() < deadline, "Node did not become ready; fixture log: {}", log.display());
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    fn stop(&mut self) {
        assert!(self.0.try_wait().unwrap().is_none(), "Fixture node exited before the graceful stop request");
        self.0.stdin.as_mut().unwrap().write_all(b"aimeat-desktop:stop\n").unwrap();
        self.0.stdin.as_mut().unwrap().flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                assert!(status.success(), "Node must drain and close SQLite successfully: {status}");
                return;
            }
            assert!(Instant::now() < deadline, "Node did not stop through the Desktop adapter");
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
impl Drop for NodeProcess {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_some() { return; }
        if let Some(stdin) = self.0.stdin.as_mut() {
            let _ = stdin.write_all(b"aimeat-desktop:stop\n");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + Duration::from_secs(40);
        while Instant::now() < deadline {
            if self.0.try_wait().ok().flatten().is_some() { return; }
            std::thread::sleep(Duration::from_millis(100));
        }
        // This fixture owns this Child; it never kills a process found by a shared port.
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn request(port: u16, method: reqwest::Method, path: &str, body: Option<Value>, token: Option<&str>) -> Value {
    tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let mut request = client.request(method, format!("http://127.0.0.1:{port}{path}"));
        if let Some(body) = body { request = request.json(&body); }
        if let Some(token) = token { request = request.bearer_auth(token); }
        let response = request.send().await.expect("Local fixture API request");
        let status = response.status();
        let value: Value = response.json().await.expect("Local fixture API envelope");
        assert!(status.is_success(), "Fixture route {path}: status {status}, code {}", value.pointer("/error/code").unwrap_or(&Value::Null));
        value.get("data").cloned().expect("API data envelope")
    })
}

fn login(port: u16, username: &str, password: &str) -> String {
    request(port, reqwest::Method::POST, "/v1/ghii/login", Some(json!({ "username": username, "password": password })), None)
        .get("token").and_then(Value::as_str).expect("Fixture owner login token").to_string()
}

#[test]
#[ignore = "requires staged runtime and an explicitly claimed AIMEAT_DESKTOP_SMOKE_PORT"]
fn backup_runtime_smoke_restores_a_real_identity_and_memory_after_restart() {
    let port: u16 = std::env::var("AIMEAT_DESKTOP_SMOKE_PORT")
        .expect("Set the Lifecycle-claimed AIMEAT_DESKTOP_SMOKE_PORT explicitly").parse().unwrap();
    assert!(port >= 40251, "Use a claimed E2E port, not a person's Desktop port");
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let server = std::env::var_os("AIMEAT_DESKTOP_SMOKE_SERVER").map(PathBuf::from)
        .unwrap_or_else(|| manifest.join("resources/server"));
    assert!(server.is_absolute() && server.join("dist/src/index.js").is_file(), "Stage the server first");
    let node = std::env::var_os("AIMEAT_DESKTOP_SMOKE_NODE").map(PathBuf::from).unwrap_or_else(|| {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        fs::read_dir(manifest.join("binaries")).unwrap().filter_map(Result::ok)
            .find(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                name.starts_with("node-") && name.ends_with(suffix)
            }).expect("Stage the Node sidecar first").path()
    });
    assert!(node.is_absolute() && node.is_file());
    let fixture = SmokeDirectory::new();
    let root = fixture.0.join("node");
    new_directory(&root, true).unwrap();
    new_directory(&root.join("data"), false).unwrap();
    let key = format!("{}{}", random_id().unwrap(), random_id().unwrap());
    let env = format!("AIMEAT_STORAGE=sqlite\nAIMEAT_SQLITE_PATH=./data/aimeat.db\nAIMEAT_PORT={port}\nAIMEAT_BIND_HOST=127.0.0.1\nAIMEAT_BASE_URL=http://127.0.0.1:{port}\nAIMEAT_NODE_ID=desktop-backup-smoke\nAIMEAT_FEDERATION_ROLE=standalone\nAIMEAT_CROSS_FEDERATION_ENABLED=false\nAIMEAT_ENCRYPTION_KEY={key}\nAIMEAT_TOTP_ENCRYPTION_KEY={key}\nAIMEAT_TEST_MODE=true\n");
    new_file(&root.join(".env"), false).unwrap().write_all(env.as_bytes()).unwrap();
    let log = fixture.0.join("runtime.log");
    let username = format!("backup{}", &random_id().unwrap()[..12]);
    let password = format!("Fixture-{}-A7!", random_id().unwrap());
    let before = json!({ "text": "Restored memory: ääkköset", "fixture": random_id().unwrap() });
    let memory_path = "/v1/memory/desktop-backup-smoke";
    let mut process = NodeProcess::start(&node, &server, &root, &log, port);
    request(port, reqwest::Method::POST, "/v1/ghii", Some(json!({ "username": username, "password": password, "display_name": "Desktop backup fixture" })), None);
    let token = login(port, &username, &password);
    request(port, reqwest::Method::POST, "/v1/memory", Some(json!({ "key": "desktop-backup-smoke", "value": before, "visibility": "private" })), Some(&token));
    process.stop();
    new_directory(&root.join("data/storage"), false).unwrap();
    fs::write(root.join("data/storage/retained.txt"), b"original stored bytes").unwrap();
    let archive = fixture.0.join("backup.zip.age");
    let backup_password = SecretString::from("isolated runtime backup password".to_owned());
    let backup = create_encrypted(&root, &archive, env!("CARGO_PKG_VERSION"), &backup_password).unwrap();
    assert!(is_encrypted(&archive).unwrap());
    assert!(backup.files.iter().any(|file| file.path == "data/aimeat.db"));
    let mut process = NodeProcess::start(&node, &server, &root, &log, port);
    let token = login(port, &username, &password);
    request(port, reqwest::Method::POST, "/v1/memory", Some(json!({ "key": "desktop-backup-smoke", "value": "newer state kept in recovery", "visibility": "private" })), Some(&token));
    process.stop();
    let current_database = archive_digest(&root.join("data/aimeat.db")).unwrap();
    fs::write(root.join("data/storage/retained.txt"), b"newer stored bytes").unwrap();
    fs::write(root.join("newer-only.txt"), b"keep this in recovery").unwrap();
    let digest = archive_digest(&archive).unwrap();
    let wrong_password = SecretString::from("a different runtime backup password".to_owned());
    assert!(restore_encrypted(&root, &archive, &digest, Some(&wrong_password)).is_err());
    assert_eq!(archive_digest(&root.join("data/aimeat.db")).unwrap(), current_database);
    let (_, recovery) = restore_encrypted(&root, &archive, &digest, Some(&backup_password)).unwrap();
    assert_eq!(archive_digest(&recovery.join("data/aimeat.db")).unwrap(), current_database);
    assert_eq!(fs::read(recovery.join("newer-only.txt")).unwrap(), b"keep this in recovery");
    assert_eq!(fs::read_to_string(root.join(".env")).unwrap(), env);
    assert_eq!(fs::read(root.join("data/storage/retained.txt")).unwrap(), b"original stored bytes");
    let mut process = NodeProcess::start(&node, &server, &root, &log, port);
    let token = login(port, &username, &password);
    let restored = request(port, reqwest::Method::GET, memory_path, None, Some(&token));
    assert_eq!(restored.get("value"), Some(&before));
    process.stop();
    println!("Staged runtime passed: identity login, SQLite memory, private keys, stored file, graceful stop, encrypted backup, wrong-password refusal, recovery retention and restart after restore.");
}
