/**
 * @file data-wallet-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Data Wallet profile tab — displays consent rules, audit trail,
 *   permission summary, and GDPR export controls for the logged-in owner.
 * @structure
 *   - DataWalletTab (default export) — main tab component
 *   - Permission summary card, consent table with filter/bulk-revoke,
 *     audit log with day-range selector, GDPR export button
 * @usage Loaded by profile.js route as a lazy tab component.
 * @version-history
 *   v1.7.0 — 2026-08-25 — Both tables told the owner something untrue. The consent table listed
 *     REVOKED grants alongside live ones and stamped every non-expired row `active`, so a grant the
 *     owner had withdrawn read as still standing; it now reads `status`, shows revoked rows only
 *     behind a toggle, and offers Revoke on a row that still has something to revoke. The audit
 *     table read `data_key` and `purpose`, which the audit API has never returned (it sends
 *     `memory_key`, `action`, `allowed`), so two of its four columns were a dash on every row and
 *     the one fact that matters, whether the read was allowed or denied, was not shown at all.
 *   v1.6.0 — 2026-08-25 — The coverage view, above the permission summary. That card counts memory
 *     keys without saying which, and this is the drill-down it is asking for.
 *   v1.5.0 — 2026-08-24 — Live update is filtered and split by concern. It was a raw
 *     `aimeat-live-update` listener with no domain filter, so every tick of every domain re-ran all
 *     three reads; `memory` alone emits from thirty places. Consents + audit follow `consent`, and
 *     the permission summary follows `memory` and `files` as well, because it counts both.
 *   v1.4.0 — 2026-07-18 — Vaihe 2d: the bespoke `audit-table` → canonical generic <DataTable>
 *     (rows/headers), unifying its look with the node-wide table style. The consents `consent-table`
 *     stays hand-rolled (its per-row `dw-expiring` highlight isn't expressible via DataTable).
 *   v1.3.0 — 2026-07-16 — Mount folds consents + audit + permission-summary into GET /v1/data-wallet
 *     (getDataWalletOverview); individual reads kept as fallback + interactive re-fetch.
 *   v1.2.0 — 2026-07-16 — Consent-grant recipient input is the shared ContactPicker (contacts +
 *     directory suggestions + email resolve, full-id mode).
 *   v1.1.1 — 2026-06-19 — lint fixes (misleading-char-class/unused-expression/empty-block)
 *   v1.1.0 — 2026-03-17 — Refactor: replace all inline styles with CSS classes
 *   v1.0.0 — 2026-03-10 — Initial data wallet tab implementation
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner, recipientBadge, isExpiringSoon } from './shared.js';
import { DataTable } from '/components/DataTable.js';
import * as consentService from '/js/services/consent.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';

export default function DataWalletTab({ session, showToast }) {
  const [consents, setConsents] = useState(null);
  const [auditEntries, setAuditEntries] = useState(null);
  const [auditDays, setAuditDays] = useState(30);
  const [permSummary, setPermSummary] = useState(null);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [consentFilter, setConsentFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  // Revoked grants are history, not access. They stay out of the list until the owner asks for them.
  const [showRevoked, setShowRevoked] = useState(false);
  const [selectedConsents, setSelectedConsents] = useState(new Set());
  const [recipientValue, setRecipientValue] = useState('');

  useEffect(() => {
    if (!session) return;
    // Mount fold: ONE composite (consents + audit + permission summary). On failure, fall back to the
    // three individual reads. Interactive re-fetches (grant/revoke, audit day-range) keep the individuals.
    (async () => {
      const ov = await consentService.getDataWalletOverview(30);
      if (ov) {
        setConsents(Array.isArray(ov.consents) ? ov.consents : []);
        setAuditEntries(Array.isArray(ov.audit) ? ov.audit : []);
        setPermSummary(ov.permSummary || null);
        return;
      }
      loadConsents(); loadAudit(30); loadPermSummary();
    })();
  }, [session]);

  async function loadConsents() {
    try {
      const list = await consentService.listConsents();
      setConsents(Array.isArray(list) ? list : []);
    } catch (err) { swallowed('data-wallet-tab', err); setConsents([]); }
  }

  async function loadAudit(days) {
    try {
      const list = await consentService.listAuditEntries(days);
      setAuditEntries(Array.isArray(list) ? list : []);
    } catch (err) { swallowed('data-wallet-tab', err); setAuditEntries([]); }
  }

  async function loadPermSummary() {
    try {
      const data = await consentService.getPermissionSummary();
      setPermSummary(data || null);
    } catch (err) { swallowed('data-wallet-tab', err); setPermSummary(null); }
  }

  // Live update, one subscription per concern.
  //
  // This used to be a raw `aimeat-live-update` listener with NO domain filter, so every tick of every
  // domain — and `memory` alone emits from thirty places — re-ran all three reads. On an account with
  // a busy agent that is three requests a second for data that had not changed. Consents and the audit
  // trail both move only on `consent`; the permission summary counts memory keys and storage files, so
  // it also follows `memory` and `files`.
  const loadConsentSideRef = useRef(null);
  loadConsentSideRef.current = () => { loadConsents(); loadAudit(auditDays); loadPermSummary(); };
  const loadPermSummaryRef = useRef(null);
  loadPermSummaryRef.current = () => { loadPermSummary(); };
  useEffect(() => onLiveUpdate(['consent'], () => loadConsentSideRef.current()), []);
  useEffect(() => onLiveUpdate(['memory', 'files'], () => loadPermSummaryRef.current()), []);

  async function handleGrant(body) {
    try {
      await consentService.grantConsent(body);
      showToast(t('permissions.granted'));
      setShowConsentForm(false);
      loadConsents();
      loadPermSummary();
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  async function handleRevoke(id) {
    try {
      await consentService.revokeConsent(id);
      showToast(t('wallet.consents.revoked'));
      loadConsents();
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  async function handleBulkRevoke(ids) {
    try {
      await consentService.bulkRevoke([...ids]);
      showToast(t('wallet.consents.revoked'));
    } catch (e) { showToast(e.message || t('profile.error'), true); }
    setSelectedConsents(new Set());
    loadConsents();
    loadPermSummary();
  }

  async function handleExport() {
    try {
      const data = await consentService.exportGdpr(session.owner);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aimeat-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { swallowed('data-wallet-tab', err); showToast(t('profile.error'), true); }
  }

  /** A grant the owner withdrew, or one the node expired: neither gives access any more. */
  const isRevoked = (c) => c.status === 'revoked';
  const isExpiredConsent = (c) => c.status === 'expired'
    || !!((c.expires_at || c.expires) && new Date(c.expires_at || c.expires) < new Date());
  const isLive = (c) => !isRevoked(c) && !isExpiredConsent(c);

  const filteredConsents = consents?.filter(c => {
    // Status: what is live is the answer to "who has access"; the rest is history, behind the toggle.
    if (!showRevoked && !isLive(c)) return false;
    // Scope filter
    if (scopeFilter === 'federation' && c.scope !== 'federation') return false;
    if (scopeFilter === 'auth' && c.scope !== 'auth') return false;
    // Text filter
    if (!consentFilter) return true;
    const q = consentFilter.toLowerCase();
    const recip = (c.recipient_gaii || c.recipient || '').toLowerCase();
    const pat = (c.data_pattern || c.pattern || '').toLowerCase();
    return recip.includes(q) || pat.includes(q);
  });

  return html`
    <div class="section-title">\u{1F6E1}\uFE0F ${t('profile.tabs.dataWallet')}</div>

      ${/* What is stored here that nobody has described. Above the totals, because the summary
            card below counts memory keys without saying which, and this is the drill-down that
            counter is asking for. */ ''}

    ${permSummary && html`
      <div class="card dw-summary-card">
        <h3 class="card-h3">${t('permissions.summaryTitle')}</h3>
        <div class="dw-summary-grid mb-1">
          <div class="dw-stat">
            <div class="dw-stat-value">${permSummary.active_consents || 0}</div>
            <div class="text-meta-sm">${t('permissions.summaryActiveRules')}</div>
          </div>
          <div class="dw-stat">
            <div class="dw-stat-value">${permSummary.total_memory_keys || 0}</div>
            <div class="text-meta-sm">${t('permissions.summaryMemoryKeys')}</div>
          </div>
          <div class="dw-stat">
            <div class="dw-stat-value">${permSummary.total_storage_files || 0}</div>
            <div class="text-meta-sm">${t('permissions.summaryStorageFiles')}</div>
          </div>
        </div>
        ${permSummary.rules_by_recipient_type && html`
          <div class="text-meta mb-half">${t('permissions.summaryByType')}</div>
          <div class="flex-row-wrap">
            ${Object.entries(permSummary.rules_by_recipient_type).filter(([,v]) => v > 0).map(([k,v]) => html`
              <span class="dw-type-tag">${k}: ${v}</span>
            `)}
          </div>
        `}
      </div>
    `}

    <div class="flex-between dw-section-title">
      <h3 class="dw-section-heading">${t('wallet.consents.title')}</h3>
      <button class="btn-primary" onClick=${() => setShowConsentForm(!showConsentForm)}>${t('permissions.grantBtn')}</button>
    </div>
    <p class="text-caption dw-section-lead">${t('wallet.consents.intro')}</p>
    <p class="text-caption dw-section-lead">${t('wallet.consents.scopeHelp')}</p>

    ${showConsentForm && html`
      <div class="card dw-consent-card">
        <h4 class="card-h3">${t('permissions.grantTitle')}</h4>
        <form onSubmit=${(e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const rType = fd.get('recipientType');
          let recipVal = recipientValue.trim();
          if (rType === 'wildcard') recipVal = '*';
          else if (rType === 'ghii') recipVal = 'ghii:' + recipVal;
          else if (rType === 'domain') recipVal = 'domain:' + recipVal;
          else if (rType === 'node') recipVal = 'node:' + recipVal;
          else if (rType === 'organism') recipVal = 'organism.' + recipVal;
          handleGrant({
            data_pattern: fd.get('dataPattern'),
            recipient: recipVal,
            purpose: fd.get('purpose') || 'general',
            scope: fd.get('scope') || 'private',
            expires_at: fd.get('expires') || undefined,
          });
        }}>
          <div class="dw-form-grid">
            <div>
              <label class="dw-label">${t('permissions.dataPattern')}</label>
              <input name="dataPattern" class="input-field w-full" placeholder=${t('permissions.dataPatternHint')} required />
            </div>
            <div>
              <label class="dw-label">${t('permissions.recipientType')}</label>
              <select name="recipientType" class="input-field w-full">
                <option value="gaii">${t('permissions.typGaii')}</option>
                <option value="ghii">${t('permissions.typGhii')}</option>
                <option value="organism">${t('permissions.typOrganism')}</option>
                <option value="domain">${t('permissions.typDomain')}</option>
                <option value="node">${t('permissions.typNode')}</option>
                <option value="wildcard">${t('permissions.typWildcard')}</option>
              </select>
            </div>
            <div>
              <label class="dw-label">${t('permissions.recipient')}</label>
              <${ContactPicker} value=${recipientValue} onChange=${setRecipientValue} valueMode="full"
                placeholder="agent#owner@node" />
            </div>
            <div>
              <label class="dw-label">${t('permissions.purpose')}</label>
              <input name="purpose" class="input-field w-full" placeholder=${t('permissions.purposeHint')} />
            </div>
            <div>
              <label class="dw-label">${t('permissions.scope')}</label>
              <select name="scope" class="input-field w-full">
                <option value="private">${t('permissions.scopePrivate')}</option>
                <option value="dmz">${t('permissions.scopeDmz')}</option>
                <option value="federation">${t('permissions.scopeFederation')}</option>
              </select>
            </div>
            <div>
              <label class="dw-label">${t('permissions.expires')}</label>
              <input name="expires" type="date" class="input-field w-full" />
            </div>
          </div>
          <div class="flex-actions">
            <button type="submit" class="btn-primary">${t('permissions.grantBtn')}</button>
            <button type="button" class="btn-outline btn-sm" onClick=${() => setShowConsentForm(false)}>${t('permissions.cancelBtn')}</button>
          </div>
        </form>
      </div>
    `}

    ${consents && consents.length > 0 && html`
      <div class="flex-row mb-half dw-filter-row">
        <input type="text" class="input-field dw-filter-input"
          placeholder=${t('permissions.filterPlaceholder')}
          value=${consentFilter}
          onInput=${(e) => { setConsentFilter(e.target.value); setSelectedConsents(new Set()); }} />
        <div class="dw-scope-filters">
          <button class="btn-sm ${scopeFilter === 'all' ? 'btn-primary' : 'btn-outline'}"
            onClick=${() => { setScopeFilter('all'); setSelectedConsents(new Set()); }}>
            ${t('wallet.consents.filterAll')}
          </button>
          <button class="btn-sm ${scopeFilter === 'federation' ? 'btn-primary' : 'btn-outline'}"
            onClick=${() => { setScopeFilter('federation'); setSelectedConsents(new Set()); }}>
            ${t('wallet.consents.filterFederation')}
          </button>
          <button class="btn-sm ${scopeFilter === 'auth' ? 'btn-primary' : 'btn-outline'}"
            onClick=${() => { setScopeFilter('auth'); setSelectedConsents(new Set()); }}>
            ${t('wallet.consents.filterAuth')}
          </button>
          <button class="btn-sm ${showRevoked ? 'btn-primary' : 'btn-ghost'}"
            onClick=${() => { setShowRevoked(!showRevoked); setSelectedConsents(new Set()); }}>
            ${showRevoked ? t('wallet.consents.hideRevoked') : t('wallet.consents.showRevoked')}
            ${' '}(${consents.filter(c => !isLive(c)).length})
          </button>
        </div>
        ${selectedConsents.size > 0 && html`
          <button class="btn-danger text-meta" onClick=${() => handleBulkRevoke(selectedConsents)}>
            ${t('permissions.revokeSelected')} (${selectedConsents.size})
          </button>
        `}
      </div>
    `}

    ${!consents ? html`<${Spinner} />`
      : filteredConsents.length === 0 ? html`<div class="empty">${t('wallet.consents.empty')}</div>`
      : html`<div class="card scroll-x">
          <table class="consent-table"><thead><tr>
            <th class="dw-checkbox-col"><input type="checkbox"
              checked=${filteredConsents.length > 0 && filteredConsents.every(c => selectedConsents.has(c.id || c.consent_id))}
              onChange=${(e) => {
                if (e.target.checked) {
                  // Select-all means "everything I could revoke here", so it skips what is already gone.
                  setSelectedConsents(new Set(filteredConsents.filter(isLive).map(c => c.id || c.consent_id)));
                } else {
                  setSelectedConsents(new Set());
                }
              }} /></th>
            <th>${t('wallet.consents.pattern')}</th>
            <th>${t('wallet.consents.recipient')}</th>
            <th>${t('wallet.consents.purpose')}</th>
            <th>${t('wallet.consents.status')}</th>
            <th>${t('wallet.consents.scope')}</th>
            <th>${t('wallet.consents.granted')}</th>
            <th>${t('wallet.consents.expires')}</th>
            <th></th>
          </tr></thead><tbody>
            ${filteredConsents.map(c => {
              const cId = c.id || c.consent_id;
              const revoked = isRevoked(c);
              const isExpired = isExpiredConsent(c);
              const live = isLive(c);
              const expSoon = live && isExpiringSoon(c.expires_at);
              return html`<tr class=${[expSoon ? 'dw-expiring' : '', live ? '' : 'dw-consent-dead'].filter(Boolean).join(' ')}>
                <td>${live && html`<input type="checkbox" checked=${selectedConsents.has(cId)}
                  onChange=${(e) => {
                    const next = new Set(selectedConsents);
                    if (e.target.checked) next.add(cId); else next.delete(cId);
                    setSelectedConsents(next);
                  }} />`}</td>
                <td><span class="dw-code-accent">${escHtml(c.data_pattern || c.pattern || '-')}</span></td>
                <td class="dw-recipient-cell">${recipientBadge(c.recipient_gaii || c.recipient)} <span class="text-meta">${escHtml(c.recipient_gaii || c.recipient || '-')}</span></td>
                <td>${escHtml(c.purpose || '-')}</td>
                <td>
                  ${revoked
                    ? html`<span class="badge badge-muted">${t('wallet.consents.statusRevoked')}</span>`
                    : isExpired
                    ? html`<span class="badge badge-muted">${t('wallet.consents.statusExpired')}</span>`
                    : html`<span class="badge badge-success">${t('wallet.consents.statusActive')}</span>`}
                </td>
                <td>
                  ${c.scope === 'federation'
                    ? html`<span class="badge badge-info">${t('wallet.consents.scopeFederation')}</span>`
                    : c.scope === 'auth'
                    ? html`<span class="badge badge-warn">${t('wallet.consents.scopeAuth')}</span>`
                    : html`<span>${escHtml(c.scope || '-')}</span>`}
                </td>
                <td class="text-meta">${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : '-'}</td>
                <td class="text-meta">
                  ${expSoon && html`<span class="dw-expiring-icon" title=${t('permissions.expiringWarning')}>\u26A0\uFE0F</span>`}
                  ${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : t('wallet.consents.never')}
                </td>
                <td>${live && html`<button class="btn-danger-solid btn-sm" onClick=${() => handleRevoke(cId)}>${t('wallet.consents.revoke')}</button>`}
                  ${revoked && c.revoked_at && html`<span class="text-meta">${new Date(c.revoked_at).toLocaleDateString()}</span>`}</td>
              </tr>`;
            })}
          </tbody></table>
        </div>`
    }

    <h3 class="dw-section-heading">${t('wallet.audit.title')}</h3>
    <p class="text-caption dw-section-lead">${t('wallet.audit.intro')}</p>
    <div class="flex-row mb-1">
      ${[7, 30, 90].map(d => html`
        <button class="audit-day-btn ${auditDays === d ? 'active' : ''}" onClick=${() => { setAuditDays(d); loadAudit(d); }}>${d} ${t('wallet.audit.days')}</button>
      `)}
    </div>
    ${!auditEntries ? html`<${Spinner} />`
      : auditEntries.length === 0 ? html`<div class="empty">${t('wallet.audit.empty')}</div>`
      : html`<div class="card scroll-x">
          <${DataTable}
            headers=${[t('wallet.audit.who'), t('wallet.audit.what'), t('wallet.audit.action'), t('wallet.audit.when'), t('wallet.audit.outcome')]}
            rows=${auditEntries.map(e => {
              // Both doors (GET /v1/consent/audit and the /v1/data-wallet mount) send the same shape.
              const key = e.memory_key || '-';
              const action = e.action || '-';
              const when = e.timestamp;
              const allowed = e.allowed === true || e.allowed === 1;
              return [
                escHtml(e.accessor_gaii || '-'),
                html`<span class="dw-code-accent">${escHtml(key)}</span>`,
                escHtml(action),
                html`<span class="text-meta">${when ? timeAgo(when) : '-'}</span>`,
                allowed
                  ? html`<span class="badge badge-success">${t('wallet.audit.allowed')}</span>`
                  : html`<span class="badge badge-danger">${t('wallet.audit.denied')}</span>`,
              ];
            })}
          />
        </div>`
    }

    <h3 class="dw-section-heading">${t('wallet.export.title')}</h3>
    <div class="card">
      <p class="text-caption mb-1">${t('wallet.export.description')}</p>
      <button class="btn-primary" onClick=${handleExport}>${t('wallet.export.button')}</button>
    </div>
  `;
}
