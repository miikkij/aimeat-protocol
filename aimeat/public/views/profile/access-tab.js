/**
 * @file access-tab.js
 * @description Profile tab displaying session info, public key, owner key,
 *   MCP endpoint details, federation access management, sharing groups,
 *   and owner-level agent defaults.
 * @structure
 *   - AccessTab (default export) -- main tab component
 *   - SharingGroupsSection -- CRUD for sharing groups with expandable member lists
 *   - AgentDefaultsSection -- owner-level default rules and token budget for agents
 * @version-history
 *   v1.0.0 -- 2026-03-16 -- Initial access tab
 *   v1.1.0 -- 2026-03-17 -- Replace inline styles with CSS classes
 *   v1.2.0 -- 2026-05-21 -- Add Federation Access section for auth consent management
 *   v1.3.0 -- 2026-05-21 -- Add Sharing Groups and Agent Defaults sections
 *   v1.4.0 -- 2026-06-10 -- Security-page clarity round: federation allow-all warning is a
 *     caption under the checkbox and the allowlist dims/disables while allow-all is on;
 *     Public Key reads the real key from GET /v1/ghii/me (+ explanatory text when absent);
 *     JWT row shows "Valid until HH:MM (h)" decoded from the token; copy buttons on
 *     GHII/Node/MCP endpoint; empty token/group states are one-line rows; section headers
 *     neutral (access-h3, emojis dropped) and Add Node / New Token / New Group de-accented;
 *     Token Budget value is click-to-edit and the empty-rules state shows an example rule;
 *     sharing-groups section accepts the Memory tab's deep link (aimeat.access.focus).
 *   v1.5.0 -- 2026-06-20 -- Add Connected Apps section (H-2 app grants): list + revoke the
 *     scoped, user-approved access tokens published apps hold (GET/DELETE /v1/app-grants).
 *   v1.6.0 -- 2026-07-16 -- Mount folds the 6-request fan-out into ONE GET /v1/access/overview
 *     (AccessTabService); parent seeds consent+public-key, the four child sections seed from their
 *     `initial` slice and skip their own mount fetch (live-update still self-refreshes). Falls back to
 *     the individual endpoints if the composite is unavailable. (Phase 4 slice 2 — frontend half.)
 *   v1.7.0 -- 2026-08-08 -- Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { getNodeUrl } from '/js/services/auth.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { CopyButton } from '/components/CopyButton.js';
import { SharingGroupsSection } from './access-tab/sharing-groups.js';
import { AgentDefaultsSection } from './access-tab/agent-defaults.js';
import { ConnectedAppsSection } from './access-tab/connected-apps.js';
import { AccessTokensSection } from './access-tab/access-tokens.js';
import { ConnectionsSection } from './access-tab/connections.js';
import { swallowed } from '/js/swallowed.js';

/* ═══════════════════════════════════════════════════════════════════
   Main Access Tab
   ═══════════════════════════════════════════════════════════════════ */

/** Decode the JWT's exp claim → { until: Date, hoursLeft } or null. Display-only. */
function jwtExpiry(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return null;
    const until = new Date(payload.exp * 1000);
    return { until, hoursLeft: Math.max(0, (until.getTime() - Date.now()) / 3600000) };
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  } catch { return null; }
}

export default function AccessTab({ session, showToast }) {
  const NODE_URL = getNodeUrl();
  const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;
  const [keyBlurred, setKeyBlurred] = useState(true);
  const [authConsents, setAuthConsents] = useState([]);
  const [newNodeId, setNewNodeId] = useState('');
  const [fedLoading, setFedLoading] = useState(false);
  // undefined = loading, null = no keypair stored, string = the key
  const [pubKey, setPubKey] = useState(undefined);

  // Mount: ONE composite call (GET /v1/access/overview) seeds the parent (auth consents + public key)
  // AND the four child sections (app-grants / access-tokens / groups / agent-defaults), which receive
  // their slice as `initial` and skip their own mount fetch. undefined = loading, null = composite
  // unavailable → parent + children fall back to the individual endpoints.
  const [overview, setOverview] = useState(undefined);
  useEffect(() => {
    apiGet('/v1/access/overview').then(r => {
      const d = r?.data;
      if (!d) throw new Error('no overview');
      setAuthConsents((d.consent?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      setPubKey(d.publicKey ?? null);
      setOverview(d);
    }).catch(() => {
      setOverview(null);   // children self-load; parent falls back to its own two reads
      apiGet('/v1/consent').then(data => setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'))).catch(err => { swallowed('access-tab: AccessTab', err); });
      apiGet('/v1/ghii/me').then(r => setPubKey(r?.data?.public_key ?? null)).catch(() => setPubKey(null));
    });
  }, []);

  async function addAuthNode() {
    if (!newNodeId.trim()) return;
    setFedLoading(true);
    try {
      await apiPost('/v1/consent', {
        data_pattern: '_identity',
        recipient: 'node:' + newNodeId.trim(),
        scope: 'auth',
        purpose: 'federation_login',
      });
      setNewNodeId('');
      const data = await apiGet('/v1/consent');
      setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      showToast(t('profile.access.fedGranted'));
    } catch (e) {
      showToast(e.message);
    } finally {
      setFedLoading(false);
    }
  }

  async function removeAuthConsent(id) {
    try {
      await apiDelete('/v1/consent/' + id);
      setAuthConsents(prev => prev.filter(c => c.id !== id));
      showToast(t('profile.access.fedRevoked'));
    } catch (e) {
      showToast(e.message);
    }
  }

  async function toggleAllowAll() {
    const wildcard = authConsents.find(c => c.recipient === '*');
    if (wildcard) {
      await removeAuthConsent(wildcard.id);
    } else {
      try {
        await apiPost('/v1/consent', {
          data_pattern: '_identity',
          recipient: '*',
          scope: 'auth',
          purpose: 'federation_login_all',
        });
        const data = await apiGet('/v1/consent');
        setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      } catch (e) {
        showToast(e.message);
      }
    }
  }

  const exp = session.jwt ? jwtExpiry(session.jwt) : null;
  const copyRow = (label, value) => html`
    <div class="mem-item"><span class="mem-key">${label}</span>
      <span class="access-copy-val">${escHtml(value || '-')}
        ${value && html`<${CopyButton} text=${value} className="btn-ghost btn-sm" label="📋" onCopied=${() => showToast(t('common.copied') || 'Copied')} />`}
      </span>
    </div>`;

  return html`
    <div class="section-title">${t('profile.access.title')}</div>
    <div class="section-desc">${t('profile.access.desc')}</div>

    <h3 class="card-h3 access-h3">${t('profile.access.session')}</h3>
    <div class="card">
      <div class="mem-item"><span class="mem-key">${t('profile.access.owner')}</span><span>${escHtml(session.owner || '-')}</span></div>
      ${copyRow(t('profile.access.ghii'), session.ghii)}
      ${session.gaii && copyRow(t('profile.access.agentGaii'), session.gaii)}
      ${copyRow(t('profile.access.node'), NODE_URL)}
      <div class="mem-item"><span class="mem-key">${t('profile.access.jwtValid')}</span><span>
        ${session.valid
          ? (exp
              ? html`<span class="badge badge-success">${(t('profile.access.validUntil') || 'Valid until {time} ({h} h)').replace('{time}', exp.until.toLocaleTimeString(getLocale() === 'fi' ? 'fi-FI' : undefined, { hour: '2-digit', minute: '2-digit' })).replace('{h}', exp.hoursLeft < 1 ? '<1' : String(Math.round(exp.hoursLeft)))}</span>`
              : html`<span class="badge badge-success">${t('profile.access.yes')}</span>`)
          : html`<span class="badge badge-danger">${t('profile.access.expired')}</span>`}
      </span></div>
    </div>

    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.publicKey')}</h3>
    <div class="card">
      ${pubKey === undefined
        ? html`<div class="access-mono">…</div>`
        : pubKey
          ? html`<div class="flex-between"><div class="access-mono">${escHtml(pubKey)}</div>
              <${CopyButton} text=${pubKey} className="btn-ghost btn-sm" label="📋" onCopied=${() => showToast(t('common.copied') || 'Copied')} /></div>`
          : html`<div class="text-meta-sm">${t('profile.access.noKeypair') || 'No keypair is stored for this account. Keys are generated at registration; older accounts may not have one.'}</div>`}
    </div>

    ${ownerKey && html`
      <h3 class="card-h3 access-h3 mt-section">${t('profile.access.ownerKey')}</h3>
      <div class="card access-card-warn" onClick=${() => copyToClipboard(ownerKey).then(() => showToast(t('profile.access.keyCopied')))}>
        <div class="flex-between">
          <div class="access-mono ${keyBlurred ? 'access-key-blur' : 'access-key-blur revealed'}"
            onMouseEnter=${() => setKeyBlurred(false)} onMouseLeave=${() => setKeyBlurred(true)}>
            ${escHtml(ownerKey)}
          </div>
          <div class="flex-row">
            <span class="badge badge-warn">${t('profile.access.hoverReveal')}</span>
            <span onClick=${(e) => e.stopPropagation()}>
              <${CopyButton} text=${ownerKey} className="btn-sm"
                onCopied=${() => showToast(t('profile.access.keyCopied'))} />
            </span>
          </div>
        </div>
        <div class="access-warn-text">⚠ ${t('profile.access.keepSafe')}</div>
      </div>
    `}

    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.mcpEndpoint')}</h3>
    <div class="card">
      <div class="flex-between">
        <div class="access-mcp-url">${escHtml(NODE_URL + '/v1/mcp')}</div>
        <${CopyButton} text=${NODE_URL + '/v1/mcp'} className="btn-ghost btn-sm" label="📋" onCopied=${() => showToast(t('common.copied') || 'Copied')} />
      </div>
      <div class="access-mcp-desc">${t('profile.access.mcpDesc')}</div>
    </div>

    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.fedTitle')}</h3>
    <div class="section-desc">${t('profile.access.fedDesc')}</div>

    ${(() => {
      const allowAll = authConsents.some(c => c.recipient === '*');
      return html`
    <div class="card">
      <div class="access-fed-allowall">
        <label class="flex-row">
          <input type="checkbox" checked=${allowAll} onChange=${toggleAllowAll} />
          ${t('profile.access.fedAllowAll')}
        </label>
        ${allowAll && html`
          <div class="access-fed-warn-caption">⚠ ${t('profile.access.fedAllowAllCaption') || 'Any federation node can verify your identity. Uncheck to restrict to the list below.'}</div>
        `}
      </div>

      <!-- The allowlist is meaningless while allow-all is on — dim it so it cannot
           masquerade as the active control. -->
      <div class=${allowAll ? 'access-fed-list access-fed-list--inactive' : 'access-fed-list'}>
        ${authConsents.filter(c => c.recipient !== '*').length === 0 && !allowAll && html`
          <p class="adm-text-dim">${t('profile.access.fedNoConsents')}</p>
        `}
        ${authConsents.filter(c => c.recipient !== '*').map(c => html`
          <div class="mem-item">
            <span class="mem-key">${escHtml(c.recipient.replace('node:', ''))}</span>
            <span class="adm-text-dim" style="font-size:.85em">${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : ''}</span>
            <button class="btn-ghost btn-danger" disabled=${allowAll} onClick=${() => removeAuthConsent(c.id)}>
              ${t('profile.access.fedRemove')}
            </button>
          </div>
        `)}

        <div class="mem-item access-fed-add">
          <input type="text" class="input-field input-sm" placeholder=${t('profile.access.fedNodeId')}
            disabled=${allowAll}
            value=${newNodeId} onInput=${e => setNewNodeId(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && addAuthNode()} />
          <button class="btn-outline" onClick=${addAuthNode} disabled=${fedLoading || allowAll}>
            ${t('profile.access.fedAddNode')}
          </button>
        </div>
      </div>
    </div>`;
    })()}

    ${overview !== undefined ? html`
      <${ConnectedAppsSection} showToast=${showToast} initial=${overview?.appGrants} />
      <${AccessTokensSection} session=${session} showToast=${showToast} initial=${overview?.accessTokens} />
      <${ConnectionsSection} showToast=${showToast} />
      <${SharingGroupsSection} showToast=${showToast} initial=${overview?.groups} />
      <${AgentDefaultsSection} showToast=${showToast} initial=${overview?.agentDefaults} />
    ` : null}
  `;
}
