import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner, recipientBadge, isExpiringSoon } from './shared.js';
import * as consentService from '/js/services/consent.js';

export default function DataWalletTab({ session, showToast }) {
  const [consents, setConsents] = useState(null);
  const [auditEntries, setAuditEntries] = useState(null);
  const [auditDays, setAuditDays] = useState(30);
  const [permSummary, setPermSummary] = useState(null);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [consentFilter, setConsentFilter] = useState('');
  const [selectedConsents, setSelectedConsents] = useState(new Set());

  useEffect(() => {
    if (session) { loadConsents(); loadAudit(30); loadPermSummary(); }
  }, [session]);

  async function loadConsents() {
    try {
      const list = await consentService.listConsents();
      setConsents(Array.isArray(list) ? list : []);
    } catch { setConsents([]); }
  }

  async function loadAudit(days) {
    try {
      const list = await consentService.listAuditEntries(days);
      setAuditEntries(Array.isArray(list) ? list : []);
    } catch { setAuditEntries([]); }
  }

  async function loadPermSummary() {
    try {
      const data = await consentService.getPermissionSummary();
      setPermSummary(data || null);
    } catch { setPermSummary(null); }
  }

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
    } catch { showToast(t('profile.error'), true); }
  }

  const filteredConsents = consents?.filter(c => {
    if (!consentFilter) return true;
    const q = consentFilter.toLowerCase();
    const recip = (c.recipient_gaii || c.recipient || '').toLowerCase();
    const pat = (c.data_pattern || c.pattern || '').toLowerCase();
    return recip.includes(q) || pat.includes(q);
  });

  return html`
    <div class="section-title">\u{1F6E1}\uFE0F ${t('profile.tabs.dataWallet')}</div>

    ${permSummary && html`
      <div class="card" style="margin-bottom:1.5rem;padding:1rem">
        <h3 style="color:var(--love1);margin:0 0 .75rem;font-size:.95rem">${t('permissions.summaryTitle')}</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.75rem;margin-bottom:1rem">
          <div style="text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:var(--love1)">${permSummary.active_consents || 0}</div>
            <div style="font-size:.75rem;color:var(--muted)">${t('permissions.summaryActiveRules')}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#8b5cf6">${permSummary.total_memory_keys || 0}</div>
            <div style="font-size:.75rem;color:var(--muted)">${t('permissions.summaryMemoryKeys')}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:var(--accent)">${permSummary.total_storage_files || 0}</div>
            <div style="font-size:.75rem;color:var(--muted)">${t('permissions.summaryStorageFiles')}</div>
          </div>
        </div>
        ${permSummary.rules_by_recipient_type && html`
          <div style="font-size:.8rem;color:var(--muted);margin-bottom:.25rem">${t('permissions.summaryByType')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:.5rem">
            ${Object.entries(permSummary.rules_by_recipient_type).filter(([,v]) => v > 0).map(([k,v]) => html`
              <span style="font-size:.75rem;padding:3px 8px;border-radius:4px;background:var(--bg-secondary);border:1px solid var(--border)">${k}: ${v}</span>
            `)}
          </div>
        `}
      </div>
    `}

    <div style="display:flex;justify-content:space-between;align-items:center;margin:1rem 0 .75rem">
      <h3 style="color:var(--love1);margin:0">${t('wallet.consents.title')}</h3>
      <button class="btn-primary" onClick=${() => setShowConsentForm(!showConsentForm)}>${t('permissions.grantBtn')}</button>
    </div>

    ${showConsentForm && html`
      <div class="card" style="margin-bottom:1rem;padding:1rem;border-color:var(--love1)">
        <h4 style="margin:0 0 .75rem;color:var(--love1)">${t('permissions.grantTitle')}</h4>
        <form onSubmit=${(e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const rType = fd.get('recipientType');
          let recipVal = fd.get('recipientValue');
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
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">${t('permissions.dataPattern')}</label>
              <input name="dataPattern" class="input-field" placeholder=${t('permissions.dataPatternHint')} required style="width:100%" />
            </div>
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">${t('permissions.recipientType')}</label>
              <select name="recipientType" class="input-field" style="width:100%">
                <option value="gaii">${t('permissions.typGaii')}</option>
                <option value="ghii">${t('permissions.typGhii')}</option>
                <option value="organism">${t('permissions.typOrganism')}</option>
                <option value="domain">${t('permissions.typDomain')}</option>
                <option value="node">${t('permissions.typNode')}</option>
                <option value="wildcard">${t('permissions.typWildcard')}</option>
              </select>
            </div>
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">${t('permissions.recipient')}</label>
              <input name="recipientValue" class="input-field" placeholder="agent#owner@node" style="width:100%" />
            </div>
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">${t('permissions.purpose')}</label>
              <input name="purpose" class="input-field" placeholder=${t('permissions.purposeHint')} style="width:100%" />
            </div>
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">${t('permissions.scope')}</label>
              <select name="scope" class="input-field" style="width:100%">
                <option value="private">${t('permissions.scopePrivate')}</option>
                <option value="dmz">${t('permissions.scopeDmz')}</option>
                <option value="federation">${t('permissions.scopeFederation')}</option>
              </select>
            </div>
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">${t('permissions.expires')}</label>
              <input name="expires" type="date" class="input-field" style="width:100%" />
            </div>
          </div>
          <div style="display:flex;gap:.5rem;margin-top:1rem">
            <button type="submit" class="btn-primary">${t('permissions.grantBtn')}</button>
            <button type="button" class="btn-sm btn-outline" onClick=${() => setShowConsentForm(false)}>${t('permissions.cancelBtn')}</button>
          </div>
        </form>
      </div>
    `}

    ${consents && consents.length > 0 && html`
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem">
        <input type="text" class="input-field" style="flex:1;max-width:300px"
          placeholder=${t('permissions.filterPlaceholder')}
          value=${consentFilter}
          onInput=${(e) => { setConsentFilter(e.target.value); setSelectedConsents(new Set()); }} />
        ${selectedConsents.size > 0 && html`
          <button class="btn-danger" style="font-size:.8rem" onClick=${() => handleBulkRevoke(selectedConsents)}>
            ${t('permissions.revokeSelected')} (${selectedConsents.size})
          </button>
        `}
      </div>
    `}

    ${!consents ? html`<${Spinner} />`
      : filteredConsents.length === 0 ? html`<div class="empty">${t('wallet.consents.empty')}</div>`
      : html`<div class="card" style="overflow-x:auto">
          <table class="consent-table"><thead><tr>
            <th style="width:30px"><input type="checkbox"
              checked=${filteredConsents.length > 0 && filteredConsents.every(c => selectedConsents.has(c.id || c.consent_id))}
              onChange=${(e) => {
                if (e.target.checked) {
                  setSelectedConsents(new Set(filteredConsents.map(c => c.id || c.consent_id)));
                } else {
                  setSelectedConsents(new Set());
                }
              }} /></th>
            <th>${t('wallet.consents.pattern')}</th>
            <th>${t('wallet.consents.recipient')}</th>
            <th>${t('wallet.consents.purpose')}</th>
            <th>${t('wallet.consents.scope')}</th>
            <th>${t('wallet.consents.granted')}</th>
            <th>${t('wallet.consents.expires')}</th>
            <th></th>
          </tr></thead><tbody>
            ${filteredConsents.map(c => {
              const cId = c.id || c.consent_id;
              const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
              const expSoon = isExpiringSoon(c.expires_at);
              return html`<tr style=${expSoon ? 'background:rgba(245,158,11,.08)' : ''}>
                <td><input type="checkbox" checked=${selectedConsents.has(cId)}
                  onChange=${(e) => {
                    const next = new Set(selectedConsents);
                    e.target.checked ? next.add(cId) : next.delete(cId);
                    setSelectedConsents(next);
                  }} /></td>
                <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(c.data_pattern || c.pattern || '-')}</span></td>
                <td style="display:flex;gap:4px;align-items:center">${recipientBadge(c.recipient_gaii || c.recipient)} <span style="font-size:.8rem">${escHtml(c.recipient_gaii || c.recipient || '-')}</span></td>
                <td>${escHtml(c.purpose || '-')}</td>
                <td>${isExpired ? html`<span class="badge badge-muted">expired</span>` : html`<span class="badge badge-success">active</span>`} ${escHtml(c.scope || '-')}</td>
                <td style="font-size:.8rem;color:var(--muted)">${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : '-'}</td>
                <td style="font-size:.8rem;color:var(--muted)">
                  ${expSoon && html`<span style="color:#f59e0b;font-size:.7rem;margin-right:4px" title=${t('permissions.expiringWarning')}>\u26A0\uFE0F</span>`}
                  ${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : t('wallet.consents.never')}
                </td>
                <td>${!isExpired && html`<button class="revoke-btn" onClick=${() => handleRevoke(cId)}>${t('wallet.consents.revoke')}</button>`}</td>
              </tr>`;
            })}
          </tbody></table>
        </div>`
    }

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('wallet.audit.title')}</h3>
    <div style="display:flex;gap:.5rem;margin-bottom:1rem">
      ${[7, 30, 90].map(d => html`
        <button class="audit-day-btn ${auditDays === d ? 'active' : ''}" onClick=${() => { setAuditDays(d); loadAudit(d); }}>${d} ${t('wallet.audit.days')}</button>
      `)}
    </div>
    ${!auditEntries ? html`<${Spinner} />`
      : auditEntries.length === 0 ? html`<div class="empty">${t('wallet.audit.empty')}</div>`
      : html`<div class="card" style="overflow-x:auto">
          <table class="audit-table"><thead><tr>
            <th>${t('wallet.audit.who')}</th>
            <th>${t('wallet.audit.what')}</th>
            <th>${t('wallet.audit.when')}</th>
            <th>${t('wallet.audit.purpose')}</th>
          </tr></thead><tbody>
            ${auditEntries.map(e => html`<tr>
              <td>${escHtml(e.accessor_gaii || e.accessed_by || e.who || '-')}</td>
              <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(e.data_key || e.key || e.what || '-')}</span></td>
              <td style="font-size:.8rem;color:var(--muted)">${e.accessed_at ? timeAgo(e.accessed_at) : (e.timestamp ? timeAgo(e.timestamp) : '-')}</td>
              <td>${escHtml(e.purpose || '-')}</td>
            </tr>`)}
          </tbody></table>
        </div>`
    }

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('wallet.export.title')}</h3>
    <div class="card">
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${t('wallet.export.description')}</p>
      <button class="btn-primary" onClick=${handleExport}>${t('wallet.export.button')}</button>
    </div>
  `;
}
