/**
 * @file my-company.js
 * @description "Yritykseni" (My Company) view — the Enterprise surface. An owner creates a company
 *   and lists their agents' EXISTING offerings for sale (picked, not typed; specs from
 *   agents.{name}.offers). Anyone can order a listed offering like profile>offers, fulfilled by the
 *   seller's agent: callable offerings invoke the seller's capability and return the result inline;
 *   task-runner offerings queue a task on the seller's agent. Every order is tracked: the buyer sees
 *   "My orders" (status + result), the company owner sees "Orders received". Calls the proprietary
 *   ee/ module's /v1/orgs + /v1/orders API; a Community node returns ENTERPRISE_REQUIRED.
 * @structure MyCompanyView · OfferPicker (list your offerings to sell) · OfferingCard (specs + order)
 *   · OrdersList (orders received / my orders, with live status) · statusChip helper.
 * @usage routed at /v1/my-company; header tab "Yritykseni".
 * @version-history
 *   v0.1.0 — 2026-06-23 — initial (hand-typed)
 *   v0.2.0 — 2026-06-23 — pick existing offerings; order → result/inbox
 *   v0.2.1 — 2026-06-23 — order tracking (my orders + orders received) with live status
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { OfferCardView } from '/components/offer-card-view.js';

const html = htm.bind(h);

function statusChip(o) {
  const s = o.kind === 'result' ? 'instant' : (o.status || 'queued');
  const map = { queued: ['stQueued', 'queued'], active: ['stActive', 'active'], done: ['stDone', 'done'], failed: ['stFailed', 'failed'], instant: ['stInstant', 'done'] };
  const [key, cls] = map[s] || ['stQueued', 'queued'];
  return html`<span class="mc-status mc-status--${cls}">${t('myCompany.' + key)}</span>`;
}

/** One order row, in either the owner ("Orders received") or buyer ("My orders") list. */
function OrderRow({ o, view }) {
  return html`
    <li class="mc-order">
      <div class="mc-order-head">
        <span class="mc-order-title">${o.offerTitle}</span>
        ${statusChip(o)}
      </div>
      <div class="mc-order-meta">
        ${view === 'owner'
          ? html`<span>${t('myCompany.orderedBy')}: ${o.buyerOwner}</span>`
          : html`<span>${t('myCompany.fromCompany')}: ${o.orgSlug}</span>`}
        <span>🤖 ${o.agentName}</span>
        <span class="mc-mini">${new Date(o.createdAt).toLocaleString()}</span>
      </div>
      ${o.input && html`<div class="mc-order-input">${t('myCompany.orderedWhat')}: “${o.input}”</div>`}
      ${o.kind === 'result' && o.result != null && html`
        <div class="mc-result"><div class="mc-result-label">${t('myCompany.result')}</div><${DeliverableBody} value=${o.result} alt=${o.offerTitle} /></div>`}
    </li>`;
}

function OrdersList({ orders, view, empty }) {
  if (!orders || orders.length === 0) return html`<p class="mc-empty">${empty}</p>`;
  return html`<ul class="mc-order-list">${orders.map(o => html`<${OrderRow} key=${o.id} o=${o} view=${view} />`)}</ul>`;
}

/** A catalog entry: the SAME offer card format as profile>offers + an order box. */
function OfferingCard({ o, orgOwner, slug, onOrdered }) {
  const offer = o.offer;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function order() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await apiPost(`/v1/orgs/${encodeURIComponent(orgOwner)}/${encodeURIComponent(slug)}/use`,
        { agentName: o.agentName, offerId: o.offerId, input: input.trim() || undefined });
      setResult(res.data); setInput('');
      if (onOrdered) await onOrdered();
    } catch (e) { setErr(e.message || 'Order failed'); }
    finally { setBusy(false); }
  }

  const actions = html`
    <div class="mc-not-callable">${o.callable ? t('myCompany.callable') : t('myCompany.viaInbox')}</div>
    <textarea class="input-field input-sm of-input" rows="2" value=${input}
      placeholder=${t('myCompany.usePlaceholder')} onInput=${(e) => setInput(e.target.value)}></textarea>
    <div class="flex-row-wrap">
      <button class="btn-primary btn-sm" disabled=${busy} onClick=${order}>${t('myCompany.use')}</button>
    </div>
    ${err && html`<p class="mc-error">${err}</p>`}
    ${result && html`
      <div class="mc-result">
        ${result.kind === 'result'
          ? html`<div class="mc-result-msg">${t('myCompany.orderPlacedResult')}</div><div class="mc-result-label">${t('myCompany.result')}</div><${DeliverableBody} value=${result.result} alt=${offer.title} format=${offer.deliverable?.format} />`
          : html`<div class="mc-result-msg">${t('myCompany.orderPlacedTask').replace('{agent}', o.agentName)}</div>`}
        ${result.receipt?.charged > 0 && html`<div class="mc-receipt">${t('myCompany.charged').replace('{n}', result.receipt.charged)} → ${t('myCompany.wallet')} +${result.receipt.toOrgWallet}</div>`}
      </div>`}
  `;

  return html`<li class="mc-cat-item"><${OfferCardView} entry=${{ agent: o.agentName, online: o.online }} offer=${offer} actions=${actions} /></li>`;
}

function OfferPicker({ slug, alreadyListed, onListed }) {
  const [myOffers, setMyOffers] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    apiGet('/v1/offers').then(r => {
      const flat = [];
      for (const a of (r.data?.agents ?? [])) for (const off of (a.offers ?? [])) flat.push({ agentName: a.agent, offer: off });
      setMyOffers(flat);
    }).catch(() => setMyOffers([]));
  }, []);
  async function list(agentName, offer) {
    setBusy(agentName + '/' + offer.id);
    try { await apiPost(`/v1/orgs/${encodeURIComponent(slug)}/offerings`, { agentName, offerId: offer.id }); await onListed(); }
    catch (e) { alert(e.message || 'Failed'); }
    finally { setBusy(''); }
  }
  if (myOffers === null) return html`<div class="mc-center"><div class="spinner"></div></div>`;
  if (myOffers.length === 0) return html`<p class="mc-empty">${t('myCompany.noOffersToList')}</p>`;
  return html`
    <ul class="mc-pick-list">
      ${myOffers.map(({ agentName, offer }) => {
        const key = agentName + '/' + offer.id;
        const listed = alreadyListed.has(key);
        return html`
          <li class="mc-pick-item" key=${key}>
            <div>
              <div class="mc-off-title">${offer.title}</div>
              <div class="mc-off-meta"><span class="mc-chip">🤖 ${agentName}</span>${offer.price?.morsels ? html`<span class="mc-chip">${offer.price.morsels} ${t('myCompany.morsels')}</span>` : null}${offer.deliverable?.format ? html`<span class="mc-chip">📦 ${offer.deliverable.format}</span>` : null}</div>
            </div>
            ${listed ? html`<span class="mc-listed">${t('myCompany.listed')}</span>`
              : html`<button class="btn-outline" disabled=${busy === key} onClick=${() => list(agentName, offer)}>${t('myCompany.putUpForSale')}</button>`}
          </li>`;
      })}
    </ul>`;
}

export default function MyCompanyView() {
  useViewCSS('/css/views/my-company.css');

  const [state, setState] = useState('loading');
  const [orgs, setOrgs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [offerings, setOfferings] = useState([]);
  const [ordersReceived, setOrdersReceived] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [myOrders, setMyOrders] = useState(null);
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadOrgs() {
    setState('loading');
    try { const res = await apiGet('/v1/orgs'); setOrgs(res.data?.orgs ?? []); setState('ready'); }
    catch (e) {
      if (e.code === 'ENTERPRISE_REQUIRED') setState('enterprise');
      else if (e.status === 401) setState('unauth');
      else { setErrMsg(e.message || 'Failed to load'); setState('error'); }
    }
  }
  useEffect(() => { loadOrgs(); }, []);

  async function loadOrders(org) {
    try { const r = await apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/orders`); setOrdersReceived(r.data?.orders ?? []); }
    catch { setOrdersReceived([]); }
  }
  async function openOrg(org) {
    setSelected(org); setOfferings([]); setOrdersReceived([]); setShowPicker(false);
    try {
      const res = await apiGet(`/v1/orgs/${encodeURIComponent(org.creatorOwner)}/${encodeURIComponent(org.slug)}/offerings`);
      setOfferings(res.data?.offerings ?? []);
    } catch (e) { setErrMsg(e.message || ''); }
    loadOrders(org);
  }
  async function afterOrder() {
    if (selected) { await loadOrders(selected); await loadOrgs(); }
    if (showMyOrders) await loadMyOrders();
  }
  async function loadMyOrders() {
    try { const r = await apiGet('/v1/orders'); setMyOrders(r.data?.orders ?? []); }
    catch { setMyOrders([]); }
  }
  function toggleMyOrders() {
    const next = !showMyOrders; setShowMyOrders(next);
    if (next) loadMyOrders();
  }

  async function createOrg(e) {
    e.preventDefault(); setErrMsg(''); setBusy(true);
    try {
      const res = await apiPost('/v1/orgs', { slug: newSlug.trim().toLowerCase(), name: newName.trim() });
      setNewSlug(''); setNewName(''); await loadOrgs();
      if (res.data?.org) await openOrg(res.data.org);
    } catch (e) { setErrMsg(e.message || 'Create failed'); }
    finally { setBusy(false); }
  }

  if (state === 'loading') return html`<div class="mc-container"><div class="mc-center"><div class="spinner"></div></div></div>`;
  if (state === 'enterprise') return html`<div class="mc-container"><div class="mc-card mc-stub"><h1 class="mc-title">${t('myCompany.title')}</h1><p class="mc-stub-badge">${t('myCompany.enterpriseBadge')}</p><p class="mc-desc">${t('myCompany.enterpriseRequired')}</p></div></div>`;
  if (state === 'unauth') return html`<div class="mc-container"><div class="mc-card"><h1 class="mc-title">${t('myCompany.title')}</h1><p class="mc-desc">${t('myCompany.loginRequired')}</p></div></div>`;
  if (state === 'error') return html`<div class="mc-container"><div class="mc-card"><h1 class="mc-title">${t('myCompany.title')}</h1><p class="mc-error">${errMsg}</p></div></div>`;

  const listedKeys = new Set(offerings.map(o => o.agentName + '/' + o.offerId));

  return html`
    <div class="mc-container">
      <header class="mc-header">
        <div class="mc-header-row">
          <h1 class="mc-title">${t('myCompany.title')}</h1>
          <button class="btn-outline btn-sm" onClick=${toggleMyOrders}>${showMyOrders ? t('myCompany.done') : t('myCompany.myOrders')}</button>
        </div>
        <p class="mc-desc">${t('myCompany.desc')}</p>
      </header>
      ${errMsg && html`<p class="mc-error">${errMsg}</p>`}

      ${showMyOrders && html`
        <div class="mc-card">
          <h2 class="mc-col-title">${t('myCompany.myOrders')}</h2>
          ${myOrders === null ? html`<div class="mc-center"><div class="spinner"></div></div>`
            : html`<${OrdersList} orders=${myOrders} view="buyer" empty=${t('myCompany.noMyOrders')} />`}
        </div>`}

      <div class="mc-grid">
        <aside class="mc-col">
          <h2 class="mc-col-title">${t('myCompany.yourCompanies')}</h2>
          ${orgs.length === 0 && html`<p class="mc-empty">${t('myCompany.noCompanies')}</p>`}
          <ul class="mc-org-list">
            ${orgs.map(org => html`<li key=${org.slug}>
              <button class="mc-org-item ${selected?.slug === org.slug ? 'active' : ''}" onClick=${() => openOrg(org)}>
                <span class="mc-org-name">${org.name}</span>
                <span class="mc-org-meta">${org.goii} · ${(org.wallet?.balance ?? 0)} ${t('myCompany.morsels')}</span>
              </button></li>`)}
          </ul>
          <form class="mc-form" onSubmit=${createOrg}>
            <h3 class="mc-form-title">${t('myCompany.createCompany')}</h3>
            <label class="mc-label">${t('myCompany.slug')}
              <input class="mc-input" value=${newSlug} placeholder="overscale" onInput=${(e) => setNewSlug(e.target.value)} required /></label>
            <label class="mc-label">${t('myCompany.name')}
              <input class="mc-input" value=${newName} placeholder="Overscale Solutions Oy" onInput=${(e) => setNewName(e.target.value)} required /></label>
            <button class="btn-primary" type="submit" disabled=${busy}>${t('myCompany.create')}</button>
          </form>
        </aside>

        <section class="mc-col">
          ${!selected && html`<p class="mc-empty">${t('myCompany.selectHint')}</p>`}
          ${selected && html`
            <div class="mc-detail-head">
              <h2 class="mc-col-title">${selected.name}</h2>
              <span class="mc-wallet">${t('myCompany.wallet')}: <strong>${selected.wallet?.balance ?? 0}</strong> ${t('myCompany.morsels')}</span>
            </div>

            <div class="mc-section-head">
              <h3 class="mc-form-title">${t('myCompany.offerings')}</h3>
              <button class="btn-outline btn-sm" onClick=${() => setShowPicker(s => !s)}>${showPicker ? t('myCompany.done') : t('myCompany.addFromOffers')}</button>
            </div>
            ${showPicker && html`<div class="mc-picker"><p class="mc-pick-hint">${t('myCompany.pickHint')}</p><${OfferPicker} slug=${selected.slug} alreadyListed=${listedKeys} onListed=${() => openOrg(selected)} /></div>`}
            ${offerings.length === 0 && !showPicker && html`<p class="mc-empty">${t('myCompany.noOfferings')}</p>`}
            <ul class="mc-off-list">
              ${offerings.map(o => html`<${OfferingCard} key=${o.agentName + '/' + o.offerId} o=${o} orgOwner=${selected.creatorOwner} slug=${selected.slug} onOrdered=${afterOrder} />`)}
            </ul>

            <div class="mc-orders-received">
              <h3 class="mc-form-title">${t('myCompany.ordersReceived')}</h3>
              <${OrdersList} orders=${ordersReceived} view="owner" empty=${t('myCompany.noOrdersReceived')} />
            </div>
          `}
        </section>
      </div>
    </div>`;
}
