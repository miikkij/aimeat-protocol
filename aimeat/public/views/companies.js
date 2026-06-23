/**
 * @file companies.js
 * @description Public company directory + public company page (the Enterprise discovery surface).
 *   Anyone (even anonymous) can browse every company on the node (GET /v1/orgs/directory), open one
 *   to see its public profile (name, Y-tunnus, description) and catalogue (GET
 *   /v1/orgs/:owner/:slug/offerings — the SAME offer cards as profile>offers), and order an offering
 *   (POST .../use — ordering requires login). Backend stays protocol-only; the EE module provides the
 *   org APIs (a Community node returns ENTERPRISE_REQUIRED).
 * @structure CompaniesView · directory list · PublicOfferingCard (order box, reuses OfferCardView)
 * @usage routed at /v1/companies; deep-link a company via ?c=owner/slug.
 * @version-history
 *   v0.1.0 — 2026-06-23 — initial: directory + public company page + order
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { OfferCardView } from '/components/offer-card-view.js';

const html = htm.bind(h);

const isLoggedIn = () => !!(typeof window !== 'undefined' && window.AIMEAT?.auth?.getSession?.());

/** One orderable offering on the public company page (same card as profile>offers + an order box). */
function PublicOfferingCard({ o, owner, slug }) {
  const offer = o.offer;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const loggedIn = isLoggedIn();

  async function order() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await apiPost(`/v1/orgs/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/use`,
        { agentName: o.agentName, offerId: o.offerId, input: input.trim() || undefined });
      setResult(res.data); setInput('');
    } catch (e) { setErr(e.message || 'Order failed'); }
    finally { setBusy(false); }
  }

  const actions = html`
    <div class="cm-not-callable">${o.callable ? t('companies.callable') : t('companies.viaInbox')}</div>
    ${loggedIn
      ? html`
        <textarea class="input-field input-sm of-input" rows="2" value=${input}
          placeholder=${t('companies.usePlaceholder')} onInput=${(e) => setInput(e.target.value)}></textarea>
        <div class="flex-row-wrap">
          <button class="btn-primary btn-sm" disabled=${busy} onClick=${order}>
            ${t('companies.order')}${offer.price?.morsels ? ` · ${offer.price.morsels} ${t('companies.morsels')}` : ''}
          </button>
        </div>`
      : html`<a class="btn-outline btn-sm" href="/v1/profile">${t('companies.loginToOrder')}</a>`}
    ${err && html`<p class="cm-error">${err}</p>`}
    ${result && html`
      <div class="cm-result">
        ${result.kind === 'result'
          ? html`<div class="cm-result-msg">${t('companies.orderResult')}</div><${DeliverableBody} value=${result.result} alt=${offer.title} format=${offer.deliverable?.format} />`
          : html`<div class="cm-result-msg">${t('companies.orderTask').replace('{agent}', o.agentName)}</div>`}
        ${result.receipt?.charged > 0 && html`<div class="cm-receipt">${t('companies.charged').replace('{n}', result.receipt.charged)}</div>`}
      </div>`}
  `;
  return html`<li class="cm-cat-item"><${OfferCardView} entry=${{ agent: o.agentName, online: o.online }} offer=${offer} actions=${actions} /></li>`;
}

export default function CompaniesView() {
  const [companies, setCompanies] = useState(null);
  const [selected, setSelected] = useState(null); // { owner, slug }
  const [profile, setProfile] = useState(null);    // { org, offerings }
  const [err, setErr] = useState('');

  async function loadDirectory() {
    try { const r = await apiGet('/v1/orgs/directory'); setCompanies(r.data?.companies ?? []); }
    catch (e) {
      if (e.code === 'ENTERPRISE_REQUIRED') setCompanies('enterprise');
      else { setErr(e.message || 'Failed to load'); setCompanies([]); }
    }
  }
  useEffect(() => { loadDirectory(); }, []);

  async function openCompany(owner, slug) {
    setSelected({ owner, slug }); setProfile(null); setErr('');
    try { history.replaceState(null, '', `/v1/companies?c=${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`); } catch { /* ignore */ }
    try {
      const r = await apiGet(`/v1/orgs/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/offerings`);
      setProfile(r.data ?? null);
    } catch (e) { setErr(e.message || ''); }
  }

  // Deep-link: once the directory is loaded, open ?c=owner/slug if present.
  useEffect(() => {
    if (Array.isArray(companies) && !selected) {
      const c = new URLSearchParams(location.search).get('c');
      if (c && c.includes('/')) { const [o, s] = c.split('/'); openCompany(o, s); }
    }
  }, [companies]);

  if (companies === null) return html`<div class="cm-container"><div class="cm-center"><div class="spinner"></div></div></div>`;
  if (companies === 'enterprise') return html`<div class="cm-container"><div class="cm-card"><h1 class="cm-title">${t('companies.title')}</h1><p class="cm-desc">${t('companies.enterpriseRequired')}</p></div></div>`;

  return html`
    <div class="cm-container">
      <header class="cm-header">
        <h1 class="cm-title">${t('companies.title')}</h1>
        <p class="cm-desc">${t('companies.desc')}</p>
      </header>
      ${err && html`<p class="cm-error">${err}</p>`}
      <div class="cm-grid">
        <aside class="cm-col">
          <h2 class="cm-col-title">${t('companies.directory')} (${companies.length})</h2>
          ${companies.length === 0 && html`<p class="cm-empty">${t('companies.none')}</p>`}
          <ul class="cm-dir-list">
            ${companies.map(c => html`<li key=${c.goii}>
              <button class="cm-dir-item ${selected?.slug === c.slug && selected?.owner === c.creatorOwner ? 'active' : ''}" onClick=${() => openCompany(c.creatorOwner, c.slug)}>
                <span class="cm-dir-name">${c.name}</span>
                <span class="cm-dir-meta">${c.businessId ? html`<span class="cm-tag">Y ${c.businessId}</span>` : ''}${c.offerings} ${t('companies.offeringsShort')}</span>
              </button></li>`)}
          </ul>
        </aside>
        <section class="cm-col">
          ${!selected && html`<p class="cm-empty">${t('companies.selectHint')}</p>`}
          ${selected && !profile && html`<div class="cm-center"><div class="spinner"></div></div>`}
          ${profile && html`
            <div class="cm-profile-head">
              <h2 class="cm-col-title">${profile.org?.name}</h2>
              ${profile.org?.businessId && html`<span class="cm-mini">${t('companies.businessId')}: ${profile.org.businessId}</span>`}
              ${profile.org?.description && html`<p class="cm-profile-desc">${profile.org.description}</p>`}
            </div>
            <h3 class="cm-form-title">${t('companies.catalogue')}</h3>
            ${(profile.offerings ?? []).length === 0 && html`<p class="cm-empty">${t('companies.noOfferings')}</p>`}
            <ul class="cm-cat-list">
              ${(profile.offerings ?? []).map(o => html`<${PublicOfferingCard} key=${o.agentName + '/' + o.offerId} o=${o} owner=${selected.owner} slug=${selected.slug} />`)}
            </ul>
          `}
        </section>
      </div>
    </div>`;
}
