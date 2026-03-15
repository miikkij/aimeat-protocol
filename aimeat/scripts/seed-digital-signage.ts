/**
 * @file seed-digital-signage.ts
 * @description Creates the Digital Signage example package via API calls.
 *   Demonstrates the full package system with all 7 component types.
 * @usage
 *   cd aimeat && OWNER_TOKEN=<jwt> pnpm exec tsx scripts/seed-digital-signage.ts
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:40050';
const OWNER_TOKEN = process.env.OWNER_TOKEN;

if (!OWNER_TOKEN) {
  console.error('ERROR: OWNER_TOKEN env var is required.\n');
  console.error('Usage: OWNER_TOKEN=<jwt> pnpm exec tsx scripts/seed-digital-signage.ts');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as any;
  if (!json.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${json.error?.code} — ${json.error?.message}`);
  }
  return { status: res.status, data: json.data };
}

function log(emoji: string, msg: string) {
  console.log(`  ${emoji} ${msg}`);
}

// ── Component content ────────────────────────────────────────────────

const CSM_SIGNAGE = `# Digital Signage CSM
# Defines data schemas for residents, announcements, and ad slots

schemas:
  resident:
    fields:
      - name: displayName
        type: string
        required: true
      - name: unit
        type: string
        required: true
      - name: moveInDate
        type: date
      - name: photoUrl
        type: string
    visibility: owner

  announcement:
    fields:
      - name: title
        type: string
        required: true
      - name: body
        type: text
        required: true
      - name: priority
        type: enum
        values: [normal, urgent, emergency]
        default: normal
      - name: expiresAt
        type: datetime
      - name: createdBy
        type: string
    visibility: public

  adSlot:
    fields:
      - name: advertiser
        type: string
        required: true
      - name: imageUrl
        type: string
        required: true
      - name: linkUrl
        type: string
      - name: weight
        type: integer
        default: 1
      - name: activeFrom
        type: datetime
      - name: activeUntil
        type: datetime
    visibility: public

permissions:
  announcement:
    create: [operator, owner]
    read: [public]
    delete: [operator]
  adSlot:
    create: [operator]
    read: [public]
    delete: [operator]
  resident:
    create: [owner]
    read: [owner]
    delete: [owner]
`;

const MEMORY_INIT = JSON.stringify({
  "signage:config": {
    rotationIntervalMs: 8000,
    announcementDisplayMs: 12000,
    emergencyOverride: true,
    theme: "dark",
    locale: "en",
    buildingName: "Sunrise Residences",
    floors: 12,
    timezone: "Europe/Helsinki"
  },
  "signage:announcements": [
    {
      id: "welcome-1",
      title: "Welcome to Digital Signage",
      body: "This kiosk displays building announcements, resident info, and sponsored content. Managed through the admin panel.",
      priority: "normal",
      createdBy: "system",
      createdAt: new Date().toISOString()
    }
  ],
  "signage:ads": [
    {
      id: "demo-ad-1",
      advertiser: "Local Cafe",
      imageUrl: "/placeholder/ad-cafe.jpg",
      linkUrl: "https://example.com",
      weight: 2,
      activeFrom: new Date().toISOString(),
      activeUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    }
  ]
}, null, 2);

const CORTEX_SIGNAGE = JSON.stringify({
  manifest: `name: signage-cortex
version: 1.0.0
description: AI agent instructions for managing digital signage content
capabilities:
  - memory_read
  - memory_write
  - consent_check
triggers:
  - event: schedule
    cron: "0 8 * * *"
    action: rotate_daily_content
  - event: memory_change
    key: "signage:announcements"
    action: notify_kiosk_refresh`,
  libs: {
    contentRotation: `// Content rotation logic for the signage cortex
// Selects announcements based on priority and expiry
function selectActiveAnnouncements(announcements, now) {
  return announcements
    .filter(a => !a.expiresAt || new Date(a.expiresAt) > now)
    .sort((a, b) => {
      const pri = { emergency: 0, urgent: 1, normal: 2 };
      return (pri[a.priority] ?? 2) - (pri[b.priority] ?? 2);
    });
}

function selectActiveAds(ads, now) {
  return ads.filter(ad =>
    (!ad.activeFrom || new Date(ad.activeFrom) <= now) &&
    (!ad.activeUntil || new Date(ad.activeUntil) > now)
  );
}`,
    scheduling: `// Daily content scheduling
// Runs via cortex trigger at 08:00 daily
async function rotateDailyContent(memoryApi) {
  const config = await memoryApi.get("signage:config");
  const announcements = await memoryApi.get("signage:announcements");
  const now = new Date();

  // Archive expired announcements
  const active = announcements.filter(a =>
    !a.expiresAt || new Date(a.expiresAt) > now
  );

  if (active.length !== announcements.length) {
    await memoryApi.set("signage:announcements", active);
  }
}`
  }
}, null, 2);

const APP_ADMIN = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signage Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #333; padding: 1rem; }
    h1 { font-size: 1.4rem; margin-bottom: 1rem; }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .tabs button { padding: 0.5rem 1rem; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; }
    .tabs button.active { background: #0066cc; color: #fff; border-color: #0066cc; }
    .panel { background: #fff; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .form-group { margin-bottom: 0.75rem; }
    .form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .form-group input, .form-group textarea, .form-group select {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;
    }
    .form-group textarea { min-height: 80px; resize: vertical; }
    button.primary { background: #0066cc; color: #fff; border: none; padding: 0.5rem 1.5rem; border-radius: 4px; cursor: pointer; }
    button.danger { background: #cc3333; color: #fff; border: none; padding: 0.3rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
    .list-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
    .badge-urgent { background: #fff3cd; color: #856404; }
    .badge-emergency { background: #f8d7da; color: #721c24; }
    .badge-normal { background: #d4edda; color: #155724; }
    #status { margin-top: 0.5rem; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <h1>Digital Signage Admin</h1>
  <div class="tabs">
    <button class="active" onclick="showTab('announcements')">Announcements</button>
    <button onclick="showTab('ads')">Ad Slots</button>
    <button onclick="showTab('config')">Settings</button>
  </div>
  <div id="tab-announcements" class="panel">
    <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Announcements</h2>
    <div id="announcement-list"></div>
    <hr style="margin:1rem 0">
    <div class="form-group"><label>Title</label><input id="ann-title" placeholder="Announcement title"></div>
    <div class="form-group"><label>Body</label><textarea id="ann-body" placeholder="Announcement content"></textarea></div>
    <div class="form-group"><label>Priority</label>
      <select id="ann-priority"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select>
    </div>
    <button class="primary" onclick="addAnnouncement()">Add Announcement</button>
    <div id="status"></div>
  </div>
  <div id="tab-ads" class="panel" style="display:none">
    <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Ad Slots</h2>
    <div id="ad-list"></div>
    <hr style="margin:1rem 0">
    <div class="form-group"><label>Advertiser</label><input id="ad-advertiser" placeholder="Company name"></div>
    <div class="form-group"><label>Image URL</label><input id="ad-image" placeholder="https://..."></div>
    <div class="form-group"><label>Weight (1-10)</label><input id="ad-weight" type="number" value="1" min="1" max="10"></div>
    <button class="primary" onclick="addAd()">Add Ad Slot</button>
  </div>
  <div id="tab-config" class="panel" style="display:none">
    <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Display Settings</h2>
    <div class="form-group"><label>Building Name</label><input id="cfg-building" placeholder="Building name"></div>
    <div class="form-group"><label>Rotation Interval (ms)</label><input id="cfg-interval" type="number" value="8000"></div>
    <div class="form-group"><label>Theme</label>
      <select id="cfg-theme"><option value="dark">Dark</option><option value="light">Light</option></select>
    </div>
    <button class="primary" onclick="saveConfig()">Save Settings</button>
  </div>

  <script>
    const BASE = window.location.origin;
    const TOKEN = localStorage.getItem('aimeat_token') || '';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };

    async function memGet(key) {
      const r = await fetch(BASE + '/v1/memory/' + encodeURIComponent(key), { headers });
      const j = await r.json();
      return j.ok ? (typeof j.data?.value === 'string' ? JSON.parse(j.data.value) : j.data?.value) : null;
    }
    async function memSet(key, value) {
      await fetch(BASE + '/v1/memory/' + encodeURIComponent(key), {
        method: 'PUT', headers, body: JSON.stringify({ value: JSON.stringify(value) })
      });
    }

    function showTab(name) {
      document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + name).style.display = 'block';
      event.target.classList.add('active');
      if (name === 'announcements') loadAnnouncements();
      if (name === 'ads') loadAds();
      if (name === 'config') loadConfig();
    }

    async function loadAnnouncements() {
      const list = await memGet('signage:announcements') || [];
      const el = document.getElementById('announcement-list');
      el.innerHTML = list.length === 0 ? '<p style="color:#999">No announcements yet.</p>' :
        list.map((a, i) => '<div class="list-item"><div><strong>' + esc(a.title) + '</strong> '
          + '<span class="badge badge-' + a.priority + '">' + a.priority + '</span>'
          + '<br><small style="color:#666">' + esc(a.body.substring(0, 80)) + '</small></div>'
          + '<button class="danger" onclick="removeAnnouncement(' + i + ')">Remove</button></div>').join('');
    }

    async function addAnnouncement() {
      const title = document.getElementById('ann-title').value.trim();
      const body = document.getElementById('ann-body').value.trim();
      const priority = document.getElementById('ann-priority').value;
      if (!title || !body) { setStatus('Title and body are required'); return; }
      const list = await memGet('signage:announcements') || [];
      list.push({ id: 'ann-' + Date.now(), title, body, priority, createdBy: 'admin', createdAt: new Date().toISOString() });
      await memSet('signage:announcements', list);
      document.getElementById('ann-title').value = '';
      document.getElementById('ann-body').value = '';
      setStatus('Announcement added');
      loadAnnouncements();
    }

    async function removeAnnouncement(idx) {
      const list = await memGet('signage:announcements') || [];
      list.splice(idx, 1);
      await memSet('signage:announcements', list);
      loadAnnouncements();
    }

    async function loadAds() {
      const ads = await memGet('signage:ads') || [];
      const el = document.getElementById('ad-list');
      el.innerHTML = ads.length === 0 ? '<p style="color:#999">No ads configured.</p>' :
        ads.map((a, i) => '<div class="list-item"><div><strong>' + esc(a.advertiser)
          + '</strong> <small>(weight: ' + a.weight + ')</small></div>'
          + '<button class="danger" onclick="removeAd(' + i + ')">Remove</button></div>').join('');
    }

    async function addAd() {
      const advertiser = document.getElementById('ad-advertiser').value.trim();
      const imageUrl = document.getElementById('ad-image').value.trim();
      const weight = parseInt(document.getElementById('ad-weight').value) || 1;
      if (!advertiser || !imageUrl) { setStatus('Advertiser and image URL required'); return; }
      const ads = await memGet('signage:ads') || [];
      ads.push({ id: 'ad-' + Date.now(), advertiser, imageUrl, weight,
        activeFrom: new Date().toISOString(),
        activeUntil: new Date(Date.now() + 90*24*60*60*1000).toISOString() });
      await memSet('signage:ads', ads);
      document.getElementById('ad-advertiser').value = '';
      document.getElementById('ad-image').value = '';
      loadAds();
    }

    async function removeAd(idx) {
      const ads = await memGet('signage:ads') || [];
      ads.splice(idx, 1);
      await memSet('signage:ads', ads);
      loadAds();
    }

    async function loadConfig() {
      const cfg = await memGet('signage:config') || {};
      document.getElementById('cfg-building').value = cfg.buildingName || '';
      document.getElementById('cfg-interval').value = cfg.rotationIntervalMs || 8000;
      document.getElementById('cfg-theme').value = cfg.theme || 'dark';
    }

    async function saveConfig() {
      const cfg = await memGet('signage:config') || {};
      cfg.buildingName = document.getElementById('cfg-building').value.trim();
      cfg.rotationIntervalMs = parseInt(document.getElementById('cfg-interval').value) || 8000;
      cfg.theme = document.getElementById('cfg-theme').value;
      await memSet('signage:config', cfg);
      setStatus('Settings saved');
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function setStatus(msg) { const el = document.getElementById('status'); if (el) { el.textContent = msg; setTimeout(() => el.textContent = '', 3000); } }

    loadAnnouncements();
  </script>
</body>
</html>`;

const APP_KIOSK = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Digital Signage Kiosk</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; overflow: hidden; height: 100vh; }
    .kiosk { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
    .header { background: #1a1a2e; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 1.6rem; font-weight: 300; }
    .clock { font-size: 1.2rem; font-variant-numeric: tabular-nums; }
    .content { display: grid; grid-template-columns: 2fr 1fr; gap: 1px; background: #222; }
    .main-area { padding: 2rem; display: flex; flex-direction: column; justify-content: center; align-items: center; }
    .sidebar { background: #1a1a2e; padding: 1.5rem; overflow-y: auto; }
    .announcement-card { background: #16213e; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; transition: opacity 0.5s; }
    .announcement-card h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }
    .announcement-card p { font-size: 0.95rem; color: #ccc; line-height: 1.5; }
    .announcement-card.emergency { border-left: 4px solid #e74c3c; }
    .announcement-card.urgent { border-left: 4px solid #f39c12; }
    .ad-display { text-align: center; }
    .ad-display img { max-width: 80%; max-height: 60vh; border-radius: 8px; object-fit: contain; }
    .ad-label { font-size: 0.8rem; color: #666; margin-top: 0.5rem; }
    .footer { background: #1a1a2e; padding: 0.5rem 2rem; display: flex; justify-content: space-between; font-size: 0.8rem; color: #666; }
    .no-content { color: #555; font-size: 1.2rem; text-align: center; }
  </style>
</head>
<body>
  <div class="kiosk">
    <div class="header">
      <h1 id="building-name">Digital Signage</h1>
      <div class="clock" id="clock"></div>
    </div>
    <div class="content">
      <div class="main-area" id="main-display">
        <div class="no-content">Loading content...</div>
      </div>
      <div class="sidebar" id="sidebar">
        <div class="no-content">Loading announcements...</div>
      </div>
    </div>
    <div class="footer">
      <span>Powered by AIMEAT</span>
      <span id="status-text">Connecting...</span>
    </div>
  </div>

  <script>
    const BASE = window.location.origin;
    const TOKEN = localStorage.getItem('aimeat_token') || '';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };

    let config = { rotationIntervalMs: 8000, buildingName: 'Digital Signage', theme: 'dark' };
    let announcements = [];
    let ads = [];
    let currentAdIndex = 0;

    async function memGet(key) {
      try {
        const r = await fetch(BASE + '/v1/memory/' + encodeURIComponent(key), { headers });
        const j = await r.json();
        return j.ok ? (typeof j.data?.value === 'string' ? JSON.parse(j.data.value) : j.data?.value) : null;
      } catch { return null; }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function updateClock() {
      const now = new Date();
      document.getElementById('clock').textContent =
        now.toLocaleDateString(config.locale || 'en', { weekday: 'long', month: 'long', day: 'numeric' })
        + '  ' + now.toLocaleTimeString(config.locale || 'en', { hour: '2-digit', minute: '2-digit' });
    }

    function renderAnnouncements() {
      const el = document.getElementById('sidebar');
      if (announcements.length === 0) {
        el.innerHTML = '<div class="no-content">No announcements</div>';
        return;
      }
      const now = new Date();
      const active = announcements.filter(a => !a.expiresAt || new Date(a.expiresAt) > now);
      active.sort((a, b) => {
        const pri = { emergency: 0, urgent: 1, normal: 2 };
        return (pri[a.priority] || 2) - (pri[b.priority] || 2);
      });
      el.innerHTML = active.map(a =>
        '<div class="announcement-card ' + (a.priority || 'normal') + '">'
        + '<h3>' + esc(a.title) + '</h3>'
        + '<p>' + esc(a.body) + '</p></div>'
      ).join('');
    }

    function rotateAds() {
      const el = document.getElementById('main-display');
      const now = new Date();
      const active = ads.filter(ad =>
        (!ad.activeFrom || new Date(ad.activeFrom) <= now) &&
        (!ad.activeUntil || new Date(ad.activeUntil) > now)
      );
      if (active.length === 0) {
        el.innerHTML = '<div class="no-content">No active advertisements</div>';
        return;
      }
      currentAdIndex = currentAdIndex % active.length;
      const ad = active[currentAdIndex];
      el.innerHTML = '<div class="ad-display">'
        + '<img src="' + esc(ad.imageUrl) + '" alt="' + esc(ad.advertiser) + '" onerror="this.style.display=\'none\'">'
        + '<div class="ad-label">Sponsored by ' + esc(ad.advertiser) + '</div></div>';
      currentAdIndex++;
    }

    async function loadAll() {
      const [cfgData, annData, adData] = await Promise.all([
        memGet('signage:config'),
        memGet('signage:announcements'),
        memGet('signage:ads'),
      ]);
      if (cfgData) {
        config = { ...config, ...cfgData };
        document.getElementById('building-name').textContent = config.buildingName || 'Digital Signage';
      }
      announcements = annData || [];
      ads = adData || [];
      renderAnnouncements();
      rotateAds();
      document.getElementById('status-text').textContent = 'Connected';
    }

    updateClock();
    setInterval(updateClock, 30000);
    loadAll();
    setInterval(() => rotateAds(), config.rotationIntervalMs || 8000);
    setInterval(loadAll, 60000);
  </script>
</body>
</html>`;

const TRANSLATION_FI_EN = JSON.stringify({
  en: {
    "signage.title": "Digital Signage",
    "signage.announcements": "Announcements",
    "signage.ads": "Advertisements",
    "signage.settings": "Settings",
    "signage.addAnnouncement": "Add Announcement",
    "signage.removeAnnouncement": "Remove",
    "signage.priority.normal": "Normal",
    "signage.priority.urgent": "Urgent",
    "signage.priority.emergency": "Emergency",
    "signage.buildingName": "Building Name",
    "signage.rotationInterval": "Rotation Interval (ms)",
    "signage.theme": "Theme",
    "signage.theme.dark": "Dark",
    "signage.theme.light": "Light",
    "signage.saveSettings": "Save Settings",
    "signage.adSlots": "Ad Slots",
    "signage.advertiser": "Advertiser",
    "signage.weight": "Weight",
    "signage.noAnnouncements": "No announcements yet.",
    "signage.noAds": "No ads configured.",
    "signage.poweredBy": "Powered by AIMEAT"
  },
  fi: {
    "signage.title": "Digitaalinen infotaulu",
    "signage.announcements": "Tiedotteet",
    "signage.ads": "Mainokset",
    "signage.settings": "Asetukset",
    "signage.addAnnouncement": "Lisää tiedote",
    "signage.removeAnnouncement": "Poista",
    "signage.priority.normal": "Normaali",
    "signage.priority.urgent": "Kiireellinen",
    "signage.priority.emergency": "Hätätiedote",
    "signage.buildingName": "Rakennuksen nimi",
    "signage.rotationInterval": "Vaihtoväli (ms)",
    "signage.theme": "Teema",
    "signage.theme.dark": "Tumma",
    "signage.theme.light": "Vaalea",
    "signage.saveSettings": "Tallenna asetukset",
    "signage.adSlots": "Mainospaikat",
    "signage.advertiser": "Mainostaja",
    "signage.weight": "Painoarvo",
    "signage.noAnnouncements": "Ei tiedotteita.",
    "signage.noAds": "Ei mainoksia.",
    "signage.poweredBy": "Käyttää AIMEAT-alustaa"
  }
}, null, 2);

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Digital Signage Package Seed ===\n');
  console.log(`  Target: ${BASE_URL}\n`);

  // Step 1: Create the package with all 6 components
  log('📦', 'Creating package with 6 components...');

  const { data: pkg } = await api('POST', '/v1/bundles', {
    name: 'digital-signage',
    description: 'Complete digital signage system for buildings — kiosk display, admin panel, announcements, ads, and AI content management.',
    category: 'iot',
    tags: ['signage', 'kiosk', 'building', 'announcements', 'ads', 'display'],
    visibility: 'public',
    components: [
      {
        id: 'csm-signage',
        type: 'csm',
        label: 'Signage Data Schema',
        content: CSM_SIGNAGE,
        dependencies: [],
      },
      {
        id: 'memory-init',
        type: 'memory',
        label: 'Initial Data',
        content: MEMORY_INIT,
        dependencies: ['csm-signage'],
      },
      {
        id: 'cortex-signage',
        type: 'cortex',
        label: 'Content Management Cortex',
        content: CORTEX_SIGNAGE,
        dependencies: ['csm-signage', 'memory-init'],
      },
      {
        id: 'app-admin',
        type: 'app',
        label: 'Admin Panel',
        content: APP_ADMIN,
        dependencies: ['csm-signage', 'memory-init'],
      },
      {
        id: 'app-kiosk',
        type: 'app',
        label: 'Kiosk Display',
        content: APP_KIOSK,
        dependencies: ['csm-signage', 'memory-init'],
      },
      {
        id: 'translation-fi-en',
        type: 'translation',
        label: 'Finnish & English Translations',
        content: TRANSLATION_FI_EN,
        dependencies: [],
      },
    ],
  });

  const groupId = pkg.packageGroupId;
  const version = pkg.version;
  log('✅', `Package created: ${groupId} (${version})`);

  // Step 2: Publish the version
  log('🚀', 'Publishing version...');

  const encodedGroupId = encodeURIComponent(groupId);
  await api('PATCH', `/v1/bundles/${encodedGroupId}/versions/${version}`, {
    status: 'published',
  });

  log('✅', `Version ${version} published`);

  // Step 3: Create template listing
  log('🏪', 'Creating template listing...');

  const { data: tmpl } = await api('POST', '/v1/templates', {
    packageGroupId: groupId,
    title: 'Digital Signage System',
    description: 'Full-featured digital signage for residential and commercial buildings. Includes a kiosk display for lobbies, an admin panel for managing announcements and ads, AI-powered content rotation, and Finnish/English translations.',
    category: 'iot',
    tags: ['signage', 'kiosk', 'building', 'display', 'announcements'],
    screenshots: [],
  });

  log('✅', `Template listing created: ${tmpl.listing?.id ?? tmpl.id}`);

  // Summary
  console.log('\n=== Summary ===\n');
  console.log(`  Package:    ${pkg.name}`);
  console.log(`  Group ID:   ${groupId}`);
  console.log(`  Version:    ${version}`);
  console.log(`  Status:     published`);
  console.log(`  Components: 6`);
  console.log(`    - csm-signage         (csm)         Data schema`);
  console.log(`    - memory-init         (memory)      Initial data`);
  console.log(`    - cortex-signage      (cortex)      AI content management`);
  console.log(`    - app-admin           (app)          Admin panel`);
  console.log(`    - app-kiosk           (app)          Kiosk display`);
  console.log(`    - translation-fi-en   (translation)  Finnish & English`);
  console.log(`  Template:   ${tmpl.listing?.id ?? tmpl.id}`);
  console.log(`\n  View: ${BASE_URL}/v1/bundles/${encodedGroupId}`);
  console.log(`  Export: ${BASE_URL}/v1/bundles/${encodedGroupId}/export\n`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
