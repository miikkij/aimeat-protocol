/**
 * @file views/profile/access-tab/access-tokens.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent Access Tokens section — create/revoke revocable Bearer
 *   tokens an agent can use to log in and test apps. Extracted from access-tab.js
 *   to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from access-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

// Mirrors the agent scope domains (agents-tab.js) — the same list agents are granted from.
const PAT_SCOPE_DOMAINS = [
  { key: 'memory', permissions: ['read', 'write', 'delete'] },
  { key: 'work', permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social', permissions: ['read', 'write'] },
  { key: 'wallet', permissions: ['read'] },
  { key: 'consent', permissions: ['manage'] },
  { key: 'catalogue', permissions: ['read'] },
  { key: 'generator', permissions: ['read', 'write', 'execute'] },
  { key: 'task', permissions: ['read', 'write', 'manage'] },
  { key: 'cortex', permissions: ['write'] },
  { key: 'ext', permissions: ['write'] },
];

function buildPatAgentPrompt(tokenData) {
  const url = (typeof window !== 'undefined' ? window.location.origin : '');
  const level = tokenData.grant_operator ? 'operator (full node control)'
    : tokenData.grant_owner ? 'owner (acts as me)'
    : `scoped agent (${(tokenData.scopes || []).join(', ') || 'no scopes'})`;
  return `I'm giving you an AIMEAT access token so you can log in to my node (${url}) as ${level} and check that a web app works.

Use it by adding this HTTP header to your requests (and, for browser testing, set it as an extra header in your browser automation so every request the page makes carries it):

  Authorization: Bearer ${tokenData.token}

The server recognizes the token and treats every request as if I'm logged in — no extra login step. Open the app, click through it, read/write via it, and confirm it behaves correctly. Tell me what you find.`;
}

export function AccessTokensSection({ session, showToast, initial }) {
  const { confirm, ConfirmUI } = useConfirm();
  const isOperator = (session.roles || []).includes('operator');

  const [tokens, setTokens] = useState(initial?.tokens ?? null);   // seeded from /v1/access/overview; else self-loads
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { token, prompt }

  // Create form
  const [label, setLabel] = useState('');
  const [selScopes, setSelScopes] = useState({});
  const [grantOwner, setGrantOwner] = useState(false);
  const [grantOperator, setGrantOperator] = useState(false);
  const [expiry, setExpiry] = useState('');

  const fullLevel = grantOwner || grantOperator;

  const load = useCallback(async () => {
    try { const r = await apiGet('/v1/access/tokens'); setTokens(r.data?.tokens || []); }
    catch (err) { swallowed('access-tokens', err); setTokens([]); }
  }, []);
  useEffect(() => { if (!initial) load(); }, [load]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded

  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const resetForm = () => {
    setShowCreate(false); setLabel(''); setSelScopes({});
    setGrantOwner(false); setGrantOperator(false); setExpiry('');
  };

  const toggleScope = (s) => setSelScopes(prev => ({ ...prev, [s]: !prev[s] }));

  const handleCreate = useCallback(async () => {
    if (!label.trim()) { showToast(t('profile.access.patLabelRequired') || 'Give the token a name'); return; }
    const scopes = fullLevel ? [] : Object.keys(selScopes).filter(k => selScopes[k]);
    if (!fullLevel && scopes.length === 0) {
      showToast(t('profile.access.patScopeRequired') || 'Select at least one scope, or Full / Operator');
      return;
    }
    setCreating(true);
    try {
      const body = {
        label: label.trim(), scopes,
        grant_owner: grantOwner, grant_operator: grantOperator,
      };
      if (expiry) body.expires_in = parseInt(expiry, 10);
      const r = await apiPost('/v1/access/tokens', body);
      const data = r.data;
      setCreated({ token: data.token, prompt: buildPatAgentPrompt(data) });
      resetForm();
      load();
    } catch (e) {
      showToast(e.message || (t('profile.access.patCreateError') || 'Failed to create token'));
    } finally { setCreating(false); }
  }, [label, fullLevel, selScopes, grantOwner, grantOperator, expiry, showToast, load]);

  const handleRevoke = useCallback((id, lbl) => {
    confirm(
      (t('profile.access.patConfirmRevoke') || 'Revoke token "{name}"? Agents using it lose access immediately.').replace('{name}', lbl),
      async () => {
        try {
          await apiDelete('/v1/access/tokens/' + id);
          showToast(t('profile.access.patRevoked') || 'Token revoked');
          load();
        } catch (e) { showToast(e.message); }
      },
      { danger: true },
    );
  }, [confirm, showToast, load]);

  const levelBadge = (tok) => {
    if (tok.grant_operator) return html`<span class="badge badge-danger">${t('profile.access.patOperator') || 'Operator'}</span>`;
    if (tok.grant_owner) return html`<span class="badge badge-warn">${t('profile.access.patFullOwner') || 'Full owner'}</span>`;
    return html`<span class="badge badge-info">${(tok.scopes || []).length} ${t('profile.access.patScopes') || 'scopes'}</span>`;
  };

  return html`
    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.patTitle') || 'Agent Access Tokens'}</h3>
    <div class="section-desc">${t('profile.access.patDesc') || 'Create a revocable token an agent can use (as a Bearer header) to log in and test your apps. One token can be shared across all your agents.'}</div>

    ${created && html`
      <div class="card access-card-warn">
        <div class="card-title">${t('profile.access.patCreatedTitle') || 'Token created — copy it now'}</div>
        <div class="access-warn-text">⚠ ${t('profile.access.patShownOnce') || 'This token is shown only once. Store it now; you cannot see it again.'}</div>
        <div class="mem-item">
          <div class="access-mono access-pat-token">${escHtml(created.token)}</div>
          <${CopyButton} text=${created.token} className="btn-sm"
            onCopied=${() => showToast(t('profile.access.patCopied') || 'Token copied')} />
        </div>
        <div class="mem-item access-pat-prompt-row">
          <span class="mem-key">${t('profile.access.patAgentPrompt') || 'Ready-made agent prompt'}</span>
          <${CopyButton} text=${created.prompt} className="btn-sm"
            onCopied=${() => showToast(t('profile.access.patPromptCopied') || 'Prompt copied')} />
        </div>
        <div class="form-actions">
          <button class="btn-ghost btn-sm" onClick=${() => setCreated(null)}>${t('profile.access.patDone') || 'Done'}</button>
        </div>
      </div>
    `}

    ${tokens === null
      ? html`<div class="empty">${t('profile.access.patLoading') || 'Loading...'}</div>`
      : tokens.length === 0
        ? (!showCreate && html`
            <div class="access-empty-row">
              <span class="text-meta-sm">${t('profile.access.patEmpty') || 'No access tokens yet.'}</span>
              <button class="btn-outline btn-sm" onClick=${() => setShowCreate(true)}>${t('profile.access.patCreate') || 'New Token'}</button>
            </div>`)
        : tokens.map(tok => html`
            <div class="card" key=${tok.id}>
              <div class="flex-between">
                <div class="card-title">${escHtml(tok.label)}</div>
                ${levelBadge(tok)}
              </div>
              <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">${t('profile.access.patCreatedAt') || 'Created'}</span><span class="detail-value">${new Date(tok.created_at).toLocaleDateString()}</span></div>
                <div class="detail-item"><span class="detail-label">${t('profile.access.patLastUsed') || 'Last used'}</span><span class="detail-value">${tok.last_used_at ? new Date(tok.last_used_at).toLocaleString() : (t('profile.access.patNever') || 'never')}</span></div>
                <div class="detail-item"><span class="detail-label">${t('profile.access.patExpires') || 'Expires'}</span><span class="detail-value">${tok.expires_at ? new Date(tok.expires_at).toLocaleDateString() : (t('profile.access.patNoExpiry') || 'never')}</span></div>
              </div>
              ${!tok.grant_owner && !tok.grant_operator && (tok.scopes || []).length > 0 && html`
                <div class="flex-row-wrap mt-half">
                  ${tok.scopes.map(s => html`<span class="badge badge-muted" key=${s}>${s}</span>`)}
                </div>
              `}
              <div class="card-actions">
                <button class="btn-danger-solid btn-sm" onClick=${() => handleRevoke(tok.id, tok.label)}>${t('profile.access.patRevoke') || 'Revoke'}</button>
              </div>
            </div>
          `)
    }

    ${!showCreate ? (tokens?.length > 0 && html`
      <div class="mb-1"><button class="btn-outline" onClick=${() => setShowCreate(true)}>${t('profile.access.patCreate') || 'New Token'}</button></div>
    `) : html`
      <div class="create-form">
        <h4 class="card-h3 mb-half">${t('profile.access.patCreateTitle') || 'Create Access Token'}</h4>
        <div class="flex-col">
          <div class="form-row">
            <label>${t('profile.access.patLabel') || 'Name'}</label>
            <input type="text" class="input-field input-sm"
              placeholder=${t('profile.access.patLabelPlaceholder') || 'e.g. App tester'}
              value=${label} onInput=${e => setLabel(e.target.value)} />
          </div>

          <div class="form-row">
            <label>${t('profile.access.patLevel') || 'Permissions'}</label>
            <label class="flex-row">
              <input type="checkbox" checked=${grantOwner} disabled=${grantOperator}
                onChange=${() => setGrantOwner(v => !v)} />
              <strong>${t('profile.access.patFullOwner') || 'Full owner'}</strong> — ${t('profile.access.patFullOwnerHint') || 'acts as you; sees all apps & data'}
            </label>
            ${isOperator && html`
              <label class="flex-row">
                <input type="checkbox" checked=${grantOperator}
                  onChange=${() => setGrantOperator(v => !v)} />
                <strong>${t('profile.access.patOperator') || 'Operator'}</strong> — ${t('profile.access.patOperatorHint') || 'full node administration (master key)'}
              </label>
            `}
            ${fullLevel && html`<span class="badge badge-warn">⚠ ${t('profile.access.patMasterKeyWarn') || 'Master key — guard it like a password'}</span>`}
          </div>

          ${!fullLevel && html`
            <div class="form-row">
              <label>${t('profile.access.patSelectScopes') || 'Scopes'}</label>
              ${PAT_SCOPE_DOMAINS.map(dom => html`
                <div class="flex-row-wrap access-pat-scope-row" key=${dom.key}>
                  <span class="access-pat-scope-domain">${dom.key}</span>
                  ${dom.permissions.map(p => {
                    const s = `${dom.key}:${p}`;
                    return html`<label class="flex-row" key=${s}>
                      <input type="checkbox" checked=${!!selScopes[s]} onChange=${() => toggleScope(s)} /> ${p}
                    </label>`;
                  })}
                </div>
              `)}
            </div>
          `}

          <div class="form-row">
            <label>${t('profile.access.patExpiry') || 'Expiry'}</label>
            <select class="input-field input-sm" value=${expiry} onChange=${e => setExpiry(e.target.value)}>
              <option value="">${t('profile.access.patNoExpiry') || 'No expiry'}</option>
              <option value="86400">${t('profile.access.patExpiry1d') || '24 hours'}</option>
              <option value="604800">${t('profile.access.patExpiry7d') || '7 days'}</option>
              <option value="2592000">${t('profile.access.patExpiry30d') || '30 days'}</option>
            </select>
          </div>

          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating}>
              ${creating ? '...' : (t('profile.access.patCreateBtn') || 'Create Token')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${resetForm}>${t('profile.access.patCancel') || 'Cancel'}</button>
          </div>
        </div>
      </div>
    `}
    <${ConfirmUI} />
  `;
}
