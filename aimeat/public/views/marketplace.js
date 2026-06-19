/**
 * @file marketplace.js
 * @description Marketplace SPA view (Preact + HTM) — home/browse/search/sell/detail
 *   sub-views for the listings directory, category grid, status badges, pagination.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Component unification (#18 category cards): category tiles
 *     use canonical theme.css .category-card / -icon / -name / -count (was .mk-category-*).
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { hasSession, getSession, getOwner } from '/js/services/auth.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);

/* ── Constants ── */
const DEFAULT_CATEGORIES = [
  { key: 'palvelut', icon: '\uD83D\uDEE0\uFE0F' },
  { key: 'tuotteet', icon: '\uD83D\uDCE6' },
  { key: 'data',     icon: '\uD83D\uDCCA' },
  { key: 'osaaminen',icon: '\uD83C\uDF93' },
  { key: 'muu',      icon: '\uD83D\uDD39' },
];

const STATUS_MAP = {
  active:           { cls: 'mk-status-active' },
  sold:             { cls: 'mk-status-sold' },
  pending_delivery: { cls: 'mk-status-pending' },
  delivered:        { cls: 'mk-status-delivered' },
  completed:        { cls: 'mk-status-completed' },
  delisted:         { cls: 'mk-status-delisted' },
};

/* ── Auth helpers (uses centralized AIMEAT auth service) ── */
function isLoggedIn() { return hasSession(); }
function getAuthInfo() {
  const s = getSession();
  return { token: s?.jwt, gaii: s?.gaii, owner: s?.owner || getOwner() };
}

/* ── Tiny helpers ── */
function getCategoryList(instanceConfig) {
  const keys = instanceConfig.categories || DEFAULT_CATEGORIES.map(c => c.key);
  return keys.map(k => {
    const def = DEFAULT_CATEGORIES.find(c => c.key === k);
    return { key: k, icon: def ? def.icon : '\uD83D\uDD39' };
  });
}
function catLabel(key, tl) {
  const def = DEFAULT_CATEGORIES.find(c => c.key === key);
  const translate = tl || t;
  const name = translate('mkt.cat.' + key);
  return { name: name !== 'mkt.cat.' + key ? name : key, icon: def ? def.icon : '' };
}
function statusBadge(status) {
  const m = STATUS_MAP[status] || {};
  return html`<span class="mk-status-badge ${m.cls || ''}">${t('mkt.status.' + status) || status}</span>`;
}
function stars(score) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= score ? '\u2605' : '\u2606';
  return html`<span class="mk-stars">${s}</span>`;
}

/* ══════════════════════════════════════════════
   Sub-views
   ══════════════════════════════════════════════ */

/* ── Instance Selector ── */
function InstanceSelector({ onSelect }) {
  const [instances, setInstances] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/v1/extensions/marketplace-behaviors/instances')
      .then(j => {
        if (!j.ok) throw new Error();
        setInstances(j.data.instances || j.data || []);
      })
      .catch(() => setErr(t('mkt.myListings.error')));
  }, []);

  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!instances) return html`<div class="mk-alert mk-alert-info">...</div>`;

  return html`
    <h1 class="mk-page-title">${t('mkt.instanceSelector')}</h1>
    <p class="mk-page-subtitle">${t('mkt.instanceSelectorSubtitle')}</p>
    ${instances.length === 0
      ? html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDED2</div><div class="mk-empty-text">${t('mkt.noInstances')}</div></div>`
      : html`
        <div class="mk-instance-grid">
          ${instances.map(inst => {
            const vis = (inst.config && inst.config.visibility) || 'public';
            return html`
              <div class="mk-instance-card" onClick=${() => onSelect(inst)}>
                <div class="mk-instance-name">${inst.config && inst.config.name || inst.id}</div>
                <div class="mk-instance-meta">
                  <span class="mk-visibility-badge mk-vis-${vis}">${t('mkt.visibility.' + vis) || vis}</span>
                  ${inst.config && inst.config.description ? html`<div style="margin-top:6px;">${inst.config.description}</div>` : null}
                </div>
              </div>
            `;
          })}
        </div>
      `}
  `;
}

/* ── Listing Card (reused in home + browse) ── */
function ListingCard({ listing: l, onNav, tl }) {
  const cl = catLabel(l.category, tl);
  const tags = (l.tags || []).slice(0, 4);
  return html`
    <a class="mk-card mk-card-clickable" onClick=${() => onNav('listing', { id: l.id })}>
      <div class="mk-listing-header">
        <div>
          <div class="mk-card-title">${l.title}</div>
          <div class="mk-card-meta">${cl.icon} ${cl.name}${l.location && l.location.city ? ' \u00B7 ' + l.location.city : ''}${l.sellerGhii ? ' \u00B7 ' + l.sellerGhii : ''}</div>
        </div>
        <div class="mk-price-badge">${l.price} morsels</div>
      </div>
      ${l.description ? html`<div class="mk-card-desc">${l.description.length > 120 ? l.description.slice(0, 120) + '...' : l.description}</div>` : null}
      ${tags.length > 0 ? html`<div class="mk-tags">${tags.map(tg => html`<span class="mk-tag">${tg}</span>`)}</div>` : null}
    </a>
  `;
}

/* ── Home ── */
function HomeView({ extAction, instanceConfig, onNav, tl }) {
  const [listings, setListings] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    extAction('browse', { limit: 50 })
      .then(d => setListings(d))
      .catch(() => setErr(t('mkt.myListings.error')));
  }, []);

  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!listings) return html`<div class="mk-alert mk-alert-info">...</div>`;

  const items = listings.listings || [];
  const total = listings.total || items.length;
  const categories = getCategoryList(instanceConfig);
  const catCounts = {};
  items.forEach(l => { catCounts[l.category] = (catCounts[l.category] || 0) + 1; });
  const recent = items.slice(0, 6);

  return html`
    <h1 class="mk-page-title">${instanceConfig.name || t('mkt.home.title')}</h1>
    <p class="mk-page-subtitle">${instanceConfig.description || t('mkt.home.subtitle')}</p>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-card-value accent">${total}</div><div class="stat-card-label">${t('mkt.home.listings')}</div></div>
      <div class="stat-card"><div class="stat-card-value accent">${Object.keys(catCounts).length}</div><div class="stat-card-label">${t('mkt.home.categories')}</div></div>
    </div>

    <h2 class="mk-section-heading">${t('mkt.home.categoriesHeading')}</h2>
    <div class="mk-categories-grid">
      ${categories.map(cat => html`
        <a class="category-card" onClick=${() => onNav('browse', { category: cat.key })}>
          <div class="category-icon">${cat.icon}</div>
          <div class="category-name">${tl('mkt.cat.' + cat.key) !== 'mkt.cat.' + cat.key ? tl('mkt.cat.' + cat.key) : cat.key}</div>
          ${catCounts[cat.key] ? html`<div class="category-count">${catCounts[cat.key]} ${t('mkt.home.announcements')}</div>` : null}
        </a>
      `)}
    </div>

    ${recent.length > 0 ? html`
      <h2 class="mk-section-heading">${t('mkt.home.recentHeading')}</h2>
      ${recent.map(l => html`<${ListingCard} listing=${l} onNav=${onNav} tl=${tl} />`)}
    ` : html`
      <div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDED2</div><div class="mk-empty-text">${t('mkt.home.emptyText')}</div></div>
    `}

    <div style="text-align:center; margin-top:32px;">
      <a class="btn-primary" style="margin-right:8px;" onClick=${() => onNav('browse')}>${t('mkt.home.browseBtn')}</a>
      <a class="btn-outline" onClick=${() => onNav('sell')}>${t('mkt.home.sellBtn')}</a>
    </div>
  `;
}

/* ── Browse / Search ── */
function BrowseView({ extAction, instanceConfig, onNav, params, tl }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(params.category || '');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState('');
  const categories = getCategoryList(instanceConfig);

  const doSearch = useCallback((pg) => {
    const p = pg || 1;
    setPage(p);
    setResults(null);
    setErr('');
    const body = { page: p, limit: 20 };
    if (category) body.category = category;
    if (minPrice) body.minPrice = parseInt(minPrice, 10);
    if (maxPrice) body.maxPrice = parseInt(maxPrice, 10);
    extAction('browse', body)
      .then(d => {
        let items = d.listings || [];
        if (q) {
          const lower = q.toLowerCase();
          items = items.filter(l =>
            l.title.toLowerCase().includes(lower) ||
            (l.description || '').toLowerCase().includes(lower) ||
            (l.tags || []).some(tg => tg.toLowerCase().includes(lower))
          );
        }
        setResults({ listings: items, total: d.total || 0 });
      })
      .catch(() => setErr(t('mkt.search.error')));
  }, [q, category, minPrice, maxPrice, extAction]);

  useEffect(() => { doSearch(1); }, []);

  const clearSearch = () => {
    setQ(''); setCategory(''); setMinPrice(''); setMaxPrice('');
    setPage(1); setResults(null);
    setTimeout(() => doSearch(1), 0);
  };

  const catOptions = [{ key: '', label: t('mkt.search.categoryAll') },
    ...categories.map(c => { const n = tl('mkt.cat.' + c.key); return { key: c.key, label: c.icon + ' ' + (n !== 'mkt.cat.' + c.key ? n : c.key) }; })];

  return html`
    <h1 class="mk-page-title">${t('mkt.search.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.search.subtitle')}</p>
    <div class="mk-card" style="margin-bottom:24px;">
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.keyword')}</label>
          <input type="text" class="input-field" placeholder=${t('mkt.search.keywordPlaceholder')} value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.category')}</label>
          <select class="input-field" value=${category} onChange=${e => setCategory(e.target.value)}>
            ${catOptions.map(o => html`<option value=${o.key}>${o.label}</option>`)}
          </select></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.price')}</label>
          <div style="display:flex; gap:8px;">
            <input type="number" class="input-field" placeholder=${t('mkt.search.minPlaceholder')} value=${minPrice} onInput=${e => setMinPrice(e.target.value)} min="0" />
            <input type="number" class="input-field" placeholder=${t('mkt.search.maxPlaceholder')} value=${maxPrice} onInput=${e => setMaxPrice(e.target.value)} min="0" />
          </div></div>
      </div>
      <div style="margin-top:12px;">
        <button class="btn-primary btn-sm" onClick=${() => doSearch(1)}>${t('mkt.search.btn')}</button>
        <button class="btn-outline btn-sm" style="margin-left:8px;" onClick=${clearSearch}>${t('mkt.search.clearBtn')}</button>
      </div>
    </div>

    ${err ? html`<div class="mk-alert mk-alert-error">${err}</div>` : null}
    ${!results && !err ? html`<div class="mk-alert mk-alert-info">...</div>` : null}
    ${results && results.listings.length === 0 ? html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD0D</div><div class="mk-empty-text">${t('mkt.search.noResults')}</div></div>` : null}
    ${results && results.listings.length > 0 ? html`
      ${results.listings.map(l => html`<${ListingCard} listing=${l} onNav=${onNav} tl=${tl} />`)}
      ${results.total > 20 ? html`
        <div class="mk-pagination">
          ${page > 1 ? html`<a onClick=${() => doSearch(page - 1)}>\u00AB ${t('mkt.search.prev')}</a>` : null}
          <a class="active">${t('mkt.search.page')} ${page}</a>
          ${results.listings.length >= 20 ? html`<a onClick=${() => doSearch(page + 1)}>${t('mkt.search.next')} \u00BB</a>` : null}
        </div>
      ` : null}
    ` : null}
  `;
}

/* ── Listing Detail ── */
function ListingDetailView({ extAction, onNav, params, tl }) {
  const [listing, setListing] = useState(null);
  const [err, setErr] = useState('');
  const [purchaseMsg, setPurchaseMsg] = useState('');
  const [purchaseErr, setPurchaseErr] = useState('');

  const load = useCallback(() => {
    setListing(null); setErr('');
    extAction('browse', { listingId: params.id })
      .then(d => {
        const item = d.listing || (d.listings && d.listings.find(l => l.id === params.id));
        if (!item) throw new Error('Not found');
        setListing(item);
      })
      .catch(() => setErr(t('mkt.detail.loadError')));
  }, [params.id, extAction]);

  useEffect(() => { load(); }, [load]);

  const doPurchase = () => {
    if (!isLoggedIn()) return;
    setPurchaseMsg(''); setPurchaseErr('');
    extAction('purchase', { listingId: params.id })
      .then(d => {
        setPurchaseMsg(t('mkt.detail.purchaseSuccess') + (d.trackingCode ? ' Code: ' + d.trackingCode : ''));
        setTimeout(() => load(), 2000);
      })
      .catch(e => setPurchaseErr(t('mkt.detail.purchaseFailed') + ': ' + (e.message || t('mkt.sell.unknownError'))));
  };

  if (err) return html`
    <div class="mk-empty-state"><div class="mk-empty-icon">\u2753</div><div class="mk-empty-text">${t('mkt.detail.notFound')}</div></div>
    <div style="text-align:center;"><a class="btn-outline" onClick=${() => onNav('home')}>${t('mkt.detail.backBtn')}</a></div>
  `;
  if (!listing) return html`<div class="mk-alert mk-alert-info">...</div>`;

  const cl = catLabel(listing.category, tl);
  const tags = listing.tags || [];
  const info = getAuthInfo();
  const isOwner = info.owner && info.owner === listing.ownerName;
  const feePercent = 5;
  const fee = Math.ceil(listing.price * feePercent / 100);
  const totalCost = listing.price + fee;

  return html`
    <div style="margin-bottom:16px;">
      <a style="color:var(--text-dim); text-decoration:none; font-size:0.85rem; cursor:pointer;" onClick=${() => onNav('home')}>\u00AB ${t('mkt.detail.backToMarket')}</a>
    </div>
    <div class="mk-card">
      <div class="mk-listing-header">
        <div>
          <div class="mk-card-title" style="font-size:1.4rem;">${listing.title}</div>
          <div class="mk-card-meta">${cl.icon} ${cl.name}${listing.location && listing.location.city ? ' \u00B7 ' + listing.location.city : ''}${listing.location && listing.location.area ? ', ' + listing.location.area : ''} \u00B7 ${t('mkt.detail.seller')}: ${listing.sellerGhii}</div>
        </div>
        <div>
          <div class="mk-price-badge" style="font-size:1.1rem;">${listing.price} morsels</div>
          <div style="margin-top:8px;">${statusBadge(listing.status)}</div>
        </div>
      </div>
      <div class="mk-card-desc" style="margin-top:16px; white-space:pre-line;">${listing.description}</div>
      ${tags.length > 0 ? html`<div class="mk-tags" style="margin-top:12px;">${tags.map(tg => html`<span class="mk-tag">${tg}</span>`)}</div>` : null}
      <div style="margin-top:16px; font-size:0.85rem; color:var(--text-dim);">
        ${listing.condition ? t('mkt.detail.condition') + ': ' + listing.condition + ' \u00B7 ' : ''}
        ${listing.availability ? t('mkt.detail.availability') + ': ' + listing.availability + ' \u00B7 ' : ''}
        ${t('mkt.detail.created')}: ${(listing.createdAt || '').slice(0, 10)}
      </div>

      ${listing.status === 'active' && !isOwner ? html`
        <div class="mk-listing-actions">
          <div class="mk-card" style="padding:16px; background:rgba(232,86,74,0.04); border-color:rgba(232,86,74,0.15); flex:1;">
            <div style="font-size:0.85rem; color:var(--text-dim); margin-bottom:8px;">${t('mkt.detail.totalPrice')} (${feePercent}%)</div>
            <div style="font-size:1.2rem; font-weight:700; color:var(--accent-bright);">${totalCost} morsels</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">${t('mkt.detail.price')}: ${listing.price} + ${t('mkt.detail.serviceFee')}: ${fee}</div>
          </div>
        </div>
        ${isLoggedIn() ? html`
          <div style="margin-top:16px; text-align:center;">
            <button class="btn-primary" onClick=${doPurchase}>${t('mkt.detail.purchaseBtn')}</button>
          </div>
        ` : html`
          <div style="margin-top:16px; text-align:center;">
            <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:8px;">${t('mkt.detail.purchaseHint')}</p>
          </div>
        `}
      ` : null}
      ${isOwner ? html`<div class="mk-listing-actions"><p style="font-size:0.85rem; color:var(--text-dim);">${t('mkt.detail.ownListing')}</p></div>` : null}
    </div>

    ${purchaseMsg ? html`<div class="mk-alert mk-alert-success">${purchaseMsg}</div>` : null}
    ${purchaseErr ? html`<div class="mk-alert mk-alert-error">${purchaseErr}</div>` : null}
  `;
}

/* ── Create Listing ── */
function CreateListingView({ extAction, instanceConfig, onNav, tl }) {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const categories = getCategoryList(instanceConfig);

  if (!isLoggedIn()) return html`
    <div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD12</div><div class="mk-empty-text">${t('mkt.sell.authRequired')}</div></div>
    <div style="text-align:center; margin-top:16px;"><a href="/v1/portal/human" class="btn-primary">${t('mkt.sell.authBtn')}</a></div>
  `;

  const submit = () => {
    setMsg(''); setErr(''); setSending(true);
    const data = {
      title: /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-title')).value,
      description: /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-desc')).value,
      category: /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-category')).value,
      price: parseInt(/** @type {HTMLInputElement} */ (document.getElementById('mk-sell-price')).value, 10),
    };
    const condition = /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-condition')).value;
    if (condition) data.condition = condition;
    const availability = /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-avail')).value;
    if (availability) data.availability = availability;
    const city = /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-city')).value;
    const area = /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-area')).value;
    if (city || area) { data.location = {}; if (city) data.location.city = city; if (area) data.location.area = area; }
    const tags = /** @type {HTMLInputElement} */ (document.getElementById('mk-sell-tags')).value;
    if (tags) data.tags = tags.split(',').map(s => s.trim()).filter(Boolean);

    extAction('create-listing', data)
      .then(d => {
        setSending(false);
        setMsg(t('mkt.sell.success') + ' ' + (d.listingId || d.id || ''));
        setTimeout(() => onNav('listing', { id: d.listingId || d.id }), 1500);
      })
      .catch(e => { setSending(false); setErr(e.message || t('mkt.sell.unknownError')); });
  };

  const catOptions = categories.map(c => { const n = tl('mkt.cat.' + c.key); return { key: c.key, label: c.icon + ' ' + (n !== 'mkt.cat.' + c.key ? n : c.key) }; });

  return html`
    <h1 class="mk-page-title">${t('mkt.sell.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.sell.listingFee')}: 2 morsels</p>
    <div class="mk-card">
      <p style="font-size:0.9rem; color:var(--text-dim); margin-bottom:16px;">${t('mkt.sell.formNote')}</p>
      <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.titleLabel')}</label>
        <input type="text" id="mk-sell-title" class="input-field" placeholder=${t('mkt.sell.titlePlaceholder')} minlength="3" maxlength="200" /></div>
      <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.descLabel')}</label>
        <textarea id="mk-sell-desc" class="input-field" placeholder=${t('mkt.sell.descPlaceholder')} rows="4" minlength="10" maxlength="5000"></textarea></div>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.categoryLabel')}</label>
          <select id="mk-sell-category" class="input-field">
            ${catOptions.map(o => html`<option value=${o.key}>${o.label}</option>`)}
          </select></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.priceLabel')}</label>
          <input type="number" id="mk-sell-price" class="input-field" placeholder="10" min="1" /></div>
      </div>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.conditionLabel')}</label>
          <select id="mk-sell-condition" class="input-field">
            <option value="">${t('mkt.sell.conditionNone')}</option>
            <option value="new">${t('mkt.sell.conditionNew')}</option>
            <option value="used">${t('mkt.sell.conditionUsed')}</option>
            <option value="digital">${t('mkt.sell.conditionDigital')}</option>
          </select></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.availLabel')}</label>
          <select id="mk-sell-avail" class="input-field">
            <option value="">${t('mkt.sell.availNone')}</option>
            <option value="immediate">${t('mkt.sell.availImmediate')}</option>
            <option value="on_request">${t('mkt.sell.availOnRequest')}</option>
            <option value="scheduled">${t('mkt.sell.availScheduled')}</option>
          </select></div>
      </div>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.cityLabel')}</label>
          <input type="text" id="mk-sell-city" class="input-field" placeholder=${t('mkt.sell.cityPlaceholder')} /></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.areaLabel')}</label>
          <input type="text" id="mk-sell-area" class="input-field" placeholder=${t('mkt.sell.areaPlaceholder')} /></div>
      </div>
      <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.tagsLabel')}</label>
        <input type="text" id="mk-sell-tags" class="input-field" placeholder=${t('mkt.sell.tagsPlaceholder')} /></div>

      ${msg ? html`<div class="mk-alert mk-alert-success">${msg}</div>` : null}
      ${err ? html`<div class="mk-alert mk-alert-error">${err}</div>` : null}
      <div style="margin-top:16px;">
        <button class="btn-primary" onClick=${submit} disabled=${sending}>${t('mkt.sell.submitBtn')} (2 morsels)</button>
      </div>
    </div>
  `;
}

/* ── My Listings ── */
function MyListingsView({ extAction, onNav, tl }) {
  const [listings, setListings] = useState(null);
  const [err, setErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) return;
    extAction('browse', { seller: 'me', status: 'all' })
      .then(d => setListings(d.listings || []))
      .catch(() => setErr(t('mkt.myListings.error')));
  }, []);

  const doAction = (actionId, body, successMsg) => {
    setActionMsg('');
    extAction(actionId, body)
      .then(() => {
        setActionMsg(successMsg);
        extAction('browse', { seller: 'me', status: 'all' })
          .then(d => setListings(d.listings || []));
      })
      .catch(e => setActionMsg('Error: ' + (e.message || 'failed')));
  };

  if (!isLoggedIn()) return html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD12</div><div class="mk-empty-text">${t('mkt.myListings.authRequired')}</div></div>`;
  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!listings) return html`<div class="mk-alert mk-alert-info">...</div>`;

  return html`
    <h1 class="mk-page-title">${t('mkt.myListings.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.myListings.subtitle')}</p>
    <div style="margin-bottom:16px;"><a class="btn-primary" onClick=${() => onNav('sell')}>${t('mkt.myListings.newBtn')}</a></div>
    ${actionMsg ? html`<div class="mk-alert mk-alert-info">${actionMsg}</div>` : null}
    ${listings.length > 0 ? listings.map(l => {
      const cl = catLabel(l.category, tl);
      return html`
        <div class="mk-card">
          <a class="mk-card-clickable" style="text-decoration:none;" onClick=${() => onNav('listing', { id: l.id })}>
            <div class="mk-listing-header">
              <div>
                <div class="mk-card-title">${l.title}</div>
                <div class="mk-card-meta">${cl.icon} ${cl.name} \u00B7 ${(l.createdAt || '').slice(0, 10)}</div>
              </div>
              <div style="text-align:right;">
                <div class="mk-price-badge">${l.price} morsels</div>
                <div style="margin-top:6px;">${statusBadge(l.status)}</div>
              </div>
            </div>
          </a>
          ${l.status === 'active' ? html`
            <div style="margin-top:8px; display:flex; gap:8px;">
              <button class="btn-outline btn-sm" onClick=${() => doAction('delist', { listingId: l.id }, 'Delisted')}>${t('mkt.myListings.delistBtn')}</button>
            </div>
          ` : null}
        </div>
      `;
    }) : html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDCE6</div><div class="mk-empty-text">${t('mkt.myListings.empty')}</div></div>`}
  `;
}

/* ── My Purchases ── */
function MyPurchasesView({ extAction, onNav, tl }) {
  const [purchases, setPurchases] = useState(null);
  const [err, setErr] = useState('');
  const [rateId, setRateId] = useState('');
  const [rateScore, setRateScore] = useState(5);
  const [rateComment, setRateComment] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) return;
    extAction('browse', { buyer: 'me' })
      .then(d => setPurchases(d.purchases || d.listings || []))
      .catch(() => setErr(t('mkt.myPurchases.error')));
  }, []);

  const doRate = () => {
    if (!rateId) return;
    setActionMsg('');
    extAction('rate', { listingId: rateId, score: rateScore, comment: rateComment })
      .then(() => { setActionMsg(t('mkt.detail.purchaseSuccess')); setRateId(''); setRateComment(''); })
      .catch(e => setActionMsg('Error: ' + (e.message || 'failed')));
  };

  if (!isLoggedIn()) return html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD12</div><div class="mk-empty-text">${t('mkt.myPurchases.authRequired')}</div></div>`;
  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!purchases) return html`<div class="mk-alert mk-alert-info">...</div>`;

  return html`
    <h1 class="mk-page-title">${t('mkt.myPurchases.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.myPurchases.subtitle')}</p>
    ${actionMsg ? html`<div class="mk-alert mk-alert-info">${actionMsg}</div>` : null}
    ${purchases.length === 0 ? html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDED2</div><div class="mk-empty-text">${t('mkt.myPurchases.empty')}</div></div>` : null}
    ${purchases.map(p => {
      const title = p.title || p._listing && p._listing.title || t('mkt.myPurchases.unknown');
      return html`
        <div class="mk-card">
          <div class="mk-listing-header">
            <div>
              <div class="mk-card-title">${title}</div>
              <div class="mk-card-meta">${t('mkt.myPurchases.seller')}: ${p.sellerOwner || p.seller || ''} \u00B7 ${(p.createdAt || '').slice(0, 10)} ${p.trackingCode ? '\u00B7 ' + t('mkt.myPurchases.code') + ': ' + p.trackingCode : ''}</div>
            </div>
            <div style="text-align:right;">
              <div class="mk-price-badge">${p.totalCostMorsels || p.price || 0} morsels</div>
              <div style="margin-top:6px;">${statusBadge(p.status)}</div>
            </div>
          </div>
          ${p.rating ? html`<div style="margin-top:8px;">${stars(p.rating.score)}${p.rating.comment ? html`<span style="font-size:0.85rem; color:var(--text-dim); margin-left:8px;">"${p.rating.comment}"</span>` : null}</div>` : null}
        </div>
      `;
    })}

    <div class="mk-card" style="margin-top:24px;">
      <h3 class="mk-section-heading">${t('mkt.myPurchases.rateHint')}</h3>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">Listing ID</label>
          <input type="text" class="input-field" value=${rateId} onInput=${e => setRateId(e.target.value)} placeholder="listing-id" /></div>
        <div class="mk-form-group"><label class="mk-form-label">Score (1-5)</label>
          <input type="number" class="input-field" value=${rateScore} onInput=${e => setRateScore(parseInt(e.target.value, 10))} min="1" max="5" /></div>
      </div>
      <div class="mk-form-group"><label class="mk-form-label">Comment</label>
        <input type="text" class="input-field" value=${rateComment} onInput=${e => setRateComment(e.target.value)} /></div>
      <button class="btn-primary btn-sm" onClick=${doRate}>${t('mkt.detail.purchaseBtn')}</button>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   Main Marketplace Component
   ══════════════════════════════════════════════ */
export default function MarketplaceView({ navigate: spaNavigate, locale }) {
  const [view, setView] = useState('instances');
  const [instanceId, setInstanceId] = useState(null);
  const [instanceConfig, setInstanceConfig] = useState({});
  const [instanceTranslations, setInstanceTranslations] = useState({});
  const [params, setParams] = useState({});

  useViewCSS('/css/views/marketplace.css');

  // Instance-aware translation: check instance translations first, then global
  const tl = useCallback((key) => {
    return instanceTranslations[key] || t(key);
  }, [instanceTranslations]);

  const nav = useCallback((v, p) => {
    setView(v || 'instances');
    setParams(p || {});
    window.scrollTo(0, 0);
  }, []);

  const selectInstance = useCallback((inst) => {
    setInstanceId(inst.id);
    setInstanceConfig(inst.config || {});
    setView('home');
    setParams({});
    // Load instance translations for current locale
    const loc = getLocale();
    apiGet('/v1/extensions/marketplace-behaviors/instances/' + inst.id + '/translations?locale=' + loc)
      .then(res => setInstanceTranslations(res.data?.translations || {}))
      .catch(() => setInstanceTranslations({}));
  }, []);

  const extAction = useCallback(async (actionId, body = {}) => {
    const res = await apiPost('/v1/ext/marketplace-behaviors/' + instanceId + '/' + actionId, body);
    if (!res.ok) throw new Error(res.error && res.error.message || 'Action failed');
    return res.data;
  }, [instanceId]);

  // If no instance selected, show instance selector
  if (view === 'instances' || !instanceId) {
    return html`<${InstanceSelector} onSelect=${selectInstance} />`;
  }

  const sharedProps = { extAction, instanceConfig, onNav: nav, params, tl };

  let content;
  switch (view) {
    case 'browse':       content = html`<${BrowseView} ...${sharedProps} />`; break;
    case 'listing':      content = html`<${ListingDetailView} ...${sharedProps} />`; break;
    case 'sell':         content = html`<${CreateListingView} ...${sharedProps} />`; break;
    case 'my-listings':  content = html`<${MyListingsView} ...${sharedProps} />`; break;
    case 'my-purchases': content = html`<${MyPurchasesView} ...${sharedProps} />`; break;
    default:             content = html`<${HomeView} ...${sharedProps} />`; break;
  }

  return html`
    <nav class="mk-nav">
      <a class="mk-back-link" onClick=${() => { setInstanceId(null); nav('instances'); }}>${t('mkt.backToMarketplaces')}</a>
      <a class=${view === 'home' ? 'active' : ''} onClick=${() => nav('home')}>${instanceConfig.name || t('mkt.brand')}</a>
      <a class=${view === 'browse' ? 'active' : ''} onClick=${() => nav('browse')}>${t('mkt.nav.search')}</a>
      <a class=${view === 'sell' ? 'active' : ''} onClick=${() => nav('sell')}>${t('mkt.nav.sell')}</a>
      <a class=${view === 'my-listings' ? 'active' : ''} onClick=${() => nav('my-listings')}>${t('mkt.nav.myListings')}</a>
      <a class=${view === 'my-purchases' ? 'active' : ''} onClick=${() => nav('my-purchases')}>${t('mkt.nav.myPurchases')}</a>
    </nav>
    ${content}
  `;
}
