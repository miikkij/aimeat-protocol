/**
 * @file src/routes/profile/client-script-tabs.ts
 * @description Client-side script (services publish, uploads, agent connect prompt, platform panels, personal nodes) for the legacy SSR profile page as a template string. Extracted from src/routes/profile.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/profile.ts (max-file-lines)
 */
export const PROFILE_JS_TABS = `function togglePublishForm() {
  var el = document.getElementById('publish-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function publishService() {
  var name = document.getElementById('svc-name').value.trim();
  var desc = document.getElementById('svc-desc').value.trim();
  var cat = document.getElementById('svc-category').value;
  var amount = parseInt(document.getElementById('svc-price').value) || 0;
  var unit = document.getElementById('svc-unit').value || 'call';
  var webhook = document.getElementById('svc-webhook').value.trim();

  if (!name || !desc) { showToast(t('profile.memory.keyRequired'), true); return; }

  try {
    var body = {
      display_name: name,
      description: desc,
      category: cat,
      pricing: { amount: amount, unit: unit },
    };
    if (webhook) body.webhook_url = webhook;

    await session.fetch('/v1/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast(t('profile.services.published'));
    togglePublishForm();
    document.getElementById('svc-name').value = '';
    document.getElementById('svc-desc').value = '';
    document.getElementById('svc-webhook').value = '';
    document.getElementById('svc-price').value = '0';
    loadActions();
  } catch(e) { showToast(t('profile.error'), true); }
}

async function deleteAction(id) {
  if (!confirm(t('profile.services.unpublishConfirm'))) return;
  try {
    await session.fetch('/v1/actions/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(t('profile.services.unpublished'));
    loadActions();
  } catch(e) { showToast(t('profile.error'), true); }
}

var cataloguePage = 1;
async function loadCatalogue(page) {
  page = page || 1;
  cataloguePage = page;
  var el = document.getElementById('catalogue-list');
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.services.loading');
  var catFilter = document.getElementById('cat-filter').value;
  var url = '/v1/catalogue/actions?page=' + page + '&per_page=20';
  if (catFilter) url += '&category=' + catFilter;
  try {
    var resp = await fetch(NODE_URL + url);
    var data = await resp.json();
    var actions = data && data.data && data.data.actions ? data.data.actions : (data && data.data ? [data.data].flat() : []);
    if (actions.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.services.catalogueEmpty') + '</div>'; return; }
    var html = '';
    actions.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.display_name || a.id) + '</div>'
        + '<span class="badge badge-info">' + escHtml(a.category || 'general') + '</span></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>'
        + '<div class="card-subtitle" style="margin-top:.3rem">'
        + t('profile.work.provider') + ': ' + escHtml(a.provider_gaii || 'unknown')
        + (a.pricing && a.pricing.amount ? ' &bull; ' + t('profile.services.price') + ': <strong>' + a.pricing.amount + '</strong> ' + t('profile.stats.morsels').toLowerCase() + '/' + (a.pricing.unit || 'call') : ' &bull; ' + t('profile.services.free'))
        + '</div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.services.catalogueError') + '</div>'; }
}

// ── Boards ──
async function loadBoards() {
  var el = document.getElementById('boards-list');
  try {
    var data = await apiFetch('/v1/boards/subscriptions');
    var subs = data && data.data && data.data.subscriptions ? data.data.subscriptions : [];
    if (subs.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.boards.empty') + '</div>'; return; }
    var html = '';
    subs.forEach(function(s) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(s.board_id || s.boardId) + '</div>'
        + '<span class="badge badge-success">' + t('profile.boards.mine') + '</span></div>'
        + (s.filters ? '<div class="card-subtitle">Filters: ' + escHtml(JSON.stringify(s.filters)) + '</div>' : '')
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.boards.error') + '</div>'; }
}

async function loadAllBoards() {
  var el = document.getElementById('boards-browse-list');
  if (!el) return;
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.boards.browseLoading');
  try {
    var resp = await fetch(NODE_URL + '/v1/catalogue/boards');
    var data = await resp.json();
    var boards = data && data.data && data.data.boards ? data.data.boards : [];
    if (boards.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.boards.browseEmpty') + '</div>'; return; }
    var html = '';
    boards.forEach(function(b) {
      html += '<div class="card" style="cursor:pointer" onclick="viewBoard(\\'' + escHtml(b.id) + '\\', \\'' + escHtml(b.name || b.id).replace(/'/g, "\\\\'") + '\\')">'
        + '<div class="card-header"><div class="card-title">' + escHtml(b.name || b.id) + '</div>'
        + '<span class="badge ' + (b.visibility === 'public' ? 'badge-success' : 'badge-warn') + '">' + escHtml(b.visibility || 'public') + '</span></div>'
        + (b.description ? '<div class="card-subtitle">' + escHtml(b.description) + '</div>' : '')
        + '<div style="margin-top:.5rem"><button class="btn-sm" onclick="event.stopPropagation();subscribeBoard(\\'' + escHtml(b.id) + '\\')">' + t('profile.boards.subscribe') + '</button></div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.boards.browseError') + '</div>'; }
}

async function viewBoard(boardId, boardName) {
  var el = document.getElementById('boards-browse-list');
  el.innerHTML = '<div style="margin-bottom:1rem"><button class="btn-outline" onclick="loadAllBoards()">&larr; ' + t('profile.boards.backToBoards') + '</button> <strong>' + escHtml(boardName) + '</strong></div>'
    + '<div class="create-form" style="margin-bottom:1rem"><div class="form-row"><label>' + t('profile.boards.newPost') + '</label><textarea id="board-post-content" class="input-field" rows="2" placeholder="' + t('profile.boards.postPlaceholder') + '"></textarea></div>'
    + '<div class="form-actions"><button class="btn-primary" onclick="createPost(\\'' + escHtml(boardId) + '\\')">' + t('profile.boards.postBtn') + '</button></div></div>'
    + '<div id="board-posts"><span class="spinner"></span> ' + t('profile.boards.postsLoading') + '</div>';

  try {
    var resp = await fetch(NODE_URL + '/v1/boards/' + encodeURIComponent(boardId) + '/posts');
    var data = await resp.json();
    var posts = data && data.data && data.data.posts ? data.data.posts : [];
    var postsEl = document.getElementById('board-posts');
    if (posts.length === 0) { postsEl.innerHTML = '<div class="empty">' + t('profile.boards.postsEmpty') + '</div>'; return; }
    var html = '';
    posts.forEach(function(p) {
      html += '<div class="post-card">'
        + '<div class="post-content">' + escHtml(p.content || p.body || '') + '</div>'
        + '<div class="post-meta"><span>' + escHtml(p.author_gaii || p.gaii || 'anonymous') + '</span>'
        + '<span>' + (p.created_at ? new Date(p.created_at).toLocaleString() : '') + '</span></div>'
        + '<div class="post-reactions">';
      var emojis = ['\\u{1F44D}', '\\u{2764}\\u{FE0F}', '\\u{1F525}', '\\u{2B50}', '\\u{1F602}'];
      emojis.forEach(function(emoji) {
        var count = p.reactions && p.reactions[emoji] ? p.reactions[emoji].length : 0;
        html += '<button class="reaction-btn" onclick="reactToPost(\\'' + escHtml(boardId) + '\\', \\'' + escHtml(p.id || p.postId) + '\\', \\'' + emoji + '\\')">' + emoji + (count > 0 ? ' ' + count : '') + '</button>';
      });
      html += '</div></div>';
    });
    postsEl.innerHTML = html;
  } catch(e) { document.getElementById('board-posts').innerHTML = '<div class="empty">' + t('profile.boards.postsError') + '</div>'; }
}

async function createPost(boardId) {
  var content = document.getElementById('board-post-content').value.trim();
  if (!content) { showToast(t('profile.boards.writeFirst'), true); return; }
  try {
    await session.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    showToast(t('profile.boards.posted'));
    document.getElementById('board-post-content').value = '';
    viewBoard(boardId, boardId);
  } catch(e) { showToast(t('profile.error'), true); }
}

async function reactToPost(boardId, postId, emoji) {
  try {
    await session.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: emoji })
    });
    viewBoard(boardId, boardId);
  } catch(e) { showToast(t('profile.error'), true); }
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
    if (mine.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.apps.empty') + '</div>'; return; }
    var html = '';
    mine.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.filename || a.name) + '</div>'
        + '<span class="badge badge-info">' + escHtml(a.content_type || 'html') + '</span></div>'
        + '<div class="card-subtitle"><a href="' + escHtml(NODE_URL + '/v1/apps/' + (a.owner || session.owner) + '/' + (a.filename || a.name)) + '" target="_blank">' + t('profile.apps.download') + ' / Open</a>'
        + (a.size ? ' &bull; ' + Math.round(a.size/1024) + ' KB' : '')
        + '</div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.apps.error') + '</div>'; }
}

function toggleUploadForm() {
  var el = document.getElementById('upload-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function loadAllApps() {
  var el = document.getElementById('apps-gallery-list');
  if (!el) return;
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.apps.galleryLoading');
  try {
    var resp = await fetch(NODE_URL + '/v1/apps');
    var data = await resp.json();
    var apps = data && data.data && data.data.apps ? data.data.apps : [];
    if (apps.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.apps.galleryEmpty') + '</div>'; return; }
    var html = '<div class="app-grid">';
    apps.forEach(function(a) {
      var screenshotUrl = a.screenshot_url ? (NODE_URL + a.screenshot_url) : null;
      html += '<div class="app-card">'
        + '<div class="app-screenshot">'
        + (screenshotUrl
          ? '<img src="' + escHtml(screenshotUrl) + '" alt="' + escHtml(a.filename) + '" onerror="this.parentElement.innerHTML=\\'<div class=placeholder>\\u{1F4F1}</div>\\'">'
          : '<div class="placeholder">\\u{1F4F1}</div>')
        + '</div>'
        + '<div class="app-info"><div class="app-name">' + escHtml(a.filename) + '</div>'
        + '<div class="app-meta">' + escHtml(a.owner) + ' &bull; ' + Math.round((a.size || 0) / 1024) + ' KB'
        + (a.protected ? ' &bull; \\u{1F512} ' + t('profile.apps.protected') : '') + '</div>'
        + '<div style="margin-top:.5rem"><a href="' + escHtml(NODE_URL + (a.download_url || '/v1/apps/' + a.owner + '/' + a.filename)) + '" class="btn-sm" style="text-decoration:none;display:inline-block">' + t('profile.apps.download') + '</a></div>'
        + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.apps.galleryError') + '</div>'; }
}

async function uploadApp() {
  var fileInput = document.getElementById('app-file');
  var ssInput = document.getElementById('app-screenshot');
  var codeInput = document.getElementById('app-access-code');

  if (!fileInput.files.length) { showToast(t('profile.apps.selectFile'), true); return; }
  var file = fileInput.files[0];

  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result.split(',')[1];
    var body = {
      filename: file.name,
      content: base64,
      mime_type: file.type || 'text/html',
    };
    var code = codeInput.value.trim();
    if (code) body.access_code = code;

    // Handle screenshot
    if (ssInput.files.length) {
      var ssReader = new FileReader();
      ssReader.onload = async function() {
        body.screenshot = ssReader.result.split(',')[1];
        body.screenshot_mime_type = ssInput.files[0].type || 'image/png';
        await doUpload(body);
      };
      ssReader.readAsDataURL(ssInput.files[0]);
    } else {
      await doUpload(body);
    }
  };
  reader.readAsDataURL(file);
}

async function doUpload(body) {
  try {
    var resp = await session.fetch('/v1/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.apps.uploaded'));
      document.getElementById('app-file').value = '';
      document.getElementById('app-screenshot').value = '';
      document.getElementById('app-access-code').value = '';
      document.getElementById('upload-form').style.display = 'none';
      loadApps();
    } else {
      showToast(t('profile.apps.uploadFailed') + ': ' + (resp && resp.error ? resp.error.message : t('profile.unknownError')), true);
    }
  } catch(e) { showToast(t('profile.apps.uploadFailed'), true); }
}

// ── Federation ──
async function loadFederation() {
  var el = document.getElementById('federation-area');
  try {
    var resp = await fetch(NODE_URL + '/v1/federation/directory');
    var data = await resp.json();
    var peers = data && data.data && data.data.peers ? data.data.peers : [];
    if (peers.length === 0) {
      el.innerHTML = '<div class="empty">' + t('profile.federation.empty') + '</div>';
      return;
    }
    var html = '<div class="section-title" style="margin-top:0">' + t('profile.federation.peers') + '</div>';
    peers.forEach(function(p) {
      var alive = p.status === 'active' || p.alive;
      html += '<div class="card"><div class="peer-card">'
        + '<div><div class="card-title">' + escHtml(p.node_id || p.nodeId || p.url) + '</div>'
        + '<div class="card-subtitle">' + escHtml(p.url || '') + '</div></div>'
        + '<div class="peer-status"><span class="peer-dot ' + (alive ? 'alive' : 'dead') + '"></span>'
        + '<span style="font-size:.8rem;color:' + (alive ? 'var(--success)' : 'var(--danger)') + '">' + (alive ? t('profile.federation.online') : t('profile.federation.offline')) + '</span>'
        + '</div></div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.federation.error') + '</div>'; }
}

// ── Agent CTA ──
function updateAgentPrompt() {
  var el = document.getElementById('agent-connect-prompt');
  if (!el || !session) return;
  var ownerName = session.owner || 'unknown';
  var ghii = session.ghii || (ownerName + '@' + (window.AIMEAT && window.AIMEAT.auth ? window.AIMEAT.auth.nodeId : 'unknown'));
  var nodeUrl = NODE_URL;
  el.textContent = 'I want you to register a new automation agent on my AIMEAT node.\\n\\n'
    + 'IMPORTANT: I already have an account. Do NOT create a new owner. Use my existing identity.\\n\\n'
    + 'My GHII: ' + ghii + '\\n'
    + 'My owner name (for API calls): ' + ownerName + '\\n'
    + 'Node URL: ' + nodeUrl + '\\n\\n'
    + 'Steps:\\n'
    + '1. First, authenticate as my owner:\\n'
    + '   POST ' + nodeUrl + '/v1/auth/token\\n'
    + '   You need my owner private key to sign (ownerName + nodeId + timestamp) with Ed25519.\\n'
    + '   My owner key is stored in my browser (I will provide it if needed).\\n\\n'
    + '2. Register a new agent under my account:\\n'
    + '   POST ' + nodeUrl + '/v1/agents\\n'
    + '   Header: Authorization: Bearer <owner_jwt>\\n'
    + '   Body: {"name": "<choose-a-name>", "owner": "' + ownerName + '", "display_name": "<Your Agent Name>", "description": "<What this agent does>"}\\n'
    + '   The new agent will get a GAII in the format: <name>#' + ghii + '\\n'
    + '   SAVE the private_key from the response!\\n\\n'
    + '3. Authenticate as the new agent:\\n'
    + '   Sign (gaii + timestamp) with the agent\\'s Ed25519 private key\\n'
    + '   POST ' + nodeUrl + '/v1/auth/token with {"gaii": "<agent-gaii>", "timestamp": "<iso>", "signature": "<sig>"}\\n\\n'
    + '4. You\\'re connected! Use the JWT to access:\\n'
    + '   GET ' + nodeUrl + '/v1/catalogue \\u2014 Browse services\\n'
    + '   POST ' + nodeUrl + '/v1/memory \\u2014 Store/retrieve memories\\n'
    + '   GET ' + nodeUrl + '/v1/wallet \\u2014 Check balance\\n'
    + '   Full API spec: ' + nodeUrl + '/v1/spec\\n'
    + '   Operating instructions: ' + nodeUrl + '/v1/agents/me/handbook';
}

function copyAgentPrompt() {
  var el = document.getElementById('agent-connect-prompt');
  if (!el) return;
  copyToClipboard(el.textContent).then(function() {
    var btn = document.querySelector('.copy-prompt-btn');
    btn.textContent = '\\u{2705} ' + t('profile.agents.copied');
    setTimeout(function(){ btn.textContent = t('profile.agents.copyPrompt'); }, 2000);
  });
}

function toggleInstructions(btn) {
  var el = document.getElementById('platform-instructions');
  var expanded = el.classList.toggle('expanded');
  var arrow = btn.querySelector('span');
  arrow.style.transform = expanded ? 'rotate(180deg)' : '';
  if (expanded && !el.dataset.loaded) {
    el.dataset.loaded = '1';
    renderPlatformPanels();
  }
}

function renderPlatformPanels() {
  var panels = {
    windows: '<h4>OpenClaw (Recommended)</h4>'
      + '<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \\u2014 perfect for AIMEAT.</p>'
      + '<p>Windows requires WSL2. Open PowerShell as Admin:</p>'
      + '<ol><li>Install WSL2: <code>wsl --install</code> (restart if prompted)</li>'
      + '<li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>',
    mac: '<h4>OpenClaw (Recommended)</h4>'
      + '<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \\u2014 perfect for AIMEAT.</p>'
      + '<ol><li>Install Node.js 22+: <code>brew install node</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>Alternative: one-liner install</h4>'
      + '<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>',
    linux: '<h4>OpenClaw (Recommended)</h4>'
      + '<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \\u2014 perfect for AIMEAT.</p>'
      + '<ol><li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>Alternative: one-liner install</h4>'
      + '<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>',
    wsl2: '<h4>Setup WSL2 (if not already)</h4>'
      + '<ol><li>Open PowerShell as Admin: <code>wsl --install</code></li>'
      + '<li>Restart and set up your Linux username/password</li></ol>'
      + '<h4>Install OpenClaw</h4>'
      + '<ol><li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>',
    android: '<h4>Option A: Termux (CLI only)</h4>'
      + '<ol><li>Install <a href="https://f-droid.org/packages/com.termux/" target="_blank">Termux from F-Droid</a> (not Play Store)</li>'
      + '<li>Run: <code>pkg update && pkg install nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>Option B: andClaw (on-device with camera/mic)</h4>'
      + '<p><a href="https://play.google.com/store/apps/details?id=com.coderred.andclaw" target="_blank">andClaw</a> runs the OpenClaw gateway directly on your phone \\u2014 no server needed. '
      + 'It gives the agent access to your camera, microphone, screen, and sensors.</p>'
      + '<p><strong>\\u26A0\\u{FE0F} Heads up:</strong> This means an AI agent can see through your camera and hear your mic. '
      + 'Only use this if you understand the privacy implications and trust your LLM provider.</p>'
      + '<h4>Alternative: Use a cloud server</h4>'
      + '<p>Run OpenClaw on a remote server (see AWS/Cloud tab) and connect via WhatsApp or Telegram.</p>',
    aws: '<h4>Quick EC2 Setup</h4>'
      + '<ol><li>Launch an EC2 instance (Amazon Linux 2023 or Ubuntu, t3.micro is fine)</li>'
      + '<li>SSH in: <code>ssh -i key.pem ec2-user@your-ip</code></li>'
      + '<li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>For a persistent agent</h4>'
      + '<ol><li>Use <code>tmux</code> or <code>screen</code> to keep the session alive</li>'
      + '<li>Or set up a systemd service for always-on operation</li></ol>'
  };

  var html = '';
  Object.keys(panels).forEach(function(key) {
    html += '<div class="platform-panel' + (key === 'windows' ? ' active' : '') + '" id="platform-' + key + '">'
      + '<div class="platform-content">' + panels[key] + '</div></div>';
  });
  document.getElementById('platform-panels').innerHTML = html;
}

// Platform tab clicks
document.getElementById('platform-tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.platform-tab');
  if (!btn) return;
  var platform = btn.dataset.platform;
  document.querySelectorAll('.platform-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.platform === platform); });
  document.querySelectorAll('.platform-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'platform-' + platform); });
});

// ── Access Codes ──
async function loadAccess() {
  var el = document.getElementById('access-area');
  var html = '';

  // Session info
  html += '<h3 style="color:var(--love1);margin-bottom:.75rem">\\u{1F4BB} ' + t('profile.access.session') + '</h3>';
  html += '<div class="card">'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.owner') + '</span><span>' + escHtml(session.owner || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.ghii') + '</span><span>' + escHtml(session.ghii || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.agentGaii') + '</span><span>' + escHtml(session.gaii || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.node') + '</span><span>' + escHtml(NODE_URL) + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.jwtValid') + '</span><span>' + (session.valid ? '<span class="badge badge-success">' + t('profile.access.yes') + '</span>' : '<span class="badge badge-danger">' + t('profile.access.expired') + '</span>') + '</span></div>'
    + '</div>';

  // Public key
  html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\\u{1F510} ' + t('profile.access.publicKey') + '</h3>';
  html += '<div class="card"><div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted)">' + escHtml(session.publicKey || 'N/A') + '</div></div>';

  // Owner key info
  var ownerKey = localStorage.getItem('aimeat_owner_key');
  if (ownerKey) {
    html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\\u{1F5DD}\\u{FE0F} ' + t('profile.access.ownerKey') + '</h3>';
    html += '<div class="card" style="border-color:var(--warn);cursor:pointer" onclick="copyToClipboard(localStorage.getItem(&quot;aimeat_owner_key&quot;)).then(function(){showToast(&quot;' + t('profile.access.keyCopied').replace(/"/g, '&quot;') + '&quot;)})">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted);filter:blur(4px);transition:filter .2s" '
      + 'onmouseenter="this.style.filter=&quot;none&quot;" onmouseleave="this.style.filter=&quot;blur(4px)&quot;">'
      + escHtml(ownerKey)
      + '</div><span class="badge badge-warn">' + t('profile.access.hoverReveal') + '</span></div>'
      + '<div style="font-size:.75rem;color:var(--warn);margin-top:.5rem">\\u26A0 ' + t('profile.access.keepSafe') + '</div>'
      + '</div>';
  }

  // MCP endpoint
  html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\\u{1F517} ' + t('profile.access.mcpEndpoint') + '</h3>';
  html += '<div class="card"><div style="font-family:monospace;font-size:.85rem;color:var(--love3)">' + escHtml(NODE_URL + '/v1/mcp') + '</div>'
    + '<div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">' + t('profile.access.mcpDesc') + '</div></div>';

  el.innerHTML = html;
}

// ── Personal Nodes ──
var nodesData = [];

async function loadNodes() {
  var el = document.getElementById('nodes-list');
  try {
    var data = await apiFetch('/v1/personal/status');
    var nodes = [];
    if (data && data.data && data.data.node_id) {
      nodes.push(data.data);
    }
    if (nodes.length === 0 && data && data.error && data.error.code === 'NOT_FOUND') {
      nodes = [];
    }
    nodesData = nodes;
    document.getElementById('stat-nodes').textContent = nodes.length;

    if (nodes.length === 0) {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.empty') + '</div>';
      return;
    }

    var html = '';
    nodes.forEach(function(node, idx) {
      var statusClass = node.status || 'offline';
      var statusLabel = t('profile.nodes.' + statusClass) || statusClass;
      var visBadge = node.visibility === 'public'
        ? '<span class="badge badge-success">' + t('profile.nodes.public') + '</span>'
        : '<span class="badge badge-muted">' + t('profile.nodes.private') + '</span>';
      var agentCount = node.agent_gaiis ? node.agent_gaiis.length : 0;
      var agentWord = agentCount === 1 ? t('profile.nodes.agent') : t('profile.nodes.agents');
      var mailboxCount = node.mailbox ? node.mailbox.items : 0;
      var tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';

      html += '<div class="pn-card" id="pn-' + idx + '">'
        + '<div class="pn-header" onclick="toggleNodeCard(' + idx + ')">'
        + '<div class="pn-header-left">'
        + '<div class="pn-status-dot ' + statusClass + '"></div>'
        + '<span class="pn-name">' + escHtml(node.node_id) + '</span>'
        + '</div>'
        + '<div class="pn-badges">'
        + visBadge
        + ' <span class="badge badge-' + (statusClass === 'online' ? 'success' : statusClass === 'degraded' ? 'warn' : 'danger') + '">' + statusLabel + '</span>'
        + ' <span class="pn-arrow" id="pn-arrow-' + idx + '">\\u25BC</span>'
        + '</div></div>'
        + '<div class="pn-quick">' + agentCount + ' ' + agentWord + ' \\u2502 ' + t('profile.nodes.mailboxItems') + ': ' + mailboxCount + ' ' + t('profile.nodes.items') + '</div>'
        + '<div class="pn-details" id="pn-details-' + idx + '">';

      // Tunnel URL
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.tunnelUrl') + '</span>'
        + '<span class="pn-detail-value" style="display:flex;align-items:center;gap:.5rem"><code style="font-size:.75rem">' + escHtml(tunnelUrl) + '</code>'
        + '<button onclick="copyTunnelUrl()" style="padding:2px 8px;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--love4);cursor:pointer;font-size:.7rem">' + t('profile.nodes.copyUrl') + '</button></span></div>';

      // Agents
      html += '<div style="padding:.5rem 0"><span class="pn-detail-label">' + t('profile.nodes.agentList') + '</span>';
      if (node.agent_gaiis && node.agent_gaiis.length > 0) {
        html += '<div class="pn-agent-list">';
        node.agent_gaiis.forEach(function(g) { html += '<div class="pn-agent-item">' + escHtml(g) + '</div>'; });
        html += '</div>';
      } else {
        html += '<div style="font-size:.8rem;color:var(--muted);margin-top:.3rem">' + t('profile.nodes.noAgents') + '</div>';
      }
      html += '</div>';

      // Mailbox
      var mbUsed = node.mailbox ? node.mailbox.used_bytes : 0;
      var mbQuota = node.mailbox ? node.mailbox.quota_bytes : 0;
      var mbUsedMB = (mbUsed / 1024 / 1024).toFixed(1);
      var mbQuotaMB = (mbQuota / 1024 / 1024).toFixed(0);
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.mailbox') + '</span>'
        + '<span class="pn-detail-value">' + mailboxCount + ' ' + t('profile.nodes.items') + ' (' + mbUsedMB + ' ' + t('profile.nodes.mailboxOf') + ' ' + mbQuotaMB + ' MB)</span></div>';

      // Last seen
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.lastSeen') + '</span>'
        + '<span class="pn-detail-value">' + escHtml(node.last_seen ? timeAgo(node.last_seen) : '-') + '</span></div>';

      // Visibility toggle
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.visibility') + '</span>'
        + '<div class="pn-vis-toggle">'
        + '<button class="pn-vis-btn ' + (node.visibility !== 'public' ? 'active' : '') + '" onclick="setNodeVis(\\'' + escHtml(node.node_id) + '\\',\\'private\\')">' + t('profile.nodes.private') + '</button>'
        + '<button class="pn-vis-btn ' + (node.visibility === 'public' ? 'active' : '') + '" onclick="setNodeVis(\\'' + escHtml(node.node_id) + '\\',\\'public\\')">' + t('profile.nodes.public') + '</button>'
        + '</div></div>';

      // Setup instructions
      html += '<div style="margin-top:.75rem"><button class="expand-btn" onclick="toggleSetup(' + idx + ')" style="font-size:.8rem;padding:6px 12px">' + t('profile.nodes.setupTitle') + ' <span style="transition:transform .2s">\\u25BC</span></button>'
        + '<div class="pn-setup" id="pn-setup-' + idx + '">'
        + '<ol>'
        + '<li>' + t('profile.nodes.setupStep1') + '</li>'
        + '<li>' + t('profile.nodes.setupStep2') + '</li>'
        + '<li>' + t('profile.nodes.setupStep3') + '</li>'
        + '<li>' + t('profile.nodes.setupStep4') + '</li>'
        + '</ol>'
        + '<a href="/docs/personal-node-setup-guide.md" target="_blank" style="color:var(--love1);font-size:.8rem">' + t('profile.nodes.setupDocs') + ' \\u2192</a>'
        + '</div></div>';

      // Detach button
      html += '<button class="pn-detach-btn" onclick="detachNode(\\'' + escHtml(node.node_id) + '\\')">' + t('profile.nodes.detachBtn') + '</button>';

      html += '</div></div>';
    });

    el.innerHTML = html;
  } catch(e) {
    document.getElementById('stat-nodes').textContent = '0';
    if (e && e.message && e.message.includes('NOT_FOUND')) {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.empty') + '</div>';
    } else {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.error') + '</div>';
    }
  }
}

function copyTunnelUrl() {
  var url = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';
  copyToClipboard(url).then(function() { showToast(t('profile.nodes.copied')); });
}

function toggleNodeCard(idx) {
  var details = document.getElementById('pn-details-' + idx);
  var arrow = document.getElementById('pn-arrow-' + idx);
  if (!details) return;
  details.classList.toggle('open');
  if (arrow) arrow.classList.toggle('open');
}

function toggleSetup(idx) {
  var el = document.getElementById('pn-setup-' + idx);
  if (el) el.classList.toggle('open');
}

function toggleAddNodeForm() {
  var form = document.getElementById('add-node-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function timeAgo(iso) {
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
  return Math.floor(ms / 86400000) + 'd ago';
}

async function setNodeVis(nodeId, vis) {
  try {
    await session.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: vis }),
    });
    showToast(t('profile.nodes.visUpdated'));
    loadNodes();
  } catch(e) {
    showToast(t('profile.error'), true);
  }
}

async function registerNode() {
  var nodeId = document.getElementById('node-id-input').value.trim();
  if (!nodeId) { showToast(t('profile.nodes.registerFailed'), true); return; }
  if (!nodeId.startsWith('personal-')) nodeId = 'personal-' + nodeId;

  var visRadio = document.querySelector('input[name="node-vis"]:checked');
  var visibility = visRadio ? visRadio.value : 'private';

  var gaiisRaw = document.getElementById('node-gaiis-input').value.trim();
  var agentGaiis = gaiisRaw ? gaiisRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

  try {
    var resp = await session.fetch('/v1/personal/anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: nodeId,
        owner_name: session.owner,
        public_key: session.publicKey || 'placeholder',
        agent_gaiis: agentGaiis,
        visibility: visibility,
      }),
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.nodes.registered'));
      toggleAddNodeForm();
      document.getElementById('node-id-input').value = '';
      document.getElementById('node-gaiis-input').value = '';
      loadNodes();
    } else {
      showToast((resp && resp.error && resp.error.message) || t('profile.nodes.registerFailed'), true);
    }
  } catch(e) {
    showToast(t('profile.nodes.registerFailed'), true);
  }
}

async function detachNode(nodeId) {
  if (!confirm(t('profile.nodes.detachConfirm'))) return;
  try {
    await session.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), { method: 'DELETE' });
    showToast(t('profile.nodes.detached.toast'));
    loadNodes();
  } catch(e) {
    showToast(t('profile.error'), true);
  }
}
`;
