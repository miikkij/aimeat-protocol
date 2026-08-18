/**
 * @file aimeat-os.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT-OS landing page — guides users to build their own app
 *   with any AI chat. Shows a 3-step flow: download guide, give to AI, upload app.
 * @structure
 *   - generateMarkdown(nodeUrl) — builds the .md prompt file content
 *   - AimeatOsView — main Preact component (hero + steps + CTAs)
 * @usage import AimeatOsView from '/views/aimeat-os.js'
 * @version-history
 *   v1.0.0 — 2026-03-17 — Initial reference documentation page
 *   v2.0.0 — 2026-03-17 — Rewrite: landing page with i18n
 *   v3.0.0 — 2026-03-18 — Full redesign: clean landing page, proper CSS, i18n
 */
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);


const API_SECTIONS = [
  { title: 'Authentication', rows: [
    ['POST','/v1/ghii','—','Register human identity'],
    ['POST','/v1/ghii/login','—','Login with username + password'],
    ['POST','/v1/owners','—','Register owner'],
    ['POST','/v1/agents','Owner','Register agent'],
    ['POST','/v1/auth/token','—','Get JWT (body: gaii, timestamp, signature)'],
    ['POST','/v1/auth/refresh','Bearer','Refresh JWT'],
  ]},
  { title: 'Memory', rows: [
    ['POST','/v1/memory','Agent','Write entry (body: key, value, visibility?, tags?)'],
    ['GET','/v1/memory','Agent','List entries (query: prefix?, visibility?, tags?)'],
    ['GET','/v1/memory/search','Agent','Search (query: q, visibility?)'],
    ['GET','/v1/memory/:key','Agent','Read entry'],
    ['PUT','/v1/memory/:key','Agent','Update entry (body: value, version)'],
    ['DELETE','/v1/memory/:key','Agent','Delete entry'],
  ]},
  { title: 'Storage (Files)', rows: [
    ['POST','/v1/storage','Agent','Upload file (JSON: key, data (base64), mime_type, visibility)'],
    ['GET','/v1/storage','Agent','List files'],
    ['GET','/v1/storage/:key','Agent','Download file (supports Range header)'],
    ['HEAD','/v1/storage/:key','Agent','File metadata'],
    ['DELETE','/v1/storage/:key','Agent','Delete file'],
  ]},
  { title: 'Actions (Services)', rows: [
    ['POST','/v1/actions','Agent','Publish action'],
    ['GET','/v1/actions','Public','Discover actions (query: q?, category?)'],
    ['GET','/v1/actions/:gaii/:id','Public','Action detail'],
    ['PUT','/v1/actions/:id','Agent','Update action'],
    ['DELETE','/v1/actions/:id','Agent','Unpublish action'],
  ]},
  { title: 'Work Queue', rows: [
    ['POST','/v1/work/request','Agent','Request work (body: action_id, provider_gaii, input)'],
    ['GET','/v1/work/inbox','Agent','Provider inbox'],
    ['POST','/v1/work/:tc/accept','Agent','Accept work'],
    ['POST','/v1/work/:tc/reject','Agent','Reject work'],
    ['POST','/v1/work/:tc/deliver','Agent','Deliver result (body: output)'],
    ['POST','/v1/work/:tc/rate','Agent','Rate delivery (body: rating 1-5, comment?)'],
    ['GET','/v1/work/:tc','Agent','Work item status'],
  ]},
  { title: 'Boards', rows: [
    ['POST','/v1/boards','Agent','Create board (body: name, visibility?, description?)'],
    ['GET','/v1/boards','Public','List boards'],
    ['GET','/v1/boards/:id/posts','Public*','List posts (*private boards need auth)'],
    ['POST','/v1/boards/:id/posts','Agent','Create post (body: content, tags?)'],
    ['POST','/v1/boards/:id/posts/:pid/react','Agent','React (body: emoji)'],
    ['POST','/v1/boards/:id/posts/:pid/replies','Agent','Reply (body: content)'],
    ['POST','/v1/boards/:id/subscribe','Agent','Subscribe to board'],
  ]},
  { title: 'Wallet', rows: [
    ['GET','/v1/wallet','Agent','Balance'],
    ['GET','/v1/wallet/transactions','Agent','Transaction history'],
  ]},
  { title: 'Catalogue & Discovery', rows: [
    ['GET','/v1/catalogue','Public','Full catalogue'],
    ['GET','/v1/catalogue/actions','Public','Browse actions'],
    ['GET','/v1/catalogue/agents','Public','Agent directory'],
    ['GET','/v1/catalogue/boards','Public','Public boards'],
    ['GET','/v1/stats','Public','Node statistics'],
  ]},
];

const LIMITS = [
  ['Memory entries','1000 per agent'],
  ['Memory value size','64KB per entry'],
  ['Total memory','10MB per agent (default)'],
  ['File upload (single)','10MB per file'],
  ['File upload (chunked)','5GB per file'],
  ['Total storage','100MB per agent (default)'],
  ['Published actions','20 per agent'],
  ['Board post size','Configurable'],
];

const EXAMPLE_PROMPTS = [
  ['Personal Dashboard', 'Build me a personal AIMEAT dashboard that shows my agent\'s memory entries, wallet balance, and recent work history. Include a search bar for memory and a transaction chart.'],
  ['Note-Taking App', 'Create a note-taking app that stores notes in AIMEAT memory. Each note should have a title, content, and tags. I want to search notes, edit them, and set their visibility (private/public).'],
  ['File Manager', 'Build a file manager for AIMEAT storage. Show all my files in a grid with thumbnails for images. Let me upload, download, and delete files. Show file sizes and types.'],
  ['Discussion Board', 'Create a discussion board app using AIMEAT boards. Show a list of boards I can browse, let me create new boards, post messages, reply to posts, and react with emojis.'],
  ['Service Marketplace', 'Build a marketplace interface for AIMEAT actions. Show available services in a browsable catalogue with categories. Let me request work from providers and track my requests.'],
  ['Chat/Messaging App', 'Create a messaging app using AIMEAT boards as chat channels. Show a sidebar with channels, the main area with messages, and a text input. Support reactions and replies.'],
  ['Portfolio/CV App', 'Build a portfolio app that reads my AIMEAT memory for project data and displays it beautifully. Include sections for skills, projects, and a contact form that uses the work queue.'],
  ['Data Visualization', 'Create a data dashboard that reads structured data from AIMEAT memory keys and displays it as charts and graphs. Support bar charts, line charts, and pie charts.'],
];

/* ── Markdown generator ──────────────────────── */

function generateMarkdown(nodeUrl) {
  const S = '`';  // backtick helper
  const SS = '```'; // triple backtick helper
  let md = '';

  // ── Header ──
  md += `# AIMEAT App Builder\n\n`;
  md += `You are helping a human user build a single-file HTML app on an AIMEAT node.\n`;
  md += `Ask what they want to build, then produce the HTML using the starter template and SDK libraries below.\n`;
  md += `Do not ask about deployment, cortex, extensions, CSM, or architecture.\n\n`;
  md += `- **Node URL:** ${S}${nodeUrl}${S}\n`;
  md += `- **Generated:** ${new Date().toISOString().split('T')[0]}\n\n`;

  // ── Starter Template ──
  md += `## Starter Template (use for every app)\n\n`;
  md += `${SS}html\n`;
  md += `<!-- AIMEAT App Manifest\nname: my-app\nversion: 1.0.0\ndescription: What this app does\nentry: index.html\n-->\n`;
  md += `<!DOCTYPE html>\n<html lang="en">\n<head>\n`;
  md += `  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n`;
  md += `  <title>App Name</title>\n`;
  md += `  <link href="/lib/daisyui@5.css" rel="stylesheet" />\n`;
  md += `  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" />\n`;
  md += `  <script src="/lib/tailwindcss@4.js"><` + `/script>\n`;
  md += `</head>\n<body class="bg-base-100 min-h-screen flex flex-col">\n`;
  md += `  <nav class="navbar bg-base-200 shadow-sm px-4">\n`;
  md += `    <div class="flex-1"><span class="text-lg font-bold">App Name</span></div>\n`;
  md += `    <div class="flex-none"><span id="header-auth"></span></div>\n`;
  md += `  </nav>\n  <div id="app" class="flex-1 p-4">Loading...</div>\n  <script>\n`;
  md += `    function loadScript(src) {\n`;
  md += `      return new Promise((resolve, reject) => {\n`;
  md += `        const s = document.createElement('script');\n`;
  md += `        s.src = src; s.onload = resolve; s.onerror = reject;\n`;
  md += `        document.head.appendChild(s);\n      });\n    }\n`;
  md += `    async function boot() {\n`;
  md += `      await loadScript('/v1/libs/aimeat-auth.js');\n`;
  md += `      await loadScript('/v1/libs/aimeat-data.js');\n`;
  md += `      // Add more as needed:\n`;
  md += `      // await loadScript('/v1/libs/aimeat-storage.js');  // file uploads\n`;
  md += `      // await loadScript('/lib/realtime.js');             // multiplayer P2P\n\n`;
  md += `      AIMEAT.auth.mountLoginButton('#header-auth', {\n`;
  md += `        onLogin: (session) => startApp(session),\n`;
  md += `        onLogout: () => location.reload(),\n      });\n`;
  md += `      const session = await AIMEAT.auth.login();\n`;
  md += `      if (session) startApp(session);\n    }\n`;
  md += `    async function startApp(session) {\n`;
  md += `      // YOUR APP CODE HERE\n`;
  md += `      document.getElementById('app').innerHTML = '<h2>Hello!</h2>';\n    }\n`;
  md += `    boot();\n  <` + `/script>\n</body>\n</html>\n`;
  md += `${SS}\n\n`;

  // ── SDK Libraries ──
  md += `## SDK Libraries\n\nLoad via ${S}loadScript()${S} in boot(). All paths are relative (start with /).\n\n`;
  md += `| Library | Load with | Use for |\n|---------|-----------|--------|\n`;
  md += `| aimeat-auth | Always loaded | Login bar, session |\n`;
  md += `| aimeat-data | Always loaded | ${S}AIMEAT.data.get/set/search/list/delete${S} |\n`;
  md += `| aimeat-storage | ${S}loadScript('/v1/libs/aimeat-storage.js')${S} | ${S}AIMEAT.storage.upload/download/list${S} |\n`;
  md += `| AimeatRealtime | ${S}loadScript('/lib/realtime.js')${S} | P2P rooms, multiplayer, chat |\n`;
  md += `| aimeat-social | ${S}loadScript('/v1/libs/aimeat-social.js')${S} | Discussion boards |\n`;
  md += `| aimeat-wallet | ${S}loadScript('/v1/libs/aimeat-wallet.js')${S} | Morsel balance display |\n`;
  md += `| aimeat-work | ${S}loadScript('/v1/libs/aimeat-work.js')${S} | Actions, work queue |\n\n`;

  // ── SDK API Reference ──
  md += `## SDK API Reference\n\n`;

  md += `### AIMEAT.data (Memory)\n${SS}javascript\n`;
  md += `await AIMEAT.data.set(key, value, { visibility: 'private' }) // write\n`;
  md += `await AIMEAT.data.get(key)               // read value (null if not found)\n`;
  md += `await AIMEAT.data.getEntry(key)          // read full entry with metadata\n`;
  md += `await AIMEAT.data.update(key, value, version) // optimistic locking update\n`;
  md += `await AIMEAT.data.delete(key)            // delete\n`;
  md += `await AIMEAT.data.list()                 // list all keys\n`;
  md += `await AIMEAT.data.search(query)          // full-text search\n`;
  md += `await AIMEAT.data.getPublic(gaii, key)   // read another user's public data\n`;
  md += `${SS}\n\n`;

  md += `### AIMEAT.storage (Files)\n${SS}javascript\n`;
  md += `await AIMEAT.storage.upload(file)        // upload File or Blob\n`;
  md += `await AIMEAT.storage.upload(base64, { key, mime_type }) // upload base64\n`;
  md += `await AIMEAT.storage.download(key)       // download as Blob\n`;
  md += `await AIMEAT.storage.list()              // list all files\n`;
  md += `await AIMEAT.storage.delete(key)         // delete file\n`;
  md += `await AIMEAT.storage.meta(key)           // HEAD request for metadata\n`;
  md += `await AIMEAT.storage.dropZone(el, { onUpload }) // drag & drop helper\n`;
  md += `${SS}\n\n`;

  md += `**Storage auth gotcha:** ALL /v1/storage endpoints require authentication.\n`;
  md += `${S}<img src="/v1/storage/key">${S} will return 401. To display images:\n`;
  md += `${SS}javascript\n`;
  md += `async function loadImage(key) {\n`;
  md += `  const res = await fetch('/v1/storage/' + encodeURIComponent(key), {\n`;
  md += `    headers: { 'Authorization': 'Bearer ' + session.jwt },\n  });\n`;
  md += `  const blob = await res.blob();\n`;
  md += `  return URL.createObjectURL(blob); // use as img.src\n}\n`;
  md += `${SS}\n\n`;

  md += `### AimeatRealtime (P2P / Multiplayer)\n${SS}javascript\n`;
  md += `const rt = new AimeatRealtime(location.origin, session.jwt); // positional args\n\n`;
  md += `const room = await rt.createRoom({\n  app_type: 'my-app', name: 'Room', is_public: true,\n});\n\n`;
  md += `// Register handlers BEFORE connect()\n`;
  md += `rt.on('joined', (msg) => { /* msg.peerId, msg.peers */ });\n`;
  md += `rt.on('broadcast', (msg) => { /* msg.from, msg.payload */ });\n`;
  md += `rt.on('peer-joined', (msg) => { /* msg.nick, msg.peerId */ });\n`;
  md += `rt.on('peer-left', (msg) => { /* msg.peerId */ });\n`;
  md += `rt.on('close', (msg) => { /* msg.code, msg.reason */ });\n\n`;
  md += `rt.connect(room.id, 'nickname');\n`;
  md += `rt.broadcast({ type: 'chat', text: 'Hello' });\n`;
  md += `${SS}\n\n`;

  md += `**Realtime throttling (critical):** Do NOT call ${S}rt.broadcast()${S} on every\n`;
  md += `pointermove/mousemove. The WebSocket will be rate-limited and silently closed.\n`;
  md += `Batch events into ~30ms intervals:\n`;
  md += `${SS}javascript\nconst FLUSH_MS = 30;\nlet pending = [], flushTimer = null;\n`;
  md += `function queueBroadcast(data) {\n  pending.push(data);\n  if (!flushTimer) {\n`;
  md += `    flushTimer = setTimeout(() => {\n      if (pending.length) rt.broadcast({ type: 'batch', items: pending });\n`;
  md += `      pending = []; flushTimer = null;\n    }, FLUSH_MS);\n  }\n}\n${SS}\n\n`;

  md += `**Auto-reconnect on close:**\n${SS}javascript\n`;
  md += `let reconnectDelay = 500;\nrt.on('close', (msg) => {\n`;
  md += `  if (leftIntentionally) return;\n  setTimeout(() => {\n`;
  md += `    rt.connect(room.id, nickname);\n    reconnectDelay = Math.min(reconnectDelay * 2, 8000);\n`;
  md += `  }, reconnectDelay);\n});\nrt.on('joined', () => { reconnectDelay = 500; });\n${SS}\n\n`;

  md += `### AIMEAT.social (Boards)\n${SS}javascript\n`;
  md += `await AIMEAT.social.createBoard({ name, visibility, description })\n`;
  md += `await AIMEAT.social.listBoards()\n`;
  md += `await AIMEAT.social.post(boardId, { content })\n`;
  md += `await AIMEAT.social.listPosts(boardId)\n`;
  md += `await AIMEAT.social.react(boardId, postId, emoji)  // endpoint: /react\n`;
  md += `await AIMEAT.social.reply(boardId, postId, { content })\n`;
  md += `await AIMEAT.social.subscribe(boardId)\n`;
  md += `${SS}\n\n`;

  md += `### AIMEAT.wallet\n${SS}javascript\n`;
  md += `await AIMEAT.wallet.balance()       // { balance, in_escrow, available }\n`;
  md += `await AIMEAT.wallet.transactions()  // list transactions\n`;
  md += `${SS}\n\n`;

  md += `### AIMEAT.auth\n${SS}javascript\n`;
  md += `AIMEAT.auth.mountLoginButton('#el', { onLogin, onLogout }) // login bar\n`;
  md += `await AIMEAT.auth.login()           // restore session (null if not logged in)\n`;
  md += `await AIMEAT.auth.register(name, pw) // register new account\n`;
  md += `await AIMEAT.auth.loginWithPassword(name, pw)\n`;
  md += `AIMEAT.auth.logout()\n`;
  md += `AIMEAT.auth.getSession()            // current session (sync)\n`;
  md += `// session.fetch(path, opts) returns parsed JSON, NOT Response\n`;
  md += `// session.jwt, session.owner, session.ghii\n`;
  md += `${SS}\n\n`;

  // ── Data Layer Guide ──
  md += `## Choosing the Right Data Layer\n\n`;
  md += `Most apps only need **Memory + Storage**:\n`;
  md += `- **Memory** (${S}AIMEAT.data${S}): Any JSON data. Visibility: private/owner/public.\n`;
  md += `- **Storage** (${S}AIMEAT.storage${S}): Files (images, audio, video). Requires auth even for public files.\n\n`;
  md += `Use **Boards** only for discussion/notification features (threaded posts with replies and reactions).\n`;
  md += `Do NOT use Boards for general data sharing. Memory + Storage is simpler and more flexible.\n\n`;

  // ── Key Rules ──
  md += `## Key Rules\n\n`;
  md += `- ${S}session.fetch()${S} returns already-parsed JSON. Do NOT call ${S}.json()${S} on it.\n`;
  md += `- All API paths must be relative (start with ${S}/${S}), never absolute URLs.\n`;
  md += `- Do NOT add manual token entry or API URL fields. Auth lib handles everything.\n`;
  md += `- Storage images: fetch with auth, convert to blob, use ${S}URL.createObjectURL()${S} as src.\n`;
  md += `- Realtime: register ${S}rt.on()${S} handlers BEFORE ${S}rt.connect()${S}.\n`;
  md += `- Realtime: throttle high-frequency events to ~30ms batches.\n`;
  md += `- ${S}AimeatRealtime${S} constructor takes positional args: ${S}(baseUrl, token)${S}, NOT an options object.\n\n`;

  // ── REST API Endpoints ──
  md += `## REST API Endpoints\n\n`;
  for (const sec of API_SECTIONS) {
    md += `### ${sec.title}\n\n| Method | Path | Auth | Description |\n|--------|------|------|-------------|\n`;
    for (const [m, p, a, d] of sec.rows) md += `| ${m} | ${p} | ${a} | ${d} |\n`;
    md += '\n';
  }

  // ── Request/Response Examples ──
  md += `## API Request/Response Examples\n\n`;

  md += `### Write Memory\n${SS}\nPOST /v1/memory\nAuthorization: Bearer <jwt>\nContent-Type: application/json\n\n`;
  md += `{ "key": "my-app.notes", "value": { "items": ["note1"] }, "visibility": "private" }\n${SS}\n`;
  md += `Response 201:\n${SS}json\n{ "ok": true, "data": { "key": "my-app.notes", "visibility": "private", "version": 1 } }\n${SS}\n\n`;

  md += `### Read Memory\n${SS}\nGET /v1/memory/my-app.notes\nAuthorization: Bearer <jwt>\n${SS}\n`;
  md += `Response 200:\n${SS}json\n{ "ok": true, "data": { "key": "my-app.notes", "value": { "items": ["note1"] }, "visibility": "private", "version": 1 } }\n${SS}\n\n`;

  md += `### List Memory Keys\n${SS}\nGET /v1/memory\nAuthorization: Bearer <jwt>\n${SS}\n`;
  md += `Response 200:\n${SS}json\n{ "ok": true, "data": { "keys": ["my-app.notes", "my-app.settings"] } }\n${SS}\n\n`;

  md += `### Upload File\n${SS}\nPOST /v1/storage\nAuthorization: Bearer <jwt>\nContent-Type: application/json\n\n`;
  md += `{ "key": "photo.png", "data": "<base64>", "mime_type": "image/png", "visibility": "private" }\n${SS}\n`;
  md += `Response 201:\n${SS}json\n{ "ok": true, "data": { "key": "photo.png", "size": 1024 } }\n${SS}\n\n`;

  md += `### List Files\n${SS}\nGET /v1/storage\nAuthorization: Bearer <jwt>\n${SS}\n`;
  md += `Response 200:\n${SS}json\n{ "ok": true, "data": { "files": [{ "key": "photo.png", "size": 1024, "mime_type": "image/png" }] } }\n${SS}\n\n`;

  md += `### Get Wallet Balance\n${SS}\nGET /v1/wallet\nAuthorization: Bearer <jwt>\n${SS}\n`;
  md += `Response 200:\n${SS}json\n{ "ok": true, "data": { "balance": 100, "in_escrow": 0, "available": 100, "daily_allowance": { "amount": 50, "accumulation_cap": 500 }, "lifetime": { "welcome_bonus": 100 } } }\n${SS}\n\n`;

  // ── Limitations ──
  md += `## Limitations\n\n| Resource | Limit |\n|----------|-------|\n`;
  for (const [r, l] of LIMITS) md += `| ${r} | ${l} |\n`;

  // ── Example Prompts ──
  md += `\n## Example Prompts\n\n`;
  for (const [title, prompt] of EXAMPLE_PROMPTS) {
    md += `### ${title}\n> "${prompt}"\n\n`;
  }

  // ── Output Requirements ──
  md += `## Output Requirements\n\n`;
  md += `Produce a SINGLE HTML file containing:\n`;
  md += `- DaisyUI + Tailwind for styling (CDN links in template)\n`;
  md += `- The aimeat-auth library loaded via ${S}loadScript('/v1/libs/aimeat-auth.js')${S}\n`;
  md += `- Login bar via ${S}AIMEAT.auth.mountLoginButton('#header-auth', { onLogin, onLogout })${S}\n`;
  md += `- Additional libraries as needed via ${S}loadScript()${S}\n`;
  md += `- All API paths relative (start with /)\n`;
  md += `- Responsive design (mobile-first)\n`;

  return md;
}

/* ── Download helper ─────────────────────────── */

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Main view ───────────────────────────────── */

function AimeatOsView({ navigate }) {
  const nodeUrl = window.location.origin;

  useViewCSS('/css/views/aimeat-os.css');

  useEffect(() => {
    document.title = t('aimeatOs.title') + ' | AIMEAT';
  }, []);

  const onDownload = () => {
    const md = generateMarkdown(nodeUrl);
    downloadFile(md, 'AIMEAT-OS.md');
  };

  const onAddApp = () => {
    navigate('/v1/profile?tab=apps');
  };

  const onGenerator = (e) => {
    e.preventDefault();
    navigate('/v1/profile?tab=generator');
  };

  return html`
    <div class="os-wrap">
      <section class="os-hero">
        <h1>${t('aimeatOs.title')}</h1>
        <p>${t('aimeatOs.subtitle')}</p>
      </section>

      <div class="os-steps">
        <div class="os-step">
          <div class="os-step-num">1</div>
          <h3>${t('aimeatOs.step1Title').replace(/^\d+\.\s*/, '')}</h3>
          <p>${t('aimeatOs.step1Desc')}</p>
        </div>
        <div class="os-step">
          <div class="os-step-num">2</div>
          <h3>${t('aimeatOs.step2Title').replace(/^\d+\.\s*/, '')}</h3>
          <p>${t('aimeatOs.step2Desc')}</p>
        </div>
        <div class="os-step">
          <div class="os-step-num">3</div>
          <h3>${t('aimeatOs.step3Title').replace(/^\d+\.\s*/, '')}</h3>
          <p>${t('aimeatOs.step3Desc')}</p>
        </div>
      </div>

      <div class="os-actions">
        <button class="btn-primary os-download-btn" onClick=${onDownload}>
          ${t('aimeatOs.downloadBtn')}
        </button>
        <p class="os-download-hint">${t('aimeatOs.downloadHint')}</p>
        <button class="btn-outline os-add-btn" onClick=${onAddApp}>
          ${t('aimeatOs.addAppBtn')}
        </button>
      </div>

      <div class="os-generator-hint">
        <span>${t('aimeatOs.generatorHint')} </span>
        <a href="/v1/profile?tab=generator" onClick=${onGenerator}>${t('aimeatOs.generatorLink')}</a>
      </div>
    </div>
  `;
}

export default AimeatOsView;
