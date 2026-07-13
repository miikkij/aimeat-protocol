/**
 * @file src/routes/portal-human/page-script.ts
 * @description Human portal page inline browser <script> body (IIFE) as a rendered string with i18n interpolations. Extracted from src/routes/portal-human.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-human.ts (max-file-lines)
 */

import type { AimeatConfig } from '../../config.js';
import type { Locale, TFunction } from '../../i18n.js';
import { jesc } from './escape.js';

export function renderPortalScript(config: AimeatConfig, t: TFunction, locale: Locale): string {
  return `(function() {
  'use strict';

  /* ── Modal i18n strings ── */
  var __modalI18n = {
    title: '${jesc(t('modal.title'))}',
    descNew: '${jesc(t('modal.descNew'))}',
    descReturning: '${jesc(t('modal.descReturning'))}',
    usernamePlaceholder: '${jesc(t('modal.usernamePlaceholder'))}',
    passwordPlaceholder: '${jesc(t('modal.passwordPlaceholder'))}',
    displayNamePlaceholder: '${jesc(t('modal.displayNamePlaceholder'))}',
    signInBtn: '${jesc(t('modal.signInBtn'))}',
    cancelBtn: '${jesc(t('modal.cancelBtn'))}',
    working: '${jesc(t('modal.working'))}',
    errUserShort: '${jesc(t('modal.errUserShort'))}',
    errPassShort: '${jesc(t('modal.errPassShort'))}',
    errWrongPass: '${jesc(t('modal.errWrongPass'))}',
    loggedIn: '${jesc(t('modal.loggedIn'))}',
    logoutBtn: '${jesc(t('modal.logoutBtn'))}',
    whyTitle: '${jesc(t('modal.whyTitle'))}',
    whyGhii: '${jesc(t('modal.whyGhii'))}',
    whyPrivacy: '${jesc(t('modal.whyPrivacy'))}',
    whyControl: '${jesc(t('modal.whyControl'))}',
    whyAgents: '${jesc(t('modal.whyAgents'))}',
    whyMorsels: '${jesc(t('modal.whyMorsels'))}'
  };

  /* ── Clipboard helper (fallback for HTTP) ── */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function() { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  /* ── Language persistence ── */
  var LANG_KEY = 'aimeat-lang';
  var urlParams = new URLSearchParams(window.location.search);
  var langFromUrl = urlParams.get('lang');

  if (langFromUrl) {
    try { localStorage.setItem(LANG_KEY, langFromUrl); } catch(e) {}
    document.cookie = LANG_KEY + '=' + langFromUrl + ';path=/;max-age=31536000;SameSite=Lax';
  }

  /* ── Starfield background ── */
  var canvas = document.getElementById('bgCanvas');
  if (canvas) {
    for (var i = 0; i < 60; i++) {
      var star = document.createElement('div');
      star.className = 'star';
      star.style.left = (Math.random() * 100) + '%';
      star.style.top = (Math.random() * 100) + '%';
      star.style.animationDuration = (2 + Math.random() * 4) + 's';
      star.style.animationDelay = (Math.random() * 4) + 's';
      star.style.width = star.style.height = (1 + Math.random() * 2) + 'px';
      canvas.appendChild(star);
    }
  }

  var nodeUrl = (document.querySelector('meta[name="aimeat-node"]') || {}).content || window.location.origin;
  var userLang = '${locale}';

  /* ── Group expand / collapse ── */
  var groups = document.querySelectorAll('.group-section');
  groups.forEach(function(group) {
    var header = group.querySelector('.group-header');
    if (!header) return;
    header.addEventListener('click', function() {
      var isExpanded = group.classList.contains('expanded');
      groups.forEach(function(g) { g.classList.remove('expanded'); });
      if (!isExpanded) {
        group.classList.add('expanded');
        setTimeout(function() { group.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
      }
    });
  });

  /* ── Welcome board (board.welcome) ── */
  var welcomeList = document.getElementById('welcomeList');
  var welcomeInput = document.getElementById('welcomeInput');
  var welcomeSendBtn = document.getElementById('welcomeSendBtn');
  var welcomeSent = document.getElementById('welcomeSent');
  var WELCOME_KEY = 'board.welcome';

  function timeAgo(iso) {
    var sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h';
    return Math.floor(hr / 24) + 'd';
  }

  function renderWelcome(messages) {
    if (!welcomeList) return;
    if (!messages || messages.length === 0) {
      welcomeList.innerHTML = '<div class="welcome-msg"><span class="welcome-msg-text">${jesc(t('welcome.emptyBoard'))}</span></div>';
      return;
    }
    welcomeList.innerHTML = '';
    messages.slice(-20).reverse().forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'welcome-msg';
      div.innerHTML = '<span class="welcome-msg-text"></span><span class="welcome-msg-time">' + timeAgo(m.t) + '</span>';
      div.querySelector('.welcome-msg-text').textContent = m.msg;
      welcomeList.appendChild(div);
    });
  }

  function loadWelcome() {
    fetch('/v1/memory/' + WELCOME_KEY)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (d && d.ok && d.data && d.data.value && d.data.value.messages) {
          renderWelcome(d.data.value.messages);
        }
      })
      .catch(function() {});
  }

  loadWelcome();

  if (welcomeSendBtn && welcomeInput) {
    welcomeSendBtn.addEventListener('click', function() {
      var text = welcomeInput.value.trim();
      if (!text || text.length > 280) return;
      welcomeSendBtn.disabled = true;
      fetch('/v1/portal/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        welcomeSendBtn.disabled = false;
        if (data.ok) {
          welcomeInput.value = '';
          loadWelcome();
          if (welcomeSent) { welcomeSent.style.display = 'block'; setTimeout(function() { welcomeSent.style.display = 'none'; }, 3000); }
        }
      })
      .catch(function() { welcomeSendBtn.disabled = false; });
    });
  }

  /* ══════════════════════════════════════════════════════════
     MEGA-PROMPT: Group 1 — For Me & Others
     ══════════════════════════════════════════════════════════ */

  var megaForMe = document.getElementById('megaPromptForMe');
  var anonGaii = encodeURIComponent('shared#anonymous@${jesc(config.nodeId)}');
      var text = memoryInput.value.trim();
      if (!text) { memoryInput.focus(); return; }
      if (text.length > 280) return;

      sendBtn.disabled = true;
      sendBtn.classList.add('loading');

      fetch('/v1/portal/try-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
        if (data.ok) {
          memoryInput.value = '';
          /* Reload board to show new message */
          loadBoard();
          /* Show prompt section */
          if (sendResult) sendResult.classList.add('visible');
          if (instructionBlock) {
            var listUrl = nodeUrl + '/v1/memory/' + BOARD_KEY;
            var writeUrl = nodeUrl + '/v1/memory';
            instructionBlock.value =
              'There is an AIMEAT protocol server at ' + nodeUrl + ' with a public message board.\\n\\n' +
              'Before building, ask me two questions:\\n' +
              '1. What should the board be called? (e.g. "Neighborhood Board", "Game Night Chat", "Family Messages")\\n' +
              '2. How should it look and feel? (e.g. "cozy and warm", "sleek and minimal", "fun and colorful", "professional")\\n' +
              'Use my answers to customize the title, colors, fonts, and overall vibe of the board.\\n\\n' +
              'Build a single self-contained HTML file that I will save and open in my browser.\\n\\n' +
              '## Data storage API\\n' +
              'Server: ' + nodeUrl + ' (no authentication needed, anonymous mode)\\n' +
              'Save data: POST ' + writeUrl + '\\n' +
              'Content-Type: application/json\\n' +
              'Body: {"key":"' + BOARD_KEY + '","value":{"messages":[...existing messages..., {"msg":"NEW MESSAGE","t":"2026-01-15T12:00:00.000Z"}]},"visibility":"public","ttl_hours":24}\\n' +
              'Read data: GET ' + listUrl + '\\n' +
              'Response: { ok: true, data: { key: "...", value: { messages: [ { msg: "text", t: "ISO timestamp" }, ... ] } } }\\n' +
              'Messages are in data.value.messages — an array of objects, each with "msg" (the message text) and "t" (ISO 8601 timestamp). Newest messages are last in the array.\\n' +
              'IMPORTANT: Always read the existing messages first (GET), then append the new one to the array, and POST the full updated array back. This is a read-modify-write pattern.\\n\\n' +
              '## App requirements\\n' +
              '1. On load, fetch GET ' + listUrl + ' and display all messages from data.value.messages\\n' +
              '2. Show each message with its text and a human-readable relative time (e.g. "2 minutes ago"), newest first\\n' +
              '3. Show a "Last updated: [time]" label so the user knows when data was last fetched\\n' +
              '4. A "Refresh" button that manually re-fetches and updates the message list\\n' +
              '5. An auto-refresh toggle (checkbox or button) — when enabled, re-fetches every 15 seconds. Default: off\\n' +
              '6. A text input + Send button to post new messages\\n' +
              '7. To send: GET existing board, append new {msg, t} to the messages array, POST the full updated object back to ' + writeUrl + '\\n' +
              '8. After sending, immediately refresh the message list to show the new message\\n\\n' +
              'General requirements:\\n' +
              '- Single HTML file, all CSS and JS inline, no external dependencies\\n' +
              '- Mobile-friendly, works on any screen size\\n' +
              '- Clean, modern UI\\n' +
              '- Dark theme (#0a0a1a background, #ff69b4 pink accent)\\n' +
              '- Works immediately when opened in a browser\\n\\n' +
              'Make the HTML a downloadable file. This is a live API — the URLs work right now.' +
              '\\n\\n## If Something Doesn\\'t Work\\n' +
              'After giving the user the download link or HTML file, always add this message at the end:\\n' +
              '"If the app doesn\\'t work as expected or you see errors, don\\'t worry — tell me what happened and we\\'ll fix it together!\\n\\n' +
              'Here\\'s how to check for errors:\\n' +
              '1. Open the app in your browser\\n' +
              '2. Press F12 (or right-click → Inspect) to open Developer Tools\\n' +
              '3. Click the \\'Console\\' tab\\n' +
              '4. If you see red error messages, copy them and paste them here\\n' +
              '5. I\\'ll analyze the errors and give you a fixed version\\n\\n' +
              'Even if there are no console errors — just describe what\\'s wrong (e.g. \\'the button doesn\\'t do anything\\', \\'I see a blank page\\', \\'the data doesn\\'t save\\') and I\\'ll investigate."';
          }
        }
      })
      .catch(function() {
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
      });
    });
  }

  /* ── Copy instruction to clipboard ── */
  var copyInstructionBtn = document.getElementById('copyInstructionBtn');
  var copyInstructionLabel = '${jesc(t('cards.memory.copyInstructions'))}';
  var copiedInstructionLabel = '${jesc(t('cards.memory.copiedInstructions'))}';

  if (copyInstructionBtn && instructionBlock) {
    copyInstructionBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      copyToClipboard(instructionBlock.value).then(function() {
        copyInstructionBtn.textContent = copiedInstructionLabel;
        setTimeout(function() { copyInstructionBtn.textContent = copyInstructionLabel; }, 2000);
      });
    });
  }

  /* ── Apps: Category selection & prompt templates ── */
  var catCards = document.querySelectorAll('.cat-card');
  var appCategories = document.getElementById('appCategories');
  var promptArea = document.getElementById('promptArea');
  var promptBox = document.getElementById('promptBox');
  var copyPromptBtn = document.getElementById('copyPromptBtn');
  var backToCats = document.getElementById('backToCats');
  var copyLabel = '${jesc(t('cards.apps.copyPrompt'))}';
  var copiedLabel = '${jesc(t('cards.apps.copied'))}';

  var nodeUrl = (document.querySelector('meta[name="aimeat-node"]') || {}).content || window.location.origin;
  var anonGaii = encodeURIComponent('shared#anonymous@${jesc(config.nodeId)}');

  var askUser = 'Before building, ask me:\\n' +
    '1. What should the app be called?\\n' +
    '2. How should it look and feel? (e.g. "cozy and warm", "sleek and minimal", "fun and colorful", "professional")\\n' +
    '3. Memory area: Should this app use its OWN private space, or a SHARED community space where I can see what others have made and add mine?\\n' +
    '   - OWN: create a unique key like "apps.[type].[my-unique-id]" — only I see my data\\n' +
    '   - SHARED: use the community key given below — I see others\\' content and can add mine\\n' +
    'Use my answers to customize everything.\\n\\n';

  var apiRef = '## Data storage API\\n' +
    'Server: ' + nodeUrl + ' (no authentication needed, anonymous mode)\\n' +
    'Save data: POST ' + nodeUrl + '/v1/memory\\n' +
    'Content-Type: application/json\\n' +
    'Body: {"key": "apps.[TYPE].[ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}\\n' +
    'Read data: GET ' + nodeUrl + '/v1/memory/apps.[TYPE].[ID]\\n' +
    'Response: { ok: true, data: { key: "...", value: {...your data...}, ... } }\\n' +
    'List keys: GET ' + nodeUrl + '/v1/memory?prefix=apps.[TYPE]\\n' +
    'IMPORTANT: When updating, always GET first, modify, then POST back (read-modify-write).\\n\\n';

  var baseReqs = 'General requirements:\\n' +
    '- Single HTML file, all CSS and JS inline, no external dependencies\\n' +
    '- Mobile-friendly, works on any screen size\\n' +
    '- Clean, modern UI\\n' +
    '- Works immediately when opened in a browser\\n';

  var realtimeRef = '## Realtime P2P API (optional \\u2014 for live multiplayer)\\n' +
    'Your app can create real-time rooms where multiple users interact live (no polling needed).\\n' +
    'Client library: <scr' + 'ipt src="' + nodeUrl + '/lib/realtime.js"><\\/scr' + 'ipt>\\n\\n' +
    'Quick start:\\n' +
    '  const rt = new AimeatRealtime("' + nodeUrl + '", token);\\n' +
    '  // token comes from: POST ' + nodeUrl + '/v1/auth/anonymous \\u2192 response.data.token\\n' +
    '  const room = await rt.createRoom({ app_type: "[TYPE]", name: "My Room" });\\n' +
    '  rt.connect(room.id, playerName);\\n' +
    '  rt.on("joined", (msg) => console.log("My peer ID:", msg.peerId, "Peers:", msg.peers));\\n' +
    '  rt.on("peer-joined", (msg) => console.log("New peer:", msg.nick));\\n' +
    '  rt.on("peer-left", (msg) => console.log("Peer left:", msg.peerId));\\n' +
    '  rt.on("broadcast", (msg) => console.log("From", msg.from, ":", msg.payload));\\n' +
    '  rt.broadcast({ action: "move", x: 10, y: 20 }); // send to all peers\\n' +
    '  rt.presence({ status: "ready", cursor: {x:100, y:200} }); // share state\\n' +
    '  rt.on("peer-presence", (msg) => console.log(msg.peerId, "state:", msg.state));\\n\\n' +
    'Room lifecycle:\\n' +
    '  - Create: rt.createRoom({ app_type, name, max_peers, is_public, tags })\\n' +
    '  - List: rt.listRooms({ app_type }) \\u2192 rooms array\\n' +
    '  - Connect: rt.connect(roomId, nickname)\\n' +
    '  - Disconnect: rt.disconnect()\\n' +
    '  - Broadcast (to all): rt.broadcast(payload)\\n' +
    '  - Signal (to one peer): rt.signal(peerId, payload) \\u2014 for WebRTC handshake\\n' +
    '  - Presence (share state): rt.presence({ key: value })\\n' +
    '  - Leave: rt.leave()\\n\\n' +
    'Events: joined, peer-joined, peer-left, peer-presence, broadcast, signal, error, open, close\\n' +
    'IMPORTANT: Get an anonymous auth token FIRST, then pass it to AimeatRealtime constructor:\\n' +
    '  const authRes = await fetch("' + nodeUrl + '/v1/auth/anonymous", { method: "POST" });\\n' +
    '  const { data: { token } } = await authRes.json();\\n\\n';

  var baseEnd = '\\nMake the HTML a downloadable file. This is a live API — the URLs work right now.' +
    '\\n\\n## If Something Doesn\\'t Work\\n' +
    'After giving the user the download link or HTML file, always add this message at the end:\\n' +
    '"If the app doesn\\'t work as expected or you see errors, don\\'t worry — tell me what happened and we\\'ll fix it together!\\n\\n' +
    'Here\\'s how to check for errors:\\n' +
    '1. Open the app in your browser\\n' +
    '2. Press F12 (or right-click → Inspect) to open Developer Tools\\n' +
    '3. Click the \\'Console\\' tab\\n' +
    '4. If you see red error messages, copy them and paste them here\\n' +
    '5. I\\'ll analyze the errors and give you a fixed version\\n\\n' +
    'Even if there are no console errors — just describe what\\'s wrong (e.g. \\'the button doesn\\'t do anything\\', \\'I see a blank page\\', \\'the data doesn\\'t save\\') and I\\'ll investigate."';

  var prompts = {
    games: 'Before building, ask me:\\n' +
      '1. What should the game be called?\\n' +
      '2. What type of game? (e.g. "tic-tac-toe", "connect four", "battleship", "trivia quiz", "word game")\\n' +
      '3. How should it look and feel? (e.g. "retro arcade", "cozy board game", "sleek and minimal", "fun and colorful")\\n' +
      '4. Memory area: SHARED community lobby (default \u2014 all players see the same lobby and can join each other), or PRIVATE lobby (only people with the link)?\\n' +
      'Use my answers to customize the title, game type, colors, fonts, and overall vibe.\\n\\n' +
      'I want a multiplayer game with a lobby system as a single self-contained HTML file.\\n\\n' +
      apiRef +
      realtimeRef +
      'NOTE: For real-time multiplayer (instant moves, no polling) use the Realtime P2P API above. ' +
      'For turn-based games, the memory API polling approach below also works fine.\\n\\n' +
      'NOTE: The lobby is already a shared community space by default \u2014 all players see the same lobby and can join each other\\'s games.\\n' +
      'If user wants a PRIVATE lobby, use a unique key like "apps.games.[gametype].private.[uniqueId].lobby" instead.\\n\\n' +
      '## Data structure\\n\\n' +
      'Each game type gets its own memory area. The key format is:\\n' +
      '- Lobby: "apps.games.[gametype].lobby"\\n' +
      '- Individual game: "apps.games.[gametype].[gameId]"\\n\\n' +
      'Lobby format (stored at apps.games.[gametype].lobby):\\n' +
      '{"games": [{"id": "abc123", "name": "My Game Room", "host": "Mika", "status": "waiting", "players": 1, "maxPlayers": 2, "created": "ISO timestamp"}, ...]}\\n\\n' +
      'Game data format (stored at apps.games.[gametype].[gameId]):\\n' +
      '{"id": "abc123", "name": "My Game Room", "type": "[gametype]", "players": [{"name": "Mika", "joinedAt": "ISO"}, {"name": "Liisa", "joinedAt": "ISO"}], "state": {...game-specific state...}, "turn": "Mika", "status": "playing", "winner": null, "created": "ISO", "updated": "ISO"}\\n\\n' +
      'Game requirements:\\n' +
      '1. On first visit, ask the player their name (save to localStorage)\\n' +
      '2. Show lobby screen: list of open games (fetched from lobby key), with host name, status, and player count\\n' +
      '3. "Create Game" button — creates a new game, adds it to the lobby, and waits for opponent\\n' +
      '4. "Join" button on each waiting game — joins the game, updates lobby status\\n' +
      '5. Once two players are in, the game starts. Poll every 2 seconds for opponent moves\\n' +
      '6. Show game status: waiting for opponent, your turn, opponent\\'s turn, you won, you lost, draw\\n' +
      '7. When game ends, update lobby to remove it or mark as finished\\n' +
      '8. "Back to Lobby" button to return and play again\\n' +
      '9. Lobby auto-refreshes every 5 seconds to show new games\\n\\n' +
      'General requirements:\\n' +
      '- Single HTML file, all CSS and JS inline, no external dependencies\\n' +
      '- Mobile-friendly, works on any screen size\\n' +
      '- Game-like UI — bold visuals, fun animations, satisfying interactions, sound effects if possible\\n' +
      '- Works immediately when opened in a browser\\n' + baseEnd,

    notes: askUser +
      'I want a note-taking app as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## Shared community board (if user chooses SHARED):\\n' +
      'Key: "apps.notes.community.board"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.notes.community.board\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","title":"Note title","body":"Note content","created":"ISO timestamp"},...]}\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show all community notes in a feed/list. Each note shows author name and time. Let user add their own with their name.\\n\\n' +
      'App requirements:\\n' +
      '- Create, view, edit, and delete notes\\n' +
      '- If OWN: each note stored as "apps.notes.[note-id]" with value: {title, body, created, updated}\\n' +
      '- If SHARED: all notes stored at "apps.notes.community.board" in items array — show everyone\\'s notes\\n' +
      '- Sidebar or list view showing all saved notes with titles and timestamps\\n' +
      '- Click a note to view or edit it\\n' +
      '- Search or filter notes\\n\\n' +
      baseReqs + baseEnd,

    trackers: askUser +
      'I want a tracker app as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## Shared community dashboard (if user chooses SHARED):\\n' +
      'Key: "apps.tracker.community.dashboard"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.tracker.community.dashboard\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","category":"habit or expense or custom","entries":[{"date":"ISO","value":"..."}],"created":"ISO"},...]}\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show a shared leaderboard/dashboard of everyone\\'s tracked items. Let user add theirs with their name.\\n\\n' +
      'App requirements:\\n' +
      '- Track daily habits, expenses, or anything the user wants\\n' +
      '- If OWN: each entry stored as "apps.tracker.[date]" with value: {items: [...], date}\\n' +
      '- If SHARED: all entries stored at "apps.tracker.community.dashboard" in items array — show everyone\\'s progress\\n' +
      '- Calendar or list view of past entries\\n' +
      '- Simple charts or progress indicators\\n' +
      '- Add and remove tracked items\\n\\n' +
      baseReqs + baseEnd,

    family: askUser +
      'I want a shared family tool as a single self-contained HTML file.\\n\\n' +
      apiRef +
      'NOTE: This category is already shared via URL hash — family members access the same data.\\n' +
      'If user chooses SHARED, it means a PUBLIC community list visible to everyone (not just family).\\n\\n' +
      '## Public community lists (if user chooses SHARED):\\n' +
      'Key: "apps.family.community.lists"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.family.community.lists\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","listName":"Shopping list","entries":[{"text":"Milk","done":false,"addedBy":"Name"}],"created":"ISO"},...]}\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show all public lists. Let user create and contribute to shared lists with their name.\\n\\n' +
      'App requirements:\\n' +
      '- Shareable via URL so family members can access the same data (use URL hash #listId)\\n' +
      '- Auto-refresh by polling memory every 3 seconds to see others\\' changes\\n' +
      '- Add and check off items (shopping list, to-do, etc.)\\n' +
      '- If OWN: all data under shared key "apps.family.[list-id]"\\n' +
      '- If SHARED: public lists at "apps.family.community.lists" — visible to all visitors\\n' +
      '- Ask for name on first visit so items show who added them\\n\\n' +
      baseReqs + baseEnd,

    creative: askUser +
      'I want a creative tool as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## File storage API (for images)\\n' +
      'Use the storage API to save images — it supports much larger files than memory.\\n' +
      'Upload image: POST ' + nodeUrl + '/v1/storage\\n' +
      'Content-Type: application/json\\n' +
      'Body: {"key": "apps/art/[unique-id].png", "data": "<base64-encoded-image>", "mime_type": "image/png", "visibility": "public"}\\n' +
      'Response: { ok: true, data: { key: "apps/art/[unique-id].png", size: 12345, ... } }\\n' +
      'Public image URL (for <img> tags): ' + nodeUrl + '/v1/pub/' + anonGaii + '/apps/art/[unique-id].png\\n' +
      'IMPORTANT: To convert canvas to base64 for upload, use canvas.toDataURL("image/png").split(",")[1] to get the raw base64 WITHOUT the data:image/png;base64, prefix.\\n\\n' +
      '## Shared community gallery (if user chooses SHARED):\\n' +
      'Store the gallery INDEX (metadata only, no image data) in memory:\\n' +
      'Key: "apps.art.community.gallery"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.art.community.gallery\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","title":"Artwork title","storageKey":"apps/art/[id].png","created":"ISO timestamp"},...]}\\n' +
      'To add: First upload image to storage, then GET existing gallery items, append new item with storageKey (NOT base64 data), POST gallery back to memory.\\n' +
      'Display images using the public URL: <img src="' + nodeUrl + '/v1/pub/' + anonGaii + '/[storageKey]">\\n' +
      'Show all community artwork in a gallery grid. Each piece shows author name, title and time. Let user save their drawing alongside others.\\n\\n' +
      'App requirements:\\n' +
      '- Drawing canvas with color picker and brush size\\n' +
      '- Upload images to storage API (not memory) — storage supports large files\\n' +
      '- If OWN: upload to storage with key "apps/art/[drawing-id].png", store metadata in memory at "apps.art.[drawing-id]"\\n' +
      '- If SHARED: upload to storage, then add metadata (with storageKey) to "apps.art.community.gallery" items array\\n' +
      '- Gallery view: load metadata from memory, display images via public storage URL\\n' +
      '- Clear canvas, undo, and download image\\n\\n' +
      baseReqs + baseEnd,

    custom: askUser +
      'I want [DESCRIBE YOUR IDEA HERE] as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## Shared community option (if user chooses SHARED):\\n' +
      'Ask the user what to call the shared space (e.g. "apps.custom.community.[name]").\\n' +
      'Use the same pattern: store data as {"items": [...]} at the shared key.\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.custom.community.[name]\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show all community items and let user add theirs with their name.\\n\\n' +
      baseReqs + '\\n' +
      'Ask me what the app should do before building it.' + baseEnd,

    band: 'Before building, ask me:\\n' +
      '1. What should the jam session be called?\\n' +
      '2. What instruments should be available? (e.g. "drums, guitar, bass, synth, piano")\\n' +
      '3. How should it look and feel? (e.g. "dark neon studio", "cozy wooden stage", "retro arcade")\\n' +
      '4. How many musicians at once? (2\\u201320)\\n' +
      'Use my answers to customize everything.\\n\\n' +
      'I want a real-time jam session app where multiple people can play music together simultaneously.\\n\\n' +
      apiRef +
      realtimeRef +
      '## How it should work\\n' +
      '1. On first visit, ask for a musician name (save to localStorage)\\n' +
      '2. Show a "Stage Finder": list of active rooms via rt.listRooms({ app_type: "band" })\\n' +
      '3. "Create Session" and "Join" buttons\\n' +
      '4. Once connected, show a virtual instrument panel (touchable keyboard/pads/strings)\\n' +
      '5. Each player picks an instrument. Broadcast note events in real-time\\n' +
      '6. Use Web Audio API to synthesize sounds locally\\n' +
      '7. Show all connected musicians with their instrument choice (via presence)\\n' +
      '8. Broadcast format: { instrument: "guitar", note: "C4", velocity: 0.7, duration: 0.5 }\\n' +
      '9. Each peer renders incoming notes to audio locally (Web Audio API)\\n' +
      '10. Show "Now Playing" indicator when peers play notes\\n' +
      '11. "Leave Session" button to disconnect\\n\\n' +
      '## Architecture Notes\\n' +
      '- Audio does NOT travel through the server \\u2014 each client synthesizes sound locally from note events\\n' +
      '- Note events (instrument, note, velocity) are tiny JSON messages via WebSocket broadcast\\n' +
      '- This keeps latency minimal (only a few ms for the JSON message vs. streaming raw audio)\\n' +
      '- For full audio streaming (e.g. real microphone input), use WebRTC P2P audio channels\\n\\n' +
      '## Instruments\\n' +
      'Implement at least 3 instruments using Web Audio API:\\n' +
      '- Drums: Grid of pads (kick, snare, hi-hat, tom) that trigger percussion sounds via OscillatorNode/noise\\n' +
      '- Synth/Keys: Chromatic keyboard (1-2 octaves) with OscillatorNode (sine/square/sawtooth)\\n' +
      '- Bass: Simple bass synth with lower octave notes\\n\\n' +
      'Each instrument should produce short, recognizable sounds even with basic oscillators.\\n\\n' +
      '## Auth setup\\n' +
      'The app must first get an anonymous auth token:\\n' +
      '  const authRes = await fetch("' + nodeUrl + '/v1/auth/anonymous", { method: "POST" });\\n' +
      '  const { data: { token } } = await authRes.json();\\n' +
      'Then create the realtime client: new AimeatRealtime("' + nodeUrl + '", token)\\n\\n' +
      baseReqs +
      '- Include <scr' + 'ipt src="' + nodeUrl + '/lib/realtime.js"><\\/scr' + 'ipt> for the realtime client library\\n' +
      '- Use WebSocket-based realtime API (NOT polling) for all live interactions\\n' +
      '- Mobile-friendly \\u2014 pads/keys work on touch screens\\n' +
      '- Dark, studio-like UI\\n' + baseEnd,

    realtime: 'Before building, ask me:\\n' +
      '1. What should the app be called?\\n' +
      '2. What type of real-time experience? (e.g. "collaborative whiteboard", "live chat room", "multiplayer game", "jam session", "shared timer")\\n' +
      '3. How should it look and feel? (e.g. "sleek and minimal", "fun and colorful", "dark mode gaming")\\n' +
      '4. How many people at once? (2–20)\\n' +
      'Use my answers to customize everything.\\n\\n' +
      'I want a real-time collaborative app where multiple people interact simultaneously — no page refreshing, instant updates.\\n\\n' +
      apiRef +
      realtimeRef +
      '## How it should work\\n' +
      '1. On first visit, ask the user for a display name (save to localStorage)\\n' +
      '2. Show a room browser: list of active rooms (via rt.listRooms({ app_type: "[TYPE]" }))\\n' +
      '3. "Create Room" button — creates a new room and connects to it\\n' +
      '4. "Join" button on each room — connects to that room\\n' +
      '5. Once connected, show the live experience with peer list sidebar\\n' +
      '6. All interactions broadcast instantly to all peers (NO polling)\\n' +
      '7. Show who\\'s online and their status via presence\\n' +
      '8. Handle peer join/leave gracefully with notifications\\n' +
      '9. "Leave Room" button to disconnect and return to room browser\\n\\n' +
      '## Auth setup\\n' +
      'The app must first get an anonymous auth token:\\n' +
      '  const authRes = await fetch("' + nodeUrl + '/v1/auth/anonymous", { method: "POST" });\\n' +
      '  const { data: { token } } = await authRes.json();\\n' +
      'Then create the realtime client: new AimeatRealtime("' + nodeUrl + '", token)\\n\\n' +
      baseReqs +
      '- Include <scr' + 'ipt src="' + nodeUrl + '/lib/realtime.js"><\\/scr' + 'ipt> for the realtime client library\\n' +
      '- Use WebSocket-based realtime API (NOT polling) for all live interactions\\n' +
      '- Show connection status indicator (connected / disconnected / reconnecting)\\n' + baseEnd
  };

  catCards.forEach(function(cat) {
    cat.addEventListener('click', function(e) {
      e.stopPropagation();
      var catId = cat.dataset.category;
      if (prompts[catId] && promptBox) {
        promptBox.value = prompts[catId];
        if (appCategories) appCategories.style.display = 'none';
        if (promptArea) promptArea.classList.add('visible');
      }
    });
  });

  if (backToCats) {
    backToCats.addEventListener('click', function(e) {
      e.stopPropagation();
      if (promptArea) promptArea.classList.remove('visible');
      if (appCategories) appCategories.style.display = '';
    });
  }

  if (copyPromptBtn && promptBox) {
    copyPromptBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      copyToClipboard(promptBox.value).then(function() {
        copyPromptBtn.textContent = copiedLabel;
        setTimeout(function() { copyPromptBtn.textContent = copyLabel; }, 2000);
      });
    });
  }

  /* ── Apps: Return flow button ── */
  var returnBtn = document.getElementById('return-app-btn');
  if (returnBtn) {
    returnBtn.addEventListener('click', function() {
      if (typeof AIMEAT === 'undefined' || !AIMEAT.auth) return;
      var existing = AIMEAT.auth.getSession();

      /* Already logged in → go to profile apps tab */
      if (existing && existing.token) {
        window.location.href = '/v1/profile?tab=apps';
        return;
      }

      /* Not logged in → open sign-in modal */
      var tmp = document.createElement('div');
      tmp.id = 'aimeat-return-auth';
      tmp.style.position = 'fixed';
      tmp.style.top = '-9999px';
      document.body.appendChild(tmp);
      AIMEAT.auth.mountLoginButton('#aimeat-return-auth', {
        nodeUrl: '${jesc(config.baseUrl)}',
        i18n: __modalI18n,
        onLogin: function(session) {
          tmp.remove();
          window.location.href = '/v1/profile?tab=apps';
        }
      });
      var loginBtn = document.getElementById('aimeat-login-btn');
      if (loginBtn) loginBtn.click();
    });
    // Update text if already logged in
    setTimeout(function() {
      if (typeof AIMEAT !== 'undefined' && AIMEAT.auth && AIMEAT.auth.hasSession) {
        returnBtn.textContent = returnBtn.dataset.authText;
      }
    }, 500);
  }

  /* ── Services: need help / offer help ── */
  var needHelpBtn = document.getElementById('needHelpBtn');
  var offerHelpBtn = document.getElementById('offerHelpBtn');
  var needHelpForm = document.getElementById('needHelpForm');
  var offerHelpForm = document.getElementById('offerHelpForm');
  var serviceChoices = document.getElementById('serviceChoices');

  /* Populate example chips */
  var needHelpExamples = [${t('cards.services.needHelpExamples').split(', ').map(s => `'${jesc(s)}'`).join(',')}];
  var offerHelpExamples = [${t('cards.services.offerHelpExamples').split(', ').map(s => `'${jesc(s)}'`).join(',')}];

  function populateChips(containerId, examples, inputId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    examples.forEach(function(ex) {
      var chip = document.createElement('span');
      chip.className = 'service-chip';
      chip.textContent = ex;
      chip.addEventListener('click', function() {
        var input = document.getElementById(inputId);
        if (input) input.value = ex;
      });
      container.appendChild(chip);
    });
  }
  populateChips('needHelpChips', needHelpExamples, 'needHelpInput');
  populateChips('offerHelpChips', offerHelpExamples, 'offerHelpInput');

  function showServiceForm(mode) {
    if (typeof AIMEAT === 'undefined' || !AIMEAT.auth) return;
    var existing = AIMEAT.auth.getSession();

    /* Not logged in → open sign-in modal */
    if (!existing || !existing.token) {
      var tmp = document.createElement('div');
      tmp.id = 'aimeat-service-auth';
      tmp.style.position = 'fixed';
      tmp.style.top = '-9999px';
      document.body.appendChild(tmp);
      AIMEAT.auth.mountLoginButton('#aimeat-service-auth', {
        nodeUrl: '${jesc(config.baseUrl)}',
        i18n: __modalI18n,
        onLogin: function(session) {
          tmp.remove();
          showServiceForm(mode);
        }
      });
      var loginBtn = document.getElementById('aimeat-login-btn');
      if (loginBtn) loginBtn.click();
      return;
    }

    /* Logged in → show the form */
    if (serviceChoices) serviceChoices.style.display = 'none';
    if (mode === 'request') {
      if (needHelpForm) needHelpForm.classList.add('visible');
      if (offerHelpForm) offerHelpForm.classList.remove('visible');
    } else {
      if (offerHelpForm) offerHelpForm.classList.add('visible');
      if (needHelpForm) needHelpForm.classList.remove('visible');
    }
  }

  function hideServiceForm() {
    if (needHelpForm) needHelpForm.classList.remove('visible');
    if (offerHelpForm) offerHelpForm.classList.remove('visible');
    if (serviceChoices) serviceChoices.style.display = '';
  }

  if (needHelpBtn) {
    needHelpBtn.addEventListener('click', function(e) { e.stopPropagation(); showServiceForm('request'); });
  }
  if (offerHelpBtn) {
    offerHelpBtn.addEventListener('click', function(e) { e.stopPropagation(); showServiceForm('offer'); });
  }

  /* Submit request */
  var submitRequestBtn = document.getElementById('submitRequestBtn');
  if (submitRequestBtn) {
    submitRequestBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var input = document.getElementById('needHelpInput');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      var session = AIMEAT.auth.getSession();
      if (!session || !session.token) return;
      submitRequestBtn.disabled = true;
      submitRequestBtn.textContent = '...';
      fetch('${jesc(config.baseUrl)}/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.token },
        body: JSON.stringify({ key: 'service-request:' + Date.now(), value: { type: 'service_request', text: text, created: new Date().toISOString() }, visibility: 'node' })
      }).then(function(r) { return r.json(); }).then(function(data) {
        var result = document.getElementById('needHelpResult');
        if (result) {
          result.textContent = '${jesc(t('cards.services.posted'))} ${jesc(t('cards.services.requestPosted'))}';
          result.style.display = 'block';
        }
        if (input) input.value = '';
        submitRequestBtn.disabled = false;
        submitRequestBtn.textContent = '${jesc(t('cards.services.submitRequest'))}';
      }).catch(function() {
        submitRequestBtn.disabled = false;
        submitRequestBtn.textContent = '${jesc(t('cards.services.submitRequest'))}';
      });
    });
  }

  /* Submit offer */
  var submitOfferBtn = document.getElementById('submitOfferBtn');
  if (submitOfferBtn) {
    submitOfferBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var input = document.getElementById('offerHelpInput');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      var session = AIMEAT.auth.getSession();
      if (!session || !session.token) return;
      submitOfferBtn.disabled = true;
      submitOfferBtn.textContent = '...';
      fetch('${jesc(config.baseUrl)}/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.token },
        body: JSON.stringify({ key: 'service-offer:' + Date.now(), value: { type: 'service_offer', text: text, created: new Date().toISOString() }, visibility: 'node' })
      }).then(function(r) { return r.json(); }).then(function(data) {
        var result = document.getElementById('offerHelpResult');
        if (result) {
          result.textContent = '${jesc(t('cards.services.posted'))} ${jesc(t('cards.services.offerPosted'))}';
          result.style.display = 'block';
        }
        if (input) input.value = '';
        submitOfferBtn.disabled = false;
        submitOfferBtn.textContent = '${jesc(t('cards.services.submitOffer'))}';
      }).catch(function() {
        submitOfferBtn.disabled = false;
        submitOfferBtn.textContent = '${jesc(t('cards.services.submitOffer'))}';
      });
    });
  }

  /* ── Launcher: Copy customization prompt ── */
  var copyLauncherPromptBtn = document.getElementById('copyLauncherPromptBtn');
  if (copyLauncherPromptBtn) {
    var launcherPrompt = 'I have an app-catalog.html file (attached or pasted below). It is a personal app catalog that runs as a single HTML file in the browser.\\n\\n' +
      'I want you to customize it for me. Here is what I want you to change:\\n' +
      '- [TELL THE AI: colors, layout, language, features you want added or removed]\\n\\n' +
      'Requirements:\\n' +
      '- Keep it as a single self-contained HTML file (inline CSS + JS, no external dependencies)\\n' +
      '- It must work completely offline (no CDN links)\\n' +
      '- Keep IndexedDB storage for the app registry\\n' +
      '- Keep the AIMEAT import feature (fetches apps from /v1/apps)\\n' +
      '- The AIMEAT node URL should be configurable in settings\\n\\n' +
      'Give me the complete modified HTML file.';
    var launcherCopyLabel = '${jesc(t('cards.launcher.copyPromptBtn'))}';
    var launcherCopiedLabel = '${jesc(t('cards.launcher.copiedPromptBtn'))}';
    copyLauncherPromptBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      copyToClipboard(launcherPrompt).then(function() {
        copyLauncherPromptBtn.textContent = '\\u2705 ' + launcherCopiedLabel;
        setTimeout(function() { copyLauncherPromptBtn.textContent = '\\ud83d\\udccb ' + launcherCopyLabel; }, 2000);
      });
    });
  }

})();`;
}
