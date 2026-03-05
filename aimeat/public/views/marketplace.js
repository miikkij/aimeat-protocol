import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';

const html = htm.bind(h);

/* ── Constants ── */
const CATEGORIES = [
  { key: 'palvelut', icon: '\uD83D\uDEE0\uFE0F' },
  { key: 'tuotteet', icon: '\uD83D\uDCE6' },
  { key: 'data',     icon: '\uD83D\uDCCA' },
  { key: 'osaaminen',icon: '\uD83C\uDF93' },
  { key: 'muu',      icon: '\uD83D\uDD39' },
];

const STATUS_MAP = {
  active:           { cls: 'mk-status-active',    color: 'var(--success)' },
  sold:             { cls: 'mk-status-sold',       color: '#818cf8' },
  pending_delivery: { cls: 'mk-status-pending',    color: 'var(--warning, #eab308)' },
  delivered:        { cls: 'mk-status-delivered',   color: 'var(--success)' },
  completed:        { cls: 'mk-status-completed',   color: '#818cf8' },
  delisted:         { cls: 'mk-status-delisted',    color: '#ef4444' },
};

/* ── Auth helpers ── */
function getAuthHeaders() {
  const token = localStorage.getItem('aimeat-token');
  if (!token) return null;
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
}
function getAuthInfo() {
  return {
    token: localStorage.getItem('aimeat-token'),
    gaii: localStorage.getItem('aimeat-gaii'),
    owner: localStorage.getItem('aimeat-owner'),
  };
}
function isLoggedIn() { return !!localStorage.getItem('aimeat-token'); }

/* ── Tiny helpers ── */
function catLabel(key) {
  const cat = CATEGORIES.find(c => c.key === key);
  return cat ? { name: t('mkt.cat.' + key), icon: cat.icon } : { name: key, icon: '' };
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

/* ── Home ── */
function HomeView({ onNav }) {
  const [listings, setListings] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/v1/marketplace/listings?per_page=50&page=1')
      .then(j => { if (!j.ok) throw new Error(); setListings(j.data); })
      .catch(() => setErr(t('mkt.myListings.error')));
  }, []);

  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!listings) return html`<div class="mk-alert mk-alert-info">...</div>`;

  const items = listings.listings || [];
  const total = listings.total || items.length;
  const catCounts = {};
  items.forEach(l => { catCounts[l.category] = (catCounts[l.category] || 0) + 1; });
  const recent = items.slice(0, 6);

  return html`
    <h1 class="mk-page-title">${t('mkt.home.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.home.subtitle')}</p>

    <div class="mk-stats-grid">
      <div class="mk-stat-card"><div class="mk-stat-value">${total}</div><div class="mk-stat-label">${t('mkt.home.listings')}</div></div>
      <div class="mk-stat-card"><div class="mk-stat-value">${Object.keys(catCounts).length}</div><div class="mk-stat-label">${t('mkt.home.categories')}</div></div>
    </div>

    <h2 class="mk-section-heading">${t('mkt.home.categoriesHeading')}</h2>
    <div class="mk-categories-grid">
      ${CATEGORIES.map(cat => html`
        <a class="mk-category-card" onClick=${() => onNav('search', { category: cat.key })}>
          <div class="mk-category-icon">${cat.icon}</div>
          <div class="mk-category-name">${t('mkt.cat.' + cat.key)}</div>
          ${catCounts[cat.key] ? html`<div class="mk-category-count">${catCounts[cat.key]} ${t('mkt.home.announcements')}</div>` : null}
        </a>
      `)}
    </div>

    ${recent.length > 0 ? html`
      <h2 class="mk-section-heading">${t('mkt.home.recentHeading')}</h2>
      ${recent.map(l => html`<${ListingCard} listing=${l} onNav=${onNav} />`)}
    ` : html`
      <div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDED2</div><div class="mk-empty-text">${t('mkt.home.emptyText')}</div></div>
    `}

    <div style="text-align:center; margin-top:32px;">
      <a class="mk-btn mk-btn-primary" style="margin-right:8px;" onClick=${() => onNav('search')}>${t('mkt.home.browseBtn')}</a>
      <a class="mk-btn mk-btn-secondary" onClick=${() => onNav('sell')}>${t('mkt.home.sellBtn')}</a>
    </div>
  `;
}

/* ── Listing Card (reused in home + search) ── */
function ListingCard({ listing: l, onNav }) {
  const cl = catLabel(l.category);
  const tags = (l.tags || []).slice(0, 4);
  return html`
    <a class="mk-card mk-card-clickable" onClick=${() => onNav('listing', { id: l.id })}>
      <div class="mk-listing-header">
        <div>
          <div class="mk-card-title">${l.title}</div>
          <div class="mk-card-meta">${cl.icon} ${cl.name}${l.location && l.location.city ? ' \u00B7 ' + l.location.city : ''}${l.sellerGhii ? ' \u00B7 ' + l.sellerGhii : ''}</div>
        </div>
        <div class="mk-price-badge">${l.priceMorsels} morsels</div>
      </div>
      ${l.description ? html`<div class="mk-card-desc">${l.description.length > 120 ? l.description.slice(0, 120) + '...' : l.description}</div>` : null}
      ${tags.length > 0 ? html`<div class="mk-tags">${tags.map(tg => html`<span class="mk-tag">${tg}</span>`)}</div>` : null}
    </a>
  `;
}

/* ── Search ── */
function SearchView({ onNav, params }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(params.category || '');
  const [city, setCity] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState('');

  const doSearch = useCallback((pg) => {
    const p = pg || 1;
    setPage(p);
    setResults(null);
    setErr('');
    let url = '/v1/marketplace/listings?page=' + p + '&per_page=20';
    if (category) url += '&category=' + encodeURIComponent(category);
    if (city) url += '&city=' + encodeURIComponent(city);
    if (minPrice) url += '&min_price=' + encodeURIComponent(minPrice);
    if (maxPrice) url += '&max_price=' + encodeURIComponent(maxPrice);
    apiGet(url)
      .then(j => {
        if (!j.ok) throw new Error();
        let items = j.data.listings || [];
        if (q) {
          const lower = q.toLowerCase();
          items = items.filter(l =>
            l.title.toLowerCase().includes(lower) ||
            l.description.toLowerCase().includes(lower) ||
            (l.tags || []).some(tg => tg.toLowerCase().includes(lower))
          );
        }
        setResults({ listings: items, total: j.data.total || 0 });
      })
      .catch(() => setErr(t('mkt.search.error')));
  }, [q, category, city, minPrice, maxPrice]);

  useEffect(() => { doSearch(1); }, []);

  const clearSearch = () => {
    setQ(''); setCategory(''); setCity(''); setMinPrice(''); setMaxPrice('');
    setPage(1); setResults(null);
    setTimeout(() => doSearch(1), 0);
  };

  const catOptions = [{ key: '', label: t('mkt.search.categoryAll') },
    ...CATEGORIES.map(c => ({ key: c.key, label: c.icon + ' ' + t('mkt.cat.' + c.key) }))];

  return html`
    <h1 class="mk-page-title">${t('mkt.search.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.search.subtitle')}</p>
    <div class="mk-card" style="margin-bottom:24px;">
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.keyword')}</label>
          <input type="text" class="mk-form-input" placeholder=${t('mkt.search.keywordPlaceholder')} value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.category')}</label>
          <select class="mk-form-select" value=${category} onChange=${e => setCategory(e.target.value)}>
            ${catOptions.map(o => html`<option value=${o.key}>${o.label}</option>`)}
          </select></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.city')}</label>
          <input type="text" class="mk-form-input" placeholder=${t('mkt.search.cityPlaceholder')} value=${city} onInput=${e => setCity(e.target.value)} /></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.search.price')}</label>
          <div style="display:flex; gap:8px;">
            <input type="number" class="mk-form-input" placeholder=${t('mkt.search.minPlaceholder')} value=${minPrice} onInput=${e => setMinPrice(e.target.value)} min="0" />
            <input type="number" class="mk-form-input" placeholder=${t('mkt.search.maxPlaceholder')} value=${maxPrice} onInput=${e => setMaxPrice(e.target.value)} min="0" />
          </div></div>
      </div>
      <div style="margin-top:12px;">
        <button class="mk-btn mk-btn-primary mk-btn-sm" onClick=${() => doSearch(1)}>${t('mkt.search.btn')}</button>
        <button class="mk-btn mk-btn-secondary mk-btn-sm" style="margin-left:8px;" onClick=${clearSearch}>${t('mkt.search.clearBtn')}</button>
      </div>
    </div>

    ${err ? html`<div class="mk-alert mk-alert-error">${err}</div>` : null}
    ${!results && !err ? html`<div class="mk-alert mk-alert-info">...</div>` : null}
    ${results && results.listings.length === 0 ? html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD0D</div><div class="mk-empty-text">${t('mkt.search.noResults')}</div></div>` : null}
    ${results && results.listings.length > 0 ? html`
      ${results.listings.map(l => html`<${ListingCard} listing=${l} onNav=${onNav} />`)}
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
function ListingDetailView({ onNav, params }) {
  const [listing, setListing] = useState(null);
  const [err, setErr] = useState('');
  const [purchaseMsg, setPurchaseMsg] = useState('');
  const [purchaseErr, setPurchaseErr] = useState('');

  const load = useCallback(() => {
    setListing(null); setErr('');
    apiGet('/v1/marketplace/listings/' + encodeURIComponent(params.id))
      .then(j => { if (!j.ok) throw new Error(); setListing(j.data.listing); })
      .catch(() => setErr(t('mkt.detail.loadError')));
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const doPurchase = () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setPurchaseMsg(''); setPurchaseErr('');
    apiPost('/v1/marketplace/listings/' + encodeURIComponent(params.id) + '/purchase')
      .then(j => {
        if (j.ok) {
          setPurchaseMsg(t('mkt.detail.purchaseSuccess') + (j.data.trackingCode ? ' Code: ' + j.data.trackingCode : ''));
          setTimeout(() => load(), 2000);
        } else {
          setPurchaseErr(t('mkt.detail.purchaseFailed') + ': ' + (j.error ? j.error.message : t('mkt.sell.unknownError')));
        }
      })
      .catch(() => setPurchaseErr(t('mkt.sell.networkError')));
  };

  if (err) return html`
    <div class="mk-empty-state"><div class="mk-empty-icon">\u2753</div><div class="mk-empty-text">${t('mkt.detail.notFound')}</div></div>
    <div style="text-align:center;"><a class="mk-btn mk-btn-secondary" onClick=${() => onNav('home')}>${t('mkt.detail.backBtn')}</a></div>
  `;
  if (!listing) return html`<div class="mk-alert mk-alert-info">...</div>`;

  const cl = catLabel(listing.category);
  const tags = listing.tags || [];
  const info = getAuthInfo();
  const isOwner = info.owner && info.owner === listing.ownerName;
  const feePercent = 5;
  const fee = Math.ceil(listing.priceMorsels * feePercent / 100);
  const totalCost = listing.priceMorsels + fee;

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
          <div class="mk-price-badge" style="font-size:1.1rem;">${listing.priceMorsels} morsels</div>
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
          <div class="mk-card" style="padding:16px; background:rgba(255,105,180,0.05); border-color:rgba(255,105,180,0.2); flex:1;">
            <div style="font-size:0.85rem; color:var(--text-dim); margin-bottom:8px;">${t('mkt.detail.totalPrice')} (${feePercent}%)</div>
            <div style="font-size:1.2rem; font-weight:700; color:var(--accent-bright);">${totalCost} morsels</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">${t('mkt.detail.price')}: ${listing.priceMorsels} + ${t('mkt.detail.serviceFee')}: ${fee}</div>
          </div>
        </div>
        ${isLoggedIn() ? html`
          <div style="margin-top:16px; text-align:center;">
            <button class="mk-btn mk-btn-primary" onClick=${doPurchase}>${t('mkt.detail.purchaseBtn')}</button>
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

/* ── Sell ── */
function SellView({ onNav }) {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);

  if (!isLoggedIn()) return html`
    <div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD12</div><div class="mk-empty-text">${t('mkt.sell.authRequired')}</div></div>
    <div style="text-align:center; margin-top:16px;"><a href="/v1/portal/human" class="mk-btn mk-btn-primary">${t('mkt.sell.authBtn')}</a></div>
  `;

  const submit = () => {
    setMsg(''); setErr(''); setSending(true);
    const data = {
      title: document.getElementById('mk-sell-title').value,
      description: document.getElementById('mk-sell-desc').value,
      category: document.getElementById('mk-sell-category').value,
      priceMorsels: parseInt(document.getElementById('mk-sell-price').value, 10),
    };
    const condition = document.getElementById('mk-sell-condition').value;
    if (condition) data.condition = condition;
    const availability = document.getElementById('mk-sell-avail').value;
    if (availability) data.availability = availability;
    const city = document.getElementById('mk-sell-city').value;
    const area = document.getElementById('mk-sell-area').value;
    if (city || area) { data.location = {}; if (city) data.location.city = city; if (area) data.location.area = area; }
    const tags = document.getElementById('mk-sell-tags').value;
    if (tags) data.tags = tags.split(',').map(s => s.trim()).filter(Boolean);

    apiPost('/v1/marketplace/listings', data)
      .then(j => {
        setSending(false);
        if (j.ok) {
          setMsg(t('mkt.sell.success') + ' ' + j.data.listingId);
          setTimeout(() => onNav('listing', { id: j.data.listingId }), 1500);
        } else {
          setErr(j.error ? j.error.message : t('mkt.sell.unknownError'));
        }
      })
      .catch(() => { setSending(false); setErr(t('mkt.sell.networkError')); });
  };

  const catOptions = CATEGORIES.map(c => ({ key: c.key, label: c.icon + ' ' + t('mkt.cat.' + c.key) }));

  return html`
    <h1 class="mk-page-title">${t('mkt.sell.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.sell.listingFee')}: 2 morsels</p>
    <div class="mk-card">
      <p style="font-size:0.9rem; color:var(--text-dim); margin-bottom:16px;">${t('mkt.sell.formNote')}</p>
      <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.titleLabel')}</label>
        <input type="text" id="mk-sell-title" class="mk-form-input" placeholder=${t('mkt.sell.titlePlaceholder')} minlength="3" maxlength="200" /></div>
      <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.descLabel')}</label>
        <textarea id="mk-sell-desc" class="mk-form-textarea" placeholder=${t('mkt.sell.descPlaceholder')} rows="4" minlength="10" maxlength="5000"></textarea></div>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.categoryLabel')}</label>
          <select id="mk-sell-category" class="mk-form-select">
            ${catOptions.map(o => html`<option value=${o.key}>${o.label}</option>`)}
          </select></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.priceLabel')}</label>
          <input type="number" id="mk-sell-price" class="mk-form-input" placeholder="10" min="1" /></div>
      </div>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.conditionLabel')}</label>
          <select id="mk-sell-condition" class="mk-form-select">
            <option value="">${t('mkt.sell.conditionNone')}</option>
            <option value="new">${t('mkt.sell.conditionNew')}</option>
            <option value="used">${t('mkt.sell.conditionUsed')}</option>
            <option value="digital">${t('mkt.sell.conditionDigital')}</option>
          </select></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.availLabel')}</label>
          <select id="mk-sell-avail" class="mk-form-select">
            <option value="">${t('mkt.sell.availNone')}</option>
            <option value="immediate">${t('mkt.sell.availImmediate')}</option>
            <option value="on_request">${t('mkt.sell.availOnRequest')}</option>
            <option value="scheduled">${t('mkt.sell.availScheduled')}</option>
          </select></div>
      </div>
      <div class="mk-form-grid">
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.cityLabel')}</label>
          <input type="text" id="mk-sell-city" class="mk-form-input" placeholder=${t('mkt.sell.cityPlaceholder')} /></div>
        <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.areaLabel')}</label>
          <input type="text" id="mk-sell-area" class="mk-form-input" placeholder=${t('mkt.sell.areaPlaceholder')} /></div>
      </div>
      <div class="mk-form-group"><label class="mk-form-label">${t('mkt.sell.tagsLabel')}</label>
        <input type="text" id="mk-sell-tags" class="mk-form-input" placeholder=${t('mkt.sell.tagsPlaceholder')} /></div>

      ${msg ? html`<div class="mk-alert mk-alert-success">${msg}</div>` : null}
      ${err ? html`<div class="mk-alert mk-alert-error">${err}</div>` : null}
      <div style="margin-top:16px;">
        <button class="mk-btn mk-btn-primary" onClick=${submit} disabled=${sending}>${t('mkt.sell.submitBtn')} (2 morsels)</button>
      </div>
    </div>
  `;
}

/* ── My Listings ── */
function MyListingsView({ onNav }) {
  const [listings, setListings] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) return;
    apiGet('/v1/marketplace/my-listings')
      .then(j => { if (!j.ok) throw new Error(); setListings(j.data.listings || []); })
      .catch(() => setErr(t('mkt.myListings.error')));
  }, []);

  if (!isLoggedIn()) return html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD12</div><div class="mk-empty-text">${t('mkt.myListings.authRequired')}</div></div>`;
  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!listings) return html`<div class="mk-alert mk-alert-info">...</div>`;

  return html`
    <h1 class="mk-page-title">${t('mkt.myListings.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.myListings.subtitle')}</p>
    <div style="margin-bottom:16px;"><a class="mk-btn mk-btn-primary" onClick=${() => onNav('sell')}>${t('mkt.myListings.newBtn')}</a></div>
    ${listings.length > 0 ? listings.map(l => {
      const cl = catLabel(l.category);
      return html`
        <a class="mk-card mk-card-clickable" onClick=${() => onNav('listing', { id: l.id })}>
          <div class="mk-listing-header">
            <div>
              <div class="mk-card-title">${l.title}</div>
              <div class="mk-card-meta">${cl.icon} ${cl.name} \u00B7 ${(l.createdAt || '').slice(0, 10)}</div>
            </div>
            <div style="text-align:right;">
              <div class="mk-price-badge">${l.priceMorsels} morsels</div>
              <div style="margin-top:6px;">${statusBadge(l.status)}</div>
            </div>
          </div>
        </a>
      `;
    }) : html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDCE6</div><div class="mk-empty-text">${t('mkt.myListings.empty')}</div></div>`}
  `;
}

/* ── My Purchases ── */
function MyPurchasesView({ onNav }) {
  const [purchases, setPurchases] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) return;
    apiGet('/v1/marketplace/my-purchases')
      .then(j => {
        if (!j.ok) throw new Error();
        const list = j.data.purchases || [];
        if (list.length === 0) { setPurchases([]); return; }
        // Fetch listing details for each purchase
        Promise.all(list.map(p =>
          apiGet('/v1/marketplace/listings/' + encodeURIComponent(p.listingId))
            .then(lj => lj.ok ? lj.data.listing : null)
            .catch(() => null)
        )).then(listings => {
          setPurchases(list.map((p, i) => ({ ...p, _listing: listings[i] })));
        });
      })
      .catch(() => setErr(t('mkt.myPurchases.error')));
  }, []);

  if (!isLoggedIn()) return html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDD12</div><div class="mk-empty-text">${t('mkt.myPurchases.authRequired')}</div></div>`;
  if (err) return html`<div class="mk-alert mk-alert-error">${err}</div>`;
  if (!purchases) return html`<div class="mk-alert mk-alert-info">...</div>`;

  return html`
    <h1 class="mk-page-title">${t('mkt.myPurchases.title')}</h1>
    <p class="mk-page-subtitle">${t('mkt.myPurchases.subtitle')}</p>
    ${purchases.length === 0 ? html`<div class="mk-empty-state"><div class="mk-empty-icon">\uD83D\uDED2</div><div class="mk-empty-text">${t('mkt.myPurchases.empty')}</div></div>` : null}
    ${purchases.map(p => {
      const title = p._listing ? p._listing.title : t('mkt.myPurchases.unknown');
      return html`
        <div class="mk-card">
          <div class="mk-listing-header">
            <div>
              <div class="mk-card-title">${title}</div>
              <div class="mk-card-meta">${t('mkt.myPurchases.seller')}: ${p.sellerOwner} \u00B7 ${(p.createdAt || '').slice(0, 10)} \u00B7 ${t('mkt.myPurchases.code')}: ${p.trackingCode}</div>
            </div>
            <div style="text-align:right;">
              <div class="mk-price-badge">${p.totalCostMorsels} morsels</div>
              <div style="margin-top:6px;">${statusBadge(p.status)}</div>
            </div>
          </div>
          ${p.rating ? html`
            <div style="margin-top:8px;">
              ${stars(p.rating.score)}
              ${p.rating.comment ? html`<span style="font-size:0.85rem; color:var(--text-dim); margin-left:8px;">"${p.rating.comment}"</span>` : null}
            </div>
          ` : (p.status === 'delivered' || p.status === 'completed') ? html`
            <div style="margin-top:12px; font-size:0.85rem; color:var(--text-dim);">${t('mkt.myPurchases.rateHint')}${p.id}/rate</div>
          ` : null}
        </div>
      `;
    })}
  `;
}

/* ══════════════════════════════════════════════
   Main Marketplace Component
   ══════════════════════════════════════════════ */
export default function MarketplaceView({ navigate: spaNavigate, locale }) {
  const [view, setView] = useState('home');
  const [params, setParams] = useState({});

  const onNav = useCallback((v, p) => {
    setView(v || 'home');
    setParams(p || {});
    window.scrollTo(0, 0);
  }, []);

  let content;
  switch (view) {
    case 'search':   content = html`<${SearchView} onNav=${onNav} params=${params} />`; break;
    case 'listing':  content = html`<${ListingDetailView} onNav=${onNav} params=${params} />`; break;
    case 'sell':     content = html`<${SellView} onNav=${onNav} />`; break;
    case 'my-listings':  content = html`<${MyListingsView} onNav=${onNav} />`; break;
    case 'my-purchases': content = html`<${MyPurchasesView} onNav=${onNav} />`; break;
    default:         content = html`<${HomeView} onNav=${onNav} />`; break;
  }

  return html`
    <style>
      .mk-page-title {
        font-size: 1.8rem; font-weight: 700;
        background: linear-gradient(135deg, var(--accent), var(--accent-bright, #ff8ecf));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; margin-bottom: 8px;
      }
      .mk-page-subtitle { color: var(--text-dim); font-size: 1rem; margin-bottom: 32px; }
      .mk-section-heading { font-size: 1.1rem; color: var(--text-bright, #fff); margin-bottom: 16px; }

      .mk-card {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,105,180,0.15);
        border-radius: 16px; padding: 24px; margin-bottom: 16px;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
      }
      .mk-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,105,180,0.4); box-shadow: 0 0 20px rgba(255,105,180,0.08); }
      .mk-card-clickable { text-decoration: none; display: block; cursor: pointer; }
      .mk-card-title { font-size: 1.1rem; font-weight: 600; color: var(--text-bright, #fff); margin-bottom: 8px; }
      .mk-card-meta { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 8px; }
      .mk-card-desc { color: var(--text); font-size: 0.9rem; line-height: 1.6; margin-bottom: 12px; }

      .mk-listing-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
      .mk-listing-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }

      .mk-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
      .mk-tag {
        display: inline-block; padding: 4px 12px;
        background: rgba(255,105,180,0.12); border: 1px solid rgba(255,105,180,0.25);
        border-radius: 20px; font-size: 0.8rem; color: var(--accent-bright, #ff8ecf); white-space: nowrap;
      }

      .mk-price-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 6px 14px; background: rgba(255,105,180,0.15);
        border: 1px solid rgba(255,105,180,0.3); border-radius: 20px;
        font-size: 0.9rem; font-weight: 600; color: var(--accent-bright, #ff8ecf);
      }

      .mk-status-badge {
        display: inline-block; padding: 3px 10px; border-radius: 12px;
        font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
      }
      .mk-status-active { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: var(--success); }
      .mk-status-sold { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); color: #818cf8; }
      .mk-status-pending { background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.3); color: #eab308; }
      .mk-status-delivered { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: var(--success); }
      .mk-status-completed { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); color: #818cf8; }
      .mk-status-delisted { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }

      .mk-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 32px; }
      .mk-stat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,105,180,0.15); border-radius: 10px; padding: 16px; text-align: center; }
      .mk-stat-value { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
      .mk-stat-label { font-size: 0.78rem; color: var(--text-muted, #6b6b8a); margin-top: 4px; }

      .mk-categories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 32px; }
      .mk-category-card {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,105,180,0.15);
        border-radius: 16px; padding: 20px; text-align: center; text-decoration: none;
        transition: all 0.2s; cursor: pointer;
      }
      .mk-category-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,105,180,0.4); box-shadow: 0 0 16px rgba(255,105,180,0.08); }
      .mk-category-icon { font-size: 2rem; margin-bottom: 8px; }
      .mk-category-name { font-size: 0.95rem; font-weight: 600; color: var(--text-bright, #fff); }
      .mk-category-count { font-size: 0.78rem; color: var(--text-muted, #6b6b8a); margin-top: 4px; }

      .mk-empty-state { text-align: center; padding: 48px 16px; }
      .mk-empty-icon { font-size: 3rem; margin-bottom: 16px; opacity: 0.4; }
      .mk-empty-text { color: var(--text-dim); font-size: 1rem; }

      .mk-alert { padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 0.9rem; }
      .mk-alert-success { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: var(--success); }
      .mk-alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }
      .mk-alert-info { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: var(--text-dim); }

      .mk-btn {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 10px 24px; border: none; border-radius: 10px;
        font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: all 0.2s; text-decoration: none;
      }
      .mk-btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent-deep, #c44569)); color: #fff; }
      .mk-btn-primary:hover { opacity: 0.9; box-shadow: 0 0 16px rgba(255,105,180,0.3); }
      .mk-btn-secondary { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--text); }
      .mk-btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: var(--accent); color: var(--accent); }
      .mk-btn-sm { padding: 6px 14px; font-size: 0.8rem; }

      .mk-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .mk-form-group { margin-bottom: 16px; }
      .mk-form-label { display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 6px; font-weight: 500; }
      .mk-form-input, .mk-form-textarea, .mk-form-select {
        width: 100%; padding: 10px 14px;
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px; color: var(--text); font-size: 0.9rem;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; transition: border-color 0.2s;
      }
      .mk-form-input:focus, .mk-form-textarea:focus, .mk-form-select:focus { outline: none; border-color: var(--accent); }
      .mk-form-textarea { min-height: 80px; resize: vertical; }
      .mk-form-select { appearance: auto; }

      .mk-pagination { display: flex; gap: 8px; justify-content: center; margin-top: 24px; }
      .mk-pagination a {
        padding: 8px 16px; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,105,180,0.15); border-radius: 10px;
        color: var(--text); text-decoration: none; font-size: 0.85rem; cursor: pointer;
      }
      .mk-pagination a:hover { border-color: var(--accent); color: var(--accent); }
      .mk-pagination a.active { border-color: var(--accent); color: var(--accent); background: rgba(255,105,180,0.1); }

      .mk-stars { color: #eab308; font-size: 1.1rem; letter-spacing: 2px; }

      .mk-nav { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.06); }
      .mk-nav a {
        color: var(--text-dim); text-decoration: none; font-size: 0.85rem;
        cursor: pointer; transition: color 0.2s; padding: 4px 8px; border-radius: 6px;
      }
      .mk-nav a:hover, .mk-nav a.active { color: var(--accent); }

      @media (max-width: 600px) {
        .mk-page-title { font-size: 1.4rem; }
        .mk-form-grid { grid-template-columns: 1fr; }
        .mk-categories-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
      }
    </style>

    <nav class="mk-nav">
      <a class=${view === 'home' ? 'active' : ''} onClick=${() => onNav('home')}>${t('mkt.brand')}</a>
      <a class=${view === 'search' ? 'active' : ''} onClick=${() => onNav('search')}>${t('mkt.nav.search')}</a>
      <a class=${view === 'sell' ? 'active' : ''} onClick=${() => onNav('sell')}>${t('mkt.nav.sell')}</a>
      <a class=${view === 'my-listings' ? 'active' : ''} onClick=${() => onNav('my-listings')}>${t('mkt.nav.myListings')}</a>
      <a class=${view === 'my-purchases' ? 'active' : ''} onClick=${() => onNav('my-purchases')}>${t('mkt.nav.myPurchases')}</a>
    </nav>
    ${content}
  `;
}
