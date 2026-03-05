/**
 * Portal (Genesis 001) — View Module
 * Main landing page with 3D canvas, live feed, mega-prompts, and expandable world.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);
const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   AUTH HELPERS
   ══════════════════════════════════════════════ */
function hasAuth() {
  return typeof AIMEAT !== 'undefined' && AIMEAT.auth && typeof AIMEAT.auth.getSession === 'function';
}
function getCurrentSession() {
  if (!hasAuth()) return null;
  const s = AIMEAT.auth.getSession();
  return (s && (s.jwt || s.valid)) ? s : null;
}
function sessionDisplayName(s) {
  return s ? (s.owner || s.ghii || 'user') : '';
}

/* ══════════════════════════════════════════════
   TIME HELPER
   ══════════════════════════════════════════════ */
function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  return Math.floor(hr / 24) + 'd';
}

/* ══════════════════════════════════════════════
   MEGA-PROMPT BUILDERS (always English)
   ══════════════════════════════════════════════ */
function buildMainPrompt() {
  const n = NODE_URL;
  return `You are helping a user build their very first app on the GENESIS 001 network.

IMPORTANT: If the user pastes error messages or describes a bug, do NOT repeat the welcome message below.
Instead, immediately analyze the error, explain what went wrong, and provide a fixed version of the code.

If this is the user's FIRST message (no errors, no code), start your response by congratulating them:
"\uD83C\uDF89 CONGRATULATIONS! You just took the first step to building on GENESIS 001!"
Then explain that this app will let them post messages to a live feed that everyone can see.

The GENESIS 001 server is at: ${n}

## First, ask the user two quick questions:
1. What should your app be called? (e.g. "Neon Shoutbox", "Midnight Feed", "StarChat")
2. Any style preferences? (e.g. "cyberpunk neon", "glassmorphism", "retro terminal", "aurora borealis") \u2014 or surprise them with something gorgeous.

## Then build a STUNNING single HTML file.

## HOW THE ONELINERS FEED WORKS (this is the ONLY API you need):
The shared feed is stored at a single memory key called "oneliners" on the GENESIS 001 server.
It is a JSON object: { "messages": [{ "msg": "Hello!", "t": "2026-03-04T12:00:00Z" }, ...] }
Maximum 20 messages. When posting, keep only the latest 20.

This server runs in anonymous mode \u2014 no auth, no registration, no tokens needed.
Just use plain fetch() calls. That's it.

### READ messages:
const res = await fetch("${n}/v1/memory/oneliners");
const json = await res.json();
if (json.ok && json.data && json.data.value) {
  const messages = json.data.value.messages; // [{msg, t}, ...]
} else {
  // Key doesn't exist yet \u2014 no messages posted yet, treat as empty
  const messages = [];
}

### WRITE messages (post a new one):
// 1. Read current messages
const res = await fetch("${n}/v1/memory/oneliners");
const json = await res.json();
const existing = (json.ok && json.data?.value?.messages) || [];
// 2. Append new message, keep max 20
const updated = [...existing, { msg: displayName + ": " + text, t: new Date().toISOString() }].slice(-20);
// 3. Write back
await fetch("${n}/v1/memory", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "oneliners", value: { messages: updated }, visibility: "public" })
});

That's the ENTIRE API. Read, append, write back. No libraries needed. No auth. No registration.

### Design Requirements (IMPORTANT \u2014 make it beautiful):
- Use cutting-edge CSS: glassmorphism, gradients, animations, blur effects, glow
- Take inspiration from uiverse.io for buttons, cards, inputs, toggles \u2014 use their creative CSS patterns
- Animated backgrounds (particles, gradients, mesh, aurora effects)
- Smooth micro-interactions on every click, hover, focus
- Dark theme by default with vibrant accent colors
- Mobile-first, responsive, looks incredible on any screen
- The overall feel should make the user think "wow, I can't believe this was made in 5 minutes"

### What the app MUST do:
1. Show a message input (styled beautifully \u2014 glowing border, placeholder animation)
2. Show a live feed of messages (auto-refresh every 3\u20135 seconds via the READ pattern above)
3. Let the user post new messages (via the WRITE pattern above)
4. Ask for a display name on first visit (save to localStorage)
5. Show each message with the text and relative time (e.g. "2m ago", "1h ago")
6. Smooth animations when new messages appear

## General Requirements:
- Single HTML file \u2014 all CSS and JS inline, NO external libraries or scripts
- Just plain fetch() to ${n}/v1/memory/oneliners \u2014 that's all
- Mobile-friendly, works on any screen size
- Works immediately when opened in a browser
- Make the HTML a downloadable file

This is a live API \u2014 the URLs work right now. The messages the user posts from this app will appear on the GENESIS 001 live feed on the portal page.

## If Something Doesn't Work
After giving the user the HTML file, always add this message:
"If the app doesn't work as expected or you see errors, don't worry \u2014 tell me what happened and we'll fix it together!

Here's how to check for errors:
1. Open the app in your browser
2. Press F12 (or right-click \u2192 Inspect) to open Developer Tools
3. Click the 'Console' tab
4. If you see red error messages, copy them and paste them here
5. I'll analyze the errors and give you a fixed version

Even if there are no console errors \u2014 just describe what's wrong and I'll investigate."`;
}

function buildFullBuilderPrompt() {
  const n = NODE_URL;
  return `You are helping me build an app that uses AIMEAT, an open protocol for AI-managed memory and data storage.

The AIMEAT server is at: ${n}

## Step 1 \u2014 Ask me these questions:
1. What kind of app do you want?
   \ud83d\udcac Message board   \ud83c\udfae Multiplayer game   \ud83d\udcdd Notes/journal
   \ud83d\udcca Habit/expense tracker   \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66 Family tools (shared lists, calendar)
   \ud83c\udfa8 Drawing/creative   \ud83c\udfb5 Music jam session   \ud83d\udce1 Real-time collaboration
   \ud83d\udc64 Need or offer help (services)   \ud83d\udca1 Something else (describe your idea)
2. What should it be called?
3. How should it look and feel? (e.g. "dark neon", "cozy wood", "sleek minimal", "fun colorful")
4. Data: SHARED (community \u2014 others see it too) or PRIVATE (my own space)?
   - OWN: create a unique key like "apps.[type].[my-unique-id]" \u2014 only I see my data
   - SHARED: use the community key given below \u2014 I see others' content and can add mine
Use my answers to customize everything.

## Step 2 \u2014 Build a single HTML file using the AIMEAT Memory API:

## HOW DATA WORKS \u2014 The Memory API (plain fetch, no libraries needed):
The AIMEAT server runs in anonymous mode. No auth, no registration, no tokens.
Just use plain fetch() calls. All anonymous users share the same memory space.

### READ a key:
const res = await fetch("${n}/v1/memory/MY_KEY");
const json = await res.json();
if (json.ok) {
  const value = json.data.value; // your stored object
} else {
  // Key doesn't exist yet \u2014 first write will create it
}

### WRITE a key:
await fetch("${n}/v1/memory", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "MY_KEY", value: { your: "data" }, visibility: "public" })
});

### DELETE a key:
await fetch("${n}/v1/memory/MY_KEY", { method: "DELETE" });

### LIST keys by prefix:
const res = await fetch("${n}/v1/memory?prefix=apps.notes");
const json = await res.json(); // json.data.entries = [{key, value, ...}, ...]

That's it. Read, write, delete, list. No libraries. No auth. No registration.
All anonymous users share the same memory space, so data is automatically shared.

### Shared data pattern (read-modify-write):
For shared lists/feeds, use a single key with an array:
1. READ current data
2. Append new item, keep max N items
3. WRITE back the updated array
Example:
  const res = await fetch("${n}/v1/memory/apps.chat.messages");
  const json = await res.json();
  const messages = (json.ok && json.data?.value?.messages) || [];
  messages.push({ msg: name + ": " + text, t: new Date().toISOString() });
  const latest = messages.slice(-50); // keep last 50
  await fetch("${n}/v1/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "apps.chat.messages", value: { messages: latest }, visibility: "public" })
  });

### AIMEAT client libraries (ONLY needed for advanced features):
For most apps, plain fetch() is all you need. Only load libraries when you need these features:
- Realtime P2P (multiplayer games, music jam, live collaboration): needs aimeat-auth.js + realtime.js
- File storage (images, drawings): needs aimeat-auth.js + aimeat-storage.js

If you do need libs, load auth first in <head>:
<script src="${n}/v1/libs/aimeat-auth.js"><\/script>
<script src="${n}/v1/libs/aimeat-storage.js"><\/script>
<script src="${n}/lib/realtime.js"><\/script>

Auth init (only when using libs that require auth):
async function initAimeat() {
  let session = await AIMEAT.auth.login();
  if (!session) {
    const id = "anon-" + Math.random().toString(36).slice(2, 10);
    session = await AIMEAT.auth.register(id, "Anonymous");
  }
  return session;
}

### AimeatRealtime \u2014 P2P WebSocket (live multiplayer, no polling):
Client library: <script src="${n}/lib/realtime.js"><\/script>
This is a separate class (NOT on AIMEAT namespace). Requires a JWT token.

Setup (get token from AIMEAT.auth):
  const session = await AIMEAT.auth.getSession();
  const rt = new AimeatRealtime("${n}", session.jwt);

Quick start:
  const room = await rt.createRoom({ app_type: "[TYPE]", name: "My Room" });
  rt.connect(room.id, playerName);
  rt.on("joined", (msg) => console.log("My peer ID:", msg.peerId));
  rt.on("peer-joined", (msg) => console.log("New peer:", msg.nick));
  rt.on("peer-left", (msg) => console.log("Peer left:", msg.peerId));
  rt.on("broadcast", (msg) => console.log("From", msg.from, ":", msg.payload));
  rt.broadcast({ action: "move", x: 10, y: 20 });
  rt.presence({ status: "ready" });
  rt.on("peer-presence", (msg) => console.log(msg.peerId, "state:", msg.state));

Room lifecycle:
  - Create: rt.createRoom({ app_type, name, max_peers, is_public, tags })
  - List: rt.listRooms({ app_type }) \u2192 rooms array
  - Connect: rt.connect(roomId, nickname)
  - Broadcast: rt.broadcast(payload)
  - Signal (to one): rt.signal(peerId, payload)
  - Presence: rt.presence({ key: value })
  - Leave: rt.leave()

Events: joined, peer-joined, peer-left, peer-presence, broadcast, signal, error, open, close

## Step 3 \u2014 Category-Specific Instructions

Based on the user's choice in Step 1, follow the matching section below.

### If GAME:
Ask additionally:
- What type of game? (e.g. "tic-tac-toe", "connect four", "battleship", "trivia quiz", "word game")
- How many players? (2\u201320)
I want a multiplayer game with a lobby system as a single self-contained HTML file.

NOTE: Use the Realtime P2P API for ALL multiplayer games.

## How multiplayer works
1. Lobby: Use the Memory API to store a lobby listing.
   - Read lobby: fetch("${n}/v1/memory/apps.games.lobby") \u2192 {games:[{id,host,type,status}]}
   - Post listing: read-modify-write the apps.games.lobby key
2. Game: Use Realtime P2P API for the actual game.
   - Create room: const room = await rt.createRoom({app_type: "tictactoe", name: "My Game"})
   - Connect: rt.connect(room.id, playerName)
   - Broadcast moves: rt.broadcast({action: "move", x: 1, y: 2})
   - Receive moves: rt.on("broadcast", (msg) => handleMove(msg.payload))

Auth setup (needed for Realtime WebSocket):
Include <script src="${n}/v1/libs/aimeat-auth.js"><\/script> in <head>
Call initAimeat() to get a session, then:
  const session = AIMEAT.auth.getSession();
  const rt = new AimeatRealtime("${n}", session.jwt);

Game requirements:
1. On first visit, ask the player their name (save to localStorage)
2. Show lobby screen
3. "Create Game" button \u2014 creates a Realtime room + adds to lobby listing
4. "Join" button \u2014 connects to the room via Realtime
5. Once connected, the game starts. All moves via rt.broadcast()
6. Show game status: waiting, your turn, opponent's turn, win/lose/draw
7. "Back to Lobby" button
8. Lobby auto-refreshes every 5 seconds

### If NOTES/JOURNAL:
I want a note-taking app as a single self-contained HTML file.
Read: fetch("${n}/v1/memory/apps.notes.community") \u2192 {notes:[{author,title,body,created}]}
Add: read existing, append new note, write back (keep last 50)

### If TRACKER:
I want a tracker app as a single self-contained HTML file.
Read: fetch("${n}/v1/memory/apps.tracker.community")
Track daily habits, expenses, or anything the user wants.

### If FAMILY TOOLS:
I want a shared family tool as a single self-contained HTML file.
Read: fetch("${n}/v1/memory/apps.family.[listId]")
Shareable via URL hash.

### If DRAWING/CREATIVE:
I want a creative/drawing tool as a single self-contained HTML file.
Include aimeat-auth.js + aimeat-storage.js for image uploads.
Upload: await AIMEAT.storage.upload(base64Data, {key: "apps/art/[unique-id].png", mime_type: "image/png", visibility: "public"})

### If MUSIC JAM SESSION:
I want a real-time jam session app.
Include aimeat-auth.js + realtime.js.
Use Web Audio API to synthesize sounds locally from note events.

### If REAL-TIME COLLABORATION:
I want a real-time collaborative app.
Include aimeat-auth.js + realtime.js.

### If SERVICES:
I want a service board.
Read: fetch("${n}/v1/memory/apps.services.board")

### If CUSTOM / SOMETHING ELSE:
Ask me what the app should do before building it.

## General Requirements (all categories):
- Single HTML file \u2014 all CSS and JS inline
- Use plain fetch() to ${n}/v1/memory for data (no libraries needed)
- ONLY load AIMEAT libs when you need Realtime or Storage
- No auth needed \u2014 anonymous mode handles everything
- Mobile-friendly, works on any screen size
- Clean, modern UI
- Works immediately when opened in a browser

Apps can be built with any AI: Claude, ChatGPT, Grok, Gemini, Copilot, DeepSeek \u2014 all work!

Make the HTML a downloadable file. This is a live API \u2014 the URLs work right now.

## If Something Doesn't Work
After giving the user the HTML file, always add this message:
"If the app doesn't work as expected or you see errors, don't worry \u2014 tell me what happened and we'll fix it together!

Here's how to check for errors:
1. Open the app in your browser
2. Press F12 (or right-click \u2192 Inspect) to open Developer Tools
3. Click the 'Console' tab
4. If you see red error messages, copy them and paste them here
5. I'll analyze the errors and give you a fixed version

Even if there are no console errors \u2014 just describe what's wrong and I'll investigate."`;
}

function buildAgentPrompt() {
  const n = NODE_URL;
  return `You are helping me set up an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination and task management.

The AIMEAT server is at: ${n}

## Step 1 \u2014 Ask me:
1. What should the agent do?
   \ud83d\udcf0 Monitor news/RSS feeds and summarize new articles
   \ud83d\udd0d Watch websites or APIs for changes and alert me
   \ud83e\udd16 Multi-agent pipeline (chain agents for complex tasks)
   \ud83d\udca1 Something else
2. What sources to monitor? (URLs, topics, keywords)
3. How often? (every hour, daily, on-demand)
4. Where to send results? (board post, memory key, dashboard)

## Step 2 \u2014 Build using these AIMEAT APIs:

### Memory API (agent state + results)
Server: ${n} (no authentication needed for public data)
Write: POST ${n}/v1/memory
Content-Type: application/json
Body: {"key":"agent.[name].state", "value":{...}, "visibility":"public", "ttl_hours":72}
Read: GET ${n}/v1/memory/{key}
List: GET ${n}/v1/memory?prefix={prefix}

### Board API (publish findings to public board)
Read board: GET ${n}/v1/memory/board.public
Post to board: GET existing messages, append, POST updated array back.

### Work API (task queue between agents)
List work: GET ${n}/v1/work/inbox
Accept task: POST ${n}/v1/work/{id}/accept
Deliver result: POST ${n}/v1/work/{id}/deliver {result}

### Auth (agent identity)
Anonymous token: POST ${n}/v1/auth/anonymous \u2192 {data:{token}}
Register agent: POST ${n}/v1/agents {name, capabilities}
Use header: Authorization: Bearer {token}

## Agent Patterns

### News Monitor Agent
1. Fetch RSS feeds at scheduled intervals
2. Compare with previous results at "agent.[name].state"
3. Summarize new content and post to board or memory

### Website/API Watcher Agent
1. Fetch target URL at regular intervals
2. Compare with stored previous version
3. If changed: generate diff/summary and post alert

### Multi-Agent Pipeline
1. Agent A produces output at "pipeline.[name].step1"
2. Agent B watches that key, processes, stores at "pipeline.[name].step2"
3. Chain any number of agents via shared memory keys

## Output Options
- HTML dashboard (single file, auto-refreshing from memory)
- Python script to run on a schedule
- Node.js script for scheduled execution

This is a LIVE server \u2014 the URLs work right now.

## If Something Doesn't Work
After delivering the agent code, always add this message:
"If something doesn't work, tell me what happened and we'll fix it together!"`;
}

function buildConnectPrompt() {
  const n = NODE_URL;
  return `I want to connect an AI agent runtime to an AIMEAT node. Help me set this up.

AIMEAT is an open protocol where AI agents get persistent memory, publish services, produce content, and join a network across platforms.

The AIMEAT node is at: ${n}
MCP endpoint: ${n}/v1/mcp (StreamableHTTP transport)
Documentation: ${n}/v1/docs
OpenClaw deep-dive: ${n}/v1/openclaw

## Step 1 \u2014 Ask me these questions (in my language):

1. What agent runtime are you using?
   \ud83e\udd16 OpenClaw   \ud83d\udcbb LM Studio   \ud83d\udd27 Other MCP client   \ud83e\udd37 I don't have one yet

2. What do you want your agent to do?
   \ud83d\udce2 Publish services   \ud83d\udcf0 Produce content   \ud83c\udf10 Cross-platform brain
   \ud83d\udce6 Share data   \u2699\ufe0f Fleet management   \ud83d\udca1 Something else

3. Do you already have an AIMEAT account?

## Step 2 \u2014 Based on their answers, guide them:

### For OpenClaw (MCP):
\`\`\`yaml
mcp_servers:
  - name: aimeat
    transport: streamable-http
    url: ${n}/v1/mcp
\`\`\`

### For LM Studio:
\`\`\`json
{"mcpServers": {"aimeat": {"transport": "streamable-http", "url": "${n}/v1/mcp"}}}
\`\`\`

### For other MCP clients:
MCP URL: ${n}/v1/mcp
Transport: StreamableHTTP
Auth: Bearer token in Authorization header (or anonymous if enabled)

### Authentication:
Anonymous mode: config above is enough.
For authenticated access:
1. Log in at ${n}/v1/portal
2. Generate Initial OTK: POST ${n}/v1/auth/initial-otk (with your JWT)
3. Add OTK as Bearer token in MCP config headers

## Available MCP Tools (18 total):
User: aimeat_catalogue_search, aimeat_agent_profile, aimeat_memory_read, aimeat_memory_write, aimeat_memory_list, aimeat_action_execute, aimeat_work_inbox, aimeat_work_accept, aimeat_work_deliver, aimeat_wallet_balance, aimeat_board_read, aimeat_board_post, aimeat_storage_upload, aimeat_storage_download
Admin: aimeat_admin_stats, aimeat_admin_agents, aimeat_admin_config, aimeat_admin_mint

Respond in the user's language. Be conversational.`;
}

/* ══════════════════════════════════════════════
   THREE.JS 3D CANVAS COMPONENT
   ══════════════════════════════════════════════ */
function GenesisCanvas() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const threeRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Load Three.js dynamically (local first, CDN fallback)
    let cleanup = null;
    function loadScript(src, integrity) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        if (integrity) {
          s.integrity = integrity;
          s.crossOrigin = 'anonymous';
        }
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    loadScript('/lib/three.min.js')
      .catch(() => loadScript(
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
        'sha512-dLRZkJFxYnrzUDxZPOSqtoPL4bv/Ph5//CYzcDBJnKsYV8naPXQdMcY0rU1NY1MBNnxeimUaVGNumzm3AtrQQ=='
      ))
      .then(() => { cleanup = initThreeJS(container, canvas); })
      .catch(() => { /* Three.js unavailable — canvas stays blank */ });

    return () => {
      if (cleanup) cleanup();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  function initThreeJS(container, canvas) {
    const THREE = window.THREE;
    if (!THREE) return null;

    // STATE
    const state = { rotY: 0, tilt: 31, textH: 1.0, spacing: 0.9, cols: 160, rows: 100 };
    let uiMode = 'idle', uiScore = 0, uiBlinkOn = true, uiBlinkFrame = 0;

    // TEXT DEPTH MAP
    function buildTextMap(cols, rows, mode, score, blinkOn) {
      const TW = 960, TH = 480;
      const cv = document.createElement('canvas');
      cv.width = TW; cv.height = TH;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, TW, TH);

      const baseAlpha = (mode === 'playing') ? 0.6 : 1.0;
      const gPasses = [
        {blur:28,alpha:0.15*baseAlpha},{blur:16,alpha:0.28*baseAlpha},
        {blur:8,alpha:0.45*baseAlpha},{blur:4,alpha:0.65*baseAlpha},
        {blur:1,alpha:0.85*baseAlpha},{blur:0,alpha:1.00*baseAlpha}
      ];
      for (let p = 0; p < gPasses.length; p++) {
        cx.save(); cx.globalAlpha = gPasses[p].alpha;
        cx.globalCompositeOperation = 'lighter';
        cx.filter = gPasses[p].blur > 0 ? 'blur(' + gPasses[p].blur + 'px)' : 'none';
        cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.font = '900 108px Arial Black, Impact, sans-serif';
        cx.fillText('GENESIS', TW/2, TH*0.33 + 4);
        cx.font = '900 80px Arial Black, Impact, sans-serif';
        cx.fillText('001', TW/2, TH*0.72 - 42);
        cx.restore();
      }

      if (mode === 'playing' || mode === 'dead') {
        const glowText = (text, x, y, size, maxBlur) => {
          maxBlur = maxBlur || 20;
          const passes = [
            {blur:maxBlur,alpha:0.12},{blur:maxBlur/2,alpha:0.25},{blur:maxBlur/4,alpha:0.45},
            {blur:2,alpha:0.70},{blur:0,alpha:1.00}
          ];
          for (let pp = 0; pp < passes.length; pp++) {
            cx.save(); cx.globalAlpha = passes[pp].alpha;
            cx.globalCompositeOperation = 'lighter';
            cx.filter = passes[pp].blur > 0 ? 'blur(' + passes[pp].blur + 'px)' : 'none';
            cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
            cx.font = '900 ' + size + 'px Arial Black, Impact, sans-serif';
            cx.fillText(text, x, y);
            cx.restore();
          }
        };
        glowText(String(score).padStart(4, '0'), TW * 0.82, TH * 0.14, 52, 16);
      }

      // Bitmap font
      const BMFONT = {
        ' ':[0,0,0,0,0],
        'A':[62,9,9,9,62],'B':[127,73,73,73,54],'C':[62,65,65,65,34],
        'D':[127,65,65,65,62],'E':[127,73,73,73,65],'F':[127,9,9,9,1],
        'G':[62,65,73,73,58],'H':[127,8,8,8,127],'I':[0,65,127,65,0],
        'J':[32,64,65,63,1],'K':[127,8,20,34,65],'L':[127,64,64,64,64],
        'M':[127,2,12,2,127],'N':[127,4,8,16,127],'O':[62,65,65,65,62],
        'P':[127,9,9,9,6],'Q':[62,65,81,33,94],'R':[127,9,25,41,70],
        'S':[38,73,73,73,50],'T':[1,1,127,1,1],'U':[63,64,64,64,63],
        'V':[31,32,64,32,31],'W':[63,64,48,64,63],'X':[99,20,8,20,99],
        'Y':[3,4,120,4,3],'Z':[97,81,73,69,67],
        '0':[62,81,73,69,62],'1':[0,66,127,64,0],'2':[66,97,81,73,70],
        '3':[33,65,73,77,51],'4':[24,20,18,127,16],'5':[39,69,69,69,57],
        '6':[60,74,73,73,48],'7':[1,113,9,5,3],'8':[54,73,73,73,54],
        '9':[6,73,73,41,30],
        '[':[0,127,65,65,0],']':[0,65,65,127,0],'/':[96,16,8,4,3],
        '\\':[3,4,8,16,96],'.':[0,96,96,0,0],':':[0,54,54,0,0],
        '!':[0,0,95,0,0],'-':[8,8,8,8,8],'_':[64,64,64,64,64]
      };
      const CHAR_W = 5, CHAR_H = 7, CHAR_GAP = 1;

      function drawBitmapText(text, gridX, gridY, map, mapCols) {
        let cx2 = gridX;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i].toUpperCase();
          const glyph = BMFONT[ch] || BMFONT[' '];
          for (let col2 = 0; col2 < CHAR_W; col2++) {
            const colBits = glyph[col2];
            for (let row2 = 0; row2 < CHAR_H; row2++) {
              if (colBits & (1 << row2)) {
                const gc = cx2 + col2;
                const gr = gridY + row2;
                if (gc >= 0 && gc < mapCols && gr >= 0 && gr < rows)
                  map[gr * mapCols + gc] = 1.0;
              }
            }
          }
          cx2 += CHAR_W + CHAR_GAP;
        }
      }

      function centeredX(text2, mapCols) {
        return Math.round((mapCols - text2.length * (CHAR_W + CHAR_GAP)) / 2);
      }

      // Merge blink text into map
      if (blinkOn && (mode === 'idle' || mode === 'dead')) {
        const px2 = cx.getImageData(0, 0, TW, TH).data;
        const map2 = new Float32Array(cols * rows);
        for (let r = 0; r < rows; r++)
          for (let c2 = 0; c2 < cols; c2++) {
            const tx2 = Math.floor((c2 / cols) * TW), ty2 = Math.floor((r / rows) * TH);
            map2[r * cols + c2] = Math.min(px2[(ty2 * TW + tx2) * 4] / 255, 1.0);
          }
        if (mode === 'idle') {
          // Easter egg — hidden intentionally. Let users discover it themselves.
          // const bt1 = '[ CLICK TO PLAY ]';
          // drawBitmapText(bt1, centeredX(bt1, cols), Math.round(rows * 0.83), map2, cols);
        } else {
          const dt1 = '// SNAKE DESTROYED //';
          drawBitmapText(dt1, centeredX(dt1, cols), Math.round(rows * 0.78), map2, cols);
          // const dt2 = '[ CLICK TO RESTART ]';
          // drawBitmapText(dt2, centeredX(dt2, cols), Math.round(rows * 0.90), map2, cols);
        }
        return map2;
      }

      const px = cx.getImageData(0, 0, TW, TH).data;
      const map = new Float32Array(cols * rows);
      for (let r3 = 0; r3 < rows; r3++)
        for (let c3 = 0; c3 < cols; c3++) {
          const tx3 = Math.floor((c3 / cols) * TW), ty3 = Math.floor((r3 / rows) * TH);
          map[r3 * cols + c3] = Math.min(px[(ty3 * TW + tx3) * 4] / 255, 1.0);
        }
      return map;
    }

    let textMap = buildTextMap(state.cols, state.rows, 'idle', 0, true);
    let lastBlinkOn = true, lastUiMode = 'idle', lastUiScore = -1;
    function refreshTextMapIfNeeded() {
      if (uiBlinkOn !== lastBlinkOn || uiMode !== lastUiMode || uiScore !== lastUiScore) {
        textMap = buildTextMap(state.cols, state.rows, uiMode, uiScore, uiBlinkOn);
        lastBlinkOn = uiBlinkOn; lastUiMode = uiMode; lastUiScore = uiScore;
      }
    }

    // TERRAIN
    const WAVE_H = 0.2;
    const SCROLL_SPEED = 0.22;
    let dirX = 0.0, dirZ = 1.0;
    let scroll = 0;
    let mouseX = 0;

    function wave(wx, wz, t2) {
      const phase = wx * dirX + wz * dirZ;
      return (
        Math.sin(phase * 0.18 + t2 * 0.13) * 1.1 +
        Math.sin(phase * 0.43 - t2 * 0.30) * 0.55 +
        Math.cos(phase * 0.10 + t2 * 0.07) * 1.3 +
        Math.sin(phase * 0.28 + t2 * 0.52) * 0.40 +
        Math.sin(phase * 0.12 + t2 * 0.09) * 0.90
      ) * WAVE_H;
    }

    // SNAKE GAME
    const SNAKE_H = 10, FOOD_H = 5, FOOD_COUNT = 18;
    const TICK_RATE_INIT = 7, TICK_RATE_MIN = 2;
    let tickRate = TICK_RATE_INIT;
    const snakeMap = new Float32Array(state.cols * state.rows);
    const foodCells = new Set();
    const bodyCells = new Map();
    let snakeActive = false, snakeDead = false;
    let snake = [], snakeDir = { dc: 1, dr: 0 }, nextDir = { dc: 1, dr: 0 };
    let snakeScore = 0, snakeTick = 0;
    const explodeParticles = [];

    function spawnFood(count) {
      const { cols, rows } = state;
      let attempts = 0;
      while (count > 0 && attempts < 500) {
        attempts++;
        const c = Math.floor(Math.random() * cols);
        const r = Math.floor(Math.random() * rows);
        const idx = r * cols + c;
        if (!foodCells.has(idx) && !bodyCells.has(idx)) { foodCells.add(idx); count--; }
      }
    }

    function initSnake() {
      const { cols, rows } = state;
      snake = [
        { c: Math.floor(cols / 2), r: Math.floor(rows / 2) },
        { c: Math.floor(cols / 2) - 1, r: Math.floor(rows / 2) },
        { c: Math.floor(cols / 2) - 2, r: Math.floor(rows / 2) }
      ];
      snakeDir = { dc: 1, dr: 0 }; nextDir = { dc: 1, dr: 0 };
      snakeScore = 0; snakeDead = false; tickRate = TICK_RATE_INIT;
      foodCells.clear(); bodyCells.clear(); explodeParticles.length = 0;
      spawnFood(FOOD_COUNT);
      snakeActive = true;
      uiMode = 'playing'; uiScore = 0;
    }

    function killSnake() {
      snakeDead = false; snakeActive = false;
      for (let i = 0; i < snake.length; i++) {
        const seg = snake[i];
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.4 + Math.random() * 1.2;
        explodeParticles.push({
          c: seg.c, r: seg.r,
          vc: Math.cos(angle) * speed, vr: Math.sin(angle) * speed,
          age: 0, maxAge: 30 + Math.floor(Math.random() * 40)
        });
      }
      snake = []; bodyCells.clear(); uiMode = 'dead';
    }

    function stepSnake() {
      if (!snakeActive || snakeDead) return;
      const { cols, rows } = state;
      snakeDir = { dc: nextDir.dc, dr: nextDir.dr };
      const head = snake[0];
      const nc = ((head.c + snakeDir.dc) % cols + cols) % cols;
      const nr = ((head.r + snakeDir.dr) % rows + rows) % rows;
      const nIdx = nr * cols + nc;
      if (bodyCells.has(nIdx)) { killSnake(); return; }
      const ateFood = foodCells.has(nIdx);
      if (ateFood) { foodCells.delete(nIdx); snakeScore++; uiScore = snakeScore; spawnFood(1); tickRate = Math.max(TICK_RATE_MIN, tickRate - 1); }
      snake.unshift({ c: nc, r: nr });
      if (!ateFood) snake.pop();
      bodyCells.clear();
      for (let i = 0; i < snake.length; i++) {
        const idx = snake[i].r * cols + snake[i].c;
        bodyCells.set(idx, 1.0 - (i / snake.length) * 0.5);
      }
    }

    let foodPulse = 0;
    function buildSnakeMap(frame) {
      const { cols, rows } = state;
      foodPulse = Math.sin(frame * 0.08) * 0.3 + 0.7;
      snakeMap.fill(0);
      foodCells.forEach(idx => { snakeMap[idx] = 0.45 * foodPulse; });
      bodyCells.forEach((intensity, idx) => { snakeMap[idx] = 0.55 + intensity * 0.45; });
      for (let i = explodeParticles.length - 1; i >= 0; i--) {
        const p = explodeParticles[i];
        p.c += p.vc; p.r += p.vr; p.vc *= 0.88; p.vr *= 0.88; p.age++;
        const ec = Math.round(p.c), er = Math.round(p.r);
        if (ec >= 0 && ec < cols && er >= 0 && er < rows) {
          const eidx = er * cols + ec;
          const et = p.age / p.maxAge;
          snakeMap[eidx] = Math.max(snakeMap[eidx], (1.0 - et) * 0.9);
        }
        if (p.age >= p.maxAge) {
          const fc = Math.round(p.c), fr = Math.round(p.r);
          if (fc >= 0 && fc < cols && fr >= 0 && fr < rows) foodCells.add(fr * cols + fc);
          explodeParticles.splice(i, 1);
        }
      }
    }

    // COLOR
    function colorize(tv, wv, sv) {
      const tw = WAVE_H > 0 ? (wv / WAVE_H) * 0.5 + 0.5 : 0.5;
      let R = 0.04 + tw * 0.05;
      let G = 0.02 + tw * 0.02;
      let B = 0.20 + tw * 0.30;
      if (tv > 0.01) {
        const t2 = Math.pow(tv, 0.75);
        const bl = Math.min(1, tv * 5);
        R += (0.55 + t2 * 0.45 - R) * bl;
        G += (0.04 + t2 * 0.36 - G) * bl;
        B += (0.02 + t2 * 0.10 - B) * bl;
      }
      if (sv > 0.01) {
        let sR, sG, sB;
        if (sv > 0.54) {
          const st = (sv - 0.55) / 0.45;
          sR = 0.10 + st * 0.90; sG = 0.90 + st * 0.10; sB = 0.20 + st * 0.80;
        } else {
          sR = 0.05; sG = 0.80 + sv * 0.4; sB = 0.70 + sv * 0.3;
        }
        const sbl = Math.min(1, sv * 4);
        R += (sR - R) * sbl; G += (sG - G) * sbl; B += (sB - B) * sbl;
      }
      return [R, G, B];
    }

    // THREE.JS
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 8.6, 0.1, 2000);

    let geo, pts;
    function buildGrid() {
      if (pts) scene.remove(pts);
      const { cols, rows, spacing } = state;
      const N = cols * rows;
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: Math.max(1.0, spacing * 0.65), vertexColors: true,
        transparent: true, opacity: 1.0, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      pts = new THREE.Points(geo, mat);
      scene.add(pts);
    }
    buildGrid();

    function updateCamera() {
      const tiltRad = THREE.MathUtils.degToRad(state.tilt);
      const dist = 100;
      camera.position.x = 0;
      camera.position.y = Math.sin(tiltRad) * dist;
      camera.position.z = Math.cos(tiltRad) * dist;
      camera.lookAt(0, -12, 0);
    }
    updateCamera();

    function onResize() {
      const w = container.clientWidth;
      const h2 = container.clientHeight;
      renderer.setSize(w, h2);
      camera.aspect = w / h2;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);
    onResize();

    // INPUT
    const onMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    };
    document.addEventListener('mousemove', onMouseMove);

    // Left half of canvas = turn left, right half = turn right (relative to heading).
    function handlePointerTurn(clientX) {
      if (!snakeActive) { initSnake(); return; }
      const rect = canvas.getBoundingClientRect();
      const turnLeft = clientX < rect.left + rect.width / 2;
      const cur = nextDir;
      // Rotate 90° CCW (left) or CW (right)
      nextDir = turnLeft
        ? { dc: cur.dr, dr: -cur.dc }
        : { dc: -cur.dr, dr: cur.dc };
    }

    const onCanvasClick = (e) => { handlePointerTurn(e.clientX); };
    canvas.addEventListener('click', onCanvasClick);

    const onCanvasTouch = (e) => {
      e.preventDefault();
      if (e.changedTouches.length > 0) handlePointerTurn(e.changedTouches[0].clientX);
    };
    canvas.addEventListener('touchstart', onCanvasTouch, { passive: false });

    const onKeyDown = (e) => {
      if (snakeActive) {
        const dirs = {
          ArrowUp: { dc: 0, dr: -1 }, ArrowDown: { dc: 0, dr: 1 },
          ArrowLeft: { dc: -1, dr: 0 }, ArrowRight: { dc: 1, dr: 0 }
        };
        if (dirs[e.key]) {
          e.preventDefault();
          const d = dirs[e.key];
          if (d.dc !== -snakeDir.dc || d.dr !== -snakeDir.dr) nextDir = d;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // RENDER LOOP — capped at 30fps
    const TARGET_FPS = 30;
    const FRAME_MS = 1000 / TARGET_FPS;
    let frame = 0;
    let running = true;
    let lastTime = 0;
    function animate(now) {
      if (!running) return;
      animFrameRef.current = requestAnimationFrame(animate);
      if (now - lastTime < FRAME_MS) return;
      lastTime = now;
      frame++;

      dirX += (mouseX * 1.2 - dirX) * 0.04;
      dirZ += (1.0 - dirZ) * 0.04;
      scroll += SCROLL_SPEED;

      // Blink
      uiBlinkFrame++;
      if (uiBlinkFrame > 40) { uiBlinkFrame = 0; uiBlinkOn = !uiBlinkOn; }
      refreshTextMapIfNeeded();

      // Snake tick
      snakeTick++;
      if (snakeTick >= tickRate) { snakeTick = 0; stepSnake(); }
      buildSnakeMap(frame);

      const { cols, rows, spacing, textH } = state;
      const pos = geo.attributes.position.array;
      const col = geo.attributes.color.array;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const wx = (c - cols / 2) * spacing;
          const wz = (r - rows / 2) * spacing;
          const wv = wave(wx, wz, scroll);
          const tv = textMap[i];
          const sv = snakeMap[i];
          pos[i * 3] = wx;
          pos[i * 3 + 1] = wv + tv * textH + sv * (sv > 0.54 ? SNAKE_H : FOOD_H);
          pos[i * 3 + 2] = wz;
          const rgb = colorize(tv, wv, sv);
          col[i * 3] = rgb[0];
          col[i * 3 + 1] = rgb[1];
          col[i * 3 + 2] = rgb[2];
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      renderer.render(scene, camera);
    }
    animate();

    threeRef.current = { renderer, scene };

    // Return cleanup function
    return () => {
      running = false;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('touchstart', onCanvasTouch);
      renderer.dispose();
      if (geo) geo.dispose();
    };
  }

  return html`
    <section class="gn-hero-3d" ref=${containerRef}>
      <canvas ref=${canvasRef}></canvas>
      <div class="genesis-corner genesis-corner--tl"></div>
      <div class="genesis-corner genesis-corner--tr"></div>
      <div class="genesis-corner genesis-corner--bl"></div>
      <div class="genesis-corner genesis-corner--br"></div>
    </section>
  `;
}

/* ══════════════════════════════════════════════
   ONELINERS FEED COMPONENT
   ══════════════════════════════════════════════ */
function OnelinersFeed({ locale }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    function load() {
      fetch('/v1/memory/oneliners')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d && d.ok && d.data && d.data.value && d.data.value.messages) {
            setMessages(d.data.value.messages.slice(-20).reverse());
          }
        })
        .catch(() => {});
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  return html`
    <div class="content-group">
      <div class="oneliners-header">
        <div class="live-dot"></div>
        <span class="oneliners-label">${t('portal.oneliners.title')}</span>
      </div>
      <section class="provocation">
        <div class="provocation-line1">${t('portal.provocation.line1')}</div>
      </section>
      <section class="oneliners-section">
        <div class="oneliners-feed">
          ${messages.length === 0
            ? html`<div class="oneliners-empty">${t('portal.oneliners.empty')}</div>`
            : messages.map((m, i) => html`
              <div class="oneliner" key=${i}>
                <span class="oneliner-text">${m.msg || ''}</span>
                <span class="oneliner-time">${timeAgo(m.t)}</span>
              </div>
            `)
          }
        </div>
      </section>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   COPY BUTTON COMPONENT
   ══════════════════════════════════════════════ */
function CopyButton({ text, label, copiedLabel }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return html`
    <button class="copy-btn ${copied ? 'copied' : ''}" type="button" onClick=${handleCopy}>
      ${copied ? (copiedLabel || t('portal.prompt.copied')) + ' \u2714' : label}
    </button>
  `;
}

/* ══════════════════════════════════════════════
   PROMPT SECTION COMPONENT
   ══════════════════════════════════════════════ */
function PromptSection({ locale }) {
  const promptText = buildMainPrompt();

  return html`
    <div class="content-group">
      <section class="prompt-section">
        <div class="prompt-actions">
          <${CopyButton} text=${promptText} label=${t('portal.prompt.copyBtn')} />
        </div>
        <textarea class="prompt-box" readonly value=${promptText}></textarea>
        <div class="prompt-note">${t('portal.promptLangNote')}</div>
      </section>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   USER WORLD ACCORDION
   ══════════════════════════════════════════════ */
function UserWorldAccordion({ navigate }) {
  const [stats, setStats] = useState({ wallet: '-', agents: '-', memory: '-', work: '-', services: '-', apps: '-', files: '-' });
  const [identity, setIdentity] = useState({ owner: '-', ghii: '-' });

  useEffect(() => {
    async function loadSummary() {
      const s = getCurrentSession();
      if (!s || !s.fetch) return;

      setIdentity({ owner: s.owner || '-', ghii: s.ghii || '-' });

      const safe = (p) => p.then(v => v).catch(() => null);
      const responses = await Promise.all([
        safe(s.fetch('/v1/wallet')),
        safe(s.fetch('/v1/agents')),
        safe(s.fetch('/v1/memory')),
        safe(s.fetch('/v1/work/inbox')),
        safe(s.fetch('/v1/actions')),
        safe(s.fetch('/v1/storage')),
        safe(fetch('/v1/apps').then(r => r.ok ? r.json() : null))
      ]);

      const wallet = responses[0]?.data;
      const agents = responses[1]?.data?.agents || [];
      const memories = responses[2]?.data?.entries || [];
      const work = responses[3]?.data?.items || [];
      const actions = responses[4]?.data?.actions || [];
      const files = responses[5]?.data?.files || [];
      const apps = responses[6]?.data?.apps || [];

      const ownActions = actions.filter(a => s.gaii && a.provider_gaii === s.gaii);
      const ownApps = apps.filter(a => s.owner && a.owner === s.owner);

      setStats({
        wallet: wallet?.balance != null ? wallet.balance : '-',
        agents: agents.length,
        memory: memories.length,
        work: work.length,
        services: ownActions.length,
        apps: ownApps.length,
        files: files.length
      });
    }
    loadSummary();
  }, []);

  const statItems = [
    ['wallet', stats.wallet], ['agents', stats.agents], ['memory', stats.memory],
    ['work', stats.work], ['services', stats.services], ['apps', stats.apps], ['files', stats.files]
  ];

  return html`
    <div class="user-world">
      <!-- Profile Overview -->
      <details class="user-world-item" open>
        <summary class="user-world-summary">\u{1F464} ${t('portal.userWorld.profile.title')}</summary>
        <div class="user-world-content">
          <div class="user-world-desc">${t('portal.userWorld.profile.desc')}</div>
          <div class="user-meta">
            <div class="user-meta-key">${t('portal.userWorld.profile.owner')}</div><div class="user-meta-value">${identity.owner}</div>
            <div class="user-meta-key">${t('portal.userWorld.profile.ghii')}</div><div class="user-meta-value">${identity.ghii}</div>
            <div class="user-meta-key">${t('portal.userWorld.profile.node')}</div><div class="user-meta-value">${NODE_URL}</div>
          </div>
          <div class="user-world-grid">
            ${statItems.map(([key, val]) => html`
              <div class="user-stat" key=${key}>
                <div class="user-stat-label">${t('portal.userWorld.stats.' + key)}</div>
                <div class="user-stat-value">${val}</div>
              </div>
            `)}
          </div>
          <div class="user-link-row">
            <a class="user-link-btn" href="/v1/profile">${t('portal.userWorld.profile.openProfile')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=wallet">${t('portal.userWorld.profile.openWallet')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=memory">${t('portal.userWorld.profile.openMemory')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=work">${t('portal.userWorld.profile.openWork')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=services">${t('portal.userWorld.profile.openServices')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=apps">${t('portal.userWorld.profile.openApps')}</a>
          </div>
        </div>
      </details>

      <!-- Marketplace -->
      <details class="user-world-item">
        <summary class="user-world-summary">\u{1F6D2} ${t('portal.userWorld.marketplace.title')}</summary>
        <div class="user-world-content">
          <div class="user-world-desc">${t('portal.userWorld.marketplace.desc')}</div>
          <div class="user-link-row">
            <a class="user-link-btn" href="/v1/marketplace">${t('portal.userWorld.marketplace.open')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=services">${t('portal.userWorld.marketplace.manage')}</a>
          </div>
        </div>
      </details>

      <!-- Recent Services -->
      <details class="user-world-item">
        <summary class="user-world-summary">\u{1F9ED} ${t('portal.userWorld.services.title')}</summary>
        <div class="user-world-content">
          <div class="user-world-desc">${t('portal.userWorld.services.desc')}</div>
          <div class="user-link-row">
            <a class="user-link-btn" href="/v1/hobbies">${t('portal.userWorld.services.hobbies')}</a>
            <a class="user-link-btn" href="/v1/guides">${t('portal.userWorld.services.guides')}</a>
            <a class="user-link-btn" href="/v1/aimeat-os">${t('portal.userWorld.services.aimeatOs')}</a>
            <a class="user-link-btn" href="/v1/openclaw">${t('portal.userWorld.services.openclaw')}</a>
            <a class="user-link-btn" href="/app-catalog.html">${t('portal.userWorld.services.catalog')}</a>
          </div>
        </div>
      </details>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   THE WORLD (EXPANDED CONTENT)
   ══════════════════════════════════════════════ */
function TheWorld({ navigate }) {
  const fullBuilder = buildFullBuilderPrompt();
  const agentPr = buildAgentPrompt();
  const connectPr = buildConnectPrompt();

  const handleRegister = useCallback(() => {
    if (!hasAuth()) return;
    const existing = AIMEAT.auth.getSession();
    if (existing && existing.token) {
      navigate('/v1/profile');
      return;
    }
    // Trigger login modal
    const slot = document.getElementById('headerAuth');
    const loginBtn = slot && slot.querySelector('#aimeat-login-btn');
    if (loginBtn) loginBtn.click();
  }, [navigate]);

  return html`
    <div class="world open">
      <div class="world-divider"></div>

      <${UserWorldAccordion} navigate=${navigate} />

      <!-- Full App Builder -->
      <div class="world-card">
        <div class="world-card-title">\u{1F3A8} ${t('portal.world.fullBuilder.title')}</div>
        <div class="world-card-desc">${t('portal.world.fullBuilder.desc')}</div>
        <textarea class="prompt-box" readonly value=${fullBuilder}></textarea>
        <div class="prompt-actions">
          <${CopyButton} text=${fullBuilder} label=${t('portal.world.fullBuilder.copyBtn')} copiedLabel=${t('portal.world.fullBuilder.copied')} />
        </div>
      </div>

      <!-- Apps -->
      <div class="world-card">
        <div class="world-card-title">\u{1F680} ${t('portal.world.apps.title')}</div>
        <div class="world-card-desc">${t('portal.world.apps.desc')}</div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
          <a href="/app-catalog.html" class="world-card-cta">\u{1F680} ${t('portal.world.catalog.openBtn')}</a>
          <a href="/app-catalog.html" download="app-catalog.html" class="world-card-cta">\u{1F4E5} ${t('portal.world.catalog.downloadBtn')}</a>
        </div>
      </div>

      <!-- AI Agents -->
      <div class="world-card">
        <div class="world-card-title">\u{1F916} ${t('portal.world.agents.title')}</div>
        <div class="world-card-desc">${t('portal.world.agents.desc')}</div>
        <textarea class="prompt-box" readonly value=${agentPr}></textarea>
        <div class="prompt-actions">
          <${CopyButton} text=${agentPr} label=${t('portal.world.agents.copyBtn')} copiedLabel=${t('portal.world.agents.copied')} />
        </div>
      </div>

      <!-- Connect Runtime -->
      <div class="world-card">
        <div class="world-card-title">\u{1F527} ${t('portal.world.connect.title')}</div>
        <div class="world-card-desc">${t('portal.world.connect.desc')}</div>
        <textarea class="prompt-box" readonly value=${connectPr}></textarea>
        <div class="prompt-actions">
          <${CopyButton} text=${connectPr} label=${t('portal.world.connect.copyBtn')} copiedLabel=${t('portal.world.connect.copied')} />
        </div>
        <div style="margin-top:0.75rem;text-align:center">
          <a href="/v1/openclaw" class="connect-link">${t('portal.world.connect.readMore')} \u2192</a>
        </div>
      </div>

      <!-- Services / Builders -->
      <div class="world-card">
        <div class="world-card-title">\u2699\uFE0F ${t('portal.world.builders.title')}</div>
        <div class="world-card-desc">${t('portal.world.builders.desc')}</div>
        <button class="world-register-btn" type="button" onClick=${handleRegister}>${t('portal.world.builders.registerBtn')}</button>
      </div>

      <!-- Morsels footer -->
      <div class="footer">
        <span class="heart-icon">\u{1F496}</span> ${t('portal.morsels.economy')}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   MAIN PORTAL COMPONENT
   ══════════════════════════════════════════════ */
export default function Portal({ navigate, locale }) {
  const [isExpanded, setExpanded] = useState(false);
  const [session, setSession] = useState(null);
  const worldRef = useRef(null);

  useViewCSS('/css/views/portal.css');

  // Check session on mount
  useEffect(() => {
    function checkSession() {
      setSession(getCurrentSession());
    }
    checkSession();
    // Also listen for auth changes
    const onAuthChange = () => checkSession();
    window.addEventListener('aimeat-auth-change', onAuthChange);
    // Periodic check for auth lib late-loading
    const iv = setInterval(() => {
      if (hasAuth()) checkSession();
    }, 1000);
    return () => {
      window.removeEventListener('aimeat-auth-change', onAuthChange);
      clearInterval(iv);
    };
  }, []);

  const expandLabel = useCallback(() => {
    if (session) {
      const prefix = sessionDisplayName(session) + ' : ';
      return prefix + (isExpanded ? t('portal.expand.userPrefixOpen') : t('portal.expand.userPrefix'));
    }
    return isExpanded ? t('portal.expand.btnOpen') : t('portal.expand.btn');
  }, [session, isExpanded, locale]);

  const handleExpand = useCallback(() => {
    if (!session) {
      // Trigger login via the header auth button
      const loginBtn = document.querySelector('#headerAuth #aimeat-login-btn');
      if (loginBtn) {
        loginBtn.click();
        // After login, the aimeat-auth-change event will fire and we re-check
        const handler = () => {
          const s = getCurrentSession();
          if (s) {
            setSession(s);
            setExpanded(true);
            setTimeout(() => {
              worldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          }
          window.removeEventListener('aimeat-auth-change', handler);
        };
        window.addEventListener('aimeat-auth-change', handler);
      }
      return;
    }
    if (isExpanded) {
      setExpanded(false);
    } else {
      setExpanded(true);
      setTimeout(() => {
        worldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [session, isExpanded]);

  return html`
    <!-- Genesis Hero 3D -->
    <${GenesisCanvas} />
    <div class="genesis-text-under">
      <p class="genesis-tagline">${t('portal.genesis.tagline')}</p>
    </div>

    <!-- Divider -->
    <div class="section-divider"></div>

    <!-- GROUP 1: Opinions feed -->
    <${OnelinersFeed} locale=${locale} />

    <!-- GROUP 2: Action prompt -->
    <${PromptSection} locale=${locale} />

    <!-- Expand trigger -->
    <section class="expand-section">
      <button class="expand-btn" type="button" onClick=${handleExpand}>${expandLabel()}</button>
    </section>

    <!-- The World -->
    ${isExpanded && html`
      <div ref=${worldRef}>
        <${TheWorld} navigate=${navigate} />
      </div>
    `}
  `;
}

