/**
 * @file agents-tab.js
 * @description Profile tab for managing AI agents — device auth flow, agent prompt,
 *   platform instructions, scope management modal, and agent detail cards.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace all inline styles with CSS utility classes
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { apiPost } from '/js/api.js';
import { listAgents, updateAgentScopes } from '/js/services/agents.js';
import { getNodeUrl } from '/js/services/auth.js';

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
  const ghii = sess.ghii || (sess.owner + '@unknown');
  const url = getNodeUrl();
  return `Register a new agent on my AIMEAT node using Device Authorization (OAuth-style flow).

IMPORTANT: I already have an account. Do NOT create a new owner.

My owner name: ${sess.owner}
Node URL: ${url}

Step 1 — Start device authorization:
  POST ${url}/v1/agents/device-authorize
  Body: { "agent_name": "choose-a-name", "owner": "${sess.owner}" }

  Response includes: device_code, user_code, verification_uri_complete, interval

Step 2 — Show the verification_uri_complete URL to me so I can open it in my browser and approve.

Step 3 — Poll for the token:
  POST ${url}/v1/agents/device-token
  Body: { "device_code": "<from step 1>", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }
  Poll every {interval} seconds. You will get "authorization_pending" until I approve.

Step 4 — On success (HTTP 200), the response contains:
  - token: a long-lived JWT (valid ~90 days)
  - gaii: your agent identity

  Store the token. Use it for ALL API calls:
  Authorization: Bearer <token>

That's it! You're connected. Available APIs:
  GET ${url}/v1/catalogue — Browse services
  POST ${url}/v1/memory — Store/retrieve data
  GET ${url}/v1/wallet — Check balance
  Full API spec: ${url}/v1/spec
  Operating instructions: ${url}/v1/prompts/tier1

If the agent name already exists, the approval will issue a new token for the existing agent.`;
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
  const [agents, setAgents] = useState(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [platExpand, setPlatExpand] = useState(false);
  const [activePlat, setActivePlat] = useState('windows');
  const [scopesModal, setScopesModal] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [gaiiCopied, setGaiiCopied] = useState(null);
  const [keyCopied, setKeyCopied] = useState(null);
  const [deviceAuthResult, setDeviceAuthResult] = useState(null);
  const [deviceAuthStatus, setDeviceAuthStatus] = useState(null);
  const [deviceAuthCountdown, setDeviceAuthCountdown] = useState(0);
  const [deviceAgentName, setDeviceAgentName] = useState('');
  const [deviceAuthLoading, setDeviceAuthLoading] = useState(false);
  const [deviceUrlCopied, setDeviceUrlCopied] = useState(false);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  // Device auth countdown timer
  useEffect(() => {
    if (!deviceAuthResult || deviceAuthStatus !== 'pending') return;
    const timer = setInterval(() => {
      setDeviceAuthCountdown(prev => {
        if (prev <= 1) {
          setDeviceAuthStatus('expired');
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [deviceAuthResult, deviceAuthStatus]);

  // Device auth status polling
  useEffect(() => {
    if (!deviceAuthResult || deviceAuthStatus !== 'pending') return;
    const poller = setInterval(async () => {
      try {
        const resp = await fetch(`/v1/agents/verify/info/${deviceAuthResult.user_code}`);
        const data = await resp.json();
        if (data?.status === 'approved') {
          setDeviceAuthStatus('approved');
          clearInterval(poller);
          loadData();
        } else if (data?.status === 'denied') {
          setDeviceAuthStatus('denied');
          clearInterval(poller);
        } else if (data?.status === 'expired') {
          setDeviceAuthStatus('expired');
          clearInterval(poller);
        }
      } catch { /* ignore poll errors */ }
    }, 5000);
    return () => clearInterval(poller);
  }, [deviceAuthResult, deviceAuthStatus]);

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

  async function handleCreateDeviceAuth() {
    setDeviceAuthLoading(true);
    try {
      const body = { owner: session.owner };
      if (deviceAgentName.trim()) body.agent_name = deviceAgentName.trim();
      const resp = await apiPost('/v1/agents/device-authorize', body);
      if (resp?.data) {
        setDeviceAuthResult(resp.data);
        setDeviceAuthStatus('pending');
        setDeviceAuthCountdown(resp.data.expires_in || 600);
      } else {
        showToast(resp?.error?.message || 'Failed to create device auth request', true);
      }
    } catch {
      showToast('Failed to create device auth request', true);
    }
    setDeviceAuthLoading(false);
  }

  if (!agents) return html`<${Spinner} text=${t('profile.agents.loadingAgents')} />`;

  return html`
    <div class="section-title">${t('profile.agents.title')}</div>
    <div class="section-desc">${t('profile.agents.desc')}</div>

    <div class="agent-cta mb-1">
      <h3>${t('profile.agents.deviceAuth.title')}</h3>
      <p>${t('profile.agents.deviceAuth.desc')}</p>

      ${!deviceAuthResult ? html`
        <div class="flex-row mt-1 pf-device-auth-row">
          <div class="pf-device-auth-field">
            <label class="text-caption mb-half">${t('profile.agents.deviceAuth.agentNameLabel')}</label>
            <input type="text" class="input-field" placeholder=${t('profile.agents.deviceAuth.agentNamePlaceholder')}
              value=${deviceAgentName} onInput=${e => setDeviceAgentName(e.target.value)}
              maxlength="64" />
          </div>
          <button class="btn-primary" onClick=${handleCreateDeviceAuth} disabled=${deviceAuthLoading}>
            ${deviceAuthLoading ? '...' : t('profile.agents.deviceAuth.createLink')}
          </button>
        </div>
      ` : html`
        <div class="card mt-1 p-1">
          <div class="flex-row mb-1">
            ${deviceAuthStatus === 'pending' ? html`
              <span class="badge badge-info">${t('profile.agents.deviceAuth.statusPending')}</span>
            ` : deviceAuthStatus === 'approved' ? html`
              <span class="badge badge-success">${t('profile.agents.deviceAuth.statusApproved')}</span>
            ` : deviceAuthStatus === 'denied' ? html`
              <span class="badge badge-error">${t('profile.agents.deviceAuth.statusDenied')}</span>
            ` : html`
              <span class="badge badge-muted">${t('profile.agents.deviceAuth.statusExpired')}</span>
            `}
          </div>

          <div class="mb-1">
            <div class="text-caption mb-half">${t('profile.agents.deviceAuth.userCode')}</div>
            <div class="pf-device-code">${deviceAuthResult.user_code}</div>
          </div>

          <div class="mb-1">
            <div class="text-caption mb-half">${t('profile.agents.deviceAuth.verifyUrl')}</div>
            <div class="flex-row">
              <code class="text-caption pf-code-break">${deviceAuthResult.verification_uri_complete}</code>
              <button class="btn-outline pf-nowrap" onClick=${() => {
                copyToClipboard(deviceAuthResult.verification_uri_complete).then(() => {
                  setDeviceUrlCopied(true);
                  setTimeout(() => setDeviceUrlCopied(false), 2000);
                });
              }}>${deviceUrlCopied ? '\u2713' : t('profile.agents.deviceAuth.copyUrl')}</button>
            </div>
          </div>

          ${deviceAuthStatus === 'pending' && html`
            <div class="text-caption">
              ${t('profile.agents.deviceAuth.expiresIn')}: ${Math.floor(deviceAuthCountdown / 60)}:${String(deviceAuthCountdown % 60).padStart(2, '0')}
            </div>
          `}

          ${deviceAuthStatus !== 'pending' && html`
            <button class="btn-outline mt-xs" onClick=${() => {
              setDeviceAuthResult(null);
              setDeviceAuthStatus(null);
              setDeviceAuthCountdown(0);
            }}>${t('profile.agents.deviceAuth.createLink')}</button>
          `}
        </div>
      `}
    </div>

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
              ${t('profile.agents.balance')}: ${a.balance ?? '-'} \u2502
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
                  <span class="agent-detail-label">${t('profile.agents.description') || 'Description'}</span>
                  <span class="agent-detail-value">${escHtml(a.description)}</span>
                </div>
              ` : ''}

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.roles') || 'Roles'}</span>
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
                <span class="agent-detail-value">${a.balance ?? '-'}</span>
              </div>

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.lastSeen')}</span>
                <span class="agent-detail-value">${a.last_seen ? timeAgo(a.last_seen) + ' (' + formatDate(a.last_seen) + ')' : '-'}</span>
              </div>

              <div class="agent-detail-row">
                <span class="agent-detail-label">${t('profile.agents.created') || 'Created'}</span>
                <span class="agent-detail-value">${a.created_at ? formatDate(a.created_at) : '-'}</span>
              </div>

              ${a.public_key ? html`
                <div class="agent-detail-row">
                  <span class="agent-detail-label">${t('profile.agents.publicKey') || 'Public Key'}</span>
                  <span class="agent-detail-value flex-row">
                    <code class="agent-pubkey">${escHtml(truncateKey(a.public_key))}</code>
                    <button class="btn-outline agent-copy-btn" onClick=${(e) => { e.stopPropagation(); handleCopyKey(a.public_key); }}>
                      ${keyCopied === a.public_key ? '\u2713 Copied' : 'Copy'}
                    </button>
                  </span>
                </div>
              ` : ''}

              ${a.capabilities?.length > 0 && html`
                <div class="agent-detail-row">
                  <span class="agent-detail-label">${t('profile.agents.capabilities') || 'Capabilities'}</span>
                  <span class="agent-detail-value">
                    <div class="caps">${a.capabilities.map(c => html`<span class="cap">${escHtml(c)}</span>`)}</div>
                  </span>
                </div>
              `}
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
