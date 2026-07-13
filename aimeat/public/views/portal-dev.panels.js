/**
 * @file public/views/portal-dev.panels.js
 * @description Connection panels (MCP/API/Browse/Prompt Package) + capability tabs for the portal-dev view. Extracted from portal-dev.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
 */
import { useState, useCallback } from 'preact/hooks';
import { sanitizeHtml, copyToClipboard } from '/js/utils.js';
import { html, NODE_URL, dt, GOAL_LIST, CopyBtn } from './portal-dev.shared.js';

/* ══════════════════════════════════════════════
   PANELS (MCP, API, Browse, Prompt Package)
   ══════════════════════════════════════════════ */
function McpPanel({ locale, isLoggedIn, session }) {
  const [setupTab, setSetupTab] = useState('code'); // 'code' | 'cowork' | 'chat'
  const [copied, setCopied] = useState(false);

  const mcpUrl = `${NODE_URL}/v1/mcp`;

  const copyUrl = useCallback(async () => {
    await copyToClipboard(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mcpUrl]);

  const copyCommand = useCallback(async () => {
    await copyToClipboard(`claude mcp add aimeat --transport http ${mcpUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mcpUrl]);

  const tabStyle = (tab) => `padding:.4rem .75rem;border:none;border-radius:.25rem .25rem 0 0;cursor:pointer;font-size:.8rem;font-weight:600;${
    setupTab === tab
      ? 'background:rgba(130,100,255,.15);color:var(--accent,#a78bfa)'
      : 'background:transparent;color:var(--muted)'
  }`;

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

          <!-- Platform tabs -->
          <div style="display:flex;gap:2px;margin-top:.75rem;border-bottom:1px solid rgba(130,100,255,.2)">
            <button type="button" style="${tabStyle('code')}" onClick=${() => setSetupTab('code')}>
              Claude Code
            </button>
            <button type="button" style="${tabStyle('cowork')}" onClick=${() => setSetupTab('cowork')}>
              Claude Desktop
            </button>
            <button type="button" style="${tabStyle('chat')}" onClick=${() => setSetupTab('chat')}>
              Claude.ai Chat
            </button>
          </div>

          <!-- Tab content -->
          <div style="padding:.75rem 0 0">
            ${setupTab === 'code' && html`
              <p style="font-size:.82rem;color:var(--muted);margin:0 0 .75rem">
                ${dt('panel.mcpSetupCodeDesc', locale)}
              </p>
              <div style="margin-bottom:.75rem">
                <div style="font-size:.8rem;color:var(--muted);margin-bottom:.25rem">${dt('panel.mcpCodeRunThis', locale)}</div>
                <div style="display:flex;align-items:center;gap:.5rem">
                  <code style="font-size:.78rem;background:var(--code-bg);padding:.4rem .6rem;border-radius:.25rem;user-select:all;flex:1;word-break:break-all">claude mcp add aimeat --transport http ${mcpUrl}</code>
                  <button type="button" onClick=${copyCommand}
                    style="padding:.3rem .6rem;background:var(--love1,#E8564A);color:#fff;border:none;border-radius:.25rem;cursor:pointer;font-size:.75rem;white-space:nowrap">
                    ${copied ? dt('panel.mcpCopied', locale) : dt('panel.mcpCopyCommand', locale)}
                  </button>
                </div>
              </div>
              <p style="font-size:.8rem;color:var(--muted);margin:0;font-style:italic">
                ${dt('panel.mcpCodeOAuthNote', locale)}
              </p>
            `}

            ${setupTab === 'cowork' && html`
              <p style="font-size:.82rem;color:var(--muted);margin:0 0 .75rem">
                ${dt('panel.mcpSetupCoworkDesc', locale)}
              </p>
              <div style="font-size:.85rem">
                <ol style="margin:0;padding-left:1.25rem;line-height:1.8">
                  <li>${dt('panel.mcpDesktopStep1', locale)}
                    <div style="margin:.5rem 0">
                      <img src="/assets/mcp_1_add_custom_connector.png" alt="Add custom connector dialog"
                        style="max-width:100%;border-radius:.5rem;border:1px solid var(--border,rgba(255,255,255,.1))" />
                    </div>
                  </li>
                  <li>${dt('panel.mcpDesktopStep2', locale)}
                    <div style="display:flex;align-items:center;gap:.5rem;margin:.4rem 0">
                      <code style="font-size:.78rem;background:var(--code-bg);padding:.25rem .5rem;border-radius:.25rem;user-select:all">${mcpUrl}</code>
                      <button type="button" onClick=${copyUrl}
                        style="padding:.2rem .5rem;background:rgba(130,100,255,.15);color:var(--accent,#a78bfa);border:1px solid rgba(130,100,255,.3);border-radius:.25rem;cursor:pointer;font-size:.75rem;white-space:nowrap">
                        ${copied ? dt('panel.mcpCopied', locale) : dt('panel.mcpCopyUrl', locale)}
                      </button>
                    </div>
                  </li>
                  <li>${dt('panel.mcpDesktopStep3', locale)}
                    <div style="margin:.5rem 0">
                      <img src="/assets/mcp_2_connect_disconnect_connector.png" alt="Connected connector with options"
                        style="max-width:100%;border-radius:.5rem;border:1px solid var(--border,rgba(255,255,255,.1))" />
                    </div>
                  </li>
                  <li>${dt('panel.mcpDesktopStep4', locale)}</li>
                </ol>
                <p style="margin-top:.75rem;font-size:.8rem;color:var(--muted);font-style:italic">${dt('panel.mcpDesktopNote', locale)}</p>
              </div>
            `}

            ${setupTab === 'chat' && html`
              <div style="font-size:.85rem">
                <p style="margin:0 0 .75rem;color:var(--muted)">${dt('panel.mcpSetupChatDesc', locale)}</p>
                <ol style="margin:0;padding-left:1.25rem;line-height:1.6">
                  <li>${dt('panel.mcpChatStep1', locale)}</li>
                  <li>${dt('panel.mcpChatStep2', locale)}
                    <div style="margin:.5rem 0">
                      <img src="/assets/mcp_1_add_custom_connector.png" alt="Add custom connector dialog"
                        style="max-width:100%;border-radius:.5rem;border:1px solid var(--border,rgba(255,255,255,.1))" />
                    </div>
                  </li>
                  <li>${dt('panel.mcpChatStep3', locale)}
                    <div style="display:flex;align-items:center;gap:.5rem;margin:.4rem 0">
                      <code style="font-size:.8rem;background:var(--code-bg);padding:.25rem .5rem;border-radius:.25rem;user-select:all">${mcpUrl}</code>
                      <button type="button" onClick=${copyUrl}
                        style="padding:.2rem .5rem;background:rgba(130,100,255,.15);color:var(--accent,#a78bfa);border:1px solid rgba(130,100,255,.3);border-radius:.25rem;cursor:pointer;font-size:.75rem;white-space:nowrap">
                        ${copied ? dt('panel.mcpCopied', locale) : dt('panel.mcpCopyUrl', locale)}
                      </button>
                    </div>
                  </li>
                  <li>${dt('panel.mcpChatStep4', locale)}</li>
                  <li>${dt('panel.mcpChatStep5', locale)}
                    <div style="margin:.5rem 0">
                      <img src="/assets/mcp_2_connect_disconnect_connector.png" alt="Connected connector ready to use"
                        style="max-width:100%;border-radius:.5rem;border:1px solid var(--border,rgba(255,255,255,.1))" />
                    </div>
                  </li>
                </ol>
                <p style="margin-top:.75rem;font-size:.8rem;color:var(--muted);font-style:italic">${dt('panel.mcpChatNote', locale)}</p>
              </div>
            `}
          </div>
        </div>
      `}

      <div class="dv-instructions">
        <p dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpTools', locale)) }}></p>
      </div>

      ${isLoggedIn && html`
        <div style="margin-top:.75rem;padding:.5rem .75rem;background:rgba(100,200,255,.06);border:1px solid rgba(100,200,255,.15);border-radius:.25rem;font-size:.82rem">
          <span dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpProfileLink', locale)) }}></span>
          ${' '}
          <a href="/v1/profile#mcp" style="color:var(--accent,#a78bfa);text-decoration:underline">
            ${dt('panel.mcpProfileLinkAction', locale)}
          </a>
        </div>
      `}

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

export { CapTabs };
