# AIMEAT Band App — Realtime P2P Demo

A real-time jam session app showcasing the AIMEAT Realtime P2P protocol.
Multiple musicians connect to the same room and play together with instant audio/control sync.

## Quick Start Prompt

Copy this into any AI chat (Claude, ChatGPT, Grok, etc.) to generate the app:

---

Before building, ask me:
1. What should the jam session be called?
2. What instruments should be available? (e.g. "drums, guitar, bass, synth, piano")
3. How should it look? (e.g. "dark neon studio", "cozy wooden stage", "retro arcade")

I want a real-time jam session app where multiple people can play music together simultaneously.

## Data storage API
Server: https://aimeat.io (no authentication needed, anonymous mode)
Save data: POST https://aimeat.io/v1/memory
Content-Type: application/json
Body: {"key": "apps.band.[session-id]", "value": {...}, "visibility": "public", "ttl_hours": 24}
Read data: GET https://aimeat.io/v1/memory/apps.band.[session-id]

## Realtime P2P API
Client library: `<script src="https://aimeat.io/lib/realtime.js"></script>`

Auth setup (required first):
```javascript
const authRes = await fetch("https://aimeat.io/v1/auth/anonymous", { method: "POST" });
const { data: { token } } = await authRes.json();
const rt = new AimeatRealtime("https://aimeat.io", token);
```

Room and messaging:
```javascript
const room = await rt.createRoom({ app_type: "band", name: "Friday Jam" });
rt.connect(room.id, playerName);
rt.on("joined", (msg) => { /* setup peer list */ });
rt.on("peer-joined", (msg) => { /* new musician arrived */ });
rt.on("peer-left", (msg) => { /* musician left */ });
rt.on("broadcast", (msg) => { /* receive note/beat data */ });
rt.broadcast({ instrument: "guitar", note: "A4", velocity: 0.8 });
rt.presence({ instrument: "drums", muted: false });
```

## How it should work
1. On first visit, ask for a musician name (save to localStorage)
2. Show a "Stage Finder": list of active rooms via `rt.listRooms({ app_type: "band" })`
3. "Create Session" and "Join" buttons
4. Once connected, show a virtual instrument panel (touchable keyboard/pads/strings)
5. Each player picks an instrument. Broadcast note events in real-time
6. Use Web Audio API to synthesize sounds locally
7. Show all connected musicians with their instrument choice (via presence)
8. Broadcast format: `{ instrument: "guitar", note: "C4", velocity: 0.7, duration: 0.5 }`
9. Each peer renders incoming notes to audio locally (Web Audio API)
10. Show "Now Playing" indicator when peers play notes
11. "Leave Session" button to disconnect

## Architecture Notes
- Audio does NOT travel through the server — each client synthesizes sound locally from note events
- Note events (instrument, note, velocity) are tiny JSON messages via WebSocket broadcast
- This keeps latency minimal (only a few ms for the JSON message vs. streaming raw audio)
- For full audio streaming (e.g. real microphone input), use WebRTC P2P audio channels (see below)
- Yjs CRDT keeps shared state (setlist, track config) in sync — even if peers join late

## WebRTC P2P Audio (optional upgrade)

For live microphone audio instead of synthesized notes, use the built-in WebRTC support:

```javascript
// After connecting to a room, establish P2P audio with each peer
rt.on("peer-joined", async (msg) => {
  // Connect with audio enabled — getUserMedia is called automatically
  await rt.connectPeer(msg.peerId, { audio: true });
});

// Handle incoming audio tracks
rt.on("peer-track", ({ peerId, track, streams }) => {
  const audio = new Audio();
  audio.srcObject = streams[0];
  audio.play();
});

// Disconnect peer audio when they leave
rt.on("peer-left", (msg) => {
  rt.disconnectPeer(msg.peerId);
});
```

WebRTC audio flows directly between browsers (peer-to-peer) — the AIMEAT server only relays the initial ICE/SDP signaling handshake.

## Yjs CRDT Shared State (optional upgrade)

Use Yjs to keep a shared setlist or mixer state that survives peer disconnects:

```javascript
import * as Y from "yjs"; // or load from CDN

const ydoc = new Y.Doc();
const setlist = ydoc.getArray("setlist");
const mixer = ydoc.getMap("mixer");

// Start syncing — late-joining peers receive the full state automatically
rt.syncDoc("band-state", ydoc);

// Add a song (automatically propagated to all peers)
setlist.push(["Smoke on the Water"]);

// Update mixer (shared volume/mute state)
mixer.set("drums-volume", 0.8);
mixer.set("bass-muted", true);

// Listen to remote changes
mixer.observe(() => {
  console.log("Mixer updated:", mixer.toJSON());
});

// When done
rt.unsyncDoc("band-state");
```

Yjs updates are tiny binary diffs sent over WebSocket. The server stores the latest snapshot so late joiners get the full document state without needing an online peer.

## Instruments
Implement at least 3 instruments using Web Audio API:
- **Drums**: Grid of pads (kick, snare, hi-hat, tom) that trigger percussion samples via OscillatorNode/noise
- **Synth/Keys**: Chromatic keyboard (1-2 octaves) with OscillatorNode (sine/square/sawtooth)
- **Bass**: Simple bass synth with lower octave notes

Each instrument should produce short, recognizable sounds even with basic oscillators.

General requirements:
- Single HTML file, all CSS and JS inline
- Include `<script src="https://aimeat.io/lib/realtime.js"></script>`
- Mobile-friendly — pads/keys work on touch screens
- Dark, studio-like UI
- Works immediately when opened in a browser

---

## Data Flow

```
Musician A: taps drum pad "kick"
  → broadcast({ instrument: "drums", note: "kick", velocity: 1.0 })
  → WebSocket → AIMEAT server → all peers in room

Musician B: receives broadcast
  → Web Audio API → play "kick" sound locally
  → UI: flash Musician A's drum pad indicator

Presence updates:
  → rt.presence({ instrument: "synth", muted: false })
  → all peers see "Musician A is playing synth"
```

## Replace `https://aimeat.io` with your node URL

If you're running your own AIMEAT node, replace `https://aimeat.io` with your node's URL (e.g. `http://localhost:40050`).
