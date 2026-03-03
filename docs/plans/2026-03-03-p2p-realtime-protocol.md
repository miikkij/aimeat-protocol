# P2P Realtime Protocol — AIMEAT Discovery & Signaling Layer

**Päivämäärä:** 2026-03-03  
**Tila:** Suunnitelma  
**Vaikutus:** Uudet endpointit, WebSocket-kanava, storage-muutokset, frontend-API  
**Riippuvuudet:** Olemassa oleva `ws`-kirjasto, `TunnelManager`-arkkitehtuuri, apps-järjestelmä

---

## 1. Ongelma

AIMEAT-appsit (HTML+JS, AI-generoituja tai käsin tehtyjä) toimivat tällä hetkellä **yksinäisinä saarekkeina**. Jokainen app puhuu vain AIMEAT Memory API:lle (HTTP GET/POST) ja näkee muiden datan vain pollaamalla. Reaaliaikaista kommunikaatiota appien välillä ei ole.

**Käytännön esimerkki:** Kaksi käyttäjää haluaa soittaa musiikkia yhdessä. Kumpikin avaa Band-appin. Mutta appit eivät tiedä toisistaan mitään eikä ääni kulje reaaliajassa.

**Tarve:** Mekanismi jolla:
1. App löytää muut saman appin instanssit (discovery)
2. AppIt voivat muodostaa suoran P2P-yhteyden (signaling → WebRTC)
3. Data liikkuu reaaliajassa appien välillä (CRDT tai viestit)
4. AIMEAT toimii vain välittäjänä (ei reititä koko dataliikennettä)

---

## 2. Arkkitehtuurivalinta

### 2.1 Protokollavertailu

| Ominaisuus | WebRTC (+ AIMEAT signaling) | Yjs over WebSocket | Puhdas WebSocket relay |
|---|---|---|---|
| **Latenssi** | Erittäin matala (P2P) | Matala (serverin kautta) | Matala (serverin kautta) |
| **Serverin kuorma** | Minimaalinen (vain signaling) | Korkea (kaikki data serverin läpi) | Korkea |
| **NAT-läpäisy** | STUN/TURN tarvitaan | Ei ongelmaa | Ei ongelmaa |
| **Audio/video** | Natiivi tuki | Ei | Ei |
| **CRDT-synkronointi** | Vaatii datakanavan + Yjs | Sisäänrakennettu | Manuaalinen |
| **Selaintuki** | Erinomainen | Erinomainen | Erinomainen |
| **Monimutkaisuus** | Korkea (ICE, SDP, TURN) | Matala-keskitaso | Matala |
| **Offline-tuki** | Ei (P2P vaatii molemmat online) | Yjs mergee offline-muutokset | Ei |

### 2.2 Suositus: Hybridimalli

**Kerros 1 — AIMEAT Presence & Signaling (WebSocket)**
- AIMEAT-serveri tarjoaa kevyen WebSocket-huoneen per app-instanssi
- Hoitaa: presence (kuka on paikalla), discovery (mitkä huoneet ovat auki), signaling (WebRTC SDP/ICE-vaihto)
- Hoitaa myös: pienet viestit ja CRDT-synkronointi niille appeille jotka eivät tarvitse WebRTC:tä

**Kerros 2 — WebRTC Data/Media Channel (P2P)**
- Kun kaksi appia haluaa suoran yhteyden (esim. audio, video, pelidata), ne käyttävät kerros 1:n signaling-kanavaa WebRTC-yhteyden muodostamiseen
- AIMEAT ei näe eikä reititä P2P-dataa → serverin kuorma minimoitu
- Fallback: Jos WebRTC epäonnistuu (NAT-ongelma), data kulkee kerros 1:n WebSocket-relayn kautta

**Kerros 3 — Yjs CRDT (valinnainen)**
- Appeille jotka tarvitsevat jaetun dokumentin/tilan (esim. yhteinen piirtoalusta, shared todo-lista)
- Yjs-dokumentti synkronoidaan kerros 1:n (WebSocket) tai kerros 2:n (WebRTC datakanava) kautta
- AIMEAT tallentaa Yjs-dokumentin snapshot:in Memoryyn persistence-kerrokseksi

### 2.3 Miksi tämä malli?

- **AI-generoitavuus:** AI voi generoida HTML-appin joka sisältää P2P-logiikan koska frontend-kirjastot (simple-peer, yjs) ovat pieniä ja CDN-ladattavia
- **Skaalautuvuus:** AIMEAT-serveri ei reititä raskasta dataa; P2P hoitaa sen
- **Yksinkertaisuus:** Jos app ei tarvitse WebRTC:tä, pelkkä WebSocket-presence riittää
- **Olemassa oleva infra:** `ws`-kirjasto ja WebSocket upgrade -mekanismi on jo `index.ts`:ssä

---

## 3. AIMEAT-serverin muutokset

### 3.1 Uudet endpointit (HTTP)

| Metodi | Polku | Auth | Kuvaus |
|---|---|---|---|
| POST | `/v1/realtime/rooms` | OTK / Agent JWT | Luo huone (tai liity olemassa olevaan) |
| GET | `/v1/realtime/rooms` | OTK / Agent JWT | Listaa aktiiviset huoneet (filtteri: app-tyyppi, tagi) |
| GET | `/v1/realtime/rooms/:roomId` | OTK / Agent JWT | Huoneen tiedot + osallistujat |
| DELETE | `/v1/realtime/rooms/:roomId` | Huoneen luoja / Operator | Sulje huone |
| GET | `/v1/realtime/ice-servers` | OTK / Agent JWT | Palauttaa STUN/TURN-konfiguraation WebRTC:lle |

### 3.2 WebSocket-endpoint

```
ws(s)://node-url/v1/realtime/ws?room=ROOM_ID&token=OTK_OR_JWT&nick=DISPLAY_NAME
```

**Kytkentä `index.ts`:ssä** (samaan `server.on('upgrade')` -handlerin kuten `/v1/personal/tunnel`):

```typescript
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === '/v1/personal/tunnel') {
    // ... olemassa oleva TunnelManager
  } else if (url.pathname === '/v1/realtime/ws') {
    realtimeWss.handleUpgrade(req, socket, head, (ws) => {
      realtimeWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});
```

### 3.3 WebSocket-viestiformaatti (JSON)

**Client → Server:**

```typescript
// Liittyy huoneeseen (automaattinen yhteyden avautuessa)
{ "type": "join", "roomId": "band-session-abc", "nick": "Jouni" }

// Presence-päivitys
{ "type": "presence", "state": { "instrument": "guitar", "muted": false } }

// Signaaliviesti WebRTC:lle (SDP offer/answer, ICE candidate)
{ "type": "signal", "to": "peer-id-xyz", "payload": { /* SDP/ICE */ } }

// Yleisviesti kaikille huoneessa (pieni data, max 16 KB)
{ "type": "broadcast", "payload": { /* app-kohtainen data */ } }

// Yjs-synkronointiviesti
{ "type": "yjs-sync", "docId": "shared-canvas", "update": "base64..." }

// Lähtee huoneesta
{ "type": "leave" }
```

**Server → Client:**

```typescript
// Huoneeseen liittyminen onnistui
{ "type": "joined", "roomId": "...", "peerId": "your-peer-id", "peers": [...] }

// Uusi peer liittyi
{ "type": "peer-joined", "peerId": "...", "nick": "...", "state": {...} }

// Peer lähti
{ "type": "peer-left", "peerId": "..." }

// Presence-päivitys muilta
{ "type": "peer-presence", "peerId": "...", "state": {...} }

// Signaaliviesti reititetty
{ "type": "signal", "from": "peer-id-abc", "payload": { /* SDP/ICE */ } }

// Broadcast muilta
{ "type": "broadcast", "from": "peer-id-abc", "payload": {...} }

// Yjs-sync muilta
{ "type": "yjs-sync", "from": "peer-id-abc", "docId": "...", "update": "base64..." }

// Virhe
{ "type": "error", "code": "ROOM_FULL", "message": "..." }
```

### 3.4 RealtimeManager-luokka

Uusi service-luokka (`src/services/realtime-manager.ts`), samaa mallia kuin `TunnelManager`:

```typescript
export interface RealtimeRoom {
  id: string;
  appType: string;           // esim. "band", "whiteboard", "game"
  name: string;
  createdBy: string;         // GAII tai OTK-tunnus
  maxPeers: number;          // oletus: 20
  isPublic: boolean;         // näkyykö room-listauksessa
  tags: string[];
  peers: Map<string, PeerConnection>;
  yjsDocs: Map<string, Uint8Array>;  // doc snapshots
  createdAt: Date;
  lastActivityAt: Date;
}

export interface PeerConnection {
  peerId: string;
  ws: WebSocket;
  nick: string;
  state: Record<string, unknown>;  // app-kohtainen presence-data
  joinedAt: Date;
}

export class RealtimeManager {
  private rooms: Map<string, RealtimeRoom>;

  // Huoneen elinkaari
  createRoom(opts: CreateRoomOpts): RealtimeRoom;
  joinRoom(roomId: string, ws: WebSocket, nick: string): PeerConnection;
  leaveRoom(roomId: string, peerId: string): void;
  closeRoom(roomId: string): void;

  // Viestit
  broadcastToRoom(roomId: string, fromPeerId: string, message: object): void;
  signalToPeer(roomId: string, fromPeerId: string, toPeerId: string, payload: object): void;

  // Yjs-tuki
  applyYjsUpdate(roomId: string, docId: string, update: Uint8Array): void;
  getYjsSnapshot(roomId: string, docId: string): Uint8Array | null;

  // Discovery
  listRooms(filter?: { appType?: string; tag?: string }): RealtimeRoom[];
  getRoomInfo(roomId: string): RealtimeRoom | null;

  // Siivous
  cleanupInactiveRooms(maxIdleMs: number): void;
}
```

### 3.5 Storage-muutokset

Uusi record `interface.ts`:iin:

```typescript
export interface RealtimeRoomRecord {
  id: string;
  appType: string;
  name: string;
  createdBy: string;
  maxPeers: number;
  isPublic: boolean;
  tags: string[];
  peerCount: number;
  yjsDocIds: string[];
  createdAt: string;
  lastActivityAt: string;
}
```

Storage interface:

```typescript
// Realtime rooms
createRealtimeRoom(room: RealtimeRoomRecord): Promise<void>;
getRealtimeRoom(id: string): Promise<RealtimeRoomRecord | null>;
listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]>;
deleteRealtimeRoom(id: string): Promise<void>;
updateRealtimeRoomActivity(id: string): Promise<void>;
```

### 3.6 Konfiguraatio

Uudet `AimeatConfig`-kentät:

```typescript
realtimeEnabled: boolean;             // oletus: true
realtimeMaxRooms: number;             // oletus: 100
realtimeMaxPeersPerRoom: number;      // oletus: 20
realtimeRoomIdleTimeoutMs: number;    // oletus: 3600000 (1h)
realtimeMaxMessageSizeBytes: number;  // oletus: 16384 (16KB)
stunServers: string[];                // oletus: ['stun:stun.l.google.com:19302']
turnServer?: string;                  // valinnainen TURN-serveri
turnUsername?: string;
turnCredential?: string;
```

Ympäristömuuttujat:

```env
AIMEAT_REALTIME_ENABLED=true
AIMEAT_REALTIME_MAX_ROOMS=100
AIMEAT_REALTIME_MAX_PEERS_PER_ROOM=20
AIMEAT_REALTIME_ROOM_IDLE_TIMEOUT_MS=3600000
AIMEAT_STUN_SERVERS=stun:stun.l.google.com:19302
AIMEAT_TURN_SERVER=
AIMEAT_TURN_USERNAME=
AIMEAT_TURN_CREDENTIAL=
```

---

## 4. Frontend / App-puolen API

### 4.1 AIMEAT Realtime Client -kirjasto

Pieni JavaScript-kirjasto joka sisällytetään AI-generoituihin appseihin (tai ladataan AIMEAT-noden `/v1/lib/realtime.js` -endpointista):

```javascript
class AimeatRealtime {
  constructor(nodeUrl, token) { ... }

  // Huoneen hallinta
  async createRoom(appType, name, opts) { ... }  // POST /v1/realtime/rooms
  async listRooms(appType) { ... }                // GET /v1/realtime/rooms?appType=...
  async joinRoom(roomId, nick) { ... }            // Avaa WebSocket
  leaveRoom() { ... }                              // Sulje WebSocket

  // Presence
  updatePresence(state) { ... }

  // Viestit
  broadcast(payload) { ... }
  onBroadcast(callback) { ... }

  // WebRTC (valinnainen, käyttää simple-peer:ä)
  async connectPeer(peerId) { ... }               // Luo P2P-yhteys signaling:n kautta
  onPeerConnected(callback) { ... }
  onPeerData(callback) { ... }
  sendToPeer(peerId, data) { ... }

  // Yjs (valinnainen)
  syncDoc(docId, yjsDoc) { ... }                  // Aloita Yjs-dokumentin synkronointi

  // Eventit
  onPeerJoined(callback) { ... }
  onPeerLeft(callback) { ... }
  onPeerPresence(callback) { ... }
  onError(callback) { ... }
}
```

### 4.2 CDN/Inline-lataus

Koska AIMEAT-appit ovat single-file HTML:ää, kirjasto ladataan:

```html
<!-- Vaihtoehto 1: Suoraan AIMEAT-nodesta -->
<script src="http://localhost:40050/v1/lib/realtime.js"></script>

<!-- Vaihtoehto 2: Inline (AI kopioi koodin suoraan appin <script>-tagiin) -->
<script>
// AimeatRealtime minified inline...
</script>
```

### 4.3 Staattinen tiedosto

Luodaan `aimeat/public/lib/realtime.js` joka servitään suoraan Express-static:n kautta. Ei tarvita uutta route-tiedostoa.

---

## 5. AI-promptistrategia

### 5.1 Promptimuutokset portal-human.ts:ssä

Lisätään `apiRef`-muuttujaan realtime-osio joka opastaa AI:ta käyttämään P2P-ominaisuuksia:

```javascript
var realtimeRef = `
## Realtime Multiplayer / P2P (optional)
If the app needs real-time collaboration or multiplayer:

1. Load the realtime library:
   <script src="${nodeUrl}/v1/lib/realtime.js"></script>

2. Create or join a room:
   const rt = new AimeatRealtime("${nodeUrl}", otk);
   // List existing rooms for this app type
   const rooms = await rt.listRooms("my-app-type");
   // Create a new room, or join existing
   if (rooms.length > 0) {
     await rt.joinRoom(rooms[0].id, userName);
   } else {
     const room = await rt.createRoom("my-app-type", "Room Name");
     await rt.joinRoom(room.id, userName);
   }

3. Use presence to show who is online:
   rt.updatePresence({ status: "playing", score: 42 });
   rt.onPeerPresence((peerId, state) => { /* update UI */ });

4. Broadcast messages to all peers:
   rt.broadcast({ action: "move", x: 10, y: 20 });
   rt.onBroadcast((from, payload) => { /* handle */ });

5. For audio/video/large data, use WebRTC P2P:
   rt.onPeerJoined((peerId, nick) => {
     rt.connectPeer(peerId);
   });
   rt.onPeerData((peerId, data) => { /* handle P2P data */ });
   rt.sendToPeer(peerId, binaryData);

6. For shared state (collaborative editing), use Yjs:
   import * as Y from 'yjs';
   const ydoc = new Y.Doc();
   rt.syncDoc("shared-state", ydoc);
   // Now ydoc auto-syncs across all peers in the room
`;
```

### 5.2 Uudet prompt-kategoriat

Lisätään portal-sovelluskorttihin uusi kategoria tai rikastetaan olemassa olevia:

| Kategoria | P2P-lisäys |
|---|---|
| **Pelit** | Lisätään: "The game MUST use AimeatRealtime for multiplayer. Create a lobby, matchmake, sync game state via broadcast." |
| **Luovat** | Lisätään: "If user wants collaborative mode, use AimeatRealtime + Yjs for real-time co-drawing/co-editing." |
| **Musiikki (UUSI)** | "Band app: Each user picks an instrument. Use WebRTC for low-latency audio streaming between peers. Show who is playing what via presence." |
| **Oma idea** | Lisätään: "If the app idea involves multiple users at the same time, suggest using AimeatRealtime for real-time sync." |

### 5.3 Esimerkkiprompt: Band-appi

```
Luo HTML-sovellus nimeltä "AIMEAT Band" jossa:
- Käyttäjä valitsee instrumentin (piano, rummut, basso, kitara, syntetisaattori)
- Näyttää ketkä ovat huoneessa ja mitä instrumenttia kukakin soittaa (presence)
- Pienen latenssin audiosynkki Web Audio API + WebRTC:n kautta
- Instrumenttien äänet generoidaan Web Audio API:lla (oscillatorit, samplerit)
- Kaikki kuulevat muiden soiton reaaliajassa
- Lobby: näkee avoimet jam-sessiot ja voi liittyä tai luoda uuden
- Käyttää AimeatRealtime-kirjastoa kaikessa P2P-kommunikaatiossa
```

---

## 6. Turvallisuus

### 6.1 Autentikointi

- WebSocket-yhteys vaatii OTK-tokenin tai Agent JWT:n query-parametrina (`?token=...`)
- Token validoidaan ennen WebSocket-yhteyden hyväksymistä (sama malli kuin `/v1/personal/tunnel`)
- OTK:n aikaraja pätee: ensimmäisen käytön jälkeen OTK on voimassa konfiguroitu aika

### 6.2 Viestivalidointi

- Viestikoko rajattu (`realtimeMaxMessageSizeBytes`, oletus 16 KB)
- JSON-viestin `type`-kenttä validoidaan (vain tunnetut tyypit sallittu)
- Signal-viestien `to`-peer validoidaan (pitää olla samassa huoneessa)
- Broadcast-viestejä ei tallenneta — ephemeral vain

### 6.3 Huonerajoitukset

- Max peers per room rajattu konfiguraatiossa
- Max rooms per server rajattu
- Idle-huoneet siivotaan automaattisesti
- Huoneen luoja voi sulkea huoneen (kick all)

### 6.4 WebRTC-turvallisuus

- WebRTC-liikenne on oletuksena salattua (DTLS-SRTP)
- AIMEAT ei näe P2P-dataa — vain signaling kulkee serverin kautta
- TURN-serveri (jos käytössä) on erillinen infrastruktuuri

### 6.5 Riskiarvio

| Riski | Vakavuus | Mitigaatio |
|---|---|---|
| WS-yhteys ilman autentikaatiota | Korkea | Token vaaditaan aina |
| Broadcast-spämmi | Keskitaso | Rate limiting per peer (5 msg/s) |
| Huone-flood (tuhansia huoneita) | Keskitaso | Max rooms -raja + per-user-raja |
| XSS signaling-viestissä | Matala | Viestit ovat JSON, ei HTML-renderöintiä serverissä |
| TURN-resurssien väärinkäyttö | Keskitaso | TURN-tunnukset ovat lyhytikäisiä, per-session |

---

## 7. Federation-näkökulma

### 7.1 Cross-node huoneet (Phase 2)

Alkuperäinen toteutus: huoneet ovat node-lokaaleja. Myöhemmin federation mahdollistaa:

```
Node A:n app    ←→  Node A:n RealtimeManager
                         ↕ (federation WS)
                    Node B:n RealtimeManager  ←→  Node B:n app
```

Tämä vaatii federation-peerien välisen WebSocket-kanavan (tällä hetkellä federation on pelkkää HTTP:tä). Federation-realtime on Phase 3.4:n laajennos.

### 7.2 Room discovery federaation yli

```
GET /v1/realtime/rooms?appType=band&federated=true
→ Kyselee myös peereil tä huoneita ja yhdistää tulokset
```

Tämä on myöhempi lisäys. Phase 1:ssä huoneet ovat node-lokaaleja.

---

## 8. Toteutusjärjestys

### Phase 0 — Foundation (arvio: 1–2 päivää)

| # | Tehtävä | Tiedostot |
|---|---|---|
| 0.1 | Lisää `RealtimeRoomRecord` storage-interfaceen | `src/storage/interface.ts` |
| 0.2 | Implementoi InMemoryStorageen | `src/storage/memory.ts` |
| 0.3 | Lisää konfiguraatiomuuttujat | `src/config.ts`, `.env.example` |
| 0.4 | Luo `RealtimeManager`-luokka | `src/services/realtime-manager.ts` |
| 0.5 | Luo HTTP-routet (rooms CRUD, ice-servers) | `src/routes/realtime.ts` |
| 0.6 | Lisää WebSocket upgrade handler `index.ts`:iin | `src/index.ts` |
| 0.7 | Lisää idle room cleanup -ajastin | `src/server.ts` |
| 0.8 | `npx tsc --noEmit` ✅ | — |

### Phase 1 — Frontend-kirjasto + prompt-integraatio (arvio: 1–2 päivää)

| # | Tehtävä | Tiedostot |
|---|---|---|
| 1.1 | Luo `AimeatRealtime`-kirjasto | `aimeat/public/lib/realtime.js` |
| 1.2 | Lisää `realtimeRef` prompt-muuttuja | `src/routes/portal-human.ts` |
| 1.3 | Päivitä pelikategorian prompt | `src/routes/portal-human.ts` |
| 1.4 | Päivitä luovat-kategorian prompt | `src/routes/portal-human.ts` |
| 1.5 | Lisää musiikki/band-kategoria (demo) | `src/routes/portal-human.ts` |
| 1.6 | AIMEAT Band -demoprompti docs:iin | `docs/hello-world/band-app.md` |
| 1.7 | Lisää lokalisaatiot | `locales/en.json`, `locales/fi.json` |

### Phase 2 — WebRTC P2P + Yjs (arvio: 2–3 päivää)

| # | Tehtävä | Tiedostot |
|---|---|---|
| 2.1 | Lisää simple-peer WebRTC-tuki kirjastoon | `public/lib/realtime.js` |
| 2.2 | Lisää Yjs CRDT-synkronointi | `public/lib/realtime.js` |
| 2.3 | Yjs-snapshot persistence Memoryyn | `src/services/realtime-manager.ts` |
| 2.4 | Audio/video demo (band-appi kokonaan) | `docs/hello-world/band-app.md` |

### Phase 3 — Federation + skaalaus

| # | Tehtävä |
|---|---|
| 3.1 | Cross-node room discovery (federation HTTP) |
| 3.2 | Federation WebSocket -kanava huoneiden välille |
| 3.3 | MongoDB-tallennus RealtimeRoomRecord:ille |
| 3.4 | Metriikat ja monitorointi (huoneet, peerit, viestit/s) |

---

## 9. Testausstrategia

### 9.1 Unit-testit (vitest)

```typescript
// test/unit/realtime-manager.test.ts
describe('RealtimeManager', () => {
  it('creates a room', ...);
  it('joins a room', ...);
  it('broadcasts to all peers in room', ...);
  it('signals to specific peer', ...);
  it('rejects join when room is full', ...);
  it('cleans up idle rooms', ...);
  it('handles peer disconnect gracefully', ...);
});
```

### 9.2 E2E-testit

```typescript
// test/e2e-realtime.ts
// Phase 1: HTTP + WS
// 1. Luo huone (POST /v1/realtime/rooms)
// 2. Avaa 2 WS-yhteyttä samaan huoneeseen
// 3. Peer A broadcastaa → Peer B vastaanottaa
// 4. Peer A signaalaa Peer B:lle → B vastaanottaa
// 5. Peer A lähtee → B saa peer-left -viestin
// 6. Tyhjä huone siivotaan idle-timeoutin jälkeen

// Phase 2: WebRTC
// 7. Peer A ja B muodostavat WebRTC-yhteyden signaling:n kautta
// 8. Data kulkee P2P-kanavaa pitkin
```

### 9.3 Demo-testi (manuaalinen)

Band-appi avataan kahdessa selaimessa. Molemmat liittyvät samaan huoneeseen. Toisen soittaessa toinen kuulee reaaliajassa.

---

## 10. Tietorakenne-esimerkki: Band-appi

```
Huone: "jam-session-friday"
├── Peer A (Jouni): { instrument: "guitar", muted: false }
├── Peer B (Miikki): { instrument: "drums", muted: false }
└── Peer C (AI-agent): { instrument: "bass", muted: false }

Dataflow:
1. Jouni painaa kitaranäppäintä → Web Audio API tuottaa äänen
2. Audio stream → WebRTC DataChannel → Peer B & C
3. Peer B & C toistavat äänen omissa selaimissaan
4. Presence päivittyy: "Jouni soittaa kitaraa"
5. Kaikki state-muutokset (kuka soittaa mitä) kulkee broadcast:lla
6. Audio kulkee WebRTC P2P:nä (ei serverin kautta)
```

---

## 11. Riippuvuudet

### Olemassa olevat (ei uusia server-puolelle)

- `ws` — jo käytössä TunnelManagerissa
- `crypto.randomUUID()` — peer ID:t

### Uudet frontend-kirjastot (CDN, ei serverin node_modules)

- `simple-peer` — WebRTC-abstraatio (Phase 2)
- `yjs` + `y-webrtc` / `y-websocket` — CRDT-synkronointi (Phase 2)

### Valinnainen infrastruktuuri

- STUN-serveri: Google tarjoaa ilmaisen (`stun:stun.l.google.com:19302`)
- TURN-serveri: Tarvitaan vain jos NAT-läpäisy epäonnistuu (esim. coturn, oma tai palveluna)

---

## 12. OpenAPI-lisäykset

```yaml
paths:
  /v1/realtime/rooms:
    post:
      summary: Create a realtime room
      tags: [Realtime]
      security: [bearerAuth: [], otkAuth: []]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [appType, name]
              properties:
                appType: { type: string, example: "band" }
                name: { type: string, example: "Friday Jam" }
                maxPeers: { type: integer, default: 20 }
                isPublic: { type: boolean, default: true }
                tags: { type: array, items: { type: string } }
      responses:
        '201':
          description: Room created
    get:
      summary: List active rooms
      tags: [Realtime]
      parameters:
        - name: appType
          in: query
          schema: { type: string }
        - name: tag
          in: query
          schema: { type: string }
      responses:
        '200':
          description: Room list

  /v1/realtime/rooms/{roomId}:
    get:
      summary: Get room details
      tags: [Realtime]
    delete:
      summary: Close a room
      tags: [Realtime]

  /v1/realtime/ice-servers:
    get:
      summary: Get STUN/TURN configuration for WebRTC
      tags: [Realtime]
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  iceServers:
                    type: array
                    items:
                      type: object
                      properties:
                        urls: { type: string }
                        username: { type: string }
                        credential: { type: string }
```

---

## 13. Yhteenveto

| Ominaisuus | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| Huoneet (create/list/join/leave) | ✅ | | | |
| WebSocket presence & broadcast | ✅ | | | |
| WebRTC signaling | ✅ | | | |
| Frontend-kirjasto (realtime.js) | | ✅ | | |
| Prompt-integraatio (portal) | | ✅ | | |
| Band-demo | | ✅ | | |
| WebRTC P2P data/audio | | | ✅ | |
| Yjs CRDT synkronointi | | | ✅ | |
| Cross-node federation rooms | | | | ✅ |
| Metriikat & skaalaus | | | | ✅ |

**Lopputulos:** Kun AI Chat saa promptin "Tee sovellus jossa voi soittaa musiikkia kavereiden kanssa", se generoi HTML-appin joka:
1. Lataa `realtime.js` AIMEAT-nodesta
2. Luo huoneen tai liittyy olemassa olevaan
3. Näyttää ketkä ovat paikalla ja mitä instrumenttia soittavat
4. Muodostaa WebRTC-yhteydet audiostreamejä varten
5. Tallentaa session-historian AIMEAT Memoryyn
6. Kaikki yhden HTML-tiedoston sisällä, ilman backend-koodia
