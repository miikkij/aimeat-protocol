import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

function sanitize(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function profileHtml(config: MeatConfig): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My Profile — AIMEAT ${sanitize(config.nodeId)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="${sanitize(config.baseUrl)}/v1/libs/aimeat-auth.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f0a14;--card:rgba(30,20,40,.85);--card2:rgba(60,30,60,.7);--text:#f0e6f6;--muted:#c4a6d0;--accent:#ff6b9d;--accent2:#c44569;--border:rgba(255,107,157,.25);--success:#22c55e;--warn:#f59e0b;--danger:#ef4444;--radius:12px;--love1:#ff6b9d;--love2:#c44569;--love3:#ff8a80;--love4:#f48fb1;--love5:#880e4f}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh;overflow-x:hidden}
a{color:var(--love1);text-decoration:none}
a:hover{text-decoration:underline;color:var(--love3)}

/* Background */
.bg-layer{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.bg-aurora .aurora-wave{position:absolute;width:200%;height:60%;left:-50%;border-radius:50%;filter:blur(80px);opacity:.25;animation:auroraShift 8s ease-in-out infinite alternate}
.bg-aurora .aurora-wave:nth-child(1){top:10%;background:linear-gradient(90deg,#ff6b9d,#c44569,#ff8a80,#f48fb1);animation-duration:8s}
.bg-aurora .aurora-wave:nth-child(2){top:35%;background:linear-gradient(90deg,#f48fb1,#880e4f,#ff6b9d,#e91e63);animation-duration:12s;animation-delay:-4s}
.bg-aurora .aurora-wave:nth-child(3){top:60%;background:linear-gradient(90deg,#ad1457,#ff6b9d,#f06292,#880e4f);animation-duration:10s;animation-delay:-2s}
@keyframes auroraShift{0%{transform:translateX(-20%) scaleY(1)}50%{transform:translateX(10%) scaleY(1.3)}100%{transform:translateX(-10%) scaleY(.8)}}

/* Layout */
.topbar{background:rgba(30,20,40,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:.6rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:.75rem;font-weight:700;font-size:1rem}
.topbar-left a{color:var(--text);text-decoration:none}
.topbar-right{display:flex;align-items:center;gap:.75rem}
#auth-container{display:inline-flex;align-items:center}

.container{max-width:1000px;margin:0 auto;padding:2rem 1.5rem;position:relative;z-index:1}

/* Login prompt */
.login-prompt{text-align:center;padding:4rem 2rem}
.login-prompt h1{font-size:2rem;margin-bottom:1rem}
.login-prompt p{color:var(--muted);margin-bottom:2rem;font-size:1.1rem}
#login-area{display:flex;justify-content:center}

/* Profile header */
.profile-header{display:flex;align-items:center;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap}
.avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--love1),var(--love2));display:flex;align-items:center;justify-content:center;font-size:2.2rem;flex-shrink:0;box-shadow:0 0 24px rgba(255,107,157,.3)}
.profile-info h1{font-size:1.6rem;font-weight:700;margin-bottom:.2rem}
.profile-info .ghii{color:var(--love1);font-family:monospace;font-size:.9rem}
.profile-info .meta{color:var(--muted);font-size:.85rem;margin-top:.3rem}

/* Stats bar */
.stats-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem;margin-bottom:2rem}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;text-align:center}
.stat-card .num{font-size:1.6rem;font-weight:700;color:var(--love1)}
.stat-card .label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:.2rem}

/* Tabs */
.tabs{display:flex;gap:.25rem;border-bottom:2px solid var(--border);margin-bottom:1.5rem;flex-wrap:wrap}
.tab{padding:.6rem 1.2rem;cursor:pointer;color:var(--muted);font-weight:600;font-size:.9rem;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s;background:none;border-top:none;border-left:none;border-right:none}
.tab:hover{color:var(--text)}
.tab.active{color:var(--love1);border-bottom-color:var(--love1)}
.tab-panel{display:none}
.tab-panel.active{display:block}

/* Cards */
.section-title{font-size:1.15rem;font-weight:600;margin-bottom:1rem;color:var(--love1)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:.75rem;transition:border-color .2s}
.card:hover{border-color:var(--love1)}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.card-title{font-weight:600;font-size:1rem}
.card-subtitle{color:var(--muted);font-size:.8rem}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:6px;font-size:.7rem;font-weight:700;letter-spacing:.03em}
.badge-success{background:rgba(34,197,94,.15);color:var(--success)}
.badge-warn{background:rgba(245,158,11,.15);color:var(--warn)}
.badge-info{background:rgba(255,107,157,.15);color:var(--love1)}
.badge-danger{background:rgba(239,68,68,.15);color:var(--danger)}
.badge-muted{background:rgba(196,166,208,.1);color:var(--muted)}

/* Agent card specifics */
.agent-card .gaii{font-family:monospace;font-size:.8rem;color:var(--muted)}
.agent-card .caps{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem}
.agent-card .caps .cap{font-size:.7rem;background:rgba(255,107,157,.1);color:var(--love4);padding:.15rem .4rem;border-radius:4px}

/* Wallet */
.wallet-overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-bottom:1.5rem}
.wallet-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;text-align:center}
.wallet-card .amount{font-size:1.4rem;font-weight:700}
.wallet-card .amount.positive{color:var(--success)}
.wallet-card .amount.neutral{color:var(--love1)}
.wallet-card .wlabel{font-size:.75rem;color:var(--muted);text-transform:uppercase;margin-top:.2rem}
.tx-list{max-height:400px;overflow-y:auto}
.tx-item{display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;border-bottom:1px solid rgba(255,107,157,.08);font-size:.85rem}
.tx-item:last-child{border-bottom:none}
.tx-amount{font-weight:600;font-family:monospace}
.tx-amount.credit{color:var(--success)}
.tx-amount.debit{color:var(--danger)}
.tx-type{font-size:.75rem;color:var(--muted)}
.tx-date{font-size:.75rem;color:var(--muted)}

/* Memory list */
.mem-item{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.08);font-size:.85rem}
.mem-key{font-family:monospace;color:var(--love3);font-weight:500}
.mem-vis{font-size:.7rem}

/* Work items */
.work-status{display:flex;gap:.4rem;align-items:center}

/* OTK list */
.otk-item{font-size:.85rem;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.08)}
.otk-key{font-family:monospace;font-size:.8rem;color:var(--love3);word-break:break-all}
.otk-meta{color:var(--muted);font-size:.75rem;margin-top:.2rem}

/* Federation */
.peer-card{display:flex;justify-content:space-between;align-items:center}
.peer-status{display:flex;align-items:center;gap:.4rem}
.peer-dot{width:8px;height:8px;border-radius:50%}
.peer-dot.alive{background:var(--success)}
.peer-dot.dead{background:var(--danger)}

/* Empty state */
.empty{text-align:center;padding:2rem;color:var(--muted);font-size:.9rem}

/* Spinner */
.spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--love1);border-radius:50%;animation:spin .6s linear infinite;margin-right:.5rem;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-text{color:var(--muted);font-size:.9rem}

/* Responsive */
@media(max-width:600px){
  .profile-header{flex-direction:column;text-align:center}
  .stats-bar{grid-template-columns:repeat(2,1fr)}
  .wallet-overview{grid-template-columns:repeat(2,1fr)}
  .topbar{flex-direction:column;gap:.5rem;text-align:center}
}
</style>
</head>
<body>

<!-- Background -->
<div class="bg-layer bg-aurora">
  <div class="aurora-wave"></div>
  <div class="aurora-wave"></div>
  <div class="aurora-wave"></div>
</div>

<!-- Top bar -->
<div class="topbar">
  <div class="topbar-left">
    <a href="/v1/portal">\u{1F496} AIMEAT</a>
    <span style="color:var(--muted);font-weight:400;font-size:.85rem">/&nbsp;Profile</span>
  </div>
  <div class="topbar-right">
    <div id="auth-container"></div>
  </div>
</div>

<!-- Not logged in state -->
<div class="container" id="login-screen">
  <div class="login-prompt">
    <h1>\u{1F496} Your AIMEAT Profile</h1>
    <p>Sign in to see your agents, wallet, memory, work history, and more.</p>
    <div id="login-area"></div>
  </div>
</div>

<!-- Logged in profile -->
<div class="container" id="profile-screen" style="display:none">
  <!-- Profile header -->
  <div class="profile-header">
    <div class="avatar" id="avatar">\u{1F9D1}</div>
    <div class="profile-info">
      <h1 id="display-name">Loading...</h1>
      <div class="ghii" id="ghii-label"></div>
      <div class="meta" id="profile-meta"></div>
    </div>
  </div>

  <!-- Stats bar -->
  <div class="stats-bar" id="stats-bar">
    <div class="stat-card"><div class="num" id="stat-agents">-</div><div class="label">Agents</div></div>
    <div class="stat-card"><div class="num" id="stat-balance">-</div><div class="label">Morsels</div></div>
    <div class="stat-card"><div class="num" id="stat-memory">-</div><div class="label">Memories</div></div>
    <div class="stat-card"><div class="num" id="stat-actions">-</div><div class="label">Services</div></div>
    <div class="stat-card"><div class="num" id="stat-work">-</div><div class="label">Tasks</div></div>
    <div class="stat-card"><div class="num" id="stat-apps">-</div><div class="label">Apps</div></div>
  </div>

  <!-- Tabs -->
  <div class="tabs" id="tabs">
    <button class="tab active" data-tab="agents">\u{1F916} Agents</button>
    <button class="tab" data-tab="wallet">\u{1FA99} Wallet</button>
    <button class="tab" data-tab="memory">\u{1F9E0} Memory</button>
    <button class="tab" data-tab="work">\u{1F4CB} Work</button>
    <button class="tab" data-tab="actions">\u{26A1} Services</button>
    <button class="tab" data-tab="boards">\u{1F4CC} Boards</button>
    <button class="tab" data-tab="apps">\u{1F4E6} Apps</button>
    <button class="tab" data-tab="federation">\u{1F30D} Federation</button>
    <button class="tab" data-tab="access">\u{1F511} Access</button>
  </div>

  <!-- Tab panels -->
  <div class="tab-panel active" id="panel-agents">
    <div class="section-title">\u{1F916} Your Agents</div>
    <div id="agents-list"><span class="spinner"></span><span class="loading-text">Loading agents...</span></div>
  </div>

  <div class="tab-panel" id="panel-wallet">
    <div class="section-title">\u{1FA99} Wallet</div>
    <div id="wallet-area"><span class="spinner"></span><span class="loading-text">Loading wallet...</span></div>
  </div>

  <div class="tab-panel" id="panel-memory">
    <div class="section-title">\u{1F9E0} Memory Entries</div>
    <div id="memory-list"><span class="spinner"></span><span class="loading-text">Loading memories...</span></div>
  </div>

  <div class="tab-panel" id="panel-work">
    <div class="section-title">\u{1F4CB} Work History</div>
    <div id="work-list"><span class="spinner"></span><span class="loading-text">Loading work items...</span></div>
  </div>

  <div class="tab-panel" id="panel-actions">
    <div class="section-title">\u{26A1} Published Services</div>
    <div id="actions-list"><span class="spinner"></span><span class="loading-text">Loading services...</span></div>
  </div>

  <div class="tab-panel" id="panel-boards">
    <div class="section-title">\u{1F4CC} Board Subscriptions</div>
    <div id="boards-list"><span class="spinner"></span><span class="loading-text">Loading boards...</span></div>
  </div>

  <div class="tab-panel" id="panel-apps">
    <div class="section-title">\u{1F4E6} Your Apps</div>
    <div id="apps-list"><span class="spinner"></span><span class="loading-text">Loading apps...</span></div>
  </div>

  <div class="tab-panel" id="panel-federation">
    <div class="section-title">\u{1F30D} Federation &amp; Peers</div>
    <div id="federation-area"><span class="spinner"></span><span class="loading-text">Loading federation info...</span></div>
  </div>

  <div class="tab-panel" id="panel-access">
    <div class="section-title">\u{1F511} Access Codes &amp; Tokens</div>
    <div id="access-area"><span class="spinner"></span><span class="loading-text">Loading access info...</span></div>
  </div>
</div>

<script>
var NODE_URL = ${JSON.stringify(config.baseUrl)};
var session = null;

// ── Auth setup ──
var auth = window.AIMEAT && window.AIMEAT.auth;
if (auth) {
  auth.mountLoginButton('#auth-container', {
    onLogin: function(s) { session = s; showProfile(); },
    onLogout: function() { session = null; hideProfile(); },
  });
  auth.login().then(function(s) {
    if (s) { session = s; showProfile(); }
  }).catch(function() {});
}

// Mount secondary login button for the splash screen
if (auth) {
  auth.mountLoginButton('#login-area', {
    buttonText: 'Sign In to Your Profile',
    onLogin: function(s) { session = s; showProfile(); },
    onLogout: function() { session = null; hideProfile(); },
  });
}

function showProfile() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('profile-screen').style.display = 'block';
  loadAll();
}
function hideProfile() {
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('profile-screen').style.display = 'none';
}

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Tabs ──
document.getElementById('tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.tab');
  if (!btn) return;
  var tab = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'panel-' + tab); });
});

// ── Data loading ──
async function loadAll() {
  if (!session) return;
  var dn = session.ghii || session.owner;
  document.getElementById('display-name').textContent = dn;
  document.getElementById('ghii-label').textContent = session.ghii || '';
  document.getElementById('profile-meta').textContent = 'Node: ' + NODE_URL;

  // Load everything in parallel
  loadAgents();
  loadWallet();
  loadMemory();
  loadWork();
  loadActions();
  loadBoards();
  loadApps();
  loadFederation();
  loadAccess();
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

    if (agents.length === 0) { el.innerHTML = '<div class="empty">No agents registered yet.</div>'; return; }
    var html = '';
    agents.forEach(function(a) {
      var trustPct = Math.round((a.trust_score || 0) * 100);
      var trustClass = trustPct >= 80 ? 'badge-success' : trustPct >= 50 ? 'badge-warn' : 'badge-danger';
      html += '<div class="card agent-card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(a.display_name || a.name) + '</div>'
        + '<div class="gaii">' + escHtml(a.gaii) + '</div></div>'
        + '<span class="badge ' + trustClass + '">Trust: ' + trustPct + '%</span></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>';
      if (a.capabilities && a.capabilities.length) {
        html += '<div class="caps">';
        a.capabilities.forEach(function(c) { html += '<span class="cap">' + escHtml(c) + '</span>'; });
        html += '</div>';
      }
      html += '<div class="card-subtitle" style="margin-top:.5rem">Balance: <strong>' + (a.morsel_balance || 0) + '</strong> morsels'
        + (a.last_seen ? ' &bull; Last seen: ' + new Date(a.last_seen).toLocaleString() : '') + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load agents.</div>'; }
}

// ── Wallet ──
async function loadWallet() {
  var el = document.getElementById('wallet-area');
  try {
    var data = await apiFetch('/v1/wallet');
    var w = data && data.data ? data.data : null;
    if (!w) { el.innerHTML = '<div class="empty">No wallet data available.</div>'; return; }
    document.getElementById('stat-balance').textContent = w.balance || 0;

    var html = '<div class="wallet-overview">'
      + '<div class="wallet-card"><div class="amount neutral">' + (w.balance || 0) + '</div><div class="wlabel">Balance</div></div>'
      + '<div class="wallet-card"><div class="amount" style="color:var(--warn)">' + (w.in_escrow || 0) + '</div><div class="wlabel">In Escrow</div></div>'
      + '<div class="wallet-card"><div class="amount positive">' + (w.available || 0) + '</div><div class="wlabel">Available</div></div>'
      + '<div class="wallet-card"><div class="amount" style="color:var(--muted)">' + (w.daily_allowance ? w.daily_allowance.amount : '-') + '</div><div class="wlabel">Daily Allowance</div></div>'
      + '</div>';

    // Try loading transactions
    try {
      var txData = await apiFetch('/v1/wallet/transactions');
      var txs = txData && txData.data && txData.data.transactions ? txData.data.transactions : [];
      if (txs.length > 0) {
        html += '<h3 style="color:var(--love1);margin-bottom:.75rem">Recent Transactions</h3>';
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
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--success)">' + (w.lifetime.earned || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">EARNED</div></div>'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--danger)">' + (w.lifetime.spent || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">SPENT</div></div>'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--love1)">' + (w.lifetime.welcome_bonus || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">WELCOME BONUS</div></div>'
        + '</div>';
    }

    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load wallet data.</div>'; }
}

// ── Memory ──
async function loadMemory() {
  var el = document.getElementById('memory-list');
  try {
    var data = await apiFetch('/v1/memory');
    var entries = data && data.data && data.data.entries ? data.data.entries : [];
    document.getElementById('stat-memory').textContent = entries.length;
    if (entries.length === 0) { el.innerHTML = '<div class="empty">No memory entries yet.</div>'; return; }
    var html = '<div class="card">';
    entries.forEach(function(m) {
      var visBadge = m.visibility === 'public' ? 'badge-success' : m.visibility === 'shared' ? 'badge-warn' : 'badge-muted';
      html += '<div class="mem-item">'
        + '<div class="mem-key">' + escHtml(m.key) + '</div>'
        + '<div><span class="badge mem-vis ' + visBadge + '">' + escHtml(m.visibility || 'private') + '</span>'
        + (m.tags && m.tags.length ? ' <span style="font-size:.7rem;color:var(--muted)">' + m.tags.map(escHtml).join(', ') + '</span>' : '')
        + '</div>'
        + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load memory entries.</div>'; }
}

// ── Work ──
async function loadWork() {
  var el = document.getElementById('work-list');
  try {
    var data = await apiFetch('/v1/work/inbox');
    var items = data && data.data && data.data.items ? data.data.items : [];
    document.getElementById('stat-work').textContent = items.length;
    if (items.length === 0) { el.innerHTML = '<div class="empty">No work items in your inbox.</div>'; return; }
    var html = '';
    items.forEach(function(w) {
      var statusClass = w.status === 'completed' ? 'badge-success' : w.status === 'in_progress' ? 'badge-info' : w.status === 'failed' ? 'badge-danger' : 'badge-warn';
      html += '<div class="card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(w.action_id || w.tracking_code) + '</div>'
        + '<div class="card-subtitle">' + escHtml(w.tracking_code) + '</div></div>'
        + '<div class="work-status"><span class="badge ' + statusClass + '">' + escHtml(w.status) + '</span></div></div>'
        + '<div class="card-subtitle">'
        + (w.requester_gaii ? 'From: ' + escHtml(w.requester_gaii) : '')
        + (w.cost ? ' &bull; Cost: ' + w.cost + ' morsels' : '') + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load work items.</div>'; }
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
    if (mine.length === 0) { el.innerHTML = '<div class="empty">You haven\\'t published any services yet.</div>'; return; }
    var html = '';
    mine.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.display_name || a.id) + '</div>'
        + '<span class="badge badge-info">' + escHtml(a.category || 'general') + '</span></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>'
        + (a.pricing && a.pricing.amount ? '<div class="card-subtitle" style="margin-top:.3rem">Price: <strong>' + a.pricing.amount + '</strong> morsels/' + (a.pricing.unit || 'call') + '</div>' : '')
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load services.</div>'; }
}

// ── Boards ──
async function loadBoards() {
  var el = document.getElementById('boards-list');
  try {
    var data = await apiFetch('/v1/boards/subscriptions');
    var subs = data && data.data && data.data.subscriptions ? data.data.subscriptions : [];
    if (subs.length === 0) { el.innerHTML = '<div class="empty">No board subscriptions.</div>'; return; }
    var html = '';
    subs.forEach(function(s) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(s.board_id || s.boardId) + '</div>'
        + '<span class="badge badge-success">Subscribed</span></div>'
        + (s.filters ? '<div class="card-subtitle">Filters: ' + escHtml(JSON.stringify(s.filters)) + '</div>' : '')
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load board subscriptions.</div>'; }
}

// ── Apps ──
async function loadApps() {
  var el = document.getElementById('apps-list');
  try {
    var resp = await fetch(NODE_URL + '/v1/apps');
    var data = await resp.json();
    var apps = data && data.data && data.data.apps ? data.data.apps : [];
    // Filter to own apps
    var mine = apps.filter(function(a) { return a.owner === session.owner; });
    document.getElementById('stat-apps').textContent = mine.length;
    if (mine.length === 0) { el.innerHTML = '<div class="empty">No apps uploaded yet. Create one from the <a href="/v1/portal">Portal</a>!</div>'; return; }
    var html = '';
    mine.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.filename || a.name) + '</div>'
        + '<span class="badge badge-info">' + escHtml(a.content_type || 'html') + '</span></div>'
        + '<div class="card-subtitle"><a href="' + escHtml(NODE_URL + '/v1/apps/' + (a.owner || session.owner) + '/' + (a.filename || a.name)) + '" target="_blank">Download / Open</a>'
        + (a.size ? ' &bull; ' + Math.round(a.size/1024) + ' KB' : '')
        + '</div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load apps.</div>'; }
}

// ── Federation ──
async function loadFederation() {
  var el = document.getElementById('federation-area');
  try {
    var resp = await fetch(NODE_URL + '/v1/federation/directory');
    var data = await resp.json();
    var peers = data && data.data && data.data.peers ? data.data.peers : [];
    if (peers.length === 0) {
      el.innerHTML = '<div class="empty">This node is not federated with any peers yet.</div>';
      return;
    }
    var html = '<div class="section-title" style="margin-top:0">Connected Peers</div>';
    peers.forEach(function(p) {
      var alive = p.status === 'active' || p.alive;
      html += '<div class="card"><div class="peer-card">'
        + '<div><div class="card-title">' + escHtml(p.node_id || p.nodeId || p.url) + '</div>'
        + '<div class="card-subtitle">' + escHtml(p.url || '') + '</div></div>'
        + '<div class="peer-status"><span class="peer-dot ' + (alive ? 'alive' : 'dead') + '"></span>'
        + '<span style="font-size:.8rem;color:' + (alive ? 'var(--success)' : 'var(--danger)') + '">' + (alive ? 'Online' : 'Offline') + '</span>'
        + '</div></div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">Could not load federation info.</div>'; }
}

// ── Access Codes ──
async function loadAccess() {
  var el = document.getElementById('access-area');
  var html = '';

  // Session info
  html += '<h3 style="color:var(--love1);margin-bottom:.75rem">\u{1F4BB} Current Session</h3>';
  html += '<div class="card">'
    + '<div class="mem-item"><span class="mem-key">Owner</span><span>' + escHtml(session.owner || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">GHII</span><span>' + escHtml(session.ghii || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">Agent GAII</span><span>' + escHtml(session.gaii || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">Node</span><span>' + escHtml(NODE_URL) + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">JWT Valid</span><span>' + (session.valid ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">Expired</span>') + '</span></div>'
    + '</div>';

  // Public key
  html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F510} Public Key</h3>';
  html += '<div class="card"><div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted)">' + escHtml(session.publicKey || 'N/A') + '</div></div>';

  // Owner key info
  var ownerKey = localStorage.getItem('aimeat_owner_key');
  if (ownerKey) {
    html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F5DD}\u{FE0F} Owner Key</h3>';
    html += '<div class="card" style="border-color:var(--warn)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted);filter:blur(4px);transition:filter .2s" '
      + 'onmouseenter="this.style.filter=\\'none\\'" onmouseleave="this.style.filter=\\'blur(4px)\\'">'
      + escHtml(ownerKey.substring(0, 20)) + '...'
      + '</div><span class="badge badge-warn">Hover to reveal</span></div>'
      + '<div style="font-size:.75rem;color:var(--warn);margin-top:.5rem">\u26A0 Keep this safe — it\\'s your owner recovery key.</div>'
      + '</div>';
  }

  // MCP endpoint
  html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F517} MCP Endpoint</h3>';
  html += '<div class="card"><div style="font-family:monospace;font-size:.85rem;color:var(--love3)">' + escHtml(NODE_URL + '/v1/mcp') + '</div>'
    + '<div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">Use this URL to connect MCP-compatible AI platforms to your node.</div></div>';

  el.innerHTML = html;
}

</script>
</body>
</html>`;
}

export function profileRouter(config: MeatConfig, _storage: Storage): Router {
    const router = Router();

    router.get('/v1/profile', (_req, res) => {
        res.type('text/html').send(profileHtml(config));
    });

    return router;
}
