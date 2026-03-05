/**
 * Portal Dev — View Module
 * Developer onboarding wizard: select platform → variant → connection type → share app.
 * Animated backgrounds (hearts, aurora, sparkle). Community apps listing.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t as globalT } from '/js/i18n.js';

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

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
  return Promise.resolve();
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
function McpPanel({ locale }) {
  return html`
    <div class="dv-panel">
      <h3>${dt('panel.mcpBadge', locale)}</h3>
      <div class="dv-instructions">
        <ol>
          <li dangerouslySetInnerHTML=${{ __html: dt('panel.mcpStep1', locale) }}></li>
          <li>${dt('panel.mcpStep2', locale)}<br/><code>${NODE_URL}/v1/mcp</code></li>
          <li>${dt('panel.mcpStep3', locale)}</li>
          <li dangerouslySetInnerHTML=${{ __html: dt('panel.mcpStep4', locale) }}></li>
        </ol>
        <p dangerouslySetInnerHTML=${{ __html: dt('panel.mcpTools', locale) }}></p>
      </div>
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

function BrowsePanel({ locale }) {
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
        <li dangerouslySetInnerHTML=${{ __html: dt('panel.browseUpgrade3', locale) }}></li>
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
      <p dangerouslySetInnerHTML=${{ __html: dt('panel.promptDesc', locale) }}></p>
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
function CapTabs({ variant, platform, locale, isLoggedIn }) {
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
        ? html`<${McpPanel} locale=${locale} />`
        : html`<div class="dv-unavail-notice"><div class="dv-unavail-icon">\ud83d\udd12</div><p>${dt('tabs.unavailable', locale)}</p><p style="font-size:.8rem;margin-top:.5rem">${dt('tabs.upgradeForMcp', locale)}</p></div>`
      )}
      ${activeTab === 'api' && (hasApi
        ? (variant.path === 'browse'
            ? html`<${BrowsePanel} locale=${locale} />`
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
  const cssRef = useRef(false);

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

  // CSS
  useEffect(() => {
    if (cssRef.current) return;
    cssRef.current = true;
    const style = document.createElement('style');
    style.textContent = DEV_CSS;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch (_) {} };
  }, []);

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
          <${CapTabs} variant=${selectedVariant} platform=${selectedPlatform} locale=${locale} isLoggedIn=${isLoggedIn} />
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

/* ══════════════════════════════════════════════
   CSS
   ══════════════════════════════════════════════ */
const DEV_CSS = `
/* ── Dev Portal root vars ── */
:root {
  --love1: #ff6b9d;
  --love2: #c44569;
  --love3: #ff8a80;
  --love4: #f48fb1;
  --love5: #880e4f;
}

/* ── Background system ── */
.dv-bg-layer { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; transition: opacity .8s ease; }
.dv-bg-hidden { opacity: 0; }
.dv-bg-hearts { background: radial-gradient(ellipse at 50% 0%, #2d1133 0%, #0f0a14 70%); }
.dv-heart-particle { position: absolute; bottom: -60px; opacity: 0; font-size: 1.2rem; animation: dv-floatUp linear infinite; filter: drop-shadow(0 0 6px rgba(255,107,157,.5)); }
@keyframes dv-floatUp { 0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 0; } 10% { opacity: .7; } 90% { opacity: .7; } 100% { transform: translateY(-110vh) rotate(720deg) scale(.3); opacity: 0; } }
.dv-bg-aurora { background: #0f0a14; }
.dv-aurora-wave { position: absolute; width: 200%; height: 60%; left: -50%; border-radius: 50%; filter: blur(80px); opacity: .35; animation: dv-auroraShift 8s ease-in-out infinite alternate; }
.dv-aurora-wave:nth-child(1) { top: 10%; background: linear-gradient(90deg, #ff6b9d, #c44569, #ff8a80, #f48fb1); animation-duration: 8s; }
.dv-aurora-wave:nth-child(2) { top: 30%; background: linear-gradient(90deg, #f48fb1, #880e4f, #ff6b9d, #e91e63); animation-duration: 12s; animation-delay: -4s; }
.dv-aurora-wave:nth-child(3) { top: 55%; background: linear-gradient(90deg, #ad1457, #ff6b9d, #f06292, #880e4f); animation-duration: 10s; animation-delay: -2s; }
@keyframes dv-auroraShift { 0% { transform: translateX(-20%) scaleY(1); } 50% { transform: translateX(10%) scaleY(1.3); } 100% { transform: translateX(-10%) scaleY(.8); } }
.dv-bg-sparkle { background: radial-gradient(ellipse at 50% 50%, #1a0a24 0%, #0f0a14 100%); }
.dv-sparkle { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: #fff; animation: dv-sparkleAnim ease-in-out infinite; }
@keyframes dv-sparkleAnim { 0%, 100% { opacity: 0; transform: scale(0); } 50% { opacity: 1; transform: scale(1); box-shadow: 0 0 8px 2px var(--love1), 0 0 20px 4px var(--love4); } }
.dv-nebula-blob { position: absolute; border-radius: 50%; filter: blur(100px); opacity: .2; animation: dv-nebulaFloat 15s ease-in-out infinite alternate; }
@keyframes dv-nebulaFloat { 0% { transform: translate(0,0) scale(1); } 100% { transform: translate(40px,-30px) scale(1.2); } }

/* BG selector */
.dv-bg-selector { position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 200; display: flex; gap: .5rem; background: rgba(15,10,20,.8); backdrop-filter: blur(12px); border: 1px solid rgba(255,107,157,.25); border-radius: 30px; padding: .4rem .6rem; }
.dv-bg-btn { width: 36px; height: 36px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: all .25s; display: flex; align-items: center; justify-content: center; font-size: .9rem; background: rgba(60,30,60,.7); }
.dv-bg-btn:hover { border-color: var(--love1); transform: scale(1.15); }
.dv-bg-btn.active { border-color: var(--love1); box-shadow: 0 0 12px rgba(255,107,157,.5); }

/* Container */
.dv-container { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; position: relative; z-index: 1; }
.dv-container h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: .5rem; }
.dv-container h2 { font-size: 1.3rem; font-weight: 600; margin-bottom: .75rem; color: var(--love1); }
.dv-container h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: .5rem; }
.dv-subtitle { color: var(--love4, #f48fb1); font-size: .95rem; margin-bottom: 2rem; }
.dv-node-badge { display: inline-flex; align-items: center; gap: .5rem; background: rgba(30,20,40,.85); border: 1px solid rgba(255,107,157,.25); border-radius: 8px; padding: .4rem .8rem; font-size: .85rem; font-family: monospace; margin-bottom: 1.5rem; }
.dv-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block; }

/* Stats */
.dv-stats { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
.dv-stat { background: rgba(30,20,40,.85); border-radius: 12px; padding: .75rem 1rem; flex: 1; min-width: 120px; text-align: center; }
.dv-num { font-size: 1.5rem; font-weight: 700; color: var(--love1); }
.dv-label { font-size: .75rem; color: #c4a6d0; text-transform: uppercase; letter-spacing: .05em; }

/* Mode notice */
.dv-mode-notice { border-radius: 12px; padding: 1rem 1.5rem; margin-bottom: 1.5rem; font-size: .9rem; display: flex; align-items: flex-start; gap: .75rem; }
.dv-mode-notice-anon { background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.3); }
.dv-mode-notice-user { background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.2); }
.dv-notice-icon { font-size: 1.3rem; flex-shrink: 0; }

/* Steps */
.dv-step { margin-bottom: 2rem; }
.dv-step-header { display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem; }
.dv-step-num { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, var(--love1), var(--love2)); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .9rem; flex-shrink: 0; box-shadow: 0 0 12px rgba(255,107,157,.3); }
.dv-step-num.done { background: linear-gradient(135deg, #22c55e, #16a34a); }
.dv-step-label { font-size: 1.1rem; font-weight: 600; }

/* Platform grid */
.dv-platforms { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .75rem; margin-bottom: 1rem; }
.dv-platform-card { background: rgba(30,20,40,.85); border: 2px solid transparent; border-radius: 12px; padding: 1rem; text-align: center; cursor: pointer; transition: all .15s; }
.dv-platform-card:hover { border-color: var(--love1); transform: translateY(-2px); box-shadow: 0 4px 20px rgba(255,107,157,.15); }
.dv-platform-card.selected { border-color: var(--love1); background: rgba(60,30,60,.7); box-shadow: 0 0 20px rgba(255,107,157,.2); }
.dv-platform-name { font-weight: 600; font-size: .9rem; }
.dv-platform-vendor { color: #c4a6d0; font-size: .75rem; }

/* Variants */
.dv-variants { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
.dv-variant-btn { background: rgba(30,20,40,.85); border: 2px solid rgba(255,107,157,.25); border-radius: 8px; padding: .4rem .8rem; cursor: pointer; color: var(--text, #f0e6f6); font-size: .85rem; transition: all .15s; font-family: inherit; }
.dv-variant-btn:hover { border-color: var(--love1); }
.dv-variant-btn.selected { border-color: var(--love1); background: rgba(60,30,60,.7); }
.dv-variant-note { font-size: .8rem; color: #c4a6d0; margin-top: .25rem; }

/* Panel */
.dv-panel { background: rgba(30,20,40,.85); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid rgba(255,107,157,.25); }

/* Prompt output */
.dv-prompt-output { position: relative; }
.dv-prompt-text { background: rgba(15,10,20,1); border: 1px solid rgba(255,107,157,.25); border-radius: 8px; padding: 1rem; font-family: monospace; font-size: .8rem; white-space: pre-wrap; word-break: break-word; max-height: 500px; overflow-y: auto; line-height: 1.5; color: var(--text, #f0e6f6); }
.dv-copy-btn { position: absolute; top: .5rem; right: .5rem; background: linear-gradient(135deg, var(--love1), var(--love2)); color: #fff; border: none; border-radius: 6px; padding: .4rem .8rem; cursor: pointer; font-weight: 600; font-size: .8rem; z-index: 1; transition: all .2s; font-family: inherit; }
.dv-copy-btn:hover { background: linear-gradient(135deg, var(--love3), var(--love1)); box-shadow: 0 0 12px rgba(255,107,157,.4); }
.dv-copy-btn.copied { background: #22c55e; }

/* Goals */
.dv-goals { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: .5rem; margin-bottom: 1rem; }
.dv-goal-card { background: rgba(30,20,40,.85); border: 2px solid rgba(255,107,157,.25); border-radius: 8px; padding: .75rem; cursor: pointer; transition: all .15s; font-size: .85rem; }
.dv-goal-card:hover { border-color: var(--love1); }
.dv-goal-card.selected { border-color: var(--love1); background: rgba(60,30,60,.7); }
.dv-goal-icon { font-size: 1.3rem; margin-bottom: .25rem; }

/* Cap tabs */
.dv-cap-tabs { display: flex; gap: 0; margin-bottom: 0; border-bottom: 2px solid rgba(255,107,157,.25); }
.dv-cap-tab { flex: 1; padding: .75rem 1rem; text-align: center; cursor: pointer; background: transparent; border: none; color: #c4a6d0; font-size: .9rem; font-weight: 600; transition: all .2s; border-bottom: 3px solid transparent; margin-bottom: -2px; position: relative; font-family: inherit; }
.dv-cap-tab:hover { color: var(--text, #f0e6f6); background: rgba(255,107,157,.05); }
.dv-cap-tab.active { color: var(--love1); border-bottom-color: var(--love1); background: rgba(255,107,157,.08); }
.dv-cap-tab.unavail { opacity: .45; cursor: default; }
.dv-cap-tab.unavail:hover { background: transparent; color: #c4a6d0; }
.dv-tab-icon { font-size: 1.2rem; display: block; margin-bottom: .15rem; }
.dv-tab-label { font-size: .8rem; display: block; }
.dv-tab-rec { position: absolute; top: 2px; right: 6px; font-size: .55rem; background: #22c55e; color: #fff; padding: 1px 5px; border-radius: 8px; text-transform: uppercase; letter-spacing: .05em; }
.dv-unavail-notice { text-align: center; padding: 2rem 1rem; color: #c4a6d0; font-size: .9rem; }
.dv-unavail-icon { font-size: 2rem; margin-bottom: .5rem; }

/* Instructions */
.dv-instructions { background: rgba(30,20,40,.85); border-radius: 12px; padding: 1.5rem; border: 1px solid rgba(255,107,157,.25); }
.dv-instructions ol { margin-left: 1.5rem; margin-bottom: .75rem; }
.dv-instructions li { margin-bottom: .5rem; }
.dv-instructions code { background: rgba(15,10,20,1); padding: .15rem .4rem; border-radius: 4px; font-size: .85rem; font-family: monospace; }

/* Upload */
.dv-upload-area { border: 2px dashed rgba(255,107,157,.25); border-radius: 12px; padding: 1.5rem; text-align: center; margin-top: 1rem; transition: all .2s; }
.dv-upload-area:hover { border-color: var(--love1); }
.dv-upload-area.dragover { border-color: var(--love1); background: rgba(255,107,157,.05); }
.dv-upload-btn { background: linear-gradient(135deg, var(--love1), var(--love2)); color: #fff; border: none; border-radius: 8px; padding: .5rem 1.2rem; cursor: pointer; font-weight: 600; font-size: .9rem; transition: all .2s; font-family: inherit; }
.dv-upload-btn:hover { background: linear-gradient(135deg, var(--love3), var(--love1)); box-shadow: 0 0 16px rgba(255,107,157,.4); }
.dv-upload-btn:disabled { opacity: .5; cursor: not-allowed; }

/* Share URL */
.dv-share-url { display: flex; align-items: center; gap: .5rem; background: rgba(15,10,20,1); border: 1px solid #22c55e; border-radius: 8px; padding: .6rem 1rem; margin-top: .75rem; font-family: monospace; font-size: .85rem; }
.dv-share-url input { flex: 1; background: none; border: none; color: var(--text, #f0e6f6); font-family: monospace; font-size: .85rem; outline: none; }
.dv-share-url .dv-copy-btn { position: static; background: #22c55e; color: #0f172a; padding: .3rem .6rem; font-size: .8rem; }

/* App list */
.dv-app-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: .75rem; margin-top: 1rem; }
.dv-app-item { background: rgba(60,30,60,.7); border-radius: 8px; padding: 1rem; border: 1px solid rgba(255,107,157,.25); }
.dv-app-name { font-weight: 600; margin-bottom: .25rem; }
.dv-app-meta { font-size: .75rem; color: #c4a6d0; }
.dv-app-item a { color: var(--love1, #ff6b9d); }

@media (max-width: 600px) {
  .dv-platforms { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .dv-goals { grid-template-columns: 1fr; }
  .dv-stats { flex-direction: column; }
  .dv-container h1 { font-size: 1.4rem; }
}
`;
