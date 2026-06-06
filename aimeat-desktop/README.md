# AIMEAT Personal Node — Desktop App

A [Tauri](https://tauri.app) desktop application that lets a non-technical user run their **own AIMEAT node**
on Windows without ever touching a terminal. It is a thin **control panel + system tray** around the AIMEAT
reference server (`../aimeat`): start/stop the node, see its status and logs, configure it, and open its web
dashboard — all from one window. Data is stored in **persistent SQLite** and survives restarts.

> The desktop window is the *control panel*. The actual AIMEAT product UI is the **web portal** the node serves
> at `http://localhost:40050/v1/portal` — use **Open Dashboard in Browser** once the node is running.

---

## How it works

The packaged app is fully self-contained — the end user installs **one** installer with **no prerequisites**
(no Node.js, no build tools). Three things are bundled together:

```
AIMEAT Personal Node.exe        ← Tauri app (Rust control panel + webview GUI)
node.exe                        ← Node.js runtime (Tauri sidecar)
resources/server/               ← the built AIMEAT server
  ├─ dist/                      ← compiled server (incl. public/, locales/, static/)
  ├─ node_modules/              ← production deps incl. native better-sqlite3
  └─ package.json
```

When you click **Start Node**, the Rust layer ([src-tauri/src/node_manager.rs](src-tauri/src/node_manager.rs))
spawns:

```
node.exe --env-file <appdata>\.env  resources\server\dist\src\index.js  start
```

with the working directory set to a **writable app-data folder**. All user state lives there, never in
`Program Files`:

| Path | Contents |
|------|----------|
| `%APPDATA%\com.overscale.aimeat-desktop\.env` | Node config (created on first run) |
| `%APPDATA%\com.overscale.aimeat-desktop\data\aimeat.db` | **Persistent SQLite database** |
| `%APPDATA%\com.overscale.aimeat-desktop\aimeat-node.log` | Server stdout/stderr |

Storage is fixed to `AIMEAT_STORAGE=sqlite` — see [config.ts](../aimeat/src/config.ts) for the underlying env
contract. To **back up** your node, stop it and copy the whole app-data folder.

---

## Building / packaging (developers)

### Prerequisites (build machine only — not the end user)

- **Rust** toolchain. Either works:
  - **MSVC** (Tauri's recommended Windows setup): `rustup` + Visual Studio C++ Build Tools, or
  - **GNU** (`x86_64-pc-windows-gnu`, e.g. via Chocolatey `rust`): also needs **mingw-w64** (`gcc` + `windres`)
    **on `PATH`** — Tauri's resource step shells out to `windres`, which uses `gcc` as its preprocessor. If
    `windres`/`gcc` aren't on `PATH` you'll see `windres: preprocessing failed`.
- **Node.js 24+** and **pnpm**.
- The Tauri CLI is already a dev dependency of this folder (`pnpm install` here installs it).

> `pnpm stage` stages the Node sidecar under **both** Windows triples (`-gnu` and `-msvc`) because the Tauri
> compiler and the Tauri CLI bundler can each resolve a different one. Whichever your toolchain uses, it's covered.

### Produce a Windows installer

```bash
cd aimeat-desktop
pnpm install            # first time only (installs the Tauri CLI)
pnpm package            # = pnpm stage && tauri build
```

`pnpm stage` runs two scripts:

- [scripts/stage-node.mjs](scripts/stage-node.mjs) — copies this machine's `node.exe` to
  `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` (the Tauri sidecar). Using the host's Node guarantees
  its ABI matches the staged native `better-sqlite3`.
- [scripts/stage-server.mjs](scripts/stage-server.mjs) — runs `pnpm build` in `../aimeat`, copies `dist/` into
  `src-tauri/resources/server/`, and does a **production-only** dependency install there (so the native SQLite
  binary is present and Prisma engines are dropped).

The installers land in:

```
src-tauri/target/release/bundle/nsis/    *-setup.exe   (recommended)
src-tauri/target/release/bundle/msi/     *.msi
```

### Develop the GUI

```bash
cd aimeat-desktop
pnpm dev          # = pnpm stage && tauri dev  (stages the sidecar + server, then runs)
```

`tauri.conf.json` declares the Node sidecar and server resources unconditionally, so `tauri dev` needs them
present — hence `pnpm dev` stages first. For **fast GUI iteration** (editing `src/index.html` only), stage once
then re-run the dev binary directly:

```bash
pnpm stage        # once
pnpm tauri dev    # repeat — skips re-staging
```

The Rust layer still contains a **dev fallback**: if the bundled server resource is absent it runs
`../aimeat/dist` with `node` from your `PATH`. Either way, runtime state (`.env`, SQLite DB, logs) is written to
the app-data folder. To iterate on the **server** itself, run it the normal way (`cd ../aimeat && pnpm dev`).

---

## Project layout

| Path | Purpose |
|------|---------|
| [src/index.html](src/index.html) | The GUI (single self-contained page: Dashboard / Connections / AI Setup / Settings / Logs) |
| [src-tauri/src/main.rs](src-tauri/src/main.rs) | Tauri entry point + command registration |
| [src-tauri/src/node_manager.rs](src-tauri/src/node_manager.rs) | Start/stop/status, path resolution, `.env` management, log tailing |
| [src-tauri/src/ai_connector.rs](src-tauri/src/ai_connector.rs) | Auto-detect local AI services (LM Studio, Ollama) |
| [src-tauri/src/tray.rs](src-tauri/src/tray.rs) | System tray icon, menu, tooltip |
| [tauri.conf.json](tauri.conf.json) | Tauri config — sidecar (`externalBin`), bundled `resources`, window |
| `scripts/` | `stage-node.mjs`, `stage-server.mjs` (run by `pnpm stage`) |

---

## Known limitations (this pass)

- **Windows-only.** macOS/Linux need per-OS builds (native `better-sqlite3` + Node sidecar can't cross-compile).
  Adding them means a GitHub Actions matrix (one runner per OS).
- **Unsigned.** The first launch shows a Windows SmartScreen warning ("More info → Run anyway"). Code signing
  is deferred.
- **No auto-update** yet. New versions are installed manually.
- **SQLite only.** MongoDB/PostgreSQL backends are intentionally excluded from the desktop bundle.

## Troubleshooting

- **"Failed to start node" / native module error** — the bundled `better-sqlite3` was built for a different Node
  ABI than the bundled sidecar. Rebuild the package with a single Node version so `pnpm stage` produces a
  matching pair (`stage-node` and `stage-server` both use the host's Node).
- **`windres: preprocessing failed`** (GNU toolchain) — `windres` can't find its `gcc` preprocessor. Put the
  mingw-w64 `bin` dir (e.g. `C:\ProgramData\mingw64\mingw64\bin`) on `PATH` before building.
- **`icon ... is not RGBA`** — the icons under `src-tauri/icons/` must be 32-bit RGBA PNGs. Regenerate the full
  set from the source SVG: `pnpm tauri icon src-tauri/icons/icon.svg`.
- **`WebView2Loader.dll was not found`** (at app launch) — the GNU toolchain links this loader dynamically, so it
  must ship next to the exe. `pnpm stage` stages it (`scripts/stage-webview2.mjs`) and `tauri.conf.json` bundles it
  as a top-level resource. If it ever goes missing, run `pnpm stage:webview2` and rebuild. (MSVC links it
  statically and never needs the DLL.) Note this is the *loader*; the Edge **WebView2 runtime** itself ships with
  Windows 11 / is auto-installed by the installer.
- **Logs** — check the **Logs** tab, or open
  `%APPDATA%\com.overscale.aimeat-desktop\aimeat-node.log` directly.
- **Port already in use** — another process holds `40050`. Stop it, or change `AIMEAT_PORT` in the Settings tab.
