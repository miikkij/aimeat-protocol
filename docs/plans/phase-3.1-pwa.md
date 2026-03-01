# 3.1 Mobiilisovellus (PWA)

*Alidokumentti: [phase-3-polish-future.md](./phase-3-polish-future.md)*

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

← [Phase 3: Polish + tulevaisuus](./phase-3-polish-future.md)
