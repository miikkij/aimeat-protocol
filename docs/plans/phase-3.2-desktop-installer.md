# 3.2 Graafinen personal node -asennusohjelma

*Alidokumentti: [phase-3-polish-future.md](./phase-3-polish-future.md)*

---

> Lähde: masterplan (§3.2), `docs/nextlevel/aimeat-personal-node-spec.md`

### 3.2.1 Tavoite

Rakentaa desktop-sovellus (Tauri) joka asentaa ja hallinnoi AIMEAT personal noden yhdellä klikkauksella. Sovellus sisältää sisäänrakennetun LM Studio / Ollama -yhdistämisen ja system tray -integraation.

**Miksi Tauri eikä Electron?**
- Tauri: ~5 MB (vs Electron: ~150 MB) — Rust-pohjainen, OS:n WebView
- Parempi suorituskyky (pienempi muistinjälki)
- Parempi turvallisuus (Rust, ei Node.js backendissa)
- Sopii AIMEAT:n filosofiaan: kevyt, tehokas, ei turhaa bloattia
- Tuki: Windows, macOS, Linux

### 3.2.2 Arkkitehtuuri

```
┌─────────────────────────────────────┐
│ Tauri Desktop App                   │
│                                     │
│  ┌──────────┐  ┌─────────────────┐ │
│  │ Frontend  │  │ Tauri Backend   │ │
│  │ (WebView) │←→│ (Rust)          │ │
│  │           │  │                 │ │
│  │ Wizard UI │  │ - Node manager  │ │
│  │ Dashboard │  │ - Config writer │ │
│  │ Settings  │  │ - Process mgmt  │ │
│  │ Tray menu │  │ - System tray   │ │
│  └──────────┘  │ - AI connector  │ │
│                 └─────────────────┘ │
│                       ↕             │
│              ┌────────────────┐     │
│              │ AIMEAT Node    │     │
│              │ (child process)│     │
│              │ port 40050     │     │
│              └────────────────┘     │
│                       ↕             │
│              ┌────────────────┐     │
│              │ LM Studio /    │     │
│              │ Ollama (opt.)  │     │
│              │ port 1234/11434│     │
│              └────────────────┘     │
└─────────────────────────────────────┘
```

### 3.2.3 Frontend (WebView)

Frontend käyttää Phase 1.2 wizard-koodia pohjana. Lisäksi:

| Näkymä | Kuvaus |
|---|---|
| **Setup Wizard** | 5-askelinen wizard (Phase 1.2 klooni) |
| **Dashboard** | Noden status, morselit, viimeisimmät tapahtumat |
| **Connections** | Ankkurioperaattori, federation-peerit, AI-yhteys |
| **Settings** | Portaali, email, matching, moderointi |
| **AI Setup** | LM Studio / Ollama tunnistus + yhdistäminen |
| **Logs** | Noden logit reaaliajassa |

### 3.2.4 Tauri Backend (Rust)

**Rust-komennot (Tauri commands):**

```rust
#[tauri::command]
fn start_node(config_path: String) -> Result<u32, String>;  // PID

#[tauri::command]
fn stop_node(pid: u32) -> Result<(), String>;

#[tauri::command]
fn get_node_status() -> Result<NodeStatus, String>;

#[tauri::command]
fn write_config(config: NodeConfig) -> Result<(), String>;

#[tauri::command]
fn detect_ai_services() -> Result<Vec<AIService>, String>;
// Tarkistaa: localhost:1234 (LM Studio), localhost:11434 (Ollama)

#[tauri::command]
fn connect_ai_service(service: AIService) -> Result<(), String>;
```

### 3.2.5 System Tray

| Toiminto | Kuvaus |
|---|---|
| **Status-ikoni** | 🟢 Online, 🟡 Syncing, 🔴 Offline |
| **Tooltip** | "AIMEAT Personal Node — 142 morseliä" |
| **Menu: Open Dashboard** | Avaa pääikkuna |
| **Menu: Start/Stop Node** | Käynnistä/pysäytä node |
| **Menu: Notifications** | Viimeisimmät ilmoitukset |
| **Menu: Quit** | Pysäytä node + sulje sovellus |

### 3.2.6 AI-palvelun automaattitunnistus

```typescript
interface AIService {
  type: 'lm-studio' | 'ollama' | 'openai-compatible' | 'unknown';
  url: string;
  port: number;
  status: 'available' | 'unavailable';
  models?: string[];     // Tunnistetut mallit
}
```

**Tunnistuslogiikka:**
1. Kokeile `GET http://localhost:1234/v1/models` → LM Studio
2. Kokeile `GET http://localhost:11434/api/tags` → Ollama
3. Kokeile custom URL (käyttäjä syöttää) → OpenAI-compatible

### 3.2.7 Uudet riippuvuudet (erillinen package)

```
aimeat-desktop/
├── src-tauri/          # Rust backend
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── node_manager.rs
│       ├── ai_connector.rs
│       └── tray.rs
├── src/                # Frontend (HTML/JS/CSS — sama kuin portal)
│   ├── wizard/
│   ├── dashboard/
│   └── settings/
├── package.json
└── tauri.conf.json
```

**Erillinen repositorio tai monorepo-workspace:** `aimeat-desktop/` aimeat-päähakemiston rinnalle.

### 3.2.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Wizard: 5-askelinen setup | Config kirjoitettu, node käynnistyy |
| 2 | Node start/stop | PID hallinta, graceful shutdown |
| 3 | System tray: status-ikoni | Oikea väri (vihreä/keltainen/punainen) |
| 4 | AI-tunnistus: LM Studio käynnissä | Tunnistettu, mallit listattu |
| 5 | AI-tunnistus: Ollama käynnissä | Tunnistettu, mallit listattu |
| 6 | AI-tunnistus: ei mitään käynnissä | "Ei AI-palvelua löytynyt" |
| 7 | Dashboard: morsel-saldo | Oikea lukema |
| 8 | Dashboard: federation-status | Online/offline oikein |
| 9 | Config muutos → node restart | Automaattinen uudelleenkäynnistys |
| 10 | Offline-moodi → reconnect | WSS-yhteys palautuu |

### 3.2.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `aimeat-desktop/` — Koko Tauri-sovellus (erillinen paketti) |
| **Uusi** | `aimeat-desktop/src-tauri/src/main.rs` — Tauri entry point |
| **Uusi** | `aimeat-desktop/src-tauri/src/node_manager.rs` — Node-prosessin hallinta |
| **Uusi** | `aimeat-desktop/src-tauri/src/ai_connector.rs` — AI-palvelutunnistus |
| **Uusi** | `aimeat-desktop/src-tauri/src/tray.rs` — System tray |
| **Uusi** | `aimeat-desktop/src/` — Frontend (wizard, dashboard, settings) |
| **Uusi** | `aimeat-desktop/tauri.conf.json` — Tauri-konfiguraatio |
| **Uusi** | `aimeat-desktop/package.json` — Frontend-riippuvuudet |
| **Muokataan** | `docs/nextlevel/aimeat-personal-node-spec.md` — Desktop-asennusohjelman viittaus |

---

← [Phase 3: Polish + tulevaisuus](./phase-3-polish-future.md)
