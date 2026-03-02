# Phase 3: "Polish + tulevaisuus" — Kattava implementointisuunnitelma

*2026-03-01 — Yksityiskohtainen toteutussuunnitelma Phase 3 -komponenteille*

---

## Yleiskatsaus

Phase 3 viimeistelee AIMEAT-ekosysteemin: mobiilikokemus (PWA), graafinen asennusohjelma (desktop), standardien integraatiot (EU:n digitaalinen identiteettilompakko, W3C Verifiable Credentials, MyData) ja edistynyt federaatioarkkitehtuuri. Tämä on **polish-phase** — kaikki ydinominaisuudet on rakennettu Phase 0–2:ssa, Phase 3 tekee niistä käytettäviä, luotettavia ja standardinmukaisia.

**Prerekvisiitit:** Phase 0 (0.1–0.9), Phase 1 (1.1–1.9) ja Phase 2 (2.1–2.9) ovat toteutettu.

**Komponentit:**

| # | Komponentti | Riippuvuudet | Arvioitu laajuus |
|---|---|---|---|
| 3.1 | Mobiilisovellus (PWA) | Phase 1.3 (portaali), Phase 1.6 + 2.6 (palvelut) | Suuri |
| 3.2 | Graafinen personal node -asennusohjelma | Phase 1.2 (wizard), personal node spec | Suuri |
| 3.3 | EUDIW / MyData / W3C VC -integraatiot | Phase 0.3 (consent), GHII Tier 3 | Suuri |
| 3.4 | Advanced federation | Phase 0 federation, Phase 2.2 (organismit) | Keskisuuri |
| 3.5 | Semanttinen ontologia (Phase 3 -rakenteet) | Phase 0.7 (ontologia) | Pieni |
| 3.6 | Dokumentaation ylläpito (Phase 3) | Kaikki | Dokumentaatio |
| 3.7 | Testausstrategia (Phase 3) | Kaikki | Keskisuuri |

**Suositeltu toteutusjärjestys:**

```
3.1 PWA ──────────────────────────────────────────┐
                                                   │
3.2 Desktop-asennusohjelma ────────────────────────┤ (rinnakkain, itsenäisiä)
                                                   │
3.3 EUDIW / MyData / W3C VC ──────────────────────┤
                                                   │
3.4 Advanced federation ──────────────────────────┘

3.5 Semanttinen ontologia ──→ (läpileikkaava)
3.6 Dokumentaation ylläpito ──→ (läpileikkaava)
3.7 Testausstrategia ─────────→ (läpileikkaava)
```

Kaikki neljä pääkomponenttia (3.1–3.4) ovat toisistaan riippumattomia ja voidaan toteuttaa täysin rinnakkain.

### Alidokumentit

| Komponentti | Tiedosto |
|---|---|
| 3.1 Mobiilisovellus (PWA) | [phase-3.1-pwa.md](./phase-3.1-pwa.md) |
| 3.2 Desktop-asennusohjelma | [phase-3.2-desktop-installer.md](./phase-3.2-desktop-installer.md) |
| 3.3 EUDIW / MyData / W3C VC | [phase-3.3-eudiw-mydata-vc.md](./phase-3.3-eudiw-mydata-vc.md) |
| 3.4 Advanced federation | [phase-3.4-advanced-federation.md](./phase-3.4-advanced-federation.md) |
| 3.5 Semanttinen ontologia (Phase 3) | [phase-3.5-semantic-ontology.md](./phase-3.5-semantic-ontology.md) |
| 3.6 Dokumentaation ylläpito | [phase-3.6-documentation-plan.md](./phase-3.6-documentation-plan.md) |
| 3.7 Testausstrategia | [phase-3.7-testing-strategy.md](./phase-3.7-testing-strategy.md) |

---

## 3.1 Mobiilisovellus (PWA)

> Lähde: masterplan (§3.1)

### 3.1.1 Tavoite

Muuntaa AIMEAT-portaali Progressive Web App -sovellukseksi joka toimii puhelimella kuten natiivi sovellus: offline-tuki, push-ilmoitukset, asennettavuus ja taustasynyc. **Ei native-sovellusta** — PWA riittää ja se toimii kaikilla alustoilla yhdellä koodikannalla.

**Miksi PWA eikä native?**
- Yksi koodikanta (HTML/JS/CSS) kaikille alustoille
- Ei sovelluskaupparajoituksia (Apple/Google eivät kontrolloi jakelua)
- Päivitykset heti (ei kauppakatselmus-viivettä)
- Sama koodi kuin portaali — ei uutta frameworkia
- AIMEAT:n filosofia: avoin, desentralisoitu, ei portteja

### 3.1.2 PWA-komponentit

| Komponentti | Tarkoitus | Teknologia |
|---|---|---|
| **Web App Manifest** | Asennettavuus, ikonit, teema | `manifest.json` |
| **Service Worker** | Offline-tuki, cache, background sync | `sw.js` (Workbox) |
| **Push Notifications** | Match-ilmoitukset, marketplace-päivitykset | Web Push API + VAPID |
| **App Shell** | Instant-lataus, offline-runko | Cache-first strategia |
| **Background Sync** | Offline-toiminnot synkronoituvat | BackgroundSync API |

### 3.1.3 Uudet riippuvuudet

```bash
cd aimeat
pnpm add web-push
pnpm add -D workbox-cli
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `web-push` | ^3.x | ~50KB | VAPID-avainten generointi + push-viestien lähetys |
| `workbox-cli` | ^7.x | (dev) | Service worker -generointi + cache-strategiat |

### 3.1.4 Web App Manifest

**Tiedosto:** `src/static/manifest.json`

```json
{
  "name": "AIMEAT",
  "short_name": "AIMEAT",
  "description": "AI Memory Exchange and Action Transfer — Sinun nodesi, sinun datasi",
  "start_url": "/v1/portal/human/dashboard",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#ff69b4",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["social", "utilities"],
  "lang": "fi",
  "dir": "ltr"
}
```

### 3.1.5 Service Worker -strategia

**Cache-strategiat:**

| Resurssi | Strategia | TTL | Selitys |
|---|---|---|---|
| App Shell (HTML, CSS, JS) | Cache-First | ∞ (versioitu) | Instant-lataus, päivitys taustalla |
| API-vastaukset (GET) | Network-First | 5 min | Tuore data, offline-fallback |
| Ikonit, fontit | Cache-First | 30 päivää | Staattinen sisältö |
| Profiilikuvat | Stale-While-Revalidate | 1 päivä | Näytä vanha, päivitä taustalla |
| POST/PUT/DELETE | Background Sync | — | Jonoon offline-aikana, synkataan kun online |

**Offline-tuki:**

```javascript
// sw.js — Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox-sync') {
    event.waitUntil(syncOutbox());
  }
});

async function syncOutbox() {
  const outbox = await getOutbox(); // IndexedDB
  for (const request of outbox) {
    try {
      await fetch(request.url, request.options);
      await removeFromOutbox(request.id);
    } catch (err) {
      // Jää jonoon seuraavaan sync-yritykseen
    }
  }
}
```

### 3.1.6 Push Notifications

**VAPID-avaimet:**

```env
# ── Push Notifications ─────────────────────────────────────
# Generoi: npx web-push generate-vapid-keys
# AIMEAT_VAPID_PUBLIC_KEY="BEl..."
# AIMEAT_VAPID_PRIVATE_KEY="..."
# AIMEAT_VAPID_SUBJECT="mailto:admin@aimeat.example.com"
```

**Uusi service: Push Notification**

**Tiedosto:** `src/services/push.ts`

```typescript
export interface PushService {
  readonly enabled: boolean;
  subscribe(ownerName: string, subscription: PushSubscription): Promise<void>;
  unsubscribe(ownerName: string): Promise<void>;
  sendNotification(ownerName: string, payload: PushPayload): Promise<boolean>;
  broadcastToOrganism(organismId: string, payload: PushPayload): Promise<number>;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;         // Avataan klikkauksessa
  tag?: string;         // Korvaa saman tagin ilmoituksen
  data?: Record<string, unknown>;
}
```

**Uusi record-tyyppi: PushSubscriptionRecord**

```typescript
export interface PushSubscriptionRecord {
  ownerName: string;
  endpoint: string;               // Push service URL
  keys: {
    p256dh: string;               // Client public key
    auth: string;                 // Auth secret
  };
  createdAt: string;
  lastUsedAt: string;
}
```

**Uudet endpointit:**

| Metodi | Polku | Auth | Kuvaus |
|---|---|---|---|
| POST | `/v1/push/subscribe` | JWT | Rekisteröi push-tilaus |
| DELETE | `/v1/push/subscribe` | JWT | Peru push-tilaus |
| POST | `/v1/push/test` | JWT | Lähetä testi-ilmoitus itselle |

**Integraatiot (push-ilmoitukset lähetetään automaattisesti):**
- AI-matchaus: uusia ehdotuksia (Phase 2.1)
- Markkinapaikka: uusia ostopyyntöjä (Phase 2.6)
- Organismi: uusia jäseniä, viestejä (Phase 2.2)
- Moderaattori: uusia flageja (Phase 2.4)

### 3.1.7 Portaalin responsiivinen päivitys

Nykyinen portaali on jo mobile-first (viewport meta tag, 100% width). PWA-konversio vaatii:

1. **Manifest-linkki:** `<link rel="manifest" href="/manifest.json">`
2. **SW-rekisteröinti:** `navigator.serviceWorker.register('/sw.js')`
3. **Install-banneri:** "Lisää aloitusnäyttöön" -prompt
4. **Offline-sivu:** Mukautettu offline-fallback (ei Chrome-dinosaurus)
5. **Bottom navigation:** Mobiilinäkymässä alanavigaatio (dashboard, hakemisto, marketplace, profiili)

### 3.1.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Manifest.json saatavilla | 200, oikea MIME-type |
| 2 | SW rekisteröityy | SW active, cache populated |
| 3 | Offline-tila: dashboard latautuu | App shell cachesta |
| 4 | Offline-tila: API-pyyntö → outbox | Tallennettu IndexedDB:hen |
| 5 | Online paluu → outbox sync | Pyynnöt lähetetty, outbox tyhjennetty |
| 6 | Push-tilaus rekisteröinti | 200, subscription tallennettu |
| 7 | Push-ilmoitus vastaanotettu | Notifikaatio näkyy |
| 8 | Push-ilmoituksen klikkaus → avaa URL | Oikea sivu avautuu |
| 9 | Install-banneri näkyy | beforeinstallprompt event |
| 10 | Lighthouse PWA-pisteet ≥ 90 | Auditointiraportti OK |

### 3.1.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/static/manifest.json` — Web App Manifest |
| **Uusi** | `src/static/sw.js` — Service Worker |
| **Uusi** | `src/static/icons/` — PWA-ikonit (192, 512, maskable) |
| **Uusi** | `src/static/offline.html` — Offline-sivu |
| **Uusi** | `src/services/push.ts` — Push Notification service |
| **Uusi** | `src/routes/push.ts` — Push-endpointit |
| **Muokataan** | `src/config.ts` — VAPID-konfiguraatio |
| **Muokataan** | `src/storage/interface.ts` — PushSubscriptionRecord |
| **Muokataan** | `src/storage/memory.ts` — In-memory push subscriptions |
| **Muokataan** | `src/routes/portal-human.ts` — Manifest-linkki, SW-rekisteröinti, responsive nav |
| **Muokataan** | `src/server.ts` — Staattisten tiedostojen palvelu, pushRouter |
| **Muokataan** | `.env.example` — VAPID-muuttujat |
| **Muokataan** | `openapi.yaml` — Push-endpointit |

---

## 3.2 Graafinen personal node -asennusohjelma

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
│              │ aimeat node    │     │
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

## 3.3 EUDIW / MyData / W3C VC -integraatiot

> Lähde: masterplan (§3.3), `docs/ghii-identity-and-network-plan.md`, `docs/research/bbs-aikakaudesta-ai-aikaan.md` (§7)

### 3.3.1 Tavoite

Integroida AIMEAT eurooppalaiseen ja kansainväliseen identiteetti- ja data-ekosysteemiin: EU:n digitaalinen identiteettilompakko (eIDAS 2.0), W3C Verifiable Credentials, MyData-periaatteet ja Suomen luottamusverkko (FTN). Tämä mahdollistaa GHII Tier 3:n — vahvimman identiteettivahvistuksen — ja yhteensopivuuden muiden datanhallintatyökalujen kanssa.

### 3.3.2 Standardikartta

| Standardi | Versio | Rooli AIMEAT:ssa | Integraatiotapa |
|---|---|---|---|
| **eIDAS 2.0 (EUDIW)** | EU Regulation 2024/1183 | GHII Tier 3: vahva identiteetti | OpenID4VP -presentaatioiden vastaanotto |
| **OpenID4VP** | Draft 20+ | EUDIW:n esitysprotokolla | Verifier-rooli (AIMEAT vastaanottaa) |
| **SD-JWT** | RFC 9449 | Selective Disclosure -todistukset | Validointi jose-kirjastolla |
| **W3C Verifiable Credentials** | v2.0 (2024) | Attestaatiot GHII:lle | VC-dokumenttien luonti + validointi |
| **MyData** | Principles 2023 | Consent receipt -malli | Integraatio Phase 0.3 audit trailiin |
| **Suomen luottamusverkko (FTN)** | Current | Suomalainen identiteetti | Tunnistautuminen FTN-palveluntarjoajan kautta |

### 3.3.3 GHII Tier 3 -implementaatio

**Nykyinen GHII-tierjärjestelmä:**

| Tier | Vahvistus | Phase |
|---|---|---|
| 0 | Ei vahvistusta (anonyymi) | Phase 0 (nykyinen) |
| 1 | Email + TOTP | Phase 0.5 + 1.3 |
| 2 | Operaattorin vahvistama | Phase 1.3 (manuaalinen) |
| 3 | EU digitaalinen lompakko / FTN | **Phase 3.3** |

**Tier 3 -vahvistusflow:**

```
1. Käyttäjä avaa "Vahvista identiteettisi" -sivun portaalissa
       ↓
2. Valitsee: "EU Digital Identity Wallet" TAI "Suomi.fi tunnistus"
       ↓
3. AIMEAT generoi OpenID4VP Authorization Request
   - Pyydetyt attribuutit: nimi, syntymäaika, kansalaisuus
   - Selective Disclosure: vain tarvittavat kentät
       ↓
4. Käyttäjä vahvistaa EU-lompakossa / Suomi.fi:ssä
       ↓
5. AIMEAT vastaanottaa VP Token (Verifiable Presentation)
       ↓
6. Validointi:
   a. SD-JWT -allekirjoituksen tarkistus
   b. Myöntäjän (issuer) luotettavuus → trusted issuers -lista
   c. Attribuuttien purkaminen
       ↓
7. GHII Level 2 → Level 3, vahvistustiedot tallennetaan
   (ei raakadataa — vain hash + myöntäjä + aikaleima)
```

### 3.3.4 Uudet riippuvuudet

```bash
cd aimeat
pnpm add @sd-jwt/core @sd-jwt/types
```

| Paketti | Versio | Tarkoitus |
|---|---|---|
| `@sd-jwt/core` | ^0.x | SD-JWT -todistusten parsinta ja validointi |
| `@sd-jwt/types` | ^0.x | TypeScript-tyypit SD-JWT:lle |

**Huom:** `jose`-kirjasto (jo käytössä) tukee EdDSA JWT:tä. SD-JWT on laajennus.

### 3.3.5 Uudet endpointit

#### POST /v1/ghii/verify/eudiw

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/verify/eudiw` |
| **Auth** | Vaatii JWT (GHII Level 1+) |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "vp_token": "eyJ...",
  "presentation_submission": {
    "id": "submission-1",
    "definition_id": "aimeat-identity-verification",
    "descriptor_map": [
      { "id": "identity-credential", "format": "vc+sd-jwt", "path": "$" }
    ]
  }
}
```

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "ghii": "erkki62@aimeat-finland-001-genesis",
    "verificationLevel": 3,
    "verificationMethod": "eudiw",
    "verifiedAttributes": ["name", "date_of_birth", "nationality"],
    "issuer": "https://issuer.eudiw.example.eu",
    "verifiedAt": "2026-03-15T10:00:00Z"
  }
}
```

#### GET /v1/ghii/verify/eudiw/request

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/ghii/verify/eudiw/request` |
| **Auth** | Vaatii JWT |

**Response 200:**
Palauttaa OpenID4VP Authorization Request -objektin jonka käyttäjä skannaa EU-lompakolla (QR-koodi tai deep link).

#### POST /v1/ghii/verify/ftn

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/verify/ftn` |
| **Auth** | Vaatii JWT |

Suomen luottamusverkon kautta tunnistautuminen (Suomi.fi). Callback-pohjainen.

### 3.3.6 W3C Verifiable Credentials — AIMEAT Attestation

AIMEAT voi myös **myöntää** Verifiable Credentials GHII-profiileille:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://aimeat.spechops.com/ns/credentials/v1"
  ],
  "type": ["VerifiableCredential", "AIMEATIdentityCredential"],
  "issuer": "did:web:aimeat-finland-001-genesis.aimeat.example",
  "issuanceDate": "2026-03-15T10:00:00Z",
  "credentialSubject": {
    "id": "did:aimeat:erkki62@aimeat-finland-001-genesis",
    "type": "AIMEATUser",
    "verificationLevel": 3,
    "memberSince": "2026-03-01",
    "trustScore": 87
  }
}
```

**Endpoint:** `GET /v1/ghii/:ghii/credential` — Myönnä VC kyseisestä GHII-profiilista.

### 3.3.7 MyData Consent Receipt -integraatio

MyData consent receipt -malli integroituu Phase 0.3 Consent Layeriin:

```json
{
  "version": "KI-CR-v1.1.0",
  "jurisdiction": "FI",
  "consentTimestamp": "2026-03-15T10:00:00Z",
  "collectionMethod": "web form",
  "consentReceiptID": "consent-001",
  "publicKey": "...",
  "language": "fi",
  "piiPrincipalId": "erkki62@aimeat-finland-001-genesis",
  "piiControllers": [{ "piiController": "aimeat-finland-001-genesis", "onBehalf": false }],
  "services": [
    {
      "service": "AIMEAT Discovery",
      "purposes": [
        {
          "purpose": "community-discovery",
          "consentType": "EXPLICIT",
          "piiCategory": ["interests", "location"],
          "termination": "revocation"
        }
      ]
    }
  ]
}
```

**Endpoint:** `GET /v1/consent/:id/receipt` — Palauttaa MyData Consent Receipt -formaatissa.

### 3.3.8 Storage-muutokset

**GHIIRecord-laajennukset:**

```typescript
export interface GHIIRecord {
  // ... nykyiset kentät ...

  // Phase 3.3 laajennukset
  verifiedAttributes?: string[];        // ["name", "date_of_birth", "nationality"]
  verificationIssuer?: string;          // "https://issuer.eudiw.example.eu"
  verificationCredentialHash?: string;  // SHA-256 hash of the credential
  ftnVerified?: boolean;                // Suomen luottamusverkko
}
```

**Uusi record-tyyppi: TrustedIssuerRecord**

```typescript
export interface TrustedIssuerRecord {
  id: string;                  // UUID
  name: string;                // "EU Digital Identity Wallet - Finland"
  url: string;                 // "https://issuer.eudiw.example.eu"
  publicKey: string;           // Myöntäjän julkinen avain
  type: 'eudiw' | 'ftn' | 'w3c_vc' | 'custom';
  trusted: boolean;
  addedBy: string;             // Operaattori
  createdAt: string;
}
```

### 3.3.9 Konfiguraatio

```env
# ── EUDIW / Identity Verification ──────────────────────────
# AIMEAT_EUDIW_ENABLED=false
# AIMEAT_EUDIW_CLIENT_ID="aimeat-verifier-001"
# AIMEAT_EUDIW_REDIRECT_URI="https://your-node.example/v1/ghii/verify/eudiw/callback"
# AIMEAT_FTN_ENABLED=false
# AIMEAT_FTN_PROVIDER_URL="https://tunnistautuminen.suomi.fi"
# AIMEAT_VC_ISSUER_DID="did:web:your-node.example"
```

### 3.3.10 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | EUDIW: Authorization Request -generointi | Oikea OpenID4VP-rakenne |
| 2 | EUDIW: VP Token -validointi (valid) | Level → 3, attribuutit tallennettu |
| 3 | EUDIW: VP Token -validointi (expired) | 401, "Credential expired" |
| 4 | EUDIW: VP Token tuntemattomalta myöntäjältä | 403, "Untrusted issuer" |
| 5 | EUDIW disabled | 503, "EUDIW verification not available" |
| 6 | FTN: callback-validointi | Level → 3 |
| 7 | W3C VC: credential-myöntäminen | Oikea VC-rakenne |
| 8 | MyData: consent receipt -generointi | Oikea KI-CR-formaatti |
| 9 | Trusted issuer -lisäys (operaattori) | 200, issuer tallennettu |
| 10 | Trusted issuer -listaus | 200, lista |

### 3.3.11 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/eudiw.ts` — EUDIW / OpenID4VP verifier |
| **Uusi** | `src/services/vc-issuer.ts` — W3C VC credential issuer |
| **Uusi** | `src/services/mydata-receipt.ts` — MyData consent receipt generator |
| **Uusi** | `src/routes/verification.ts` — EUDIW, FTN, VC endpointit |
| **Muokataan** | `src/config.ts` — EUDIW, FTN, VC konfiguraatio |
| **Muokataan** | `src/storage/interface.ts` — GHIIRecord laajennukset, TrustedIssuerRecord |
| **Muokataan** | `src/storage/memory.ts` — In-memory toteutus |
| **Muokataan** | `src/routes/ghii.ts` — Level 3 -vahvistus integraatio |
| **Muokataan** | `openapi.yaml` — Verification-endpointit, VC schema |
| **Muokataan** | `.env.example` — EUDIW, FTN muuttujat |

---

## 3.4 Advanced federation

> Lähde: masterplan (§3.4), `docs/05-federation.md`

### 3.4.1 Tavoite

Laajentaa federaatiojärjestelmä multi-genesis -arkkitehtuuriksi: useamman genesis-noden välinen discovery, organismi-reputaatio, CSM-palveluiden automaattinen jakelu ja cross-node matchaus.

### 3.4.2 Cross-federation discovery

**Nykytilanne:** Yksi genesis-node per federaatio. Kaikki nodet tuntevat genesis-nodensa.

**Tavoite:** Useampi genesis-node voi peeriä keskenään → laajempi verkko.

**Genesis-peering -protokolla:**

```
Genesis A ←→ Genesis B:
  1. A kutsuu B:n: POST /v1/federation/genesis-peer
  2. B validoi A:n (readiness-testi + operaattorin hyväksyntä)
  3. Molemmat lisäävät toisensa "trusted genesis" -listaan
  4. Katalogi-sync: molemmat synkkaavat oman federaation cataloguen
  5. Profiili-index: molemmat jakavat anonymisoidut profiili-statistiikat
```

**Uudet endpointit:**

| Metodi | Polku | Auth | Kuvaus |
|---|---|---|---|
| POST | `/v1/federation/genesis-peer` | Operator | Pyydä genesis-peering |
| GET | `/v1/federation/genesis-peers` | Operator | Listaa genesis-peerit |
| DELETE | `/v1/federation/genesis-peer/:id` | Operator | Poista genesis-peering |
| GET | `/v1/federation/cross-catalogue` | Tier 0 | Hae cross-federation catalogue |
| GET | `/v1/federation/network-stats` | Tier 0 | Koko verkon statistiikat |

### 3.4.3 Organismi-reputaatio

**Reputaation komponentit:**

| Komponentti | Paino | Laskenta |
|---|---|---|
| Jäsenmäärä | 0.20 | `log10(members) / log10(max_members)` |
| Aktiivisuus | 0.25 | Postaukset/viikko viimeisen kuukauden aikana |
| Jäsenten trust-keskiarvo | 0.25 | Jäsenten trust-pisteiden keskiarvo |
| Ikä | 0.15 | `min(age_days / 365, 1.0)` |
| Flag-historia | 0.15 | `max(1.0 - (total_flags / (members * 0.1)), 0)` |

**Uusi endpoint:**

| Metodi | Polku | Auth | Kuvaus |
|---|---|---|---|
| GET | `/v1/organisms/:id/reputation` | Tier 0 | Organismin reputaatiopisteet |

### 3.4.4 CSM-palveluiden automaattinen federation-jakelu

Kun operaattori julkaisee CSM-palvelun, se voidaan automaattisesti jakaa federation-peereille:

```
1. Operaattori: POST /v1/csm { ..., "federate": true }
2. Catalogue-sync lisää CSM:n federated catalogueen
3. Peer-nodet vastaanottavat CSM:n ja lisäävät omaan katalogiin
4. Peer-noden käyttäjät voivat löytää + käyttää palvelua
```

**Uusi kenttä CsmRecordiin:** `federate: boolean` (oletus: false)

### 3.4.5 Cross-node matchaus-agentti

Laajennetaan Phase 2.1 matchaus-agenttiä federaation yli:

```
1. Node A:n matchaus-agentti pyytää anonymisoitua profiili-dataa peeriltä B
2. B palauttaa: { interests: [...], city: "...", hash: "..." }
   (ei GHII:ta, ei nimeä — vain kiinnostukset + sijainti)
3. A:n matchaus-agentti laskee match-scoren
4. Jos match → A lähettää B:lle "match request" anonymisoidusti
5. B:n node ilmoittaa käyttäjälleen: "Toisen noden käyttäjä kiinnostui samoista asioista"
6. Molemminpuolinen accept → GHII-tiedot vaihdetaan
```

**Yksityisyydensuoja:**
- Profiilidata anonymisoituna (ei GHII:ta ennen molemminpuolista acceptia)
- Hash-pohjainen parinmuodostus (ei voi kohdistaa yksittäiseen henkilöön)
- Cross-node match-pyyntö sisältää vain hash + kiinnostukset

### 3.4.6 Storage-muutokset

**Uudet record-tyypit:**

```typescript
export interface GenesisPeerRecord {
  id: string;
  genesisNodeId: string;       // Toisen genesis-noden ID
  genesisUrl: string;          // URL
  publicKey: string;
  status: 'pending' | 'active' | 'suspended';
  lastSyncAt: string;
  catalogueHash: string;       // Viimeisin synkattu catalogue-hash
  createdAt: string;
  updatedAt: string;
}

export interface OrganismReputationRecord {
  organismId: string;
  score: number;               // 0-100
  breakdown: {
    memberScore: number;
    activityScore: number;
    trustScore: number;
    ageScore: number;
    flagScore: number;
  };
  calculatedAt: string;
}
```

### 3.4.7 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Genesis-peering pyyntö | 201, pending |
| 2 | Genesis-peering hyväksyntä | Status → active |
| 3 | Cross-catalogue haku | Molempien federaatioiden tulokset |
| 4 | Network-stats | Kokonaislukuja kaikista genesis-peereistä |
| 5 | Organismi-reputaatio: aktiivinen ryhmä | Score > 60 |
| 6 | Organismi-reputaatio: tyhjä ryhmä | Score < 20 |
| 7 | CSM federation-jakelu | CSM näkyy peer-nodessa |
| 8 | Cross-node matchaus: anonymisoitu pyyntö | Hash + kiinnostukset, ei GHII:ta |
| 9 | Cross-node matchaus: molemminpuolinen accept | GHII:t vaihdettu |
| 10 | Genesis-depeering | Grace period, sync lopetetaan |

### 3.4.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/genesis-peering.ts` — Cross-federation peering |
| **Uusi** | `src/services/organism-reputation.ts` — Reputaatiolaskenta |
| **Uusi** | `src/services/cross-node-matching.ts` — Anonymisoitu cross-node matchaus |
| **Muokataan** | `src/routes/federation.ts` — Genesis-peer endpointit, cross-catalogue |
| **Muokataan** | `src/routes/organisms.ts` — Reputaatio-endpoint |
| **Muokataan** | `src/routes/csm.ts` — federate-kenttä |
| **Muokataan** | `src/storage/interface.ts` — GenesisPeerRecord, OrganismReputationRecord |
| **Muokataan** | `src/storage/memory.ts` — In-memory toteutus |
| **Muokataan** | `src/config.ts` — Cross-federation konfiguraatio |
| **Muokataan** | `openapi.yaml` — Genesis-peer, reputation, cross-catalogue endpointit |
| **Muokataan** | `.env.example` — CROSS_FEDERATION -muuttujat |

---

## 3.5 Semanttinen ontologia (Phase 3 -rakenteet)

### 3.5.1 Phase 3 -rakenteiden semanttiset annotaatiot

#### PushSubscriptionRecord — ei tarvita

Sisäinen tekninen record.

#### GenesisPeerRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Organization",
    "schema:memberOf": "aimeat:CrossFederation"
  }
}
```

#### OrganismReputationRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Rating",
    "schema:ratingValue": 78,
    "schema:bestRating": 100,
    "schema:worstRating": 0
  }
}
```

#### W3C Verifiable Credential (AIMEAT-myönnetty)

Noudattaa W3C VC v2.0 -rakennetta — semanttinen annotaatio on sisäänrakennettu standardiin (`@context`, `type`, `credentialSubject`).

### 3.5.2 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Genesis-peer response sisältää semantic | schema:Organization |
| 2 | Reputation response sisältää semantic | schema:Rating |
| 3 | VC noudattaa W3C VC v2.0 -rakennetta | Validointityökalun läpi |

---

## 3.6 Dokumentaation ylläpito (Phase 3)

### 3.6.1 Dokumenttikartta

| Dokumentti | Vaikuttavat komponentit | Muutokset |
|---|---|---|
| `docs/05-federation.md` | 3.4 (advanced federation) | Cross-genesis, reputation, CSM-jakelu |
| `docs/08-human-layer.md` | 3.1 (PWA), 3.3 (EUDIW/VC) | Mobile, push, Tier 3 |
| `docs/09-community.md` | 3.4 (cross-federation) | Multi-genesis, organismi-reputaatio |
| `docs/ghii-identity-and-network-plan.md` | 3.3 (EUDIW/VC) | Tier 3 implementaatio |
| `docs/nextlevel/aimeat-personal-node-spec.md` | 3.2 (desktop installer) | Tauri-asennusohjelma |

**Uudet dokumentit:**

| Dokumentti | Komponentti |
|---|---|
| `docs/aimeat-pwa-guide.md` | 3.1 PWA |
| `docs/aimeat-eudiw-integration.md` | 3.3 EUDIW |
| `docs/aimeat-vc-spec.md` | 3.3 W3C VC |
| `docs/aimeat-cross-federation.md` | 3.4 Advanced federation |

**openapi.yaml:** ~15 uutta endpointia.

### 3.6.2 Definition of Done

- [ ] `openapi.yaml` päivitetty ~15 uudella endpointilla
- [ ] PWA-guide dokumentoitu
- [ ] EUDIW-integraatio dokumentoitu
- [ ] W3C VC -speksi dokumentoitu
- [ ] Cross-federation -speksi dokumentoitu
- [ ] RFC-dokumentit päivitetty
- [ ] `.env.example` päivitetty

---

## 3.7 Testausstrategia (Phase 3)

### 3.7.1 E2E-testit

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 24: PWA | 3.1 | 6 | Portaali |
| Phase 25: Desktop Installer | 3.2 | 5 | Personal node |
| Phase 26: EUDIW / VC | 3.3 | 7 | GHII |
| Phase 27: Advanced Federation | 3.4 | 8 | Federation |
| Phase 28: Semantic (Phase 3) | 3.5 | 3 | — |
| **Yhteensä Phase 3** | | **29** | |

**Kokonaistestimäärä:** Phase 0: ~111 + Phase 1: 45 + Phase 2: 46 + Phase 3: 29 = **~231 E2E-testiä**

### 3.7.2 Yksikkötestit (vitest)

| Testitiedosto | Komponentti | Testejä |
|---|---|---|
| `test/unit/push-service.test.ts` | 3.1 | ~8 |
| `test/unit/service-worker.test.ts` | 3.1 | ~6 |
| `test/unit/eudiw-verifier.test.ts` | 3.3 | ~12 |
| `test/unit/vc-issuer.test.ts` | 3.3 | ~8 |
| `test/unit/mydata-receipt.test.ts` | 3.3 | ~6 |
| `test/unit/genesis-peering.test.ts` | 3.4 | ~10 |
| `test/unit/organism-reputation.test.ts` | 3.4 | ~8 |
| `test/unit/cross-node-matching.test.ts` | 3.4 | ~10 |
| **Yhteensä Phase 3** | | **~68** |

### 3.7.3 Desktop-testaus

Desktop-sovellus (3.2) testataan erillisellä testausstrategialla:
- **Unit-testit (Rust):** Tauri-backend Rust-testit (`cargo test`)
- **E2E (Tauri):** Tauri:n WebDriver-integraatio
- **Manuaalinen:** Windows/macOS/Linux testaus CI:ssä

### 3.7.4 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `test/e2e-full.ts` — 29 uutta E2E-testiä (Phase 24-28) |
| **Uusi** | `test/unit/push-service.test.ts` |
| **Uusi** | `test/unit/service-worker.test.ts` |
| **Uusi** | `test/unit/eudiw-verifier.test.ts` |
| **Uusi** | `test/unit/vc-issuer.test.ts` |
| **Uusi** | `test/unit/mydata-receipt.test.ts` |
| **Uusi** | `test/unit/genesis-peering.test.ts` |
| **Uusi** | `test/unit/organism-reputation.test.ts` |
| **Uusi** | `test/unit/cross-node-matching.test.ts` |
| **Uusi** | `aimeat-desktop/src-tauri/tests/` — Rust-testit |

---

## Riippuvuuskaavio (koko projekti)

```
Phase 0 (Foundation):
  0.1 Schema Locking ──→ 0.2 CSM ──→ 0.7 Semantic ──→ 0.7b Retrofit
  0.3 Consent Layer ──→ 0.4 Profiilit
  0.5 OTP/TOTP, 0.6 DMZ

Phase 1 ("Ensimmäinen yhteisö"):
  1.1 Email ──→ 1.3 GHII-rek. ──→ 1.6 Harrastehakemisto
  1.2 Wizard, 1.4 Hakemistot, 1.5 Flaggaus

Phase 2 ("Markkinapaikka + yhteisötyökalut"):
  2.1 AI-matchaus, 2.2 Organismit ──→ 2.3 Workspaces
  2.4 Moderointi, 2.5 CSM-templates ──→ 2.6 Markkinapaikka

Phase 3 ("Polish + tulevaisuus") — tämä dokumentti:
  3.1 PWA ────────────────────── (itsenäinen)
  3.2 Desktop-asennusohjelma ─── (itsenäinen)
  3.3 EUDIW / MyData / VC ────── (itsenäinen)
  3.4 Advanced federation ─────── (itsenäinen)
  3.5-3.7 Semantic, Docs, Tests ── (läpileikkaava)
```

---

## Yhteenveto

| # | Komponentti | Uudet tiedostot | Muokatut tiedostot | Uudet endpointit | E2E-testit | Yksikkötestit |
|---|---|---|---|---|---|---|
| 3.1 | PWA | 6 | 6 | 3 | 6 | ~14 |
| 3.2 | Desktop-asennusohjelma | ~15 (Tauri) | 1 | 0 | 5 | ~20 (Rust) |
| 3.3 | EUDIW / MyData / VC | 4 | 6 | 5 | 7 | ~26 |
| 3.4 | Advanced federation | 3 | 7 | 5 | 8 | ~28 |
| 3.5 | Semanttinen ontologia | 0 | 3 | 0 | 3 | 0 |
| 3.6 | Dokumentaatio | 4 | ~6 | 0 | 0 | 0 |
| 3.7 | Testausstrategia | 9 | 1 | 0 | 29 | ~68 |
| **Yhteensä** | | **~41** | **~30** | **~13** | **29** | **~68** |

## Definition of Done — Phase 3

### Per komponentti:
- [ ] Kaikki endpointit implementoitu ja vastaavat openapi.yaml-spesifikaatiota
- [ ] E2E-testit kirjoitettu ja menevät läpi
- [ ] Yksikkötestit kirjoitettu ja menevät läpi
- [ ] `npx tsc --noEmit` menee läpi

### Phase 3 kokonaisuutena:
- [ ] PWA: offline-tuki, push-ilmoitukset, asennettavuus, Lighthouse ≥ 90
- [ ] Desktop: Tauri-sovellus, wizard, system tray, AI-tunnistus (LM Studio/Ollama)
- [ ] EUDIW: OpenID4VP verifier, SD-JWT validointi, GHII Tier 3
- [ ] W3C VC: credential-myöntäminen, validointi
- [ ] MyData: consent receipt -generointi
- [ ] FTN: Suomi.fi tunnistautuminen
- [ ] Advanced federation: cross-genesis, reputation, CSM-jakelu, cross-node matchaus
- [ ] 231+ E2E-testiä (kaikki 4 phasea)
- [ ] ~68 yksikkötestiä Phase 3:lle
- [ ] Kaikki RFC-dokumentit päivitetty
- [ ] Desktop-sovellus toimii Windows/macOS/Linux

---

## Koko projektin yhteenveto

| Phase | Komponentteja | Endpointit | E2E-testit | Yksikkötestit | Tiedostot |
|---|---|---|---|---|---|
| Phase 0 | 10 | ~17 | ~111 | ~80 | ~40 |
| Phase 1 | 9 | ~17 | 45 | ~64 | ~61 |
| Phase 2 | 9 | ~20 | 46 | ~86 | ~70 |
| Phase 3 | 7 | ~13 | 29 | ~68 | ~71 |
| **Yhteensä** | **35** | **~67** | **~231** | **~298** | **~242** |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
