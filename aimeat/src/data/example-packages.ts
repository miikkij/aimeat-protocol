/**
 * @file example-packages.ts
 * @description Example package definitions for seeding. Used by both the admin
 *   seed endpoint (POST /v1/admin/seed-examples) and the CLI seed script.
 * @structure
 *   - getExamplePackages() — returns all example package definitions
 *   - buildRecords() — builds ready-to-store PackageRecord + TemplateListingRecord
 * @usage
 *   import { getExamplePackages, buildRecords } from '../data/example-packages.js';
 * @version-history
 *   v1.0.0 — 2026-03-16 — initial implementation, extracted from seed-digital-signage.ts
 *   v1.1.0 — 2026-03-16 — fix admin app: pass version for optimistic locking on
 *     memory PUT, fix double-stringification of values; fix memoryInit entries format
 *   v1.2.0 — 2026-03-17 — rename Ad Slots to Rotated Views; add edit capability;
 *     support image/HTML/URL content types; layout modes (fullscreen/header/full);
 *     light+dark themes with accent colour; AI prompt helper for HTML views
 *   v1.3.0 — 2026-05-05 — rewrite cortex manifest with proper components array,
 *     .js lib filenames, tags, exports, and api_surface metadata
 */

import { createHash, randomUUID } from 'node:crypto';
import type { PackageRecord, PackageComponent, TemplateListingRecord } from '../storage/interface.js';
import { aimeatIamPackage } from './aimeat-iam-package.js';
import { aimeatMarketplacePackage } from './aimeat-marketplace-package.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ExamplePackageDef {
  name: string;
  description: string;
  category: string;
  tags: string[];
  visibility: 'public' | 'private';
  components: { id: string; type: string; label: string; content: string; dependencies: string[] }[];
  templateListing: {
    title: string;
    description: string;
    category: string;
    tags: string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function generateVersion(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `v${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Public API ───────────────────────────────────────────────────────

/** Get all example package definitions. */
export function getExamplePackages(): ExamplePackageDef[] {
  return [digitalSignagePackage(), aimeatIamPackage(), aimeatMarketplacePackage()];
}

/**
 * Build ready-to-store PackageRecord + TemplateListingRecord for an example.
 * The package is created as 'published' so it's immediately installable.
 */
export function buildRecords(def: ExamplePackageDef, author: string, authorGhii: string): {
  pkg: PackageRecord;
  listing: TemplateListingRecord;
} {
  const now = new Date().toISOString();
  const pkgId = randomUUID();
  const packageGroupId = `${def.name}::${author}`;
  const version = generateVersion();

  const components: PackageComponent[] = def.components.map(c => ({
    id: c.id,
    type: c.type as PackageComponent['type'],
    label: c.label,
    content: c.content,
    contentHash: hashContent(c.content),
    dependencies: c.dependencies,
  }));

  const pkg: PackageRecord = {
    id: pkgId,
    packageGroupId,
    name: def.name,
    author,
    authorGhii,
    version,
    changelog: 'Initial version (example package)',
    description: def.description,
    category: def.category,
    tags: def.tags,
    visibility: def.visibility,
    status: 'published',
    components,
    manifest: '',
    createdAt: now,
    updatedAt: now,
  };

  const listing: TemplateListingRecord = {
    id: randomUUID(),
    packageGroupId,
    packageName: def.name,
    packageAuthor: author,
    publishedBy: author,
    publishedByGhii: authorGhii,
    title: def.templateListing.title,
    description: def.templateListing.description,
    screenshots: [],
    category: def.templateListing.category,
    tags: def.templateListing.tags,
    featured: false,
    installCount: 0,
    rating: 0,
    reviewCount: 0,
    status: 'listed',
    createdAt: now,
    updatedAt: now,
  };

  return { pkg, listing };
}

// ══════════════════════════════════════════════════════════════════════
// ── Digital Signage Package ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function digitalSignagePackage(): ExamplePackageDef {
  return {
    name: 'digital-signage',
    description: 'Complete digital signage system for buildings — kiosk display, admin panel, announcements, rotated views (image/HTML/URL), layout modes, and AI content management.',
    category: 'iot',
    tags: ['signage', 'kiosk', 'building', 'announcements', 'display', 'rotated-views'],
    visibility: 'public',
    components: [
      { id: 'csm-signage', type: 'csm', label: 'Signage Data Schema', content: CSM_SIGNAGE, dependencies: [] },
      { id: 'memory-init', type: 'memory', label: 'Initial Data', content: memoryInit(), dependencies: ['csm-signage'] },
      { id: 'cortex-signage', type: 'cortex', label: 'Content Management Cortex', content: CORTEX_SIGNAGE, dependencies: ['csm-signage', 'memory-init'] },
      { id: 'app-admin', type: 'app', label: 'Admin Panel', content: APP_ADMIN, dependencies: ['csm-signage', 'memory-init'] },
      { id: 'app-kiosk', type: 'app', label: 'Kiosk Display', content: APP_KIOSK, dependencies: ['csm-signage', 'memory-init'] },
      { id: 'translation-fi-en', type: 'translation', label: 'Finnish & English Translations', content: TRANSLATION_FI_EN, dependencies: [] },
    ],
    templateListing: {
      title: 'Digital Signage System',
      description: 'Full-featured digital signage for residential and commercial buildings. Includes kiosk display with layout modes (fullscreen/header/full), rotated views (image/HTML/URL), light & dark themes, admin panel, AI content rotation, and Finnish/English translations.',
      category: 'iot',
      tags: ['signage', 'kiosk', 'building', 'display', 'announcements'],
    },
  };
}

// ── Content constants ────────────────────────────────────────────────

const CSM_SIGNAGE = `# Digital Signage CSM
schemas:
  resident:
    fields:
      - { name: displayName, type: string, required: true }
      - { name: unit, type: string, required: true }
      - { name: moveInDate, type: date }
      - { name: photoUrl, type: string }
    visibility: owner
  announcement:
    fields:
      - { name: title, type: string, required: true }
      - { name: body, type: text, required: true }
      - { name: priority, type: enum, values: [normal, urgent, emergency], default: normal }
      - { name: expiresAt, type: datetime }
      - { name: createdBy, type: string }
    visibility: public
  rotatedView:
    fields:
      - { name: name, type: string, required: true }
      - { name: type, type: enum, values: [image, html, url], default: image }
      - { name: content, type: text, required: true }
      - { name: weight, type: integer, default: 1 }
      - { name: activeFrom, type: datetime }
      - { name: activeUntil, type: datetime }
    visibility: public
permissions:
  announcement: { create: [operator, owner], read: [public], delete: [operator] }
  rotatedView: { create: [operator], read: [public], delete: [operator] }
  resident: { create: [owner], read: [owner], delete: [owner] }
`;

function memoryInit(): string {
  // Must use { entries: [{ key, value }] } format for component-registrar
  return JSON.stringify({
    entries: [
      {
        key: 'signage:config',
        value: {
          rotationEnabled: true, rotationIntervalSec: 8,
          emergencyOverride: true, theme: 'dark',
          layout: 'full', accentColor: '#1a1a2e',
          locale: 'en', buildingName: 'Sunrise Residences', floors: 12, timezone: 'Europe/Helsinki',
        },
        visibility: 'private',
      },
      {
        key: 'signage:announcements',
        value: [{
          id: 'welcome-1', title: 'Welcome to Digital Signage',
          body: 'This kiosk displays building announcements and rotated content views.',
          priority: 'normal', createdBy: 'system', createdAt: new Date().toISOString(),
        }],
        visibility: 'private',
      },
      {
        key: 'signage:views',
        value: [{
          id: 'demo-view-1', name: 'Local Cafe', type: 'image',
          content: '/placeholder/ad-cafe.jpg', weight: 2,
          activeFrom: new Date().toISOString(),
          activeUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        }],
        visibility: 'private',
      },
    ],
  }, null, 2);
}

const CORTEX_SIGNAGE = JSON.stringify({
  manifest: [
    'name: signage-cortex',
    'version: 1.0.0',
    'description: Content management cortex for digital signage -- schedules content rotation, prunes expired announcements, and provides helper libraries for kiosk apps.',
    'tags: [signage, kiosk, content-management, scheduling]',
    'capabilities: [memory_read, memory_write, consent_check]',
    'triggers:',
    '  - { event: schedule, cron: "0 8 * * *", action: rotate_daily_content }',
    '  - { event: memory_change, key: "signage:announcements", action: notify_kiosk_refresh }',
    'components:',
    '  - type: lib',
    '    name: contentRotation',
    '    filename: contentRotation.js',
    '    exports: [selectActiveAnnouncements]',
    '    api_surface: |',
    '      selectActiveAnnouncements(announcements, now)',
    '        Filters expired announcements and sorts by priority (emergency > urgent > normal).',
    '        Returns: filtered, sorted array.',
    '  - type: lib',
    '    name: scheduling',
    '    filename: scheduling.js',
    '    exports: [rotateDailyContent]',
    '    api_surface: |',
    '      rotateDailyContent(api)',
    '        Reads signage:announcements, removes expired entries, writes back.',
    '        Called by the daily cron trigger.',
  ].join('\n'),
  libs: {
    'contentRotation.js': 'function selectActiveAnnouncements(a,now){return a.filter(x=>!x.expiresAt||new Date(x.expiresAt)>now).sort((a,b)=>({emergency:0,urgent:1,normal:2}[a.priority]??2)-({emergency:0,urgent:1,normal:2}[b.priority]??2));}',
    'scheduling.js': 'async function rotateDailyContent(api){const a=await api.get("signage:announcements");const now=new Date();const active=a.filter(x=>!x.expiresAt||new Date(x.expiresAt)>now);if(active.length!==a.length)await api.set("signage:announcements",active);}',
  },
}, null, 2);

// ── Admin Panel App ──────────────────────────────────────────────────

const APP_ADMIN = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Signage Admin</title>
<script src="/v1/libs/aimeat-auth.js"><` + `/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f5f5f5;color:#333;padding:1rem}
h1{font-size:1.4rem;margin-bottom:1rem}
h2{font-size:1.1rem;margin-bottom:.75rem}
.tabs{display:flex;gap:.5rem;margin-bottom:1rem}
.tabs button{padding:.5rem 1rem;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:.9rem}
.tabs button.active{background:#0066cc;color:#fff;border-color:#0066cc}
.panel{background:#fff;border-radius:8px;padding:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.form-group{margin-bottom:.75rem}
.form-group label{display:block;font-weight:600;margin-bottom:.25rem;font-size:.9rem}
.form-group input,.form-group textarea,.form-group select{width:100%;padding:.5rem;border:1px solid #ddd;border-radius:4px;font-size:.9rem}
.form-group textarea{min-height:80px;resize:vertical}
button.primary{background:#0066cc;color:#fff;border:none;padding:.5rem 1.5rem;border-radius:4px;cursor:pointer;font-size:.9rem}
button.primary:hover{background:#0055aa}
button.danger{background:#c33;color:#fff;border:none;padding:.3rem .8rem;border-radius:4px;cursor:pointer;font-size:.8rem}
button.secondary{background:#6c757d;color:#fff;border:none;padding:.5rem 1.5rem;border-radius:4px;cursor:pointer;font-size:.9rem}
button.outline{background:#fff;color:#0066cc;border:1px solid #0066cc;padding:.3rem .8rem;border-radius:4px;cursor:pointer;font-size:.8rem}
.list-item{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid #eee}
.list-item:last-child{border-bottom:none}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:10px;font-size:.75rem;font-weight:600}
.badge-image{background:#d4edda;color:#155724}
.badge-html{background:#cce5ff;color:#004085}
.badge-url{background:#fff3cd;color:#856404}
.badge-urgent{background:#fff3cd;color:#856404}
.badge-emergency{background:#f8d7da;color:#721c24}
.badge-normal{background:#d4edda;color:#155724}
.type-fields{margin-top:.5rem;padding:.75rem;background:#f8f9fa;border-radius:4px;border:1px solid #e9ecef}
.prompt-section{margin-top:.75rem;padding-top:.75rem;border-top:1px dashed #ddd}
.prompt-section label{font-weight:600;font-size:.9rem;display:block;margin-bottom:.25rem}
.btn-row{display:flex;gap:.5rem;margin-top:.75rem}
.layout-options{display:flex;gap:.75rem;margin-top:.25rem}
.layout-option{flex:1;padding:.75rem;border:2px solid #ddd;border-radius:8px;cursor:pointer;text-align:center;transition:border-color .2s,background .2s}
.layout-option:hover{border-color:#99c2e6}
.layout-option.selected{border-color:#0066cc;background:#f0f7ff}
.layout-icon{font-size:1.8rem;margin-bottom:.25rem}
.layout-label{font-size:.85rem;font-weight:600}
.layout-desc{font-size:.75rem;color:#666}
.color-row{display:flex;align-items:center;gap:.5rem}
.color-row input[type=color]{width:40px;height:34px;border:1px solid #ddd;border-radius:4px;cursor:pointer;padding:2px}
#status{margin-top:.5rem;font-size:.85rem;color:#0066cc;font-weight:500}
#auth-status{padding:.5rem 1rem;background:#fff3cd;border-radius:4px;margin-bottom:1rem;font-size:.85rem;display:none}
.preview-frame{width:100%;height:300px;border:1px solid #ddd;border-radius:4px;margin-top:.5rem;background:#fff}
</style>
</head>
<body>
<div id="auth-status"></div>
<h1>Digital Signage Admin</h1>
<div class="tabs">
<button class="active" onclick="showTab('announcements',this)">Announcements</button>
<button onclick="showTab('views',this)">Rotated Views</button>
<button onclick="showTab('config',this)">Settings</button>
</div>

<div id="tab-announcements" class="panel">
<h2>Announcements</h2>
<div id="announcement-list"></div>
<hr style="margin:1rem 0">
<div class="form-group"><label>Title</label><input id="ann-title" placeholder="Announcement title"></div>
<div class="form-group"><label>Body</label><textarea id="ann-body" placeholder="Announcement content" style="font-family:system-ui"></textarea></div>
<div class="form-group"><label>Priority</label><select id="ann-priority"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div>
<button class="primary" onclick="addAnnouncement()">Add Announcement</button>
<div id="status"></div>
</div>

<div id="tab-views" class="panel" style="display:none">
<h2>Rotated Views</h2>
<div id="view-list"></div>
<hr style="margin:1rem 0">
<div id="view-form">
<div class="form-group"><label>Name</label><input id="view-name" placeholder="View name (e.g. Company Ad, Weather Widget)"></div>
<div class="form-group">
<label>Content Type</label>
<select id="view-type" onchange="onTypeChange()">
<option value="image">Image</option>
<option value="html">HTML + JS + CSS</option>
<option value="url">Webpage (URL)</option>
</select>
</div>
<div id="type-fields"></div>
<div class="form-group"><label>Weight (1-10)</label><input id="view-weight" type="number" value="1" min="1" max="10"></div>
<div class="btn-row">
<button class="primary" id="view-submit-btn" onclick="submitView()">Add View</button>
<button class="secondary" id="view-cancel-btn" onclick="cancelEdit()" style="display:none">Cancel</button>
</div>
</div>
</div>

<div id="tab-config" class="panel" style="display:none">
<h2>Display Settings</h2>
<div class="form-group"><label>Building Name</label><input id="cfg-building" placeholder="Building name"></div>
<div class="form-group">
<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer"><input id="cfg-rotation" type="checkbox" checked> Rotate views automatically</label>
<small style="color:#666">When off, only the first active view is shown</small>
</div>
<div class="form-group" id="cfg-interval-group"><label>Rotation Speed (seconds)</label><input id="cfg-interval" type="number" value="8" min="2" max="120"><small style="color:#666">How many seconds each view is shown before switching to the next</small></div>
<div class="form-group">
<label>Layout</label>
<div class="layout-options">
<div class="layout-option" data-layout="fullscreen" onclick="selectLayout('fullscreen',this)">
<div class="layout-icon">&#11036;</div>
<div class="layout-label">Fullscreen</div>
<div class="layout-desc">Views only</div>
</div>
<div class="layout-option" data-layout="header" onclick="selectLayout('header',this)">
<div class="layout-icon">&#9645;</div>
<div class="layout-label">Header + Views</div>
<div class="layout-desc">Name, clock, views</div>
</div>
<div class="layout-option selected" data-layout="full" onclick="selectLayout('full',this)">
<div class="layout-icon">&#9638;</div>
<div class="layout-label">Full</div>
<div class="layout-desc">Header, views, sidebar</div>
</div>
</div>
<input type="hidden" id="cfg-layout" value="full">
</div>
<div class="form-group">
<label>Theme</label>
<select id="cfg-theme"><option value="dark">Dark</option><option value="light">Light</option></select>
</div>
<div class="form-group">
<label>Accent Color</label>
<div class="color-row">
<input id="cfg-accent" type="color" value="#1a1a2e">
<small>Header &amp; sidebar background color</small>
</div>
</div>
<button class="primary" onclick="saveConfig()">Save Settings</button>
</div>

<div id="login-mount" style="margin-top:1rem"></div>

<script>
var session=null,editIdx=-1;

function getHeaders(){var h={'Content-Type':'application/json'};if(session&&session.jwt)h['Authorization']='Bearer '+session.jwt;return h}
function nodeUrl(){return(session&&session.nodeUrl)||window.location.origin}

function memGet(k){return fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(k),{headers:getHeaders()}).then(function(r){return r.json()}).then(function(j){if(!j.ok)return null;var d=j.data;return{value:typeof d.value==='string'?JSON.parse(d.value):d.value,version:d.version}})}
function memSet(k,v,ver){return fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(k),{method:'PUT',headers:getHeaders(),body:JSON.stringify({value:v,version:ver})})}

function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function setStatus(m){var e=document.getElementById('status');if(e){e.textContent=m;setTimeout(function(){e.textContent=''},3000)}}

function showTab(n,btn){
document.querySelectorAll('.panel').forEach(function(p){p.style.display='none'});
document.querySelectorAll('.tabs button').forEach(function(b){b.classList.remove('active')});
document.getElementById('tab-'+n).style.display='block';
if(btn)btn.classList.add('active');
if(n==='announcements')loadAnnouncements();
if(n==='views'){loadViews();onTypeChange()}
if(n==='config')loadConfig();
}

/* ── Announcements ── */
function loadAnnouncements(){
memGet('signage:announcements').then(function(_r){
var l=_r?_r.value:[];
document.getElementById('announcement-list').innerHTML=l.length===0
?'<p style="color:#999">No announcements yet.</p>'
:l.map(function(a,i){return '<div class="list-item"><div><strong>'+esc(a.title)+'</strong> <span class="badge badge-'+a.priority+'">'+a.priority+'</span><br><small style="color:#666">'+esc(a.body.substring(0,100))+'</small></div><button class="danger" onclick="removeAnnouncement('+i+')">Remove</button></div>'}).join('');
})}

function addAnnouncement(){
var t=document.getElementById('ann-title').value.trim(),b=document.getElementById('ann-body').value.trim(),p=document.getElementById('ann-priority').value;
if(!t||!b){setStatus('Title and body required');return}
memGet('signage:announcements').then(function(_r){
var l=_r?_r.value:[];
l.push({id:'ann-'+Date.now(),title:t,body:b,priority:p,createdBy:'admin',createdAt:new Date().toISOString()});
return memSet('signage:announcements',l,_r?_r.version:1);
}).then(function(){
document.getElementById('ann-title').value='';document.getElementById('ann-body').value='';
setStatus('Added');loadAnnouncements();
})}

function removeAnnouncement(i){
memGet('signage:announcements').then(function(_r){
var l=_r?_r.value:[];l.splice(i,1);
return memSet('signage:announcements',l,_r?_r.version:1);
}).then(function(){loadAnnouncements()})}

/* ── Rotated Views ── */
function onTypeChange(){
var type=document.getElementById('view-type').value;
var el=document.getElementById('type-fields');
if(type==='image'){
el.innerHTML='<div class="type-fields"><div class="form-group"><label>Image URL</label><input id="view-content" placeholder="https://... or /path/to/image.jpg"></div></div>';
}else if(type==='html'){
el.innerHTML='<div class="type-fields"><div class="form-group"><label>HTML Code</label><textarea id="view-content" placeholder="Paste your HTML+JS+CSS here, or use the AI Chat Prompt below to create one with AI..." style="min-height:180px;font-family:monospace;font-size:.85rem"></textarea><div class="btn-row"><button class="outline" onclick="previewContent()">Preview</button></div></div>'+
'<div class="prompt-section"><label style="font-size:1rem">Create with AI Chat</label><p style="font-size:.85rem;color:#555;margin:.5rem 0">Copy the prompt below and paste it into any AI chat (Claude, ChatGPT, etc.). The AI will interview you about what you want on your signage screen and create a ready-made HTML page you can paste back here.</p>'+
'<div style="position:relative"><pre id="ai-prompt-box" style="background:#1a1a2e;color:#e0e0e0;padding:1rem;border-radius:6px;font-size:.8rem;white-space:pre-wrap;max-height:200px;overflow-y:auto;line-height:1.5;border:1px solid #333;cursor:pointer" onclick="copyAiPrompt()"></pre>'+
'<button class="primary" onclick="copyAiPrompt()" style="margin-top:.5rem">Copy Prompt to Clipboard</button></div>'+
'<p id="copy-status" style="font-size:.8rem;color:#0066cc;margin-top:.25rem"></p></div></div>';
document.getElementById("ai-prompt-box").textContent=AI_CHAT_PROMPT;
}else{
el.innerHTML='<div class="type-fields"><div class="form-group"><label>Webpage URL</label><input id="view-content" placeholder="https://example.com"></div></div>';
}}

var AI_CHAT_PROMPT='You are a Digital Signage View Designer. Your job is to interview the user step by step and then produce a single self-contained HTML file (HTML + CSS + JS all in one file) that will be displayed on a digital signage kiosk screen.\\n\\n'
+'## Interview Process\\n\\n'
+'Ask these questions ONE AT A TIME. Wait for the user to answer before asking the next one. Be friendly and enthusiastic.\\n\\n'
+'1. **Purpose**: "What do you want to show on the signage screen? For example: weather, clock, company info, event schedule, welcome message, menu, news feed, social media, custom animation, or something else?"\\n\\n'
+'2. **Style**: "What visual style do you prefer? Options:\\n   - Clean & minimal (lots of whitespace, simple fonts)\\n   - Bold & colorful (gradients, vibrant colors, shadows)\\n   - Corporate & professional (muted colors, structured layout)\\n   - Playful & animated (movement, transitions, fun elements)\\n   - Futuristic / tech (dark background, glowing effects, particle animations)\\n   - Or describe your own style!"\\n\\n'
+'3. **Colors**: "Any specific brand colors? Or should I pick colors that match your chosen style? You can say things like: dark background with blue accents, or use our brand colors #FF5733 and #333333"\\n\\n'
+'4. **Content details**: Based on what they chose in step 1, ask relevant follow-up questions. For example:\\n   - Weather: "Which city? Celsius or Fahrenheit?"\\n   - Clock: "12h or 24h format? Show date too?"\\n   - Welcome message: "What should the text say? Any logo URL?"\\n   - Menu/schedule: "List the items you want to display"\\n   - Custom: "Describe in detail what should appear on screen"\\n\\n'
+'5. **Animations**: "Do you want any animations or movement? Options:\\n   - None (static page)\\n   - Subtle (gentle fades, slow floating elements)\\n   - Dynamic (sliding text, rotating elements, particle effects)\\n   - Eye-catching (bold transitions, attention-grabbing movement)"\\n\\n'
+'6. **Size & layout**: "This will be displayed on a screen section. Should the content:\\n   - Fill the entire area (full bleed)\\n   - Be centered with padding\\n   - Use a specific layout (sidebar, header+content, grid)?"\\n\\n'
+'## Output Rules\\n\\n'
+'After the interview, produce the HTML file following these rules:\\n\\n'
+'- Single self-contained HTML file with inline CSS and JS (no external dependencies unless from CDN)\\n'
+'- Use <!DOCTYPE html> and proper structure\\n'
+'- The page should look great at any screen size (use vh/vw units, flexbox/grid)\\n'
+'- Background should fill the viewport (no white edges)\\n'
+'- Use system-ui font stack unless a specific font is requested\\n'
+'- If using animations, use CSS animations or requestAnimationFrame for smooth 60fps\\n'
+'- If showing live data (time, weather), update it automatically\\n'
+'- For weather, use a free API like wttr.in or open-meteo.com\\n'
+'- Make text large and readable from a distance (this is for a wall-mounted screen)\\n'
+'- High contrast between text and background\\n'
+'- No scrollbars, no overflow\\n\\n'
+'## Final delivery\\n\\n'
+'When you output the HTML, say:\\n\\n'
+'"Here is your signage view! Copy ALL the code below and paste it into the **HTML Code** field in your Digital Signage Admin panel (Rotated Views tab, select HTML type)."\\n\\n'
+'Then output the complete HTML in a code block.\\n\\n'
+'After the code, add: "You can preview it in the admin panel and edit it anytime. Want me to make any changes?"';

function copyAiPrompt(){
navigator.clipboard.writeText(AI_CHAT_PROMPT).then(function(){
var el=document.getElementById('copy-status');
if(el){el.textContent='Copied! Paste this into any AI chat (Claude, ChatGPT, etc.)';setTimeout(function(){el.textContent=''},4000)}
}).catch(function(){
var ta=document.createElement('textarea');ta.value=AI_CHAT_PROMPT;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
var el=document.getElementById('copy-status');
if(el){el.textContent='Copied! Paste this into any AI chat.';setTimeout(function(){el.textContent=''},4000)}
})}

function previewContent(){
var content=document.getElementById('view-content');
if(!content||!content.value){setStatus('No content to preview');return}
var win=window.open('','_blank','width=900,height=600');
if(win){win.document.write(content.value);win.document.close()}
}

function loadViews(){
memGet('signage:views').then(function(_r){
var views=_r?_r.value:[];
var el=document.getElementById('view-list');
if(views.length===0){el.innerHTML='<p style="color:#999">No rotated views yet.</p>';return}
el.innerHTML=views.map(function(v,i){
return '<div class="list-item"><div><strong>'+esc(v.name)+'</strong> <span class="badge badge-'+v.type+'">'+v.type+'</span> <small>(weight:'+v.weight+')</small></div><div style="display:flex;gap:.25rem"><button class="outline" onclick="editView('+i+')">Edit</button><button class="danger" onclick="removeView('+i+')">Remove</button></div></div>';
}).join('');
})}

function editView(i){
memGet('signage:views').then(function(_r){
var views=_r?_r.value:[];var v=views[i];if(!v)return;
editIdx=i;
document.getElementById('view-name').value=v.name;
document.getElementById('view-type').value=v.type;
document.getElementById('view-weight').value=v.weight;
onTypeChange();
setTimeout(function(){
var el=document.getElementById('view-content');
if(el)el.value=v.content;
},50);
document.getElementById('view-submit-btn').textContent='Update View';
document.getElementById('view-cancel-btn').style.display='';
})}

function cancelEdit(){
editIdx=-1;
document.getElementById('view-name').value='';
document.getElementById('view-weight').value='1';
document.getElementById('view-type').value='image';
onTypeChange();
document.getElementById('view-submit-btn').textContent='Add View';
document.getElementById('view-cancel-btn').style.display='none';
}

function submitView(){
var name=document.getElementById('view-name').value.trim();
var type=document.getElementById('view-type').value;
var contentEl=document.getElementById('view-content');
var content=contentEl?contentEl.value.trim():'';
var weight=parseInt(document.getElementById('view-weight').value)||1;
if(!name||!content){setStatus('Name and content required');return}
memGet('signage:views').then(function(_r){
var views=_r?_r.value:[];
var entry={
id:editIdx>=0?views[editIdx].id:'view-'+Date.now(),
name:name,type:type,content:content,weight:weight,
activeFrom:editIdx>=0&&views[editIdx]?views[editIdx].activeFrom:new Date().toISOString(),
activeUntil:editIdx>=0&&views[editIdx]?views[editIdx].activeUntil:new Date(Date.now()+365*24*60*60*1000).toISOString()
};
if(editIdx>=0){views[editIdx]=entry}else{views.push(entry)}
return memSet('signage:views',views,_r?_r.version:1);
}).then(function(){
var wasEdit=editIdx>=0;cancelEdit();
setStatus(wasEdit?'Updated':'Added');loadViews();
})}

function removeView(i){
memGet('signage:views').then(function(_r){
var views=_r?_r.value:[];views.splice(i,1);
return memSet('signage:views',views,_r?_r.version:1);
}).then(function(){loadViews()})}

/* ── Settings ── */
function selectLayout(layout,el){
document.getElementById('cfg-layout').value=layout;
document.querySelectorAll('.layout-option').forEach(function(o){o.classList.remove('selected')});
if(el)el.classList.add('selected');
}

function loadConfig(){
memGet('signage:config').then(function(_r){
var c=_r?_r.value:{};
document.getElementById('cfg-building').value=c.buildingName||'';
var rotEnabled=c.rotationEnabled!==false;
document.getElementById('cfg-rotation').checked=rotEnabled;
document.getElementById('cfg-interval-group').style.display=rotEnabled?'':'none';
var sec=c.rotationIntervalSec||Math.round((c.rotationIntervalMs||8000)/1000);
document.getElementById('cfg-interval').value=sec;
document.getElementById('cfg-theme').value=c.theme||'dark';
document.getElementById('cfg-accent').value=c.accentColor||'#1a1a2e';
var layout=c.layout||'full';
document.getElementById('cfg-layout').value=layout;
document.querySelectorAll('.layout-option').forEach(function(o){
o.classList.remove('selected');
if(o.getAttribute('data-layout')===layout)o.classList.add('selected');
});
})}

document.getElementById('cfg-rotation').addEventListener('change',function(){
document.getElementById('cfg-interval-group').style.display=this.checked?'':'none';
});

function saveConfig(){
memGet('signage:config').then(function(_r){
var c=_r?_r.value:{};
c.buildingName=document.getElementById('cfg-building').value.trim();
c.rotationEnabled=document.getElementById('cfg-rotation').checked;
c.rotationIntervalSec=parseInt(document.getElementById('cfg-interval').value)||8;
delete c.rotationIntervalMs;
c.theme=document.getElementById('cfg-theme').value;
c.layout=document.getElementById('cfg-layout').value;
c.accentColor=document.getElementById('cfg-accent').value;
return memSet('signage:config',c,_r?_r.version:1);
}).then(function(){setStatus('Settings saved')})}

/* ── Auth ── */
function initAuth(){
var el=document.getElementById('auth-status');
try{
if(!window.AIMEAT||!window.AIMEAT.auth){el.textContent='Auth library not loaded. Open this app from the server, not as a local file.';el.style.display='block';return}
if(window.AIMEAT.auth.inSandbox){
window.AIMEAT.auth.requestParentAuth().then(function(s){
if(s){session=s;el.style.display='none';loadAnnouncements()}
else{el.textContent='Could not get auth from parent window.';el.style.display='block'}
});
}else{
window.AIMEAT.auth.login().then(function(s){
if(s){session=s;el.style.display='none';loadAnnouncements()}
else{
el.textContent='Please log in to manage signage.';el.style.display='block';
window.AIMEAT.auth.mountLoginButton('#login-mount',{onLogin:function(){session=window.AIMEAT.auth.getSession();el.style.display='none';loadAnnouncements()}});
}});
}
}catch(e){el.textContent='Auth error: '+e.message;el.style.display='block'}
}
initAuth();
<` + `/script>
</body>
</html>`;

// ── Kiosk Display App ────────────────────────────────────────────────

const APP_KIOSK = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Digital Signage Kiosk</title>
<script src="/v1/libs/aimeat-auth.js"><` + `/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;overflow:hidden;height:100vh}

/* ── Theme: CSS custom properties ── */
:root{
--bg:#111;--text:#eee;--accent:#1a1a2e;
--card-bg:#16213e;--card-text:#ccc;--muted:#666;--muted2:#555;
--border:rgba(255,255,255,.05)
}
body.theme-light{
--bg:#f0f2f5;--text:#222;--accent:#ffffff;
--card-bg:#ffffff;--card-text:#555;--muted:#999;--muted2:#bbb;
--border:rgba(0,0,0,.08)
}
body{background:var(--bg);color:var(--text)}

/* ── Layout: Kiosk grid ── */
.kiosk{display:grid;height:100vh}

/* Full layout (default) */
.kiosk.layout-full{grid-template-rows:auto 1fr auto}
.kiosk.layout-full .content{display:grid;grid-template-columns:2fr 1fr;gap:1px;background:var(--border)}
.kiosk.layout-full .main-area{background:var(--bg)}
.kiosk.layout-full .sidebar{display:block}
.kiosk.layout-full .footer{display:flex}

/* Header layout */
.kiosk.layout-header{grid-template-rows:auto 1fr}
.kiosk.layout-header .content{display:block}
.kiosk.layout-header .sidebar{display:none}
.kiosk.layout-header .footer{display:none}

/* Fullscreen layout */
.kiosk.layout-fullscreen{grid-template-rows:1fr}
.kiosk.layout-fullscreen .header{display:none}
.kiosk.layout-fullscreen .content{display:block}
.kiosk.layout-fullscreen .sidebar{display:none}
.kiosk.layout-fullscreen .footer{display:none}

/* ── Components ── */
.header{background:var(--accent);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.header h1{font-size:1.6rem;font-weight:300;letter-spacing:.5px}
.clock{font-size:1.2rem;font-variant-numeric:tabular-nums;opacity:.9}

.main-area{padding:2rem;display:flex;flex-direction:column;justify-content:center;align-items:center;position:relative;overflow:hidden}

.sidebar{background:var(--accent);padding:1.5rem;overflow-y:auto}

.announcement-card{background:var(--card-bg);border-radius:12px;padding:1.5rem;margin-bottom:1rem;box-shadow:0 1px 4px rgba(0,0,0,.15);transition:transform .2s}
.announcement-card h3{font-size:1.1rem;margin-bottom:.5rem}
.announcement-card p{font-size:.95rem;color:var(--card-text);line-height:1.5}
.announcement-card.emergency{border-left:4px solid #e74c3c}
.announcement-card.urgent{border-left:4px solid #f39c12}
.announcement-card.normal{border-left:4px solid var(--card-bg)}

.footer{background:var(--accent);padding:.5rem 2rem;justify-content:space-between;align-items:center;font-size:.8rem;color:var(--muted)}

/* ── View rendering ── */
.view-display{text-align:center;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center}
.view-display img{max-width:90%;max-height:65vh;border-radius:8px;object-fit:contain;box-shadow:0 4px 20px rgba(0,0,0,.3)}
.view-frame{width:100%;height:75vh;border:none;border-radius:8px;background:#fff}
.view-label{font-size:.85rem;color:var(--muted);margin-top:.75rem;opacity:.7}
.no-content{color:var(--muted2);font-size:1.2rem;text-align:center}

/* Fullscreen: bigger view */
.layout-fullscreen .view-display img{max-width:100%;max-height:100vh;border-radius:0}
.layout-fullscreen .view-frame{height:100vh;border-radius:0}
.layout-fullscreen .view-label{position:absolute;bottom:1rem;right:1.5rem;font-size:.75rem}
.layout-fullscreen .main-area{padding:0}

/* Header: bigger view */
.layout-header .view-display img{max-height:80vh}
.layout-header .view-frame{height:calc(100vh - 70px)}
</style>
</head>
<body>
<div class="kiosk layout-full" id="kiosk">
<div class="header"><h1 id="building-name">Digital Signage</h1><div class="clock" id="clock"></div></div>
<div class="content">
<div class="main-area" id="main-display"><div class="no-content">Loading...</div></div>
<div class="sidebar" id="sidebar"><div class="no-content">Loading...</div></div>
</div>
<div class="footer"><span>Powered by AIMEAT</span><span id="status-text">Connecting...</span></div>
</div>
<div id="login-mount"></div>

<script>
var session=null;
var cfg={rotationEnabled:true,rotationIntervalSec:8,buildingName:'Digital Signage',theme:'dark',layout:'full',accentColor:'#1a1a2e'};
var anns=[],views=[],viewIdx=0,rotTimer=null;

function getHeaders(){var h={'Content-Type':'application/json'};if(session&&session.jwt)h['Authorization']='Bearer '+session.jwt;return h}
function nodeUrl(){return(session&&session.nodeUrl)||window.location.origin}

function memGet(k){
return fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(k),{headers:getHeaders()})
.then(function(r){return r.json()})
.then(function(j){
if(!j.ok)return null;
var v=j.data?j.data.value:null;
return typeof v==='string'?JSON.parse(v):v;
}).catch(function(){return null})
}

function esc(s){var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML}

function updateClock(){
var n=new Date();
document.getElementById('clock').textContent=
n.toLocaleDateString(cfg.locale||'en',{weekday:'long',month:'long',day:'numeric'})+
'  '+n.toLocaleTimeString(cfg.locale||'en',{hour:'2-digit',minute:'2-digit'});
}

/* ── Theme & Layout ── */
function applyTheme(){
document.body.className=cfg.theme==='light'?'theme-light':'';
var accent=cfg.accentColor||'#1a1a2e';
document.documentElement.style.setProperty('--accent',accent);
var kiosk=document.getElementById('kiosk');
kiosk.className='kiosk layout-'+(cfg.layout||'full');
document.getElementById('building-name').textContent=cfg.buildingName||'Digital Signage';
}

/* ── Announcements ── */
function renderAnns(){
var el=document.getElementById('sidebar');
if(!anns||!anns.length){el.innerHTML='<div class="no-content">No announcements</div>';return}
var now=new Date();
var active=anns.filter(function(a){return !a.expiresAt||new Date(a.expiresAt)>now})
.sort(function(a,b){var p={emergency:0,urgent:1,normal:2};return(p[a.priority]||2)-(p[b.priority]||2)});
if(!active.length){el.innerHTML='<div class="no-content">No announcements</div>';return}
el.innerHTML=active.map(function(a){
return '<div class="announcement-card '+(a.priority||'normal')+'"><h3>'+esc(a.title)+'</h3><p>'+esc(a.body)+'</p></div>';
}).join('');
}

/* ── Rotated Views ── */
function renderView(){
var el=document.getElementById('main-display');
var now=new Date();
var active=views.filter(function(v){
return(!v.activeFrom||new Date(v.activeFrom)<=now)&&(!v.activeUntil||new Date(v.activeUntil)>now);
});
if(!active.length){el.innerHTML='<div class="no-content">No active views</div>';return}
viewIdx=viewIdx%active.length;
var v=active[viewIdx];
if(v.type==='html'){
el.innerHTML='<div class="view-display"><iframe class="view-frame" sandbox="allow-scripts"></iframe><div class="view-label">'+esc(v.name)+'</div></div>';
var iframe=el.querySelector('iframe');
if(iframe)iframe.srcdoc=v.content;
}else if(v.type==='url'){
el.innerHTML='<div class="view-display"><iframe class="view-frame" src="'+esc(v.content)+'" sandbox="allow-scripts allow-same-origin"></iframe><div class="view-label">'+esc(v.name)+'</div></div>';
}else{
el.innerHTML='<div class="view-display"><img src="'+esc(v.content)+'" alt="'+esc(v.name)+'" onerror="this.parentElement.innerHTML=\\'<div class=view-label>Image unavailable</div>\\'"><div class="view-label">'+esc(v.name)+'</div></div>';
}
viewIdx++;
}

function startRotation(){
if(rotTimer){clearInterval(rotTimer);rotTimer=null}
renderView();
if(cfg.rotationEnabled!==false){
var ms=(cfg.rotationIntervalSec||cfg.rotationIntervalMs/1000||8)*1000;
rotTimer=setInterval(function(){renderView()},ms);
}
}

/* ── Data loading ── */
function loadAll(){
Promise.all([memGet('signage:config'),memGet('signage:announcements'),memGet('signage:views')])
.then(function(res){
var c=res[0],a=res[1],v=res[2];
if(c){
var oldSec=cfg.rotationIntervalSec;
var oldEnabled=cfg.rotationEnabled;
cfg=Object.assign({},cfg,c);
applyTheme();
if(c.rotationIntervalSec!==oldSec||c.rotationEnabled!==oldEnabled)startRotation();
}
anns=Array.isArray(a)?a:[];
views=Array.isArray(v)?v:[];
renderAnns();
if(!rotTimer)startRotation();else renderView();
document.getElementById('status-text').textContent='Connected';
});
}

updateClock();
setInterval(updateClock,30000);

function startKiosk(){
applyTheme();loadAll();
setInterval(loadAll,60000);
}

/* ── Auth ── */
function initAuth(){
var st=document.getElementById('status-text');
try{
if(!window.AIMEAT||!window.AIMEAT.auth){st.textContent='Auth library not loaded';return}
if(window.AIMEAT.auth.inSandbox){
window.AIMEAT.auth.requestParentAuth().then(function(s){
if(s){session=s;startKiosk()}else{st.textContent='No auth from parent'}
});
}else{
window.AIMEAT.auth.login().then(function(s){
if(s){session=s;startKiosk()}
else{st.textContent='Not logged in';
window.AIMEAT.auth.mountLoginButton('#login-mount',{onLogin:function(){session=window.AIMEAT.auth.getSession();startKiosk()}});
}});
}
}catch(e){st.textContent='Auth error: '+e.message}
}
initAuth();
<` + `/script>
</body>
</html>`;

// ── Translations ─────────────────────────────────────────────────────

const TRANSLATION_FI_EN = JSON.stringify({
  en: {
    'signage.title': 'Digital Signage', 'signage.announcements': 'Announcements',
    'signage.rotatedViews': 'Rotated Views', 'signage.settings': 'Settings',
    'signage.addAnnouncement': 'Add Announcement', 'signage.priority.normal': 'Normal',
    'signage.priority.urgent': 'Urgent', 'signage.priority.emergency': 'Emergency',
    'signage.buildingName': 'Building Name', 'signage.theme': 'Theme',
    'signage.theme.dark': 'Dark', 'signage.theme.light': 'Light',
    'signage.layout': 'Layout', 'signage.layout.fullscreen': 'Fullscreen',
    'signage.layout.header': 'Header + Views', 'signage.layout.full': 'Full',
    'signage.accentColor': 'Accent Color', 'signage.contentType': 'Content Type',
    'signage.contentType.image': 'Image', 'signage.contentType.html': 'HTML + JS + CSS',
    'signage.contentType.url': 'Webpage (URL)', 'signage.weight': 'Weight',
    'signage.saveSettings': 'Save Settings', 'signage.poweredBy': 'Powered by AIMEAT',
    'signage.promptHelper': 'AI Prompt Helper', 'signage.generateTemplate': 'Generate Template',
  },
  fi: {
    'signage.title': 'Digitaalinen infotaulu', 'signage.announcements': 'Tiedotteet',
    'signage.rotatedViews': 'Kiertonäkymät', 'signage.settings': 'Asetukset',
    'signage.addAnnouncement': 'Lisää tiedote', 'signage.priority.normal': 'Normaali',
    'signage.priority.urgent': 'Kiireellinen', 'signage.priority.emergency': 'Hätätiedote',
    'signage.buildingName': 'Rakennuksen nimi', 'signage.theme': 'Teema',
    'signage.theme.dark': 'Tumma', 'signage.theme.light': 'Vaalea',
    'signage.layout': 'Asettelu', 'signage.layout.fullscreen': 'Koko näyttö',
    'signage.layout.header': 'Otsikko + näkymät', 'signage.layout.full': 'Täysi',
    'signage.accentColor': 'Korostusväri', 'signage.contentType': 'Sisältötyyppi',
    'signage.contentType.image': 'Kuva', 'signage.contentType.html': 'HTML + JS + CSS',
    'signage.contentType.url': 'Verkkosivu (URL)', 'signage.weight': 'Painoarvo',
    'signage.saveSettings': 'Tallenna asetukset', 'signage.poweredBy': 'Käyttää AIMEAT-alustaa',
    'signage.promptHelper': 'Tekoäly-apuri', 'signage.generateTemplate': 'Luo malli',
  },
}, null, 2);
