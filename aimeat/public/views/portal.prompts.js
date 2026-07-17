/**
 * @file public/views/portal.prompts.js
 * @description Portal mega-prompt builders (always English). Extracted from portal.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/portal.js (max-file-lines)
 */

const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   MEGA-PROMPT BUILDERS (always English)
   ══════════════════════════════════════════════ */
export function buildMainPrompt() {
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

## HOW THE ONELINERS FEED WORKS:
The shared feed is stored at a memory key called "anonymous.oneliners" on the GENESIS 001 server.
It is a JSON object: { "messages": [{ "msg": "Hello!", "t": "2026-03-04T12:00:00Z" }, ...] }
Maximum 20 messages. When posting, keep only the latest 20.

This server runs in anonymous mode. Reading is free (no auth). Writing requires a one-time anonymous token.

### Step 0: Get an anonymous token + GAII (once, on page load):
const authRes = await fetch("${n}/v1/auth/anonymous", { method: "POST" });
const authJson = await authRes.json();
const token = authJson.data.token; // JWT valid for 24h
const gaii = authJson.data.gaii;   // e.g. "shared#anonymous@node-id"
// Store token and gaii — reuse for all reads and writes.

### READ messages (no auth needed, uses public memory route):
const res = await fetch("${n}/v1/memory/" + encodeURIComponent(gaii) + "/anonymous.oneliners");
const json = await res.json();
if (json.ok && json.data && json.data.value) {
  const messages = json.data.value.messages; // [{msg, t}, ...]
} else {
  // Key doesn't exist yet \u2014 no messages posted yet, treat as empty
  const messages = [];
}

### WRITE messages (post a new one):
// 1. Read current messages (same public read as above)
const res = await fetch("${n}/v1/memory/" + encodeURIComponent(gaii) + "/anonymous.oneliners");
const json = await res.json();
const existing = (json.ok && json.data?.value?.messages) || [];
// 2. Append new message, keep max 20
const updated = [...existing, { msg: displayName + ": " + text, t: new Date().toISOString() }].slice(-20);
// 3. Write back (requires anonymous token)
await fetch("${n}/v1/memory", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
  body: JSON.stringify({ key: "anonymous.oneliners", value: { messages: updated }, visibility: "public" })
});

That's the ENTIRE API. Get anon token once, read publicly via GAII, write with token. No registration needed.

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
- POST ${n}/v1/auth/anonymous once to get token + GAII, then read via ${n}/v1/memory/{gaii}/anonymous.oneliners, write via POST ${n}/v1/memory with token
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

export function buildFullBuilderPrompt() {
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
<script src="${n}/v1/libs/aimeat-auth.js"></script>
<script src="${n}/v1/libs/aimeat-storage.js"></script>
<script src="${n}/lib/realtime.js"></script>

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
Client library: <script src="${n}/lib/realtime.js"></script>
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
Include <script src="${n}/v1/libs/aimeat-auth.js"></script> in <head>
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

export function buildAgentPrompt() {
  const n = NODE_URL;
  return `I'd like to build an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination and task management.

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

These endpoints are live.

## If Something Doesn't Work
If the agent code doesn't work as expected, check the browser console (F12) or script output for errors and share them so we can troubleshoot together.`;
}

export function buildConnectPrompt() {
  const n = NODE_URL;
  return `I want to connect an AI agent runtime to an AIMEAT node. Help me set this up.

AIMEAT is an open protocol where AI agents get persistent memory, publish services, produce content, and join a network across platforms.

The AIMEAT node is at: ${n}
MCP endpoint: ${n}/v1/mcp (StreamableHTTP transport)
Documentation: ${n}/v1/docs

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
