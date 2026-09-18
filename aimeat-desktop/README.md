# AIMEAT Personal Node — Desktop App

A [Tauri](https://tauri.app) desktop application that does what only a program on the person's own machine
can do. Two things, in this order:

1. **The front door ([src/index.html](src/index.html)).** Which AI tools on this computer are attached to the
   person's AIMEAT, and one click to attach or detach each one. Today that job means installing Node.js and
   running `npx aimeat connect` in a terminal, which is where a non-technical person stops. This screen works
   whether their AIMEAT is aimeat.io or a server of their own, so the app is useful before anyone decides to
   run anything. The work is in [src-tauri/src/connectors.rs](src-tauri/src/connectors.rs), which reads and
   edits each tool's own config file; nothing it writes holds a secret, because the node authenticates MCP
   over OAuth 2.1 with dynamic client registration.
2. **The machine room ([src/legacy.html](src/legacy.html)).** Run their **own AIMEAT server** on this computer
   without a terminal: start and stop it, see its status and logs, configure it, open its web pages. Data is
   stored in **persistent SQLite** and survives restarts.

> The desktop window is the front door and the control panel. The product itself is the web interface the
> server carries at `http://localhost:41050/v1/portal` — use **Open Dashboard in Browser** once it is running.

The direction, the use cases behind it and what this app deliberately does not do are in the wish bucket on
the node: wish `wish-ty-p-yt-sovellus-uusiksi-liitin-etuovena-kaikki-k-ytt-j-rjes` and its brief
`brief-tyopoytasovellus-liitin-etuovena`, under goal `goal-tekoaly-kiinni-omalta-koneelta`.

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

> **Without administrator rights**, the GNU path is the one that works, and it is what this app was built
> with on 2026-09-18. The MSVC route needs the Visual Studio Build Tools installer, which needs elevation.
> The GNU route is three user-level steps, no elevation anywhere:
>
> ```powershell
> # 1. A portable mingw-w64 (WinLibs, ~260 MB zip); check its published SHA-256 before unpacking.
> #    Unpack it under %LOCALAPPDATA%\aimeat-tools, so mingw64\bin holds gcc.exe, ld.exe and windres.exe.
> # 2. rustup toolchain install stable-x86_64-pc-windows-gnu   # rustup is user-level already
> # 3. cd aimeat-desktop\src-tauri; rustup override set stable-x86_64-pc-windows-gnu
> $env:PATH = "$env:LOCALAPPDATA\aimeat-tools\mingw64\bin;$env:PATH"
> cargo test     # 12 tests, ~26 s once the dependencies are compiled
> ```
>
> The host toolchain has to be the GNU one, not just the target: build scripts compile for the host, so
> `cargo test --target x86_64-pc-windows-gnu` on an MSVC host still asks for `link.exe` and stops.
> The installers that ship are built by CI with MSVC; this is for working on the app.

**`cargo build` needs three things staged even when you are not making an installer**, because tauri-build
validates them while cargo compiles: the Node sidecar (`node scripts/stage-node.mjs`), `WebView2Loader.dll`
(`node scripts/stage-webview2.mjs`) and a `resources/server` and `resources/licenses` that are not empty —
one placeholder file in each is enough, and `pnpm stage` empties both before writing the real thing.
[.github/workflows/desktop-check.yml](../.github/workflows/desktop-check.yml) does exactly this on every
push that touches this folder, which is what keeps the app from drifting away from the server again.

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
| [src/index.html](src/index.html) | The front door: which AI tools on this computer are attached, and the two verbs |
| [src/legacy.html](src/legacy.html) | The older control panel (Home / Dashboard / Connections / AI Setup / Agents / Chat / Settings / Logs) |
| [src/fonts/](src/fonts/) | The three design-language faces, self-hosted (SIL OFL, see `fonts/LICENSE.md`); nothing here fetches a font |
| [src-tauri/src/main.rs](src-tauri/src/main.rs) | Tauri entry point + command registration |
| [src-tauri/src/connectors.rs](src-tauri/src/connectors.rs) | Detect the AI tools on this machine; attach and detach by editing their config files |
| [src-tauri/src/node_manager.rs](src-tauri/src/node_manager.rs) | Start/stop/status, path resolution, `.env` management, log tailing |
| [src-tauri/src/ai_connector.rs](src-tauri/src/ai_connector.rs) | Auto-detect local AI services (LM Studio, Ollama) |
| [src-tauri/src/tray.rs](src-tauri/src/tray.rs) | System tray icon, menu, tooltip |
| [tauri.conf.json](tauri.conf.json) | Tauri config — sidecar (`externalBin`), bundled `resources`, window |
| `scripts/` | `stage-node.mjs`, `stage-server.mjs` (run by `pnpm stage`) |

---

## Known limitations (this pass)

- **Windows-only.** macOS/Linux need per-OS builds (native `better-sqlite3` + Node sidecar can't cross-compile).
  Adding them means a GitHub Actions matrix (one runner per OS).
- **Unsigned, on purpose for now.** The first launch shows a Windows SmartScreen warning ("More info → Run
  anyway"). Ruled 2026-09-18: no code signing until the app has been judged good; it costs money and the
  free routes were all measured closed (see the Platform Development Note `installer-code-signing`).
- **Neither update path works** (measured 2026-09-18). Both look at the repository's `releases/latest`, which
  is now a node release rather than a `desktop-v*` one: the Tauri updater's `latest.json` answers 404, and the
  in-app banner returns early because the tag does not start with `desktop-v`. Until both are fixed, a new
  version is installed by hand.
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
- **Port already in use** — another process holds `41050`. Stop it, or change `AIMEAT_PORT` in the Settings tab.
