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
 */

import { createHash, randomUUID } from 'node:crypto';
import type { PackageRecord, PackageComponent, TemplateListingRecord } from '../storage/interface.js';

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
  return [digitalSignagePackage()];
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
    description: 'Complete digital signage system for buildings — kiosk display, admin panel, announcements, ads, and AI content management.',
    category: 'iot',
    tags: ['signage', 'kiosk', 'building', 'announcements', 'ads', 'display'],
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
      description: 'Full-featured digital signage for residential and commercial buildings. Includes kiosk display, admin panel, AI content rotation, and Finnish/English translations.',
      category: 'iot',
      tags: ['signage', 'kiosk', 'building', 'display', 'announcements'],
    },
  };
}

// ── Content constants (abbreviated for readability — full HTML in apps) ──

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
  adSlot:
    fields:
      - { name: advertiser, type: string, required: true }
      - { name: imageUrl, type: string, required: true }
      - { name: linkUrl, type: string }
      - { name: weight, type: integer, default: 1 }
      - { name: activeFrom, type: datetime }
      - { name: activeUntil, type: datetime }
    visibility: public
permissions:
  announcement: { create: [operator, owner], read: [public], delete: [operator] }
  adSlot: { create: [operator], read: [public], delete: [operator] }
  resident: { create: [owner], read: [owner], delete: [owner] }
`;

function memoryInit(): string {
  // Must use { entries: [{ key, value }] } format for component-registrar
  return JSON.stringify({
    entries: [
      {
        key: 'signage:config',
        value: {
          rotationIntervalMs: 8000, emergencyOverride: true, theme: 'dark',
          locale: 'en', buildingName: 'Sunrise Residences', floors: 12, timezone: 'Europe/Helsinki',
        },
        visibility: 'private',
      },
      {
        key: 'signage:announcements',
        value: [{
          id: 'welcome-1', title: 'Welcome to Digital Signage',
          body: 'This kiosk displays building announcements and sponsored content.',
          priority: 'normal', createdBy: 'system', createdAt: new Date().toISOString(),
        }],
        visibility: 'private',
      },
      {
        key: 'signage:ads',
        value: [{
          id: 'demo-ad-1', advertiser: 'Local Cafe', imageUrl: '/placeholder/ad-cafe.jpg',
          linkUrl: 'https://example.com', weight: 2,
          activeFrom: new Date().toISOString(),
          activeUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        }],
        visibility: 'private',
      },
    ],
  }, null, 2);
}

const CORTEX_SIGNAGE = JSON.stringify({
  manifest: `name: signage-cortex\nversion: 1.0.0\ndescription: AI agent for managing digital signage content\ncapabilities: [memory_read, memory_write, consent_check]\ntriggers:\n  - { event: schedule, cron: "0 8 * * *", action: rotate_daily_content }\n  - { event: memory_change, key: "signage:announcements", action: notify_kiosk_refresh }`,
  libs: {
    contentRotation: 'function selectActiveAnnouncements(a,now){return a.filter(x=>!x.expiresAt||new Date(x.expiresAt)>now).sort((a,b)=>({emergency:0,urgent:1,normal:2}[a.priority]??2)-({emergency:0,urgent:1,normal:2}[b.priority]??2));}',
    scheduling: 'async function rotateDailyContent(api){const a=await api.get("signage:announcements");const now=new Date();const active=a.filter(x=>!x.expiresAt||new Date(x.expiresAt)>now);if(active.length!==a.length)await api.set("signage:announcements",active);}',
  },
}, null, 2);

const APP_ADMIN = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Signage Admin</title><script src="/v1/libs/aimeat-auth.js"><\/script><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#f5f5f5;color:#333;padding:1rem}h1{font-size:1.4rem;margin-bottom:1rem}.tabs{display:flex;gap:.5rem;margin-bottom:1rem}.tabs button{padding:.5rem 1rem;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer}.tabs button.active{background:#0066cc;color:#fff;border-color:#0066cc}.panel{background:#fff;border-radius:8px;padding:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}.form-group{margin-bottom:.75rem}.form-group label{display:block;font-weight:600;margin-bottom:.25rem;font-size:.9rem}.form-group input,.form-group textarea,.form-group select{width:100%;padding:.5rem;border:1px solid #ddd;border-radius:4px;font-size:.9rem}.form-group textarea{min-height:80px;resize:vertical}button.primary{background:#0066cc;color:#fff;border:none;padding:.5rem 1.5rem;border-radius:4px;cursor:pointer}button.danger{background:#c33;color:#fff;border:none;padding:.3rem .8rem;border-radius:4px;cursor:pointer;font-size:.8rem}.list-item{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid #eee}.badge{display:inline-block;padding:.15rem .5rem;border-radius:10px;font-size:.75rem;font-weight:600}.badge-urgent{background:#fff3cd;color:#856404}.badge-emergency{background:#f8d7da;color:#721c24}.badge-normal{background:#d4edda;color:#155724}#status{margin-top:.5rem;font-size:.85rem;color:#666}#auth-status{padding:.5rem 1rem;background:#fff3cd;border-radius:4px;margin-bottom:1rem;font-size:.85rem;display:none}</style></head><body><div id="auth-status"></div><h1>Digital Signage Admin</h1><div class="tabs"><button class="active" onclick="showTab('announcements')">Announcements</button><button onclick="showTab('ads')">Ad Slots</button><button onclick="showTab('config')">Settings</button></div><div id="tab-announcements" class="panel"><h2 style="font-size:1.1rem;margin-bottom:.75rem">Announcements</h2><div id="announcement-list"></div><hr style="margin:1rem 0"><div class="form-group"><label>Title</label><input id="ann-title" placeholder="Announcement title"></div><div class="form-group"><label>Body</label><textarea id="ann-body" placeholder="Announcement content"></textarea></div><div class="form-group"><label>Priority</label><select id="ann-priority"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div><button class="primary" onclick="addAnnouncement()">Add Announcement</button><div id="status"></div></div><div id="tab-ads" class="panel" style="display:none"><h2 style="font-size:1.1rem;margin-bottom:.75rem">Ad Slots</h2><div id="ad-list"></div><hr style="margin:1rem 0"><div class="form-group"><label>Advertiser</label><input id="ad-advertiser" placeholder="Company name"></div><div class="form-group"><label>Image URL</label><input id="ad-image" placeholder="https://..."></div><div class="form-group"><label>Weight (1-10)</label><input id="ad-weight" type="number" value="1" min="1" max="10"></div><button class="primary" onclick="addAd()">Add Ad Slot</button></div><div id="tab-config" class="panel" style="display:none"><h2 style="font-size:1.1rem;margin-bottom:.75rem">Display Settings</h2><div class="form-group"><label>Building Name</label><input id="cfg-building" placeholder="Building name"></div><div class="form-group"><label>Rotation Interval (ms)</label><input id="cfg-interval" type="number" value="8000"></div><div class="form-group"><label>Theme</label><select id="cfg-theme"><option value="dark">Dark</option><option value="light">Light</option></select></div><button class="primary" onclick="saveConfig()">Save Settings</button></div><div id="login-mount" style="margin-top:1rem"></div><script>let session=null;function getHeaders(){const h={'Content-Type':'application/json'};if(session&&session.jwt)h['Authorization']='Bearer '+session.jwt;return h}function nodeUrl(){return(session&&session.nodeUrl)||window.location.origin}async function memGet(k){const r=await fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(k),{headers:getHeaders()});const j=await r.json();if(!j.ok)return null;const d=j.data;return{value:typeof d.value==='string'?JSON.parse(d.value):d.value,version:d.version}}async function memSet(k,v,ver){await fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(k),{method:'PUT',headers:getHeaders(),body:JSON.stringify({value:v,version:ver})})}function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}function setStatus(m){const e=document.getElementById('status');if(e){e.textContent=m;setTimeout(()=>e.textContent='',3000)}}function showTab(n){document.querySelectorAll('.panel').forEach(p=>p.style.display='none');document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));document.getElementById('tab-'+n).style.display='block';event.target.classList.add('active');if(n==='announcements')loadAnnouncements();if(n==='ads')loadAds();if(n==='config')loadConfig()}async function loadAnnouncements(){const _r=await memGet('signage:announcements');const l=_r?_r.value:[];document.getElementById('announcement-list').innerHTML=l.length===0?'<p style="color:#999">No announcements yet.</p>':l.map((a,i)=>'<div class="list-item"><div><strong>'+esc(a.title)+'</strong> <span class="badge badge-'+a.priority+'">'+a.priority+'</span><br><small style="color:#666">'+esc(a.body.substring(0,80))+'</small></div><button class="danger" onclick="removeAnnouncement('+i+')">Remove</button></div>').join('')}async function addAnnouncement(){const t=document.getElementById('ann-title').value.trim(),b=document.getElementById('ann-body').value.trim(),p=document.getElementById('ann-priority').value;if(!t||!b){setStatus('Title and body required');return}const _r=await memGet('signage:announcements');const l=_r?_r.value:[];l.push({id:'ann-'+Date.now(),title:t,body:b,priority:p,createdBy:'admin',createdAt:new Date().toISOString()});await memSet('signage:announcements',l,_r?_r.version:1);document.getElementById('ann-title').value='';document.getElementById('ann-body').value='';setStatus('Added');loadAnnouncements()}async function removeAnnouncement(i){const _r=await memGet('signage:announcements');const l=_r?_r.value:[];l.splice(i,1);await memSet('signage:announcements',l,_r?_r.version:1);loadAnnouncements()}async function loadAds(){const _r=await memGet('signage:ads');const a=_r?_r.value:[];document.getElementById('ad-list').innerHTML=a.length===0?'<p style="color:#999">No ads.</p>':a.map((x,i)=>'<div class="list-item"><div><strong>'+esc(x.advertiser)+'</strong> <small>(weight:'+x.weight+')</small></div><button class="danger" onclick="removeAd('+i+')">Remove</button></div>').join('')}async function addAd(){const a=document.getElementById('ad-advertiser').value.trim(),img=document.getElementById('ad-image').value.trim(),w=parseInt(document.getElementById('ad-weight').value)||1;if(!a||!img){setStatus('Advertiser and image required');return}const _r=await memGet('signage:ads');const ads=_r?_r.value:[];ads.push({id:'ad-'+Date.now(),advertiser:a,imageUrl:img,weight:w,activeFrom:new Date().toISOString(),activeUntil:new Date(Date.now()+90*24*60*60*1000).toISOString()});await memSet('signage:ads',ads,_r?_r.version:1);document.getElementById('ad-advertiser').value='';document.getElementById('ad-image').value='';loadAds()}async function removeAd(i){const _r=await memGet('signage:ads');const a=_r?_r.value:[];a.splice(i,1);await memSet('signage:ads',a,_r?_r.version:1);loadAds()}async function loadConfig(){const _r=await memGet('signage:config');const c=_r?_r.value:{};document.getElementById('cfg-building').value=c.buildingName||'';document.getElementById('cfg-interval').value=c.rotationIntervalMs||8000;document.getElementById('cfg-theme').value=c.theme||'dark'}async function saveConfig(){const _r=await memGet('signage:config');const c=_r?_r.value:{};c.buildingName=document.getElementById('cfg-building').value.trim();c.rotationIntervalMs=parseInt(document.getElementById('cfg-interval').value)||8000;c.theme=document.getElementById('cfg-theme').value;await memSet('signage:config',c,_r?_r.version:1);setStatus('Saved')}async function initAuth(){const el=document.getElementById('auth-status');try{if(!window.AIMEAT||!window.AIMEAT.auth){el.textContent='Auth library not loaded. Open this app from the server, not as a local file.';el.style.display='block';return}if(window.AIMEAT.auth.inSandbox){session=await window.AIMEAT.auth.requestParentAuth();if(session){el.style.display='none';loadAnnouncements()}else{el.textContent='Could not get auth from parent window.';el.style.display='block'}}else{session=await window.AIMEAT.auth.login();if(session){el.style.display='none';loadAnnouncements()}else{el.textContent='Please log in to manage signage.';el.style.display='block';window.AIMEAT.auth.mountLoginButton('#login-mount',{onLogin:function(){session=window.AIMEAT.auth.getSession();el.style.display='none';loadAnnouncements()}})}}}catch(e){el.textContent='Auth error: '+e.message;el.style.display='block'}}initAuth();<\/script></body></html>`;

const APP_KIOSK = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Digital Signage Kiosk</title><script src="/v1/libs/aimeat-auth.js"><\/script><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#111;color:#eee;overflow:hidden;height:100vh}.kiosk{display:grid;grid-template-rows:auto 1fr auto;height:100vh}.header{background:#1a1a2e;padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center}.header h1{font-size:1.6rem;font-weight:300}.clock{font-size:1.2rem;font-variant-numeric:tabular-nums}.content{display:grid;grid-template-columns:2fr 1fr;gap:1px;background:#222}.main-area{padding:2rem;display:flex;flex-direction:column;justify-content:center;align-items:center}.sidebar{background:#1a1a2e;padding:1.5rem;overflow-y:auto}.announcement-card{background:#16213e;border-radius:12px;padding:1.5rem;margin-bottom:1rem}.announcement-card h3{font-size:1.1rem;margin-bottom:.5rem}.announcement-card p{font-size:.95rem;color:#ccc;line-height:1.5}.announcement-card.emergency{border-left:4px solid #e74c3c}.announcement-card.urgent{border-left:4px solid #f39c12}.ad-display{text-align:center}.ad-display img{max-width:80%;max-height:60vh;border-radius:8px;object-fit:contain}.ad-label{font-size:.8rem;color:#666;margin-top:.5rem}.footer{background:#1a1a2e;padding:.5rem 2rem;display:flex;justify-content:space-between;font-size:.8rem;color:#666}.no-content{color:#555;font-size:1.2rem;text-align:center}</style></head><body><div class="kiosk"><div class="header"><h1 id="building-name">Digital Signage</h1><div class="clock" id="clock"></div></div><div class="content"><div class="main-area" id="main-display"><div class="no-content">Loading...</div></div><div class="sidebar" id="sidebar"><div class="no-content">Loading...</div></div></div><div class="footer"><span>Powered by AIMEAT</span><span id="status-text">Connecting...</span></div></div><div id="login-mount"></div><script>let session=null;function getHeaders(){const h={'Content-Type':'application/json'};if(session&&session.jwt)h['Authorization']='Bearer '+session.jwt;return h}let cfg={rotationIntervalMs:8000,buildingName:'Digital Signage',theme:'dark'},anns=[],ads=[],adIdx=0;function nodeUrl(){return(session&&session.nodeUrl)||window.location.origin}async function memGet(k){try{const r=await fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(k),{headers:getHeaders()});const j=await r.json();return j.ok?(typeof j.data?.value==='string'?JSON.parse(j.data.value):j.data?.value):null}catch{return null}}function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}function updateClock(){const n=new Date();document.getElementById('clock').textContent=n.toLocaleDateString(cfg.locale||'en',{weekday:'long',month:'long',day:'numeric'})+'  '+n.toLocaleTimeString(cfg.locale||'en',{hour:'2-digit',minute:'2-digit'})}function renderAnns(){const el=document.getElementById('sidebar');if(!anns.length){el.innerHTML='<div class="no-content">No announcements</div>';return}const now=new Date(),active=anns.filter(a=>!a.expiresAt||new Date(a.expiresAt)>now).sort((a,b)=>({emergency:0,urgent:1,normal:2}[a.priority]||2)-({emergency:0,urgent:1,normal:2}[b.priority]||2));el.innerHTML=active.map(a=>'<div class="announcement-card '+(a.priority||'normal')+'"><h3>'+esc(a.title)+'</h3><p>'+esc(a.body)+'</p></div>').join('')}function rotateAds(){const el=document.getElementById('main-display'),now=new Date(),active=ads.filter(a=>(!a.activeFrom||new Date(a.activeFrom)<=now)&&(!a.activeUntil||new Date(a.activeUntil)>now));if(!active.length){el.innerHTML='<div class="no-content">No active ads</div>';return}adIdx=adIdx%active.length;const ad=active[adIdx];el.innerHTML='<div class="ad-display"><img src="'+esc(ad.imageUrl)+'" alt="'+esc(ad.advertiser)+'" onerror="this.style.display=\\'none\\'"><div class="ad-label">Sponsored by '+esc(ad.advertiser)+'</div></div>';adIdx++}async function loadAll(){const[c,a,d]=await Promise.all([memGet('signage:config'),memGet('signage:announcements'),memGet('signage:ads')]);if(c){cfg={...cfg,...c};document.getElementById('building-name').textContent=cfg.buildingName||'Digital Signage'}anns=a||[];ads=d||[];renderAnns();rotateAds();document.getElementById('status-text').textContent='Connected'}updateClock();setInterval(updateClock,30000);function startKiosk(){loadAll();setInterval(function(){rotateAds()},cfg.rotationIntervalMs||8000);setInterval(loadAll,60000)}async function initAuth(){var st=document.getElementById('status-text');try{if(!window.AIMEAT||!window.AIMEAT.auth){st.textContent='Auth library not loaded';return}if(window.AIMEAT.auth.inSandbox){session=await window.AIMEAT.auth.requestParentAuth();if(session){startKiosk()}else{st.textContent='No auth from parent'}}else{session=await window.AIMEAT.auth.login();if(session){startKiosk()}else{st.textContent='Not logged in';window.AIMEAT.auth.mountLoginButton('#login-mount',{onLogin:function(){session=window.AIMEAT.auth.getSession();startKiosk()}})}}}catch(e){st.textContent='Auth error: '+e.message}}initAuth();<\/script></body></html>`;

const TRANSLATION_FI_EN = JSON.stringify({
  en: {
    'signage.title': 'Digital Signage', 'signage.announcements': 'Announcements',
    'signage.ads': 'Advertisements', 'signage.settings': 'Settings',
    'signage.addAnnouncement': 'Add Announcement', 'signage.priority.normal': 'Normal',
    'signage.priority.urgent': 'Urgent', 'signage.priority.emergency': 'Emergency',
    'signage.buildingName': 'Building Name', 'signage.theme': 'Theme',
    'signage.saveSettings': 'Save Settings', 'signage.poweredBy': 'Powered by AIMEAT',
  },
  fi: {
    'signage.title': 'Digitaalinen infotaulu', 'signage.announcements': 'Tiedotteet',
    'signage.ads': 'Mainokset', 'signage.settings': 'Asetukset',
    'signage.addAnnouncement': 'Lisää tiedote', 'signage.priority.normal': 'Normaali',
    'signage.priority.urgent': 'Kiireellinen', 'signage.priority.emergency': 'Hätätiedote',
    'signage.buildingName': 'Rakennuksen nimi', 'signage.theme': 'Teema',
    'signage.saveSettings': 'Tallenna asetukset', 'signage.poweredBy': 'Käyttää AIMEAT-alustaa',
  },
}, null, 2);
