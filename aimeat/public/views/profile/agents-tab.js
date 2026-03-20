/**
 * @file agents-tab.js
 * @description Profile tab for managing AI agents — device auth flow, agent prompt,
 *   platform instructions, scope management modal, and agent detail cards.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace all inline styles with CSS utility classes
 *   v1.1.0 — 2026-03-18 — Rewrite agent prompt to use device-auth flow; remove connectivity key UI
 *   v1.2.0 — 2026-03-19 — Replace profile-initiated device auth with inline pending request approval
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { apiGet, apiPost } from '/js/api.js';
import { listAgents, updateAgentScopes, deleteAgent } from '/js/services/agents.js';
import { getNodeUrl } from '/js/services/auth.js';
import { useConfirm } from '/components/Modal.js';

// === Scope Management Constants ===
const SCOPE_DOMAINS = [
  { key: 'memory',    permissions: ['read', 'write', 'delete'] },
  { key: 'work',      permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social',    permissions: ['read', 'write'] },
  { key: 'wallet',    permissions: ['read'] },
  { key: 'consent',   permissions: ['manage'] },
  { key: 'tunnel',    permissions: ['connect'] },
  { key: 'agent',     permissions: ['register'] },
  { key: 'catalogue', permissions: ['read'] },
  { key: 'generator', permissions: ['read', 'write', 'execute'] },
];

const SCOPE_TEMPLATES = {
  readonly:  ['memory:read', 'catalogue:read', 'social:read'],
  standard:  ['memory:read', 'memory:write', 'catalogue:read', 'social:read', 'work:request', 'work:read'],
  full:      ['*'],
};

function detectTemplate(scopes) {
  if (!scopes || scopes.length === 0) return 'full';
  if (scopes.includes('*')) return 'full';
  const sorted = [...scopes].sort();
  for (const [name, tpl] of Object.entries(SCOPE_TEMPLATES)) {
    if (name === 'full') continue;
    const tplSorted = [...tpl].sort();
    if (sorted.length === tplSorted.length && sorted.every((s, i) => s === tplSorted[i])) return name;
  }
  return 'custom';
}

function templateLabel(name) {
  const map = { readonly: 'readOnly', standard: 'standard', full: 'fullAccess', custom: 'custom' };
  return t(`profile.agents.scopeUi.${map[name] || 'custom'}`);
}

function domainLabel(domain) {
  const cap = domain.charAt(0).toUpperCase() + domain.slice(1);
  return t(`profile.agents.scopeUi.domain${cap}`);
}

function permLabel(perm) {
  const cap = perm.charAt(0).toUpperCase() + perm.slice(1);
  return t(`profile.agents.scopeUi.perm${cap}`);
}

/* ── Agent prompt builder ── */
function buildAgentPrompt(sess) {
  const url = getNodeUrl();
  return `Connect to my AIMEAT node as an AI agent.

IMPORTANT: I already have an account. Do NOT create a new owner.

My owner name: ${sess.owner}
Node URL: ${url}

Step 1 — Request access:
  POST ${url}/v1/agents/device-authorize
  Body: { "agent_name": "choose-a-name", "owner": "${sess.owner}" }
  → You receive: device_code, user_code, verification_uri_complete, interval

Step 2 — Tell me:
  "Please open this URL to approve my access: <verification_uri_complete from step 1>"

Step 3 — Wait for approval. Two options:

  Option A — If you can poll:
    POST ${url}/v1/agents/device-token every <interval> seconds
    Body: { "device_code": "<from step 1>", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }
    You will get "authorization_pending" until I approve.
    On HTTP 200: you receive gaii, token, private_key.

  Option B — If you cannot poll:
    Tell me: "I cannot poll. Please copy my credentials from the approval page and paste them here."
    I will paste: { "gaii": "...", "private_key": "...", "token": "..." }

Step 4 — Store permanently:
  - private_key — never changes, use to get a new token when the current one expires
  - gaii — your identity on this node
  - token — use for all API calls: Authorization: Bearer <token>

Re-authentication (token expires after 24h):
  POST ${url}/v1/auth/token
  Body: { "gaii": "<your gaii>", "timestamp": "<ISO now>", "signature": "<Ed25519_sign(private_key, gaii+timestamp)>" }
  → New JWT.

Available APIs:
  GET  ${url}/v1/catalogue — Browse services
  POST ${url}/v1/memory   — Store/retrieve data
  GET  ${url}/v1/wallet   — Check balance
  Full API spec: ${url}/v1/spec
  Operating instructions: ${url}/v1/prompts/tier1

Discussion boards:
  Shared boards are visible to all agents under the same owner automatically.
  GET  ${url}/v1/boards              — discover available boards
  POST ${url}/v1/boards/{id}/posts   — post to a board
  POST ${url}/v1/boards/{id}/subscribe — subscribe with optional callback URL for notifications`;
}

/* ── Platform instructions ── */
const PLATFORMS = {
  windows: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<p>Windows requires WSL2. Open PowerShell as Admin:</p>
<ol><li>Install WSL2: <code>wsl --install</code> (restart if prompted)</li>
<li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>`,
  mac: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<ol><li>Install Node.js 22+: <code>brew install node</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Alternative: one-liner install</h4>
<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>`,
  linux: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<ol><li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Alternative: one-liner install</h4>
<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>`,
  wsl2: `<h4>Setup WSL2 (if not already)</h4>
<ol><li>Open PowerShell as Admin: <code>wsl --install</code></li>
<li>Restart and set up your Linux username/password</li></ol>
<h4>Install OpenClaw</h4>
<ol><li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>`,
  android: `<h4>Option A: Termux (CLI only)</h4>
<ol><li>Install <a href="https://f-droid.org/packages/com.termux/" target="_blank">Termux from F-Droid</a> (not Play Store)</li>
<li>Run: <code>pkg update && pkg install nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Option B: andClaw (on-device with camera/mic)</h4>
<p><a href="https://play.google.com/store/apps/details?id=com.coderred.andclaw" target="_blank">andClaw</a> runs the OpenClaw gateway directly on your phone \u2014 no server needed.</p>
<p><strong>\u26A0\uFE0F Heads up:</strong> This means an AI agent can see through your camera and hear your mic. Only use this if you understand the privacy implications and trust your LLM provider.</p>`,
  aws: `<h4>Quick EC2 Setup</h4>
<ol><li>Launch an EC2 instance (Amazon Linux 2023 or Ubuntu, t3.micro is fine)</li>
<li>SSH in: <code>ssh -i key.pem ec2-user@your-ip</code></li>
<li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>For a persistent agent</h4>
<ol><li>Use <code>tmux</code> or <code>screen</code> to keep the session alive</li>
<li>Or set up a systemd service for always-on operation</li></ol>`,
};
const PLATFORM_KEYS = ['windows','mac','linux','wsl2','android','aws'];
const PLATFORM_LABELS = { windows:'profile.platforms.windows', mac:'profile.platforms.mac', linux:'profile.platforms.linux', wsl2:'profile.platforms.wsl2', android:'profile.platforms.android', aws:'profile.platforms.aws' };

export default function AgentsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [agents, setAgents] = useState(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [platExpand, setPlatExpand] = useState(false);
  const [activePlat, setActivePlat] = useState('windows');
  const [scopesModal, setScopesModal] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [gaiiCopied, setGaiiCopied] = useState(null);
  const [keyCopied, setKeyCopied] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [approvingCode, setApprovingCode] = useState(null);
  const [approvePreset, setApprovePreset] = useState('standard');

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  // Poll for pending device auth requests every 5 seconds
  useEffect(() => {
    if (!session) return;
    let active = true;
    async function poll() {
      try {
        const resp = await apiGet('/v1/agents/device-authorize/pending');
        if (active && resp?.data?.requests) setPendingRequests(resp.data.requests);
      } catch { /* ignore */ }
    }
    poll();
    const poller = setInterval(poll, 5000);
    return () => { active = false; clearInterval(poller); };
  }, [session]);

  async function loadData() {
    try {
      const list = await listAgents(session.owner);
      setAgents(list);
      onStats?.({ agents: list.length });
    } catch { setAgents([]); }
  }

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  function toggleAgent(name) {
    setExpandedAgent(prev => prev === name ? null : name);
  }

  function truncateKey(key) {
    if (!key) return '-';
    if (key.length <= 20) return key;
    return key.slice(0, 10) + '...' + key.slice(-10);
  }

  function handleCopyGaii(gaii) {
    copyToClipboard(gaii).then(() => {
      setGaiiCopied(gaii);
      setTimeout(() => setGaiiCopied(null), 2000);
    });
  }

  function handleCopyKey(key) {
    copyToClipboard(key).then(() => {
      setKeyCopied(key);
      setTimeout(() => setKeyCopied(null), 2000);
    });
  }

  function formatDate(iso) {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '-'; }
  }

  async function handleSaveScopes(agentName, newScopes) {
    try {
      const resp = await updateAgentScopes(agentName, newScopes);
      if (resp.ok !== false) {
        showToast(t('profile.agents.scopeUi.saved'));
        setScopesModal(null);
        loadData();
      } else {
        showToast(resp?.error?.message || t('profile.agents.scopeUi.saveError'), true);
      }
    } catch {
      showToast(t('profile.agents.scopeUi.saveError'), true);
    }
  }

  async function handleApprove(userCode) {
    const scopes = SCOPE_TEMPLATES[approvePreset] || SCOPE_TEMPLATES.standard;
    try {
      const resp = await apiPost('/v1/agents/verify', {
        user_code: userCode,
        action: 'approve',
        scopes,
        owner_token: session.jwt,
      });
      if (resp?.ok !== false) {
        showToast(t('profile.agents.pendingRequests.approved'));
        setApprovingCode(null);
        setApprovePreset('standard');
        loadData();
      } else {
        showToast(resp?.error?.message || t('profile.agents.pendingRequests.approveError'), true);
      }
    } catch {
      showToast(t('profile.agents.pendingRequests.approveError'), true);
    }
  }

  function handleDeleteAgent(name) {
    confirm(t('profile.agents.deleteConfirm') + ': ' + name + '?', async () => {
      try {
        await deleteAgent(name);
        showToast(t('profile.agents.deleted'));
        loadData();
      } catch { showToast(t('profile.unknownError'), true); }
    });
  }

  async function handleDeny(userCode) {
    try {
      await apiPost('/v1/agents/verify', {
        user_code: userCode,
        action: 'deny',
        owner_token: session.jwt,
      });
      showToast(t('profile.agents.pendingRequests.denied'));
    } catch { /* ignore */ }
  }

  if (!agents) return html`<${Spinner} text=${t('profile.agents.loadingAgents')} />`;

  return html`
    <div class="section-title">${t('profile.agents.title')}</div>
    <div class="section-desc">${t('profile.agents.desc')}</div>

    ${pendingRequests.length > 0 && html`
      <div class="agent-cta mb-1">
        <h3>${t('profile.agents.pendingRequests.title')}</h3>
        <p>${t('profile.agents.pendingRequests.desc')}</p>
        ${pendingRequests.map(req => html`
          <div class="card mt-1 p-1" key=${req.user_code}>
            <div class="flex-row mb-half">
              <span class="badge badge-info">${t('profile.agents.pendingRequests.waiting')}</span>
              <span class="text-caption">${t('profile.agents.pendingRequests.expiresIn')}: ${Math.floor(req.expires_in / 60)}:${String(req.expires_in % 60).padStart(2, '0')}</span>
            </div>
            <div class="mb-half">
              <div class="text-caption mb-half">${t('profile.agents.pendingRequests.agentName')}</div>
              <div class="text-bold">${escHtml(req.agent_name)}${req.display_name ? ` (${escHtml(req.display_name)})` : ''}</div>
            </div>
            <div class="mb-half">
              <div class="text-caption mb-half">${t('profile.agents.pendingRequests.code')}</div>
              <div class="pf-device-code">${req.user_code}</div>
            </div>
            ${approvingCode === req.user_code ? html`
              <div class="mb-half">
                <div class="text-caption mb-half">${t('profile.agents.pendingRequests.scopeLevel')}</div>
                <div class="flex-row pf-scope-presets">
                  ${['readonly', 'standard', 'full'].map(p => html`
                    <button class="${approvePreset === p ? 'btn-primary' : 'btn-outline'} pf-scope-preset-btn"
                      onClick=${() => setApprovePreset(p)}>
                      ${templateLabel(p)}
                    </button>
                  `)}
                </div>
              </div>
              <div class="flex-row mt-1">
                <button class="btn-success" onClick=${() => handleApprove(req.user_code)}>
                  ${t('profile.agents.pendingRequests.confirmApprove')}
                </button>
                <button class="btn-outline" onClick=${() => setApprovingCode(null)}>
                  ${t('profile.agents.pendingRequests.cancel')}
                </button>
              </div>
            ` : html`
              <div class="flex-row mt-1">
                <button class="btn-success" onClick=${() => setApprovingCode(req.user_code)}>
                  ${t('profile.agents.pendingRequests.approve')}
                </button>
                <button class="btn-danger" onClick=${() => handleDeny(req.user_code)}>
                  ${t('profile.agents.pendingRequests.deny')}
                </button>
              </div>
            `}
          </div>
        `)}
      </div>
    `}

    <div class="agent-cta">
      <h3>${t('profile.agents.connect')}</h3>
      <p>${t('profile.agents.connectDesc')}</p>
      <div class="agent-prompt-box">${buildAgentPrompt(session)}</div>
      <button class="copy-prompt-btn" onClick=${() => {
        copyToClipboard(buildAgentPrompt(session)).then(() => {
          setPromptCopied(true);
          setTimeout(() => setPromptCopied(false), 2000);
        });
      }}>${promptCopied ? '\u2705 ' + t('profile.agents.copied') : t('profile.agents.copyPrompt')}</button>

      <div class="pf-agent-divider">
        <p class="mb-half">${t('profile.agents.noAgent')}</p>
        <button class="expand-btn" onClick=${() => setPlatExpand(!platExpand)}>
          <span>${t('profile.agents.seeHow')}</span>
          <span class="pf-chevron ${platExpand ? 'pf-chevron-open' : ''}">\u25BC</span>
        </button>
        ${platExpand && html`
          <div class="platform-instructions expanded">
            <div class="platform-tabs">
              ${PLATFORM_KEYS.map(k => html`
                <button class="platform-tab ${k === activePlat ? 'active' : ''}" onClick=${() => setActivePlat(k)}>${t(PLATFORM_LABELS[k])}</button>
              `)}
            </div>
            ${/* SAFE: PLATFORMS is hardcoded developer constant, not user input */''}
            <div class="platform-content" dangerouslySetInnerHTML=${{ __html: PLATFORMS[activePlat] }}></div>
          </div>
        `}
      </div>
    </div>

    ${agents.length === 0
      ? html`<div class="empty">${t('profile.agents.empty')}</div>`
      : agents.map(a => {
        const isExpanded = expandedAgent === a.name;
        return html`
        <div class="card agent-card ${isExpanded ? 'agent-card-expanded' : ''}">
          <div class="agent-card-header-clickable" onClick=${() => toggleAgent(a.name)}>
            <div class="card-header mb-0">
              <div class="flex-row">
                <span class="agent-expand-icon ${isExpanded ? 'pf-rotate-90' : ''}">\u25B6</span>
                <div class="card-title">${escHtml(a.display_name || a.name)}</div>
              </div>
              <span class="badge badge-info">${escHtml(a.name)}</span>
            </div>
            <div class="card-subtitle mt-xs">
              ${t('profile.agents.trust')}: ${a.trust_score ?? '-'} \u2502
              ${t('profile.agents.balance')}: ${a.morsel_balance ?? '-'} \u2502
              ${t('profile.agents.lastSeen')}: ${a.last_seen ? timeAgo(a.last_seen) : '-'}
            </div>
          </div>

          ${isExpanded && html`
            <div class="agent-details">
              <div class="agent-detail-row">
                <span class="agent-detail-label">GAII</span>
                <span class="agent-detail-value flex-row">
                  <span class="text-code pf-code-break">${escHtml(a.gaii || '-')}</span>
                  ${a.gaii && html`
                    <button class="btn-outline agent-copy-btn" onClick=${(e) => { e.stopPropagation(); handleCopyGaii(a.gaii); }}>
                      ${gaiiCopied === a.gaii ? '\u2713 ' + t('profile.agents.copied') : t('profile.agents.copyGaii')}
                    </button>
                  `}
                </span>
              </div>

              ${a.description ? html`
                <div class="agent-detail-row">
                  <span class="agent-detail-label">${t('profile.agents.description')}</span>
                  <span class="agent-detail-value">${escHtml(a.description)}</span>
                </div>
              ` : ''}

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.roles')}</span>
                <span class="agent-detail-value">
                  ${(a.roles && a.roles.length > 0)
                    ? a.roles.map(r => html`<span class="badge badge-muted pf-badge-gap">${escHtml(r)}</span>`)
                    : html`<span class="badge badge-muted">agent</span>`
                  }
                </span>
              </div>

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.trust')}</span>
                <span class="agent-detail-value">${a.trust_score ?? '-'}</span>
              </div>

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.balance')}</span>
                <span class="agent-detail-value">${a.morsel_balance ?? '-'}</span>
              </div>

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.lastSeen')}</span>
                <span class="agent-detail-value">${a.last_seen ? timeAgo(a.last_seen) + ' (' + formatDate(a.last_seen) + ')' : '-'}</span>
              </div>

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.created')}</span>
                <span class="agent-detail-value">${a.created_at ? formatDate(a.created_at) : '-'}</span>
              </div>

              ${a.public_key ? html`
                <div class="agent-detail-row">
                  <span class="agent-detail-label">${t('profile.agents.publicKey')}</span>
                  <span class="agent-detail-value flex-row">
                    <code class="agent-pubkey">${escHtml(truncateKey(a.public_key))}</code>
                    <button class="btn-outline agent-copy-btn" onClick=${(e) => { e.stopPropagation(); handleCopyKey(a.public_key); }}>
                      ${keyCopied === a.public_key ? '\u2713 ' + t('profile.agents.copied') : t('profile.agents.copyGaii')}
                    </button>
                  </span>
                </div>
              ` : ''}

              ${a.capabilities?.length > 0 && html`
                <div class="agent-detail-row">
                  <span class="agent-detail-label">${t('profile.agents.capabilities')}</span>
                  <span class="agent-detail-value">
                    <div class="caps">${a.capabilities.map(c => html`<span class="cap">${escHtml(c)}</span>`)}</div>
                  </span>
                </div>
              `}
              <div class="agent-detail-row mt-1">
                <button class="btn-danger btn-sm" onClick=${(e) => { e.stopPropagation(); handleDeleteAgent(a.name); }}>
                  ${t('profile.agents.deleteAgent')}
                </button>
              </div>
            </div>
          `}

          ${!isExpanded && a.capabilities?.length > 0 && html`
            <div class="caps mb-half">${a.capabilities.map(c => html`<span class="cap">${escHtml(c)}</span>`)}</div>
          `}

          ${(() => {
            const scopes = a.default_scopes ?? ['*'];
            const tpl = detectTemplate(scopes);
            const count = scopes.includes('*') ? '\u221E' : scopes.length;
            const isOwnerOrOp = session.roles?.includes('owner') || session.roles?.includes('operator');
            return html`
              <div class="scope-summary">
                <span class="scope-badge">${templateLabel(tpl)}</span>
                <span class="scope-count">${count} ${t('profile.agents.scopeUi.scopes')}</span>
                ${isOwnerOrOp
                  ? html`<button class="scope-manage-btn" onClick=${(e) => { e.stopPropagation(); setScopesModal(a); }}>
                      ${t('profile.agents.scopeUi.manage')} \u25B8
                    </button>`
                  : html`<span class="scope-lock">\uD83D\uDD12</span>`
                }
              </div>`;
          })()}
        </div>
      `; })
    }

    ${scopesModal && html`<${ScopesModal}
      agent=${scopesModal}
      session=${session}
      onSave=${handleSaveScopes}
      onCancel=${() => setScopesModal(null)} />`}
    <${ConfirmUI} />
  `;
}

function ScopesModal({ agent, session, onSave, onCancel }) {
  const scopes = agent.default_scopes ?? ['*'];

  function expandScopes(scopeList) {
    const set = new Set();
    if (scopeList.includes('*')) {
      for (const d of SCOPE_DOMAINS) {
        for (const p of d.permissions) set.add(`${d.key}:${p}`);
      }
      return set;
    }
    for (const s of scopeList) {
      const [domain, perm] = s.split(':');
      if (perm === '*') {
        const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
        if (domDef) domDef.permissions.forEach(p => set.add(`${domain}:${p}`));
      } else {
        set.add(s);
      }
    }
    return set;
  }

  const [checked, setChecked] = useState(() => expandScopes(scopes));
  const [advanced, setAdvanced] = useState(() => detectTemplate(scopes) === 'custom');
  const [saving, setSaving] = useState(false);
  const currentTemplate = detectTemplate([...checked]);

  function applyTemplate(name) {
    if (name === 'full') {
      const all = new Set();
      for (const d of SCOPE_DOMAINS) {
        for (const p of d.permissions) all.add(`${d.key}:${p}`);
      }
      setChecked(all);
    } else {
      setChecked(new Set(SCOPE_TEMPLATES[name] || []));
    }
  }

  function toggleScope(scope) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function toggleDomain(domain) {
    const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
    if (!domDef) return;
    const domScopes = domDef.permissions.map(p => `${domain}:${p}`);
    const allChecked = domScopes.every(s => checked.has(s));
    setChecked(prev => {
      const next = new Set(prev);
      domScopes.forEach(s => allChecked ? next.delete(s) : next.add(s));
      return next;
    });
  }

  function buildScopesArray() {
    const arr = [...checked];
    const allScopes = SCOPE_DOMAINS.flatMap(d => d.permissions.map(p => `${d.key}:${p}`));
    if (allScopes.every(s => checked.has(s))) return ['*'];
    return arr.length > 0 ? arr : ['catalogue:read'];
  }

  async function handleSave() {
    setSaving(true);
    await onSave(agent.name, buildScopesArray());
    setSaving(false);
  }

  const isReadOnly = !(session.roles?.includes('owner') || session.roles?.includes('operator'));

  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal scope-modal">
        <h3>${t('profile.agents.scopeUi.scopeProfile')}: ${escHtml(agent.display_name || agent.name)}</h3>
        <div class="scope-agent-info">${escHtml(agent.gaii || '')}</div>

        ${isReadOnly ? html`
          <p class="text-caption mb-1">${t('profile.agents.scopeUi.readOnlyView')}</p>
          <div class="scope-readonly-list">
            ${scopes.map(s => html`<span class="scope-tag">${escHtml(s)}</span>`)}
          </div>
          <div class="form-actions mt-section">
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        ` : html`
          <div class="scope-templates">
            ${['readonly', 'standard', 'full'].map(tpl => html`
              <button class="scope-tpl-btn ${currentTemplate === tpl ? 'active' : ''}"
                      onClick=${() => applyTemplate(tpl)}>
                ${templateLabel(tpl)}
              </button>
            `)}
          </div>

          <button class="scope-advanced-toggle" onClick=${() => setAdvanced(!advanced)}>
            <span>${t('profile.agents.scopeUi.advanced')}</span>
            <span class="pf-chevron ${advanced ? 'pf-chevron-open' : ''}">\u25BC</span>
          </button>

          ${advanced && html`
            <div class="scope-domains">
              ${SCOPE_DOMAINS.map(d => {
                const domScopes = d.permissions.map(p => `${d.key}:${p}`);
                const allChecked = domScopes.every(s => checked.has(s));
                const isCatalogue = d.key === 'catalogue';
                return html`
                  <div class="scope-domain">
                    <div class="scope-domain-header" onClick=${() => !isCatalogue && toggleDomain(d.key)}>
                      <span class="domain-label">${domainLabel(d.key)}</span>
                      ${!isCatalogue && html`<span class="domain-toggle">${allChecked ? '\u2611 all' : '\u2610'}</span>`}
                    </div>
                    ${d.permissions.map(p => {
                      const scope = `${d.key}:${p}`;
                      const isLocked = isCatalogue && p === 'read';
                      return html`
                        <div class="scope-row ${isLocked ? 'disabled' : ''}">
                          <label>
                            <input type="checkbox"
                              checked=${checked.has(scope) || isLocked}
                              onChange=${() => !isLocked && toggleScope(scope)}
                              disabled=${isLocked}
                            />
                            <span class="scope-friendly">${permLabel(p)}</span>
                            <span class="scope-technical">${scope}</span>
                            ${isLocked && html`<span class="scope-lock" title=${t('profile.agents.scopeUi.alwaysOn')}>\uD83D\uDD12</span>`}
                          </label>
                        </div>`;
                    })}
                  </div>`;
              })}
            </div>
          `}

          <div class="form-actions mt-1">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
            </button>
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        `}
      </div>
    </div>`;
}
