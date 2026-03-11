/**
 * Portal Dev — View Module
 * Developer onboarding wizard: select platform → variant → connection type → share app.
 * Animated backgrounds (hearts, aurora, sparkle). Community apps listing.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t as globalT } from '/js/i18n.js';
import { copyToClipboard, sanitizeHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);
const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   i18n — use SPA i18n.js t() with 'dev.' prefix
   ══════════════════════════════════════════════ */
function dt(key) {
  return globalT('dev.' + key);
}

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ══════════════════════════════════════════════
   GOALS
   ══════════════════════════════════════════════ */
const GOAL_LIST = [
  { id: 'dashboard', icon: '\ud83d\udccb' },
  { id: 'notes',     icon: '\ud83d\udcdd' },
  { id: 'game',      icon: '\ud83c\udfae' },
  { id: 'news',      icon: '\ud83d\udcf0' },
  { id: 'marketplace', icon: '\ud83d\uded2' },
  { id: 'chat',      icon: '\ud83d\udcac' },
  { id: 'iot',       icon: '\ud83d\udcca' },
  { id: 'custom',    icon: '\ud83d\udd27' },
];

/* ══════════════════════════════════════════════
   COPY BUTTON
   ══════════════════════════════════════════════ */
function CopyBtn({ text, locale }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return html`
    <button class="dv-copy-btn ${copied ? 'copied' : ''}" type="button" onClick=${handleCopy}>
      ${copied ? dt('copied', locale) : dt('copy', locale)}
    </button>
  `;
}

/* ══════════════════════════════════════════════
   BACKGROUND ANIMATIONS
   ══════════════════════════════════════════════ */
function BackgroundLayer({ activeBg }) {
  const sparkleRef = useRef(null);
  const heartsRef = useRef(null);
  const heartTimer = useRef(null);

  // Hearts animation
  useEffect(() => {
    if (heartTimer.current) clearInterval(heartTimer.current);
    const hearts = ['\u2764','\ud83d\udc95','\ud83d\udc96','\ud83d\udc97','\ud83d\udc93','\ud83e\ude77','\u2763','\ud83d\udc9e'];
    heartTimer.current = setInterval(() => {
      if (activeBg !== 1 || !heartsRef.current) return;
      const h = document.createElement('div');
      h.className = 'dv-heart-particle';
      h.textContent = hearts[Math.floor(Math.random() * hearts.length)];
      h.style.left = Math.random() * 100 + '%';
      h.style.fontSize = (0.8 + Math.random() * 1.8) + 'rem';
      h.style.animationDuration = (6 + Math.random() * 8) + 's';
      heartsRef.current.appendChild(h);
      setTimeout(() => { if (h.parentNode) h.remove(); }, 16000);
    }, 400);
    return () => { if (heartTimer.current) clearInterval(heartTimer.current); };
  }, [activeBg]);

  // Sparkle init
  useEffect(() => {
    if (!sparkleRef.current) return;
    const c = sparkleRef.current;
    c.innerHTML = '';
    const colors = ['rgba(255,107,157,.3)','rgba(196,69,105,.25)','rgba(244,143,177,.2)','rgba(136,14,79,.2)'];
    for (let n = 0; n < 5; n++) {
      const blob = document.createElement('div');
      blob.className = 'dv-nebula-blob';
      const sz = (150 + Math.random() * 250) + 'px';
      blob.style.width = sz; blob.style.height = sz;
      blob.style.left = Math.random() * 90 + '%';
      blob.style.top = Math.random() * 90 + '%';
      blob.style.background = colors[n % colors.length];
      blob.style.animationDuration = (12 + Math.random() * 10) + 's';
      blob.style.animationDelay = (-Math.random() * 10) + 's';
      c.appendChild(blob);
    }
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('div');
      s.className = 'dv-sparkle';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDuration = (2 + Math.random() * 4) + 's';
      s.style.animationDelay = (-Math.random() * 6) + 's';
      const w = (2 + Math.random() * 3) + 'px';
      s.style.width = w; s.style.height = w;
      c.appendChild(s);
    }
  }, []);

  return html`
    <div class=${`dv-bg-layer dv-bg-hearts ${activeBg !== 1 ? 'dv-bg-hidden' : ''}`} ref=${heartsRef}></div>
    <div class=${`dv-bg-layer dv-bg-aurora ${activeBg !== 2 ? 'dv-bg-hidden' : ''}`}>
      <div class="dv-aurora-wave"></div>
      <div class="dv-aurora-wave"></div>
      <div class="dv-aurora-wave"></div>
    </div>
    <div class=${`dv-bg-layer dv-bg-sparkle ${activeBg !== 3 ? 'dv-bg-hidden' : ''}`} ref=${sparkleRef}></div>
  `;
}

function BgSelector({ activeBg, onChange }) {
  return html`
    <div class="dv-bg-selector">
      <button class=${`dv-bg-btn ${activeBg === 1 ? 'active' : ''}`} type="button" title="Floating Hearts" onClick=${() => onChange(1)}>\ud83d\udc95</button>
      <button class=${`dv-bg-btn ${activeBg === 2 ? 'active' : ''}`} type="button" title="Aurora Love" onClick=${() => onChange(2)}>\ud83c\udf0c</button>
      <button class=${`dv-bg-btn ${activeBg === 3 ? 'active' : ''}`} type="button" title="Sparkle Galaxy" onClick=${() => onChange(3)}>\u2728</button>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   PANELS (MCP, API, Browse, Prompt Package)
   ══════════════════════════════════════════════ */
function McpPanel({ locale, isLoggedIn, session }) {
  const [setupPrompt, setSetupPrompt] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);

  const generateSetupPrompt = useCallback(async () => {
    if (!session) return;
    setGenerating(true);
    setGenError(null);
    try {
      const resp = await session.fetch('/v1/auth/connectivity-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'MCP agent for AI assistant' }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error?.message || 'Failed to generate key');
      const key = data.data.connectivity_key;
      const prompt = [
        `Connect me to the AIMEAT node at ${NODE_URL} via MCP.`,
        ``,
        `CONNECTIVITY KEY: ${key}`,
        `(Single-use. Do NOT share this key with anyone else.)`,
        ``,
        `## Step 1: Register as an agent`,
        `POST ${NODE_URL}/v1/agents/connect`,
        `Body: { "connectivity_key": "${key}", "agent_name": "assistant" }`,
        `→ Response contains private_key and agent.gaii — save both securely.`,
        ``,
        `## Step 2: Authenticate (get JWT)`,
        `Use Ed25519 to sign the message: gaii + "${location.hostname.includes('aimeat.io') ? 'aimeat-finland-001-genesis' : ''}" + ISO_timestamp`,
        `The private_key from Step 1 is the signing key (hex-encoded Ed25519 seed).`,
        `POST ${NODE_URL}/v1/auth/token`,
        `Body: { "gaii": "<gaii>", "timestamp": "<ISO>", "signature": "<hex_signature>" }`,
        `→ Response contains a JWT token.`,
        ``,
        `## Step 3: Configure MCP`,
        `Add to .vscode/mcp.json (or ~/.claude/mcp_servers.json):`,
        `{`,
        `  "servers": {`,
        `    "aimeat": {`,
        `      "type": "http",`,
        `      "url": "${NODE_URL}/v1/mcp",`,
        `      "headers": { "Authorization": "Bearer <jwt_token>" }`,
        `    }`,
        `  }`,
        `}`,
        ``,
        `## Step 4: Test`,
        `After configuring, use the aimeat_catalogue_search tool to verify the connection works.`,
        ``,
        `## Important`,
        `- The JWT expires. Store the private_key so you can re-authenticate later.`,
        `- The node has 18 MCP tools: catalogue, agent profile, memory (read/write/list),`,
        `  action execute, work queue (inbox/accept/deliver), wallet, boards (read/post),`,
        `  storage (upload/download), and 4 admin tools (operator only).`,
        `- Full API spec: ${NODE_URL}/v1/spec`,
        `- Operating instructions: ${NODE_URL}/v1/prompts/tier1`,
      ].join('\n');
      setSetupPrompt(prompt);
    } catch (err) {
      setGenError(err.message || 'Failed');
    } finally {
      setGenerating(false);
    }
  }, [session]);

  return html`
    <div class="dv-panel">
      <h3>${dt('panel.mcpBadge', locale)}</h3>

      ${!isLoggedIn && html`
        <div class="dv-mcp-prereq" style="background:rgba(255,180,0,.08);border:1px solid rgba(255,180,0,.25);border-radius:.5rem;padding:.75rem 1rem;margin-bottom:1rem">
          <strong>${dt('panel.mcpPrereqTitle', locale)}</strong>
          <p style="margin:.5rem 0 0;font-size:.9rem" dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpPrereqDesc', locale)) }}></p>
        </div>
      `}

      ${isLoggedIn && session?.gaii && html`
        <div style="background:rgba(100,255,150,.08);border:1px solid rgba(100,255,150,.25);border-radius:.5rem;padding:.75rem 1rem;margin-bottom:1rem">
          <strong>${dt('panel.mcpReady', locale)}</strong>
          <div style="margin-top:.5rem;font-size:.85rem">
            <div><strong>GHII:</strong> ${session.ghii || '-'}</div>
            <div><strong>Agent GAII:</strong> <code>${session.gaii}</code></div>
          </div>
          <p style="margin:.5rem 0 0;font-size:.85rem;color:var(--muted)" dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpReadyDesc', locale)) }}></p>
        </div>
      `}

      ${isLoggedIn && html`
        <div style="background:rgba(130,100,255,.08);border:1px solid rgba(130,100,255,.25);border-radius:.5rem;padding:.75rem 1rem;margin-bottom:1rem">
          <strong>${dt('panel.mcpSetupTitle', locale)}</strong>
          <p style="margin:.5rem 0 0;font-size:.85rem" dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpSetupDesc', locale)) }}></p>
          ${!setupPrompt && html`
            <button type="button" onClick=${generateSetupPrompt} disabled=${generating}
              style="margin-top:.75rem;padding:.5rem 1rem;background:var(--love1,#ff6b9d);color:#fff;border:none;border-radius:.25rem;cursor:pointer;font-size:.85rem">
              ${generating ? dt('panel.mcpSetupGenerating', locale) : dt('panel.mcpSetupBtn', locale)}
            </button>
            ${genError && html`<p style="color:#ff6b6b;margin-top:.5rem;font-size:.8rem">${genError}</p>`}
          `}
          ${setupPrompt && html`
            <div class="dv-prompt-output" style="margin-top:.75rem">
              <${CopyBtn} text=${setupPrompt} locale=${locale} />
              <div class="dv-prompt-text" style="max-height:20rem;overflow-y:auto;white-space:pre-wrap;font-size:.8rem">${setupPrompt}</div>
            </div>
            <p style="margin-top:.5rem;font-size:.75rem;color:var(--muted)">${dt('panel.mcpSetupNote', locale)}</p>
          `}
        </div>
      `}

      <div class="dv-instructions">
        <ol>
          <li dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpStep1', locale)) }}></li>
          <li>${dt('panel.mcpStep2', locale)}<br/><code>${NODE_URL}/v1/mcp</code></li>
          <li dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpStep3', locale)) }}></li>
          <li dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpStep4', locale)) }}></li>
        </ol>
        <p dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpTools', locale)) }}></p>
      </div>

      <details style="margin-top:.75rem;font-size:.85rem">
        <summary style="cursor:pointer;color:var(--muted)">${dt('panel.mcpAuthDetails', locale)}</summary>
        <div style="margin-top:.5rem;padding:.5rem;background:rgba(255,255,255,.03);border-radius:.25rem" dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpAuthExplain', locale)) }}></div>
      </details>
    </div>
  `;
}

function ApiPanel({ locale }) {
  const prompt = `I want you to connect to an AIMEAT node at ${NODE_URL}\n\nStep 1: Register an owner account\nPOST ${NODE_URL}/v1/owners\nBody: {"name": "myowner", "display_name": "My Name"}\nSAVE the owner_key from the response!\n\nStep 2: Register an agent\nPOST ${NODE_URL}/v1/agents\nHeader: X-AIMEAT-Owner-Key: (owner_key from step 1)\nBody: {"name": "myagent", "owner": "myowner", "display_name": "My Agent", "description": "My first AIMEAT agent"}\nSAVE the private_key!\n\nStep 3: Authenticate \u2014 sign (gaii+timestamp) with Ed25519, POST to /v1/auth/token\n\nStep 4: Use the API \u2014 GET /v1/catalogue, POST /v1/memory, GET /v1/wallet\n\nFull API spec: ${NODE_URL}/v1/spec\nOperating instructions: ${NODE_URL}/v1/prompts/tier1`;

  return html`
    <div class="dv-panel">
      <h3>${dt('panel.apiBadge', locale)}</h3>
      <p>${dt('panel.apiDesc', locale)}</p>
      <div class="dv-prompt-output">
        <${CopyBtn} text=${prompt} locale=${locale} />
        <div class="dv-prompt-text">${prompt}</div>
      </div>
    </div>
  `;
}

function BrowsePanel({ locale, onSwitchToPromptPackage }) {
  const prompt = `Browse these AIMEAT endpoints and tell me what's available:\n\nCatalogue: ${NODE_URL}/v1/catalogue\nNode info: ${NODE_URL}/\nDiscovery: ${NODE_URL}/.well-known/aimeat\n\nYou can also browse specific boards and agent profiles once you find them in the catalogue.`;

  return html`
    <div class="dv-panel">
      <h3>${dt('panel.browseBadge', locale)}</h3>
      <p>${dt('panel.browseDesc', locale)}</p>
      <div class="dv-prompt-output">
        <${CopyBtn} text=${prompt} locale=${locale} />
        <div class="dv-prompt-text">${prompt}</div>
      </div>
      <h3 style="margin-top:1rem">${dt('panel.browseUpgradeTitle', locale)}</h3>
      <ul style="margin-left:1.5rem">
        <li>${dt('panel.browseUpgrade1', locale)}</li>
        <li>${dt('panel.browseUpgrade2', locale)}</li>
        ${(() => {
          const text = dt('panel.browseUpgrade3', locale);
          const parts = text.split('{{promptPackageLink}}');
          return html`<li>${parts[0]}<a href="#" onClick=${(e) => { e.preventDefault(); onSwitchToPromptPackage(); }}>${dt('panel.promptPackageLabel', locale)}</a>${parts[1] ?? ''}</li>`;
        })()}
      </ul>
    </div>
  `;
}

function PromptPackagePanel({ locale, platform, variant, isLoggedIn }) {
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);

  const selectGoal = useCallback((goalId) => {
    setSelectedGoal(goalId);
    setLoading(true);
    const pid = platform.id + '-' + variant.id;
    let url = '/v1/portal/prompt/' + encodeURIComponent(pid) + '?goal=' + encodeURIComponent(goalId);
    if (isLoggedIn) url += '&mode=authenticated';
    fetch(url)
      .then(r => r.json())
      .then(d => {
        setLoading(false);
        if (d.ok) setPromptText(d.data.prompt);
        else setPromptText('Error: ' + (d.error?.message || 'Unknown'));
      })
      .catch(() => { setLoading(false); setPromptText('Failed to load prompt.'); });
  }, [platform, variant, isLoggedIn]);

  return html`
    <div class="dv-panel">
      <h3>${dt('panel.promptBadge', locale)}</h3>
      <p dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.promptDesc', locale)) }}></p>
      ${isLoggedIn
        ? html`<p style="color:var(--success);font-size:.85rem">\u2705 ${dt('panel.promptLoggedIn', locale)}</p>`
        : html`<p style="color:var(--muted);font-size:.85rem">\ud83d\udc64 ${dt('panel.promptAnon', locale)}</p>`
      }
      <div class="dv-goals">
        ${GOAL_LIST.map(g => html`
          <div
            class=${`dv-goal-card ${selectedGoal === g.id ? 'selected' : ''}`}
            onClick=${() => selectGoal(g.id)}
          >
            <div class="dv-goal-icon">${g.icon}</div>
            <div>${dt('goals.' + g.id, locale)}</div>
          </div>
        `)}
      </div>
      ${(selectedGoal || loading) && html`
        <div class="dv-prompt-output">
          <${CopyBtn} text=${promptText} locale=${locale} />
          <div class="dv-prompt-text">${loading ? dt('panel.loading', locale) : promptText}</div>
        </div>
      `}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   CAPABILITY TABS
   ══════════════════════════════════════════════ */
function CapTabs({ variant, platform, locale, isLoggedIn, session }) {
  const [activeTab, setActiveTab] = useState('apps');

  const hasMcp = variant.path === 'mcp';
  const hasApi = variant.path === 'api' || variant.path === 'browse' || variant.path === 'mcp';

  return html`
    <div>
      <div class="dv-cap-tabs">
        <button class=${`dv-cap-tab ${activeTab === 'apps' ? 'active' : ''}`} onClick=${() => setActiveTab('apps')}>
          <span class="dv-tab-icon">\ud83d\udda5\ufe0f</span>
          <span class="dv-tab-label">${dt('tabs.apps', locale)}</span>
        </button>
        <button class=${`dv-cap-tab ${hasMcp ? '' : 'unavail'} ${activeTab === 'mcp' ? 'active' : ''}`}
                onClick=${hasMcp ? () => setActiveTab('mcp') : undefined}>
          ${hasMcp && html`<span class="dv-tab-rec">\u2713</span>`}
          <span class="dv-tab-icon">\ud83d\udd0c</span>
          <span class="dv-tab-label">${dt('tabs.mcp', locale)}</span>
        </button>
        <button class=${`dv-cap-tab ${hasApi ? '' : 'unavail'} ${activeTab === 'api' ? 'active' : ''}`}
                onClick=${hasApi ? () => setActiveTab('api') : undefined}>
          <span class="dv-tab-icon">\ud83d\udce1</span>
          <span class="dv-tab-label">${dt('tabs.api', locale)}</span>
        </button>
      </div>

      ${activeTab === 'apps' && html`
        <${PromptPackagePanel} locale=${locale} platform=${platform} variant=${variant} isLoggedIn=${isLoggedIn} />
      `}
      ${activeTab === 'mcp' && (hasMcp
        ? html`<${McpPanel} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />`
        : html`<div class="dv-unavail-notice"><div class="dv-unavail-icon">\ud83d\udd12</div><p>${dt('tabs.unavailable', locale)}</p><p style="font-size:.8rem;margin-top:.5rem">${dt('tabs.upgradeForMcp', locale)}</p></div>`
      )}
      ${activeTab === 'api' && (hasApi
        ? (variant.path === 'browse'
            ? html`<${BrowsePanel} locale=${locale} onSwitchToPromptPackage=${() => setActiveTab('apps')} />`
            : html`<${ApiPanel} locale=${locale} />`)
        : html`<div class="dv-unavail-notice"><div class="dv-unavail-icon">\ud83d\udd12</div><p>${dt('tabs.unavailable', locale)}</p><p style="font-size:.8rem;margin-top:.5rem">${dt('tabs.upgradeForApi', locale)}</p></div>`
      )}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   UPLOAD SECTION (Step 4)
   ══════════════════════════════════════════════ */
function UploadSection({ locale, isLoggedIn, session }) {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [accessCode, setAccessCode] = useState('');
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef(null);

  const handleUpload = useCallback(async (file) => {
    if (!session) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);

      const body = { filename: file.name, content: b64, mime_type: 'text/html' };
      if (accessCode.trim()) body.access_code = accessCode.trim();

      const resp = await session.fetch('/v1/apps', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = resp.data || resp;
      const downloadUrl = NODE_URL + (data.download_url || '/v1/apps/' + encodeURIComponent(session.owner) + '/' + encodeURIComponent(file.name));
      setUploadResult({ ok: true, downloadUrl, protected: data.protected, filename: file.name, size: file.size });
    } catch (e) {
      setUploadResult({ ok: false, error: e.message });
    }
    setUploading(false);
  }, [session, accessCode]);

  if (!isLoggedIn) {
    return html`
      <div class="dv-panel">
        <h3>\ud83d\udccc ${dt('uploadSection.shareTitle', locale)}</h3>
        <p>${dt('uploadSection.shareDesc', locale)}</p>
        <ol style="margin-left:1.5rem;margin-bottom:1rem">
          <li>${dt('uploadSection.shareStep1', locale)}</li>
          <li>${dt('uploadSection.shareStep2', locale)}</li>
          <li>${dt('uploadSection.shareStep3', locale)}</li>
        </ol>
        <div class="dv-mode-notice dv-mode-notice-anon" style="margin:0">
          <div class="dv-notice-icon">\ud83d\udca1</div>
          <div><strong>${dt('uploadSection.wantEasier', locale)}</strong> ${dt('uploadSection.downloadLinkNote', locale)}<br/>
            <code style="font-size:.8rem;color:var(--accent)">${NODE_URL}/v1/apps/yourname/my-app.html</code>
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="dv-panel">
      <h3>\ud83d\udce4 ${dt('upload', locale)}</h3>
      <p>${dt('uploadSection.desc', locale)}</p>
      <div style="margin-bottom:1rem">
        <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.4rem">${dt('uploadSection.accessCodeLabel', locale)}</label>
        <input type="text" placeholder=${dt('uploadSection.accessCodePlaceholder', locale)}
               style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.4rem .6rem;color:var(--text);font-size:.85rem;width:100%;max-width:300px"
               maxlength="64" value=${accessCode} onInput=${e => setAccessCode(e.target.value)} />
        <p style="font-size:.75rem;color:var(--muted);margin-top:.25rem">${dt('uploadSection.accessCodeNote', locale)}</p>
      </div>
      <div class=${`dv-upload-area ${dragover ? 'dragover' : ''}`}
           onDragOver=${e => { e.preventDefault(); setDragover(true); }}
           onDragLeave=${() => setDragover(false)}
           onDrop=${e => { e.preventDefault(); setDragover(false); if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]); }}>
        <p style="margin-bottom:.5rem">${dt('uploadSection.dragDrop', locale)}</p>
        <input type="file" ref=${inputRef} accept=".html,.htm" style="display:none"
               onChange=${e => { if (e.target.files.length > 0) handleUpload(e.target.files[0]); }} />
        <button class="dv-upload-btn" type="button" disabled=${uploading}
                onClick=${() => inputRef.current?.click()}>
          ${uploading ? dt('uploading', locale) : dt('uploadSection.chooseFile', locale)}
        </button>
      </div>
      ${uploadResult && (uploadResult.ok
        ? html`
          <div style="margin-top:1rem">
            <div style="color:var(--success);font-weight:600;margin-bottom:.5rem">\u2705 ${dt('uploaded', locale)}${uploadResult.protected ? ' \ud83d\udd12' : ''}</div>
            <p>${dt('shareLink', locale)}:</p>
            <div class="dv-share-url">
              <input type="text" value=${uploadResult.downloadUrl} readonly />
              <${CopyBtn} text=${uploadResult.downloadUrl} locale=${locale} />
            </div>
            <p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">${dt('uploadSection.fileSize', locale)}${formatBytes(uploadResult.size)}</p>
          </div>
        `
        : html`<p style="color:var(--danger);margin-top:.75rem">${dt('uploadFailed', locale)}: ${uploadResult.error}</p>`
      )}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   COMMUNITY APPS
   ══════════════════════════════════════════════ */
function CommunityApps({ locale, isLoggedIn, session }) {
  const [apps, setApps] = useState([]);

  useEffect(() => {
    fetch('/v1/apps')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.data?.apps) setApps(d.data.apps);
      })
      .catch(() => {});
  }, []);

  const [codePending, setCodePending] = useState({});

  const updateAppCode = useCallback(async (filename, newCode) => {
    if (!session) return;
    setCodePending(p => ({ ...p, [filename]: 'updating' }));
    try {
      const resp = await session.fetch('/v1/apps/' + encodeURIComponent(filename), {
        method: 'PATCH',
        body: JSON.stringify({ access_code: newCode || null }),
      });
      const d = resp.data || resp;
      setCodePending(p => ({ ...p, [filename]: d.protected ? 'updated' : 'removed' }));
      // Reload
      fetch('/v1/apps').then(r => r.json()).then(d2 => {
        if (d2.ok && d2.data?.apps) setApps(d2.data.apps);
      });
    } catch (e) {
      setCodePending(p => ({ ...p, [filename]: 'error' }));
    }
  }, [session]);

  if (apps.length === 0) return null;

  return html`
    <div style="margin-top:2rem">
      <h2>\ud83d\udce6 ${dt('community.title', locale)}</h2>
      <p style="color:var(--muted);font-size:.9rem">${dt('community.desc', locale)}</p>
      <div class="dv-app-list">
        ${apps.map(app => {
          const codeInputId = 'dl-' + app.owner + '-' + app.filename;
          return html`
            <div class="dv-app-item" key=${app.filename + app.owner}>
              <div class="dv-app-name">
                ${app.filename}
                ${app.protected && html`<span style="color:var(--warn);font-size:.75rem"> \ud83d\udd12 ${dt('appList.protected', locale)}</span>`}
              </div>
              <div class="dv-app-meta">${dt('appList.by', locale)}${app.owner} \u00b7 ${formatBytes(app.size)}</div>
              ${app.protected
                ? html`
                  <div style="margin-top:.5rem;display:flex;gap:.4rem;align-items:center">
                    <input type="text" placeholder=${dt('appList.accessCode', locale)} id=${codeInputId}
                           style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.25rem .4rem;color:var(--text);font-size:.8rem;width:120px" />
                    <a href="#" onClick=${e => {
                      e.preventDefault();
                      const code = document.getElementById(codeInputId)?.value?.trim();
                      if (!code) return;
                      window.open(NODE_URL + app.download_url + '?code=' + encodeURIComponent(code));
                    }} style="font-size:.85rem">\u2b07 ${dt('download', locale)}</a>
                  </div>
                `
                : html`<a href=${NODE_URL + app.download_url} download style="display:inline-block;margin-top:.5rem;font-size:.85rem">\u2b07 ${dt('download', locale)}</a>`
              }
              ${isLoggedIn && session?.owner === app.owner && html`
                <div style="margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--border)">
                  <${AppCodeManager} filename=${app.filename} isProtected=${app.protected} locale=${locale}
                    onUpdate=${(fname, code) => updateAppCode(fname, code)} status=${codePending[app.filename]} />
                </div>
              `}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function AppCodeManager({ filename, isProtected, locale, onUpdate, status }) {
  const [code, setCode] = useState('');
  return html`
    <div style="display:flex;gap:.3rem;align-items:center">
      <input type="text" value=${code} onInput=${e => setCode(e.target.value)}
             placeholder=${isProtected ? dt('appList.newCodePlaceholder', locale) : dt('appList.setCodePlaceholder', locale)}
             style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.2rem .4rem;color:var(--text);font-size:.8rem;width:140px" />
      <button style="background:var(--accent);color:var(--bg);border:none;border-radius:4px;padding:.2rem .5rem;cursor:pointer;font-size:.75rem;font-weight:600"
              type="button" onClick=${() => onUpdate(filename, code.trim())}>\ud83d\udd11</button>
    </div>
    ${status && html`
      <div style="font-size:.75rem;margin-top:.2rem;color:${status === 'error' ? 'var(--danger)' : 'var(--success)'}">
        ${status === 'updating' ? dt('status.updating', locale) :
          status === 'updated' ? '\u2705 ' + dt('status.codeUpdatedShort', locale) :
          status === 'removed' ? '\u2705 ' + dt('status.codeRemovedShort', locale) :
          status === 'error' ? 'Error' : ''}
      </div>
    `}
  `;
}

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
export default function PortalDevView({ navigate, locale }) {
  const [platforms, setPlatforms] = useState([]);
  const [stats, setStats] = useState({ agents: 0, chatSessions: 0, actions: 0, boards: 0 });
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [activeBg, setActiveBg] = useState(3);
  const [session, setSession] = useState(null);

  useViewCSS('/css/views/portal-dev.css');

  const isLoggedIn = !!session;

  // Auth
  useEffect(() => {
    const auth = window.AIMEAT?.auth;
    if (!auth) return;
    const checkSession = () => {
      const s = typeof auth.getSession === 'function' ? auth.getSession() : null;
      setSession(s && s.jwt ? s : null);
    };
    checkSession();
    window.addEventListener('aimeat-auth-change', checkSession);
    return () => window.removeEventListener('aimeat-auth-change', checkSession);
  }, []);

  // Load platforms + stats
  useEffect(() => {
    fetch('/v1/portal/platforms')
      .then(r => r.json())
      .then(d => { if (d.ok) setPlatforms(d.data.platforms); })
      .catch(() => {});

    fetch('/v1/stats')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.data) {
          setStats({
            agents: d.data.agents || 0,
            chatSessions: d.data.chatSessions || d.data.chat_sessions || 0,
            actions: d.data.actions || d.data.services || 0,
            boards: d.data.boards || 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = dt('title', locale) + ' \u2014 AIMEAT';
  }, [locale]);

  const handleSelectPlatform = useCallback((p) => {
    setSelectedPlatform(p);
    setSelectedVariant(null);
    if (p.variants.length === 1) setSelectedVariant(p.variants[0]);
  }, []);

  const nodeId = document.querySelector('meta[name="aimeat-node-id"]')?.content || 'aimeat-node';

  return html`
    <${BackgroundLayer} activeBg=${activeBg} />
    <${BgSelector} activeBg=${activeBg} onChange=${setActiveBg} />

    <div class="dv-container">
      <h1>\ud83d\udc96 ${dt('title', locale)}</h1>
      <p class="dv-subtitle">${dt('subtitle', locale)}</p>
      <div class="dv-node-badge"><span class="dv-dot"></span> ${NODE_URL}</div>

      <!-- Stats -->
      <div class="dv-stats">
        <div class="dv-stat"><div class="dv-num">${stats.agents}</div><div class="dv-label">${dt('stats.agents', locale)}</div></div>
        <div class="dv-stat"><div class="dv-num">${stats.chatSessions}</div><div class="dv-label">${dt('stats.chatSessions', locale)}</div></div>
        <div class="dv-stat"><div class="dv-num">${stats.actions}</div><div class="dv-label">${dt('stats.services', locale)}</div></div>
        <div class="dv-stat"><div class="dv-num">${stats.boards}</div><div class="dv-label">${dt('stats.boards', locale)}</div></div>
      </div>

      <!-- Mode notice -->
      ${isLoggedIn
        ? html`<div class="dv-mode-notice dv-mode-notice-user"><div class="dv-notice-icon">\u2705</div><div><strong>${dt('mode.loggedIn', locale)} ${session?.ghii || session?.owner || ''}</strong><br/><span style="color:var(--muted);font-size:.85rem">${dt('mode.loggedInDesc', locale)}</span></div></div>`
        : html`<div class="dv-mode-notice dv-mode-notice-anon"><div class="dv-notice-icon">\ud83d\udc64</div><div><strong>${dt('mode.anonymous', locale)}</strong> \u2014 ${dt('mode.anonymousDesc', locale)}<br/><span style="color:var(--muted);font-size:.85rem">${dt('mode.anonymousNote', locale)} <strong>${dt('mode.signUp', locale)}</strong> ${dt('mode.signUpNote', locale)}</span></div></div>`
      }

      <!-- Quick Start -->
      <div class="dv-panel" style="border-color:var(--love1,#ff6b9d);background:linear-gradient(135deg,rgba(30,20,40,.9),rgba(60,10,40,.8))">
        <h3 style="margin-bottom:.5rem">\ud83d\ude80 ${dt('quickStart.title', locale)}</h3>
        <p style="margin-bottom:.5rem">${dt('quickStart.desc', locale)}</p>
        <div class="dv-prompt-output" style="margin-bottom:0">
          <${CopyBtn} text=${'Read this URL and follow the instructions to connect to this AIMEAT node: ' + NODE_URL + '/?format=json'} locale=${locale} />
          <div class="dv-prompt-text" style="max-height:none;font-size:.85rem">Read this URL and follow the instructions to connect to this AIMEAT node: ${NODE_URL}/?format=json</div>
        </div>
        <p style="margin-top:.75rem;font-size:.8rem;color:var(--muted)">${dt('quickStart.note', locale)}<br/>${dt('quickStart.fallback', locale)}</p>
      </div>

      <!-- Step 1: Platform -->
      <div class="dv-step">
        <div class="dv-step-header">
          <div class=${`dv-step-num ${selectedPlatform ? 'done' : ''}`}>${selectedPlatform ? '\u2713' : '1'}</div>
          <div class="dv-step-label">${dt('step1.label', locale)}</div>
        </div>
        <div class="dv-platforms">
          ${platforms.map(p => html`
            <div class=${`dv-platform-card ${selectedPlatform?.id === p.id ? 'selected' : ''}`}
                 onClick=${() => handleSelectPlatform(p)} key=${p.id}>
              <div class="dv-platform-name">${p.name}</div>
              <div class="dv-platform-vendor">${p.vendor}</div>
            </div>
          `)}
        </div>
      </div>

      <!-- Step 2: Variant -->
      ${selectedPlatform && selectedPlatform.variants.length > 1 && html`
        <div class="dv-step">
          <div class="dv-step-header">
            <div class=${`dv-step-num ${selectedVariant ? 'done' : ''}`}>${selectedVariant ? '\u2713' : '2'}</div>
            <div class="dv-step-label">${dt('step2.label', locale)}</div>
          </div>
          <div class="dv-variants">
            ${selectedPlatform.variants.map(v => html`
              <button class=${`dv-variant-btn ${selectedVariant?.id === v.id ? 'selected' : ''}`}
                      type="button" onClick=${() => setSelectedVariant(v)} key=${v.id}>
                ${v.name}
              </button>
            `)}
          </div>
          ${selectedVariant?.notes && html`<div class="dv-variant-note">${dt('platformNotes.' + selectedVariant.notes, locale)}</div>`}
        </div>
      `}

      <!-- Step 3: Connection type -->
      ${selectedVariant && html`
        <div class="dv-step">
          <div class="dv-step-header">
            <div class="dv-step-num">3</div>
            <div class="dv-step-label">${dt('step3.label', locale)}</div>
          </div>
          <${CapTabs} variant=${selectedVariant} platform=${selectedPlatform} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />
        </div>
      `}

      <!-- Step 4: Share -->
      ${selectedVariant && html`
        <div class="dv-step">
          <div class="dv-step-header">
            <div class="dv-step-num">4</div>
            <div class="dv-step-label">${dt('step4.label', locale)}</div>
          </div>
          <${UploadSection} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />
        </div>
      `}

      <!-- Community Apps -->
      <${CommunityApps} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />
    </div>
  `;
}
