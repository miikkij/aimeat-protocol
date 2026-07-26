/**
 * @file my-company.payments.js
 * @description The "Payments" panel of the My Company (Enterprise) view — extracted from
 *   my-company.js (line-budget). Drives real-money selling via Stripe Connect (Platform model):
 *   the company onboards as a Stripe EXPRESS connected account under the operator's Platform
 *   (POST /v1/orgs/{slug}/connect/onboard → hosted Account Link), its KYB verifies automatically
 *   once the account can take charges and it carries a Y-tunnus (GET /v1/orgs/{slug}/connect/status),
 *   and the money books render — payables owed to the seller (GET /v1/orgs/{slug}/payables) and
 *   DAC7/ALV compliance (GET /v1/orgs/{slug}/dac7). The individual standalone-key PSP form is kept
 *   behind an "Advanced" toggle. Funds settle to the seller's Stripe account — the node never holds
 *   the key or the funds (non-custodial).
 * @structure moneyRow (per-currency money row) · PaymentsPanel({ org })
 * @usage import { PaymentsPanel } from '/views/my-company.payments.js';
 * @version-history
 *   v0.10.0 — 2026-07-18 — initial extraction from my-company.js + Stripe Connect onboarding, the
 *     Stripe-backed KYB badge, and the payables + DAC7/ALV money books (TARGET-043).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { fmtMoney } from '/js/utils.js';
import { Spinner } from '/components/Spinner.js';
import { EmptyState } from '/components/EmptyState.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** One per-currency money row (micro-units → localized money). */
function moneyRow(label, totals, field) {
  const codes = Object.keys(totals || {});
  if (!codes.length) return null;
  return html`<div class="mc-money-row"><span class="mc-mini">${label}</span>
    <b>${codes.map(c => fmtMoney(totals[c][field] ?? 0, c)).join(' · ')}</b></div>`;
}

/** Payments: Stripe Connect onboarding (Platform model), the node's payment handlers + checkout
 * status, the KYB gate (Stripe-backed once the connected account can take charges), and the money
 * books — payables owed to the seller + DAC7/ALV compliance. Sellers onboard as Stripe Express
 * connected accounts under the operator's Platform; funds settle to their account (no custody). */
export function PaymentsPanel({ org }) {
  const [profile, setProfile] = useState(null);
  const [psp, setPsp] = useState(null);
  const [keyIn, setKeyIn] = useState('');
  const [pspBusy, setPspBusy] = useState(false);
  const [pspMsg, setPspMsg] = useState('');
  const [showLegacy, setShowLegacy] = useState(false);
  // Stripe Connect (Platform) onboarding + status.
  const [connect, setConnect] = useState(undefined); // undefined=loading | {connected,...} | {unavailable}
  const [cBusy, setCBusy] = useState(false);
  const [cMsg, setCMsg] = useState('');
  // Money books.
  const [payables, setPayables] = useState(null);
  const [dac7, setDac7] = useState(null);

  const loadPsp = useCallback(() => {
    apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/psp`).then(r => setPsp(r.data?.psp ?? { configured: false })).catch(() => setPsp(false));
  }, [org.slug]);
  const loadConnect = useCallback(() => {
    apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/connect/status`)
      .then(r => setConnect(r.data ?? { connected: false }))
      .catch(e => setConnect(e?.code === 'STRIPE_PLATFORM_NOT_CONFIGURED' ? { unavailable: true } : { connected: false, error: e?.message }));
  }, [org.slug]);
  const loadMoney = useCallback(() => {
    apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/payables`).then(r => setPayables(r.data)).catch(() => setPayables(null));
    apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/dac7`).then(r => setDac7(r.data)).catch(() => setDac7(null));
  }, [org.slug]);
  useEffect(() => {
    let alive = true;
    fetch('/.well-known/ucp').then(r => r.json()).then(p => { if (alive) setProfile(p); }).catch((err) => { swallowed('my-company.payments', err); if (alive) setProfile(false); });
    loadPsp(); loadConnect(); loadMoney();
    return () => { alive = false; };
  }, [loadPsp, loadConnect, loadMoney]);
  async function onboard() {
    setCBusy(true); setCMsg('');
    try {
      const r = await apiPost(`/v1/orgs/${encodeURIComponent(org.slug)}/connect/onboard`, {});
      const url = r.data?.onboardingUrl;
      if (url) { window.open(url, '_blank', 'noopener'); setCMsg(t('myCompany.connectOpened')); }
      setTimeout(loadConnect, 2000);
    } catch (e) { setCMsg(e.message || 'Onboarding failed'); }
    finally { setCBusy(false); }
  }
  async function savePsp() {
    setPspBusy(true); setPspMsg('');
    try { await apiPut(`/v1/orgs/${encodeURIComponent(org.slug)}/psp`, { secret_key: keyIn.trim() }); setKeyIn(''); setPspMsg(t('myCompany.pspSaved')); loadPsp(); }
    catch (e) { setPspMsg(e.message || 'Save failed'); }
    finally { setPspBusy(false); }
  }
  async function removePsp() {
    setPspBusy(true); setPspMsg('');
    try { await apiDelete(`/v1/orgs/${encodeURIComponent(org.slug)}/psp`); setPspMsg(t('myCompany.pspRemoved')); loadPsp(); }
    catch (e) { setPspMsg(e.message || 'Remove failed'); }
    finally { setPspBusy(false); }
  }
  if (profile === null) return html`<${Spinner} />`;
  const handlers = (profile && profile.ucp && profile.ucp.payment_handlers) || [];
  const checkoutOn = !!(profile && profile.ucp && (profile.ucp.capabilities || []).length);
  const kyb = (connect && connect.kybStatus) || org.kybStatus || 'pending';
  const kybVerified = kyb === 'verified';
  const charges = !!(connect && connect.chargesEnabled);
  const pt = payables && payables.totals ? payables.totals : {};
  const d = dac7 && dac7.dac7 ? dac7.dac7 : null;
  const vat = dac7 && dac7.vat ? dac7.vat : null;
  return html`
    <div class="mc-payments">
      <!-- ── Stripe Connect (Platform model): the primary money-selling path ── -->
      <div class="mc-label">${t('myCompany.connectTitle')}
        ${connect === undefined ? null
          : connect.unavailable ? html`<span class="mc-chip mc-chip-warn">${t('myCompany.connectUnavailable')}</span>`
          : !connect.connected ? html`<span class="mc-chip mc-chip-warn">${t('myCompany.connectNotStarted')}</span>`
          : charges ? html`<span class="mc-chip mc-chip-ok">${t('myCompany.connectReady')}</span>`
          : html`<span class="mc-chip mc-chip-warn">${t('myCompany.connectPending')}</span>`}
      </div>
      <span class="mc-mini">${t('myCompany.connectHint')}</span>
      ${connect && !connect.unavailable && html`
        <div class="flex-row-wrap mc-manage-row">
          <button class="btn-primary btn-sm" disabled=${cBusy} onClick=${onboard}>${connect.connected ? t('myCompany.connectContinue') : t('myCompany.connectOnboard')}</button>
          ${connect.connected && html`<button class="btn-ghost btn-sm" disabled=${cBusy} onClick=${loadConnect}>${t('myCompany.connectRefresh')}</button>`}
        </div>`}
      ${connect && connect.connected && Array.isArray(connect.requirementsDue) && connect.requirementsDue.length > 0 && html`
        <span class="mc-mini">${t('myCompany.connectRequirements')}: ${connect.requirementsDue.slice(0, 6).join(', ')}</span>`}
      ${cMsg && html`<span class="mc-mini">${cMsg}</span>`}

      <div class="mc-label">${t('myCompany.paymentsKyb')}
        <span class="mc-chip ${kybVerified ? 'mc-chip-ok' : 'mc-chip-warn'}">${kybVerified ? t('myCompany.kybVerified') : (org.businessId ? t('myCompany.paymentsKybPre') : t('myCompany.paymentsKybMissing'))}</span>
      </div>
      <span class="mc-mini">${t('myCompany.kybHintConnect')}</span>

      <div class="mc-label">${t('myCompany.paymentsCheckout')}
        <span class="mc-chip ${checkoutOn ? 'mc-chip-ok' : 'mc-chip-warn'}">${checkoutOn ? t('myCompany.paymentsOn') : t('myCompany.paymentsOff')}</span>
      </div>
      <div class="mc-label">${t('myCompany.paymentsHandlers')}</div>
      ${handlers.length === 0
        ? html`<${EmptyState} text=${t('myCompany.paymentsNone')} />`
        : html`<ul class="mc-order-list">${handlers.map(hd => html`
            <li key=${hd.id} class="mc-payment-row"><b>${hd.title || hd.id}</b> <span class="mc-mini">${hd.id} · ${(hd.currencies || []).join(', ')}</span></li>`)}</ul>`}

      <!-- ── Money books: payables owed to the seller + DAC7/ALV compliance ── -->
      <div class="mc-label">${t('myCompany.payablesTitle')}</div>
      ${Object.keys(pt).length === 0
        ? html`<${EmptyState} text=${t('myCompany.payablesNone')} />`
        : html`<div class="mc-money-box">
            ${moneyRow(t('myCompany.payablesGross'), pt, 'gross')}
            ${moneyRow(t('myCompany.payablesMember'), pt, 'memberCut')}
            ${moneyRow(t('myCompany.payablesOrg'), pt, 'orgCut')}
            ${moneyRow(t('myCompany.payablesFee'), pt, 'fee')}
          </div>`}
      ${(d || vat) && html`
        <div class="mc-label">${t('myCompany.dac7Title')} <span class="mc-mini">${dac7?.year ?? ''}</span></div>
        <div class="mc-money-box">
          ${d && html`<div class="mc-money-row"><span class="mc-mini">${t('myCompany.dac7Consideration')}</span><b>${fmtMoney(d.totalConsideration ?? 0, d.currency || 'EUR')}</b></div>`}
          ${d && html`<div class="mc-money-row"><span class="mc-mini">${t('myCompany.dac7Transactions')}</span><b>${d.totalTransactions ?? 0}</b></div>`}
          ${vat && html`<div class="mc-money-row"><span class="mc-mini">${t('myCompany.vatTotal')} (${vat.rate}%)</span><b>${fmtMoney(vat.totalVat ?? 0, vat.currency || 'EUR')}</b></div>`}
        </div>`}

      <!-- ── Legacy: an individual seller's OWN standalone Stripe secret (rarely needed) ── -->
      <div class="mc-label">
        <button class="btn-ghost btn-sm" onClick=${() => setShowLegacy(v => !v)}>${showLegacy ? t('myCompany.pspHideLegacy') : t('myCompany.pspShowLegacy')}</button>
      </div>
      ${showLegacy && html`
        <div>
          <div class="mc-label">${t('myCompany.pspTitle')}
            ${psp && psp.configured
              ? html`<span class="mc-chip mc-chip-ok">${t('myCompany.pspConfigured')} ${psp.keyHint || ''}</span>`
              : html`<span class="mc-chip mc-chip-warn">${t('myCompany.pspMissing')}</span>`}
          </div>
          <span class="mc-mini">${t('myCompany.pspHint')}</span>
          <div class="flex-row-wrap mc-manage-row">
            <input class="input-field input-sm mc-psp-input" type="password" placeholder="sk_test_…" value=${keyIn} onInput=${(e) => setKeyIn(e.target.value)} />
            <button class="btn-primary btn-sm" disabled=${pspBusy || keyIn.trim().length < 8} onClick=${savePsp}>${t('myCompany.pspSave')}</button>
            ${psp && psp.configured && html`<button class="btn-ghost btn-sm mc-remove" disabled=${pspBusy} onClick=${removePsp}>${t('myCompany.pspRemove')}</button>`}
          </div>
          ${pspMsg && html`<span class="mc-mini">${pspMsg}</span>`}
        </div>`}
    </div>`;
}
