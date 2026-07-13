/**
 * @file src/routes/profile/client-script-core.ts
 * @description Client-side script (helpers, auth, stats, agents, memory, files, boards, apps) for the legacy SSR profile page as a template string. Extracted from src/routes/profile.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/profile.ts (max-file-lines)
 */
export const PROFILE_JS_CORE = `var session = null;

// ── Clipboard helper (fallback for HTTP) ──
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

// ── i18n helper ──
function t(key) { return T[key] || key; }

function switchLang(lang) {
  var url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  localStorage.setItem('aimeat-lang', lang);
  document.cookie = 'aimeat-lang=' + lang + ';path=/;max-age=31536000;SameSite=Lax';
  window.location.href = url.toString();
}

// ── Auth setup ──
console.log('[AIMEAT Profile] Starting auth...', { AIMEAT: !!window.AIMEAT, auth: !!(window.AIMEAT && window.AIMEAT.auth) });
var storedRaw = localStorage.getItem('aimeat_session');
console.log('[AIMEAT Profile] Stored session:', storedRaw ? 'exists (' + storedRaw.substring(0,60) + '...)' : 'NONE');

var auth = window.AIMEAT && window.AIMEAT.auth;
if (auth) {
  auth.mountLoginButton('#auth-container', {
    i18n: (function() {
      var m = {};
      for (var k in T) { if (k.indexOf('modal.') === 0) m[k.slice(6)] = T[k]; }
      return m;
    })(),
    onLogin: function(s) { console.log('[AIMEAT Profile] onLogin callback', s); session = s; showProfile(); },
    onLogout: function() { console.log('[AIMEAT Profile] onLogout callback'); session = null; hideProfile(); },
  });
  auth.login().then(function(s) {
    console.log('[AIMEAT Profile] auth.login() result:', s ? 'session OK (gaii=' + s.gaii + ')' : 'null');
    if (s) { session = s; showProfile(); }
    else {
      console.log('[AIMEAT Profile] No session after login, stored now:', localStorage.getItem('aimeat_session') ? 'still exists' : 'DELETED');
      renderLoginSplash();
    }
  }).catch(function(e) {
    console.error('[AIMEAT Profile] auth.login() THREW:', e);
    renderLoginSplash();
  });
} else {
  console.error('[AIMEAT Profile] window.AIMEAT.auth not found! Script may have failed to load.');
  renderLoginSplash();
}

function renderLoginSplash() {
  var area = document.getElementById('login-area');
  area.innerHTML = '<button onclick="document.querySelector(\\'#auth-container button\\').click()" '
    + 'style="padding:12px 28px;background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:1rem;box-shadow:0 0 20px rgba(255,107,157,.3)">'
    + '\\u{1F496} ' + t('profile.signInBtn') + '</button>';
}

function showProfile() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('profile-screen').style.display = 'block';
  updateAgentPrompt();
  loadAll();
}
function hideProfile() {
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('profile-screen').style.display = 'none';
}

function escHtml(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

// ── Toast notifications ──
function showToast(msg, isError) {
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();
  var el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3000);
}

// ── Tabs ──
document.getElementById('tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.tab');
  if (!btn) return;
  var tab = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'panel-' + tab); });
});

// ── Sub-tab handling (generic) ──
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.sub-tab');
  if (!btn) return;
  var container = btn.closest('.tab-panel');
  if (!container) return;
  container.querySelectorAll('.sub-tab').forEach(function(t){ t.classList.toggle('active', t === btn); });
  var target = btn.dataset.subtab;
  container.querySelectorAll('.sub-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'subpanel-' + target); });
  // Lazy-load content
  if (target === 'memory-files') loadFiles();
  if (target === 'services-catalogue') loadCatalogue();
  if (target === 'boards-browse') loadAllBoards();
  if (target === 'apps-gallery') loadAllApps();
  if (target === 'work-sent') loadSentWork();
});

// ── Data loading ──
async function loadAll() {
  if (!session) return;
  var dn = session.ghii || session.owner;
  document.getElementById('display-name').textContent = dn;
  document.getElementById('ghii-label').textContent = session.ghii || '';
  document.getElementById('profile-meta').textContent = t('profile.node') + ': ' + NODE_URL;

  // Load everything in parallel
  loadAgents();
  loadChatSessions();
  loadWallet();
  loadMemory();
  loadFiles();
  loadWork();
  loadActions();
  loadBoards();
  loadApps();
  loadFederation();
  loadAccess();
  loadNodes();
}

// Helper to do authenticated fetch
async function apiFetch(path) {
  try {
    var resp = await session.fetch(path);
    if (resp && resp.ok !== undefined) return resp;
    return resp;
  } catch(e) {
    return null;
  }
}

// ── Agents ──
async function loadAgents() {
  var el = document.getElementById('agents-list');
  try {
    var data = await apiFetch('/v1/agents');
    var agents = data && data.data && data.data.agents ? data.data.agents : (Array.isArray(data) ? data : []);
    document.getElementById('stat-agents').textContent = agents.length;

    if (agents.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.agents.empty') + '</div>'; return; }
    var html = '';
    agents.forEach(function(a) {
      var trustPct = Math.round((a.trust_score || 0) * 100);
      var trustClass = trustPct >= 80 ? 'badge-success' : trustPct >= 50 ? 'badge-warn' : 'badge-danger';
      html += '<div class="card agent-card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(a.display_name || a.name) + '</div>'
        + '<div class="gaii">' + escHtml(a.gaii) + '</div></div>'
        + '<span class="badge ' + trustClass + '">' + t('profile.agents.trust') + ': ' + trustPct + '%</span></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>';
      if (a.capabilities && a.capabilities.length) {
        html += '<div class="caps">';
        a.capabilities.forEach(function(c) { html += '<span class="cap">' + escHtml(c) + '</span>'; });
        html += '</div>';
      }
      html += '<div class="card-subtitle" style="margin-top:.5rem">' + t('profile.agents.balance') + ': <strong>' + (a.morsel_balance || 0) + '</strong> ' + t('profile.stats.morsels').toLowerCase()
        + (a.last_seen ? ' &bull; ' + t('profile.agents.lastSeen') + ': ' + new Date(a.last_seen).toLocaleString() : '') + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.agents.loadError') + '</div>'; }
}

// ── Chat Sessions ──
async function loadChatSessions() {
  var el = document.getElementById('chatsessions-list');
  try {
    var csData = await apiFetch('/v1/chat-instances');
    var csList = (csData && csData.data && csData.data.chat_instances) ? csData.data.chat_instances : [];
    document.getElementById('stat-chatsessions').textContent = csList.length;
    var csHtml = '';
    if (csList.length === 0) {
      csHtml = '<div class="empty">' + t('profile.chatSessions.empty') + '</div>';
    } else {
      csList.forEach(function(c) {
        csHtml += '<div class="card">';
        csHtml += '<div class="card-header"><div><span class="card-title">' + escHtml(c.platform) + '</span>';
        csHtml += '<div class="card-subtitle">' + escHtml(c.app_name) + '</div></div>';
        csHtml += '<span class="badge badge-info">' + (c.is_anonymous ? t('profile.chatSessions.anonymous') : escHtml(c.platform)) + '</span></div>';
        csHtml += '<div style="font-size:.8rem;color:var(--muted);margin-top:.4rem">' + t('profile.chatSessions.lastSeen') + ': ' + new Date(c.last_seen).toLocaleString() + '</div>';
        csHtml += '</div>';
      });
    }
    el.innerHTML = csHtml;
  } catch(e) {
    el.innerHTML = '<div class="empty">' + t('profile.chatSessions.error') + '</div>';
  }
}

// ── Wallet ──
async function loadWallet() {
  var el = document.getElementById('wallet-area');
  try {
    var data = await apiFetch('/v1/wallet');
    var w = data && data.data ? data.data : null;
    if (!w) { el.innerHTML = '<div class="empty">' + t('profile.wallet.empty') + '</div>'; return; }
    document.getElementById('stat-balance').textContent = w.balance || 0;

    var html = '<div class="wallet-overview">'
      + '<div class="wallet-card"><div class="amount neutral">' + (w.balance || 0) + '</div><div class="wlabel">' + t('profile.wallet.balance') + '</div></div>'
      + '<div class="wallet-card"><div class="amount" style="color:var(--warn)">' + (w.in_escrow || 0) + '</div><div class="wlabel">' + t('profile.wallet.inEscrow') + '</div></div>'
      + '<div class="wallet-card"><div class="amount positive">' + (w.available || 0) + '</div><div class="wlabel">' + t('profile.wallet.available') + '</div></div>'
      + '<div class="wallet-card"><div class="amount" style="color:var(--muted)">' + (w.daily_allowance ? w.daily_allowance.amount : '-') + '</div><div class="wlabel">' + t('profile.wallet.dailyAllowance') + '</div></div>'
      + '</div>';

    // Try loading transactions
    try {
      var txData = await apiFetch('/v1/wallet/transactions');
      var txs = txData && txData.data && txData.data.transactions ? txData.data.transactions : [];
      if (txs.length > 0) {
        html += '<h3 style="color:var(--love1);margin-bottom:.75rem">' + t('profile.wallet.recentTx') + '</h3>';
        html += '<div class="card"><div class="tx-list">';
        txs.slice(0, 50).forEach(function(tx) {
          var isCredit = tx.amount > 0;
          html += '<div class="tx-item">'
            + '<div><div class="tx-type">' + escHtml(tx.type || 'transfer') + '</div>'
            + (tx.counterparty_gaii ? '<div class="tx-date">' + escHtml(tx.counterparty_gaii) + '</div>' : '')
            + '</div>'
            + '<div class="tx-amount ' + (isCredit ? 'credit' : 'debit') + '">' + (isCredit ? '+' : '') + tx.amount + '</div>'
            + '</div>';
        });
        html += '</div></div>';
      }
    } catch(e) {}

    if (w.lifetime) {
      html += '<div style="margin-top:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem">'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--success)">' + (w.lifetime.earned || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">' + t('profile.wallet.earned') + '</div></div>'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--love1)">' + (w.lifetime.spent || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">' + t('profile.wallet.shared') + '</div></div>'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--love1)">' + (w.lifetime.welcome_bonus || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">' + t('profile.wallet.welcomeBonus') + '</div></div>'
        + '</div>';
    }

    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.wallet.error') + '</div>'; }
}

// ── Memory ──
function renderMemoryList(entries, el) {
  document.getElementById('stat-memory').textContent = entries.length;
  if (entries.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.memory.noResults') + '</div>'; return; }
  var html = '<div class="card">';
  entries.forEach(function(m) {
    var visBadge = m.visibility === 'public' ? 'badge-success' : m.visibility === 'shared' ? 'badge-warn' : 'badge-muted';
    html += '<div class="mem-item" data-memkey="' + escHtml(m.key) + '" onclick="viewMemory(\\'' + escHtml(m.key).replace(/'/g, "\\\\'") + '\\')">'
      + '<div class="mem-key">' + escHtml(m.key) + '</div>'
      + '<div><span class="badge mem-vis ' + visBadge + '">' + escHtml(m.visibility || 'private') + '</span>'
      + (m.tags && m.tags.length ? ' <span style="font-size:.7rem;color:var(--muted)">' + m.tags.map(escHtml).join(', ') + '</span>' : '')
      + '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

async function loadMemory() {
  var el = document.getElementById('memory-list');
  try {
    var data = await apiFetch('/v1/memory');
    var entries = data && data.data && data.data.entries ? data.data.entries : [];
    renderMemoryList(entries, el);
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.memory.error') + '</div>'; }
}

function toggleMemoryForm() {
  var el = document.getElementById('memory-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function createMemory() {
  var key = document.getElementById('mem-key').value.trim();
  var value = document.getElementById('mem-value').value;
  var vis = document.getElementById('mem-vis').value;
  var tagsStr = document.getElementById('mem-tags').value.trim();
  var tags = tagsStr ? tagsStr.split(',').map(function(t){ return t.trim(); }).filter(Boolean) : [];

  if (!key || !value) { showToast(t('profile.memory.keyRequired'), true); return; }

  try {
    var resp = await session.fetch('/v1/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, value: value, visibility: vis, tags: tags })
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.memory.saved'));
      toggleMemoryForm();
      document.getElementById('mem-key').value = '';
      document.getElementById('mem-value').value = '';
      document.getElementById('mem-tags').value = '';
      loadMemory();
    } else {
      showToast(t('profile.memory.saveFailed') + ': ' + (resp && resp.error ? resp.error.message : t('profile.unknownError')), true);
    }
  } catch(e) { showToast(t('profile.memory.saveFailed'), true); }
}

async function viewMemory(key) {
  var existingEl = document.getElementById('mem-detail-' + key);
  if (existingEl) { existingEl.remove(); return; }

  try {
    var data = await apiFetch('/v1/memory/' + encodeURIComponent(key));
    var entry = data && data.data ? data.data : null;
    if (!entry) return;

    var containers = document.querySelectorAll('[data-memkey]');
    var container = null;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].getAttribute('data-memkey') === key) { container = containers[i]; break; }
    }
    if (!container) return;

    var detail = document.createElement('div');
    detail.className = 'mem-detail';
    detail.id = 'mem-detail-' + key;
    var valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2);
    detail.innerHTML = '<pre>' + escHtml(valueStr) + '</pre>'
      + '<div class="mem-actions">'
      + '<button class="btn-sm" onclick="editMemoryPrompt(\\'' + escHtml(key).replace(/'/g, "\\\\'") + '\\')">' + t('profile.memory.editBtn') + '</button>'
      + '<button class="btn-danger" onclick="deleteMemory(\\'' + escHtml(key).replace(/'/g, "\\\\'") + '\\')">' + t('profile.memory.deleteBtn') + '</button>'
      + '</div>';
    container.after(detail);
  } catch(e) {}
}

async function deleteMemory(key) {
  if (!confirm(t('profile.memory.deleteConfirm') + ' "' + key + '"?')) return;
  try {
    await session.fetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' });
    showToast(t('profile.memory.deleted'));
    loadMemory();
  } catch(e) { showToast(t('profile.error'), true); }
}

async function editMemoryPrompt(key) {
  try {
    var data = await apiFetch('/v1/memory/' + encodeURIComponent(key));
    var entry = data && data.data ? data.data : null;
    if (!entry) return;

    var valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="modal"><h3>' + t('profile.memory.editTitle') + ': ' + escHtml(key) + '</h3>'
      + '<div class="form-row"><label>' + t('profile.memory.valueLabel') + '</label><textarea id="edit-mem-value" class="input-field" rows="5">' + escHtml(valueStr) + '</textarea></div>'
      + '<div class="form-row"><label>' + t('profile.memory.visLabel') + '</label><select id="edit-mem-vis" class="input-field">'
      + '<option value="private"' + (entry.visibility === 'private' ? ' selected' : '') + '>' + t('profile.memory.visPrivate') + '</option>'
      + '<option value="shared"' + (entry.visibility === 'shared' ? ' selected' : '') + '>' + t('profile.memory.visShared') + '</option>'
      + '<option value="public"' + (entry.visibility === 'public' ? ' selected' : '') + '>' + t('profile.memory.visPublic') + '</option></select></div>'
      + '<div class="form-row"><label>' + t('profile.memory.tagsLabel') + '</label><input type="text" id="edit-mem-tags" class="input-field" value="' + escHtml((entry.tags || []).join(', ')) + '"></div>'
      + '<div class="form-actions"><button class="btn-primary" onclick="saveMemoryEdit(\\'' + escHtml(key).replace(/'/g, "\\\\'") + '\\')">' + t('profile.save') + '</button><button class="btn-outline" onclick="this.closest(\\'.modal-overlay\\').remove()">' + t('profile.cancel') + '</button></div></div>';
    document.body.appendChild(overlay);
  } catch(e) { showToast(t('profile.error'), true); }
}

async function saveMemoryEdit(key) {
  var value = document.getElementById('edit-mem-value').value;
  var vis = document.getElementById('edit-mem-vis').value;
  var tagsStr = document.getElementById('edit-mem-tags').value.trim();
  var tags = tagsStr ? tagsStr.split(',').map(function(t){ return t.trim(); }).filter(Boolean) : [];

  try {
    await session.fetch('/v1/memory/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value, visibility: vis, tags: tags })
    });
    showToast(t('profile.memory.updated'));
    document.querySelector('.modal-overlay').remove();
    loadMemory();
  } catch(e) { showToast(t('profile.error'), true); }
}

async function searchMemory() {
  var q = document.getElementById('memory-search').value.trim();
  if (!q) { loadMemory(); return; }
  var el = document.getElementById('memory-list');
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.memory.searchBtn') + '...';
  try {
    var data = await apiFetch('/v1/memory/search?q=' + encodeURIComponent(q));
    var entries = data && data.data && data.data.entries ? data.data.entries : [];
    renderMemoryList(entries, el);
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.memory.searchFailed') + '</div>'; }
}

// ── Files (Storage) ──
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function loadFiles() {
  var el = document.getElementById('files-list');
  try {
    var data = await apiFetch('/v1/storage');
    var files = data && data.data && data.data.files ? data.data.files : [];
    document.getElementById('stat-files').textContent = files.length;

    if (files.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.files.empty') + '</div>'; return; }
    var html = '<div class="file-grid">';
    files.forEach(function(f) {
      var isImage = f.mime_type && f.mime_type.startsWith('image/');
      var icon = isImage ? '\ud83d\uddbc\ufe0f' : f.mime_type && f.mime_type.includes('pdf') ? '\ud83d\udcc4' : f.mime_type && f.mime_type.includes('text') ? '\ud83d\udcdd' : '\ud83d\udcc1';
      var safeKey = escHtml(f.key).replace(/'/g, '&#39;');
      html += '<div class="file-card">'
        + '<div class="file-icon">' + icon + '</div>'
        + '<div class="file-info">'
        + '<div class="file-name" title="' + escHtml(f.key) + '">' + escHtml(f.key) + '</div>'
        + '<div class="file-meta">' + formatFileSize(f.size) + ' &bull; ' + escHtml(f.mime_type || 'unknown') + '</div>'
        + '<div class="file-meta">' + escHtml(f.visibility) + (f.created_at ? ' &bull; ' + new Date(f.created_at).toLocaleDateString() : '') + '</div>'
        + '</div>'
        + '<div class="file-actions">'
        + '<button class="btn-sm" onclick="downloadFile(decodeURIComponent(\\'' + encodeURIComponent(f.key) + '\\'))" title="' + t('profile.files.download') + '">\u2b07\ufe0f</button>'
        + '<button class="btn-sm btn-danger" onclick="deleteFile(decodeURIComponent(\\'' + encodeURIComponent(f.key) + '\\'))" title="' + t('profile.files.delete') + '">\u2716</button>'
        + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.files.error') + '</div>'; }
}

function toggleFileForm() {
  var form = document.getElementById('file-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function uploadFile() {
  var fileInput = document.getElementById('file-input');
  var keyInput = document.getElementById('file-key');
  var vis = document.getElementById('file-vis').value;

  if (!fileInput.files || !fileInput.files.length) {
    showToast(t('profile.files.selectFile'), true); return;
  }
  var file = fileInput.files[0];
  var key = keyInput.value.trim() || file.name;

  // Read file as base64
  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result.split(',')[1];
    try {
      var resp = await session.fetch('/v1/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key,
          visibility: vis,
          data: base64,
          mime_type: file.type || 'application/octet-stream'
        })
      });
      if (resp && resp.data) {
        showToast(t('profile.files.uploaded'));
        toggleFileForm();
        fileInput.value = '';
        keyInput.value = '';
        loadFiles();
      } else {
        showToast(t('profile.files.uploadFailed') + (resp && resp.error ? ': ' + resp.error.message : ''), true);
      }
    } catch(e) {
      showToast(t('profile.files.uploadFailed'), true);
    }
  };
  reader.readAsDataURL(file);
}

async function downloadFile(key) {
  try {
    // Use raw fetch with JWT since session.fetch() auto-parses as JSON
    var resp = await fetch(NODE_URL + '/v1/storage/' + encodeURIComponent(key), {
      headers: { 'Authorization': 'Bearer ' + session.jwt }
    });
    if (!resp || !resp.ok) { showToast(t('profile.files.error'), true); return; }
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = key;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) { showToast(t('profile.files.error'), true); }
}

async function deleteFile(key) {
  if (!confirm(t('profile.files.deleteConfirm') + ': ' + key)) return;
  try {
    var resp = await session.fetch('/v1/storage/' + encodeURIComponent(key), { method: 'DELETE' });
    if (resp && resp.data && resp.data.deleted) {
      showToast(t('profile.files.deleted'));
      loadFiles();
    } else {
      showToast(t('profile.files.error'), true);
    }
  } catch(e) { showToast(t('profile.files.error'), true); }
}

// ── Board creation ──
function toggleBoardForm() {
  var form = document.getElementById('board-create-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function createBoard() {
  var name = document.getElementById('board-name').value.trim();
  var desc = document.getElementById('board-desc').value.trim();
  var vis = document.getElementById('board-vis').value;
  if (!name) { showToast(t('profile.boards.createFailed'), true); return; }
  try {
    var resp = await session.fetch('/v1/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, description: desc, visibility: vis })
    });
    if (resp && resp.data) {
      showToast(t('profile.boards.created'));
      toggleBoardForm();
      document.getElementById('board-name').value = '';
      document.getElementById('board-desc').value = '';
      loadBoards();
    } else {
      showToast(t('profile.boards.createFailed') + (resp && resp.error ? ': ' + resp.error.message : ''), true);
    }
  } catch(e) { showToast(t('profile.boards.createFailed'), true); }
}

async function subscribeBoard(boardId) {
  try {
    var resp = await session.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (resp && resp.data) {
      showToast(t('profile.boards.subscribed'));
      loadBoards();
    } else {
      showToast(t('profile.boards.subscribeFailed') + (resp && resp.error ? ': ' + resp.error.message : ''), true);
    }
  } catch(e) { showToast(t('profile.boards.subscribeFailed'), true); }
}

// ── App creation prompt ──
function copyAppPrompt() {
  var prompt = 'I want to create a self-contained HTML application that connects to an AIMEAT node. '
    + 'The node is at: ' + NODE_URL + '\\n\\n'
    + 'Please read the attached AIMEAT-OS.md file for the complete API reference and guidelines. '
    + 'The app should be a single HTML file with embedded CSS and JavaScript that I can upload and share. '
    + 'Start by asking me what kind of app I want to build, then help me design and implement it step by step.';
  copyToClipboard(prompt).then(function() {
    showToast(t('profile.apps.promptCopied'));
  });
}

// ── Work ──
async function loadWork() {
  var el = document.getElementById('work-list');
  try {
    var data = await apiFetch('/v1/work/inbox');
    var items = data && data.data && data.data.items ? data.data.items : [];
    document.getElementById('stat-work').textContent = items.length;
    if (items.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.work.empty') + '</div>'; return; }
    var html = '';
    items.forEach(function(w) {
      var statusClass = w.status === 'completed' ? 'badge-success' : w.status === 'delivered' ? 'badge-info' : w.status === 'accepted' ? 'badge-warn' : w.status === 'in_progress' ? 'badge-info' : w.status === 'failed' ? 'badge-danger' : w.status === 'disputed' ? 'badge-danger' : 'badge-muted';
      html += '<div class="card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(w.action_id || w.tracking_code) + '</div>'
        + '<div class="card-subtitle">' + escHtml(w.tracking_code) + '</div></div>'
        + '<div class="work-status"><span class="badge ' + statusClass + '">' + escHtml(w.status) + '</span></div></div>'
        + '<div class="card-subtitle">'
        + (w.requester_gaii ? t('profile.work.from') + ': ' + escHtml(w.requester_gaii) : '')
        + (w.cost ? ' &bull; ' + t('profile.work.cost') + ': ' + w.cost + ' ' + t('profile.stats.morsels').toLowerCase() : '') + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.work.error') + '</div>'; }
}

async function loadSentWork() {
  var el = document.getElementById('work-sent-list');
  try {
    var data = await apiFetch('/v1/work/inbox');
    var items = data && data.data && data.data.items ? data.data.items : [];
    if (items.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.work.sentEmpty') + '</div>'; return; }
    var html = '';
    items.forEach(function(w) {
      var statusClass = w.status === 'completed' ? 'badge-success' : w.status === 'delivered' ? 'badge-info' : w.status === 'accepted' ? 'badge-warn' : w.status === 'disputed' ? 'badge-danger' : 'badge-muted';
      html += '<div class="card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(w.action_id || w.tracking_code) + '</div>'
        + '<div class="card-subtitle">' + escHtml(w.tracking_code) + '</div></div>'
        + '<div class="work-status"><span class="badge ' + statusClass + '">' + escHtml(w.status) + '</span></div></div>'
        + '<div class="card-subtitle">'
        + (w.provider_gaii ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii) : '')
        + (w.cost ? ' &bull; ' + t('profile.work.cost') + ': ' + w.cost + ' ' + t('profile.stats.morsels').toLowerCase() : '') + '</div>';

      // Rate button for delivered items
      if (w.status === 'delivered') {
        html += '<div style="margin-top:.5rem"><button class="btn-sm" onclick="showRateModal(\\'' + escHtml(w.tracking_code) + '\\')">' + t('profile.work.rateBtn') + '</button></div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.work.sentError') + '</div>'; }
}

function showRateModal(tc) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="modal"><h3>' + t('profile.work.rateTitle') + '</h3>'
    + '<p style="color:var(--muted);font-size:.85rem">' + t('profile.work.rateDesc') + ' ' + escHtml(tc) + '</p>'
    + '<div class="star-rating" id="rate-stars">'
    + [1,2,3,4,5].map(function(n) { return '<span class="star" data-rating="' + n + '" onclick="selectRating(' + n + ')">&#9734;</span>'; }).join('')
    + '</div>'
    + '<div class="form-row" style="margin-top:1rem"><label>' + t('profile.work.commentLabel') + '</label><textarea id="rate-comment" class="input-field" rows="2"></textarea></div>'
    + '<div class="form-actions"><button class="btn-primary" onclick="submitRating(\\'' + escHtml(tc) + '\\')">' + t('profile.work.submitRating') + '</button><button class="btn-outline" onclick="this.closest(\\'.modal-overlay\\').remove()">' + t('profile.cancel') + '</button></div></div>';
  document.body.appendChild(overlay);
}

var currentRating = 0;
function selectRating(n) {
  currentRating = n;
  document.querySelectorAll('#rate-stars .star').forEach(function(s) {
    var r = parseInt(s.dataset.rating);
    s.innerHTML = r <= n ? '&#9733;' : '&#9734;';
    s.classList.toggle('active', r <= n);
  });
}

async function submitRating(tc) {
  if (currentRating === 0) { showToast(t('profile.work.selectRating'), true); return; }
  try {
    await session.fetch('/v1/work/' + tc + '/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: currentRating, comment: document.getElementById('rate-comment').value })
    });
    showToast(t('profile.work.ratingSubmitted'));
    document.querySelector('.modal-overlay').remove();
    currentRating = 0;
    loadSentWork();
  } catch(e) { showToast(t('profile.error'), true); }
}

// ── Actions (published services) ──
async function loadActions() {
  var el = document.getElementById('actions-list');
  try {
    var data = await apiFetch('/v1/actions');
    var actions = data && data.data && data.data.actions ? data.data.actions : [];
    // Filter to own actions
    var mine = actions.filter(function(a) { return a.provider_gaii === session.gaii; });
    document.getElementById('stat-actions').textContent = mine.length;
    if (mine.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.services.empty') + '</div>'; return; }
    var html = '';
    mine.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.display_name || a.id) + '</div>'
        + '<div><span class="badge badge-info">' + escHtml(a.category || 'general') + '</span>'
        + ' <button class="btn-icon" title="' + t('profile.delete') + '" onclick="deleteAction(\\'' + escHtml(a.id) + '\\')">\\u{1F5D1}\\u{FE0F}</button></div></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>'
        + (a.pricing && a.pricing.amount ? '<div class="card-subtitle" style="margin-top:.3rem">' + t('profile.services.price') + ': <strong>' + a.pricing.amount + '</strong> ' + t('profile.stats.morsels').toLowerCase() + '/' + (a.pricing.unit || 'call') + '</div>' : '')
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.services.error') + '</div>'; }
}
`;
