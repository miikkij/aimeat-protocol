/**
 * Hobbies — View Module
 * Multi-view hobby directory: home, search, profile, join, me, matches.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { escHtml, escAttr } from '/js/utils.js';
import { t, getLocale, switchLocale } from '/js/i18n.js';
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

const html = htm.bind(h);

const NODE_URL = window.location.origin;

/* ── Hobby Categories ──────────────────────────── */
const HOBBY_CATEGORIES = [
  { key: 'liikunta', icon: '\u26BD', nameEn: 'Sports & Exercise', nameFi: 'Liikunta & Urheilu' },
  { key: 'musiikki', icon: '\uD83C\uDFB5', nameEn: 'Music', nameFi: 'Musiikki' },
  { key: 'taide', icon: '\uD83C\uDFA8', nameEn: 'Art & Crafts', nameFi: 'Taide & Askartelu' },
  { key: 'teknologia', icon: '\uD83D\uDCBB', nameEn: 'Technology', nameFi: 'Teknologia' },
  { key: 'luonto', icon: '\uD83C\uDF3F', nameEn: 'Nature & Hiking', nameFi: 'Luonto & Retkeily' },
  { key: 'ruoka', icon: '\uD83C\uDF73', nameEn: 'Food & Cooking', nameFi: 'Ruoka & Kokkaus' },
  { key: 'pelit', icon: '\uD83C\uDFAE', nameEn: 'Games', nameFi: 'Pelit' },
  { key: 'kirjallisuus', icon: '\uD83D\uDCDA', nameEn: 'Literature', nameFi: 'Kirjallisuus' },
  { key: 'valokuvaus', icon: '\uD83D\uDCF7', nameEn: 'Photography', nameFi: 'Valokuvaus' },
  { key: 'puutarha', icon: '\uD83C\uDF31', nameEn: 'Gardening', nameFi: 'Puutarhanhoito' },
  { key: 'matkailu', icon: '\u2708\uFE0F', nameEn: 'Travel', nameFi: 'Matkailu' },
  { key: 'muu', icon: '\u2728', nameEn: 'Other', nameFi: 'Muu' }
];

/* ── Auth helpers ──────────────────────────────── */
function getAuthHeaders() {
  const token = localStorage.getItem('aimeat-token');
  if (!token) return null;
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
}

function getAuthInfo() {
  return {
    token: localStorage.getItem('aimeat-token'),
    gaii: localStorage.getItem('aimeat-gaii'),
    owner: localStorage.getItem('aimeat-owner')
  };
}

function isLoggedIn() {
  const info = getAuthInfo();
  return !!(info.token && info.gaii && info.owner);
}

function apiFetch(path) {
  return fetch(NODE_URL + path).then(r => r.json());
}

function authFetch(path, opts) {
  const headers = getAuthHeaders();
  if (!headers) return Promise.reject(new Error('Not logged in'));
  return fetch(NODE_URL + path, { ...opts, headers: { ...headers, ...(opts?.headers || {}) } }).then(r => r.json());
}

/* ── Page-specific CSS ─────────────────────────── */
const HOBBIES_CSS = `
  .hb-wrap { position: relative; z-index: 1; max-width: 900px; margin: 0 auto; padding: 24px 16px 80px; }
  .hb-nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .hb-nav-brand { color: var(--accent); font-weight: 700; font-size: 1rem; cursor: pointer; letter-spacing: .05em; }
  .hb-nav-brand:hover { color: var(--accent-bright, #ff8ecf); }
  .hb-nav-links { display: flex; gap: 16px; align-items: center; }
  .hb-nav-links a { color: var(--text-dim); text-decoration: none; font-size: .85rem; cursor: pointer; transition: color .2s; }
  .hb-nav-links a:hover { color: var(--accent); }
  .hb-lang-toggle { display: flex; margin-left: 8px; }
  .hb-lang-btn { padding: 4px 10px; border: 1px solid rgba(255,255,255,.1); background: transparent; color: var(--text-muted); cursor: pointer; font-size: .75rem; font-weight: 700; transition: all .2s; }
  .hb-lang-btn:first-child { border-radius: 4px 0 0 4px; }
  .hb-lang-btn:last-child { border-radius: 0 4px 4px 0; }
  .hb-lang-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .hb-page-title { font-size: 1.8rem; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--accent-bright, #ff8ecf)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 8px; }
  .hb-page-subtitle { color: var(--text-dim); font-size: 1rem; margin-bottom: 32px; }
  .hb-card { background: var(--card-bg); border: 1px solid rgba(255,105,180,.15); border-radius: var(--radius); padding: 24px; margin-bottom: 16px; backdrop-filter: blur(12px); transition: background .2s, border-color .2s, box-shadow .2s; }
  .hb-card:hover { background: var(--card-bg-hover); border-color: rgba(255,105,180,.4); box-shadow: 0 0 20px rgba(255,105,180,.08); }
  .hb-card-link { display: block; text-decoration: none; color: inherit; cursor: pointer; }
  .hb-card-title { font-size: 1.1rem; font-weight: 600; color: var(--text-bright); margin-bottom: 8px; }
  .hb-card-meta { color: var(--text-dim); font-size: .85rem; margin-bottom: 8px; }
  .hb-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .hb-tag { display: inline-block; padding: 4px 12px; background: rgba(255,105,180,.12); border: 1px solid rgba(255,105,180,.25); border-radius: 20px; font-size: .8rem; color: var(--accent-bright, #ff8ecf); white-space: nowrap; }
  .hb-tag-shared { background: rgba(34,197,94,.12); border-color: rgba(34,197,94,.3); color: var(--success); }
  .hb-btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 24px; border: none; border-radius: var(--radius-sm); font-size: .9rem; font-weight: 600; cursor: pointer; transition: all .2s; text-decoration: none; }
  .hb-btn-primary { background: linear-gradient(135deg, var(--accent), #c44569); color: #fff; }
  .hb-btn-primary:hover { opacity: .9; box-shadow: 0 0 16px var(--accent-glow); }
  .hb-btn-secondary { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: var(--text); }
  .hb-btn-secondary:hover { background: rgba(255,255,255,.1); border-color: var(--accent); color: var(--accent); }
  .hb-btn-danger { background: rgba(239,68,68,.15); border: 1px solid rgba(239,68,68,.3); color: #ef4444; }
  .hb-btn-danger:hover { background: rgba(239,68,68,.25); }
  .hb-btn-sm { padding: 6px 14px; font-size: .8rem; }
  .hb-form-group { margin-bottom: 16px; }
  .hb-form-label { display: block; font-size: .85rem; color: var(--text-dim); margin-bottom: 6px; font-weight: 500; }
  .hb-form-input, .hb-form-textarea, .hb-form-select { width: 100%; padding: 10px 14px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); border-radius: var(--radius-sm); color: var(--text); font-size: .9rem; font-family: var(--font); transition: border-color .2s; }
  .hb-form-input:focus, .hb-form-textarea:focus, .hb-form-select:focus { outline: none; border-color: var(--accent); }
  .hb-form-textarea { min-height: 80px; resize: vertical; }
  .hb-form-select { appearance: auto; }
  .hb-form-hint { font-size: .78rem; color: var(--text-muted); margin-top: 4px; }
  .hb-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .hb-stat-card { background: var(--card-bg); border: 1px solid rgba(255,105,180,.15); border-radius: var(--radius-sm); padding: 16px; text-align: center; }
  .hb-stat-value { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
  .hb-stat-label { font-size: .78rem; color: var(--text-muted); margin-top: 4px; }
  .hb-categories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .hb-category-card { background: var(--card-bg); border: 1px solid rgba(255,105,180,.15); border-radius: var(--radius); padding: 20px; text-align: center; cursor: pointer; transition: all .2s; }
  .hb-category-card:hover { background: var(--card-bg-hover); border-color: rgba(255,105,180,.4); box-shadow: 0 0 16px rgba(255,105,180,.08); }
  .hb-category-icon { font-size: 2rem; margin-bottom: 8px; }
  .hb-category-name { font-size: .95rem; font-weight: 600; color: var(--text-bright); }
  .hb-category-count { font-size: .78rem; color: var(--text-muted); margin-top: 4px; }
  .hb-empty { text-align: center; padding: 48px 16px; }
  .hb-empty-icon { font-size: 3rem; margin-bottom: 16px; opacity: .4; }
  .hb-empty-text { color: var(--text-dim); font-size: 1rem; }
  .hb-alert { padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: .9rem; }
  .hb-alert-success { background: rgba(34,197,94,.1); border: 1px solid rgba(34,197,94,.3); color: var(--success); }
  .hb-alert-error { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: #ef4444; }
  .hb-facets { margin-bottom: 24px; }
  .hb-facet-group { margin-bottom: 12px; }
  .hb-facet-label { font-size: .78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .hb-facet-items { display: flex; flex-wrap: wrap; gap: 6px; }
  .hb-facet-item { padding: 4px 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 20px; font-size: .78rem; color: var(--text-dim); cursor: pointer; transition: all .2s; }
  .hb-facet-item:hover { border-color: var(--accent); color: var(--accent); }
  .hb-pagination { display: flex; gap: 8px; justify-content: center; margin-top: 24px; }
  .hb-pagination a { padding: 8px 16px; background: var(--card-bg); border: 1px solid rgba(255,105,180,.15); border-radius: var(--radius-sm); color: var(--text); text-decoration: none; font-size: .85rem; cursor: pointer; }
  .hb-pagination a:hover { border-color: var(--accent); color: var(--accent); }
  .hb-pagination .active { border-color: var(--accent); color: var(--accent); background: rgba(255,105,180,.1); }
  .hb-profile-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .hb-profile-avatar { font-size: 2.5rem; }
  .hb-profile-name { font-size: 1.5rem; font-weight: 700; color: var(--text-bright); }
  .hb-profile-ghii { font-size: .85rem; color: var(--text-muted); font-family: monospace; }
  .hb-profile-section { margin-bottom: 20px; }
  .hb-profile-section-label { font-size: .78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .hb-profile-bio { color: var(--text); line-height: 1.7; }
  .hb-profile-detail { color: var(--text-dim); font-size: .9rem; }
  @media (max-width: 600px) { .hb-page-title { font-size: 1.4rem; } .hb-wrap { padding: 16px 12px 60px; } .hb-categories-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); } }
`;

/* ── Sub-views ─────────────────────────────────── */

function HomeView({ goTo }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);
  const locale = getLocale();

  useEffect(() => {
    apiFetch('/v1/catalogue/directory/stats')
      .then(d => { if (d.ok) setStats(d.data); else setError(true); })
      .catch(() => setError(true));
  }, []);

  if (error) return html`<div class="hb-alert hb-alert-error">${t('hobbies.loadError')}</div>`;
  if (!stats) return html`<div style="color:var(--text-dim);text-align:center;padding:24px;">...</div>`;

  return html`
    <h1 class="hb-page-title">${t('hobbies.title')}</h1>
    <p class="hb-page-subtitle">${t('hobbies.subtitle')}</p>
    <div class="hb-stats-grid">
      <div class="hb-stat-card"><div class="hb-stat-value">${stats.total_people}</div><div class="hb-stat-label">${t('hobbies.members')}</div></div>
      <div class="hb-stat-card"><div class="hb-stat-value">${stats.top_interests?.length || 0}</div><div class="hb-stat-label">${t('hobbies.hobbies')}</div></div>
      <div class="hb-stat-card"><div class="hb-stat-value">${stats.top_cities?.length || 0}</div><div class="hb-stat-label">${t('hobbies.cities')}</div></div>
    </div>
    <h2 style="font-size:1.1rem;color:var(--text-bright);margin-bottom:16px;">${t('hobbies.browseByCategory')}</h2>
    <div class="hb-categories-grid">
      ${HOBBY_CATEGORIES.map(cat => {
        const catName = locale === 'fi' ? cat.nameFi : cat.nameEn;
        const count = (stats.top_interests || []).filter(ti => ti.name.toLowerCase().includes(cat.key)).reduce((s, ti) => s + ti.count, 0);
        return html`<div class="hb-category-card" onClick=${() => goTo('search', { interest: cat.key })}>
          <div class="hb-category-icon">${cat.icon}</div>
          <div class="hb-category-name">${catName}</div>
          ${count > 0 && html`<div class="hb-category-count">${count} ${t('hobbies.people')}</div>`}
        </div>`;
      })}
    </div>
    ${stats.top_interests?.length > 0 && html`
      <div class="hb-facets"><div class="hb-facet-group">
        <div class="hb-facet-label">${t('hobbies.topInterests')}</div>
        <div class="hb-tags">${stats.top_interests.slice(0, 12).map(i => html`
          <span class="hb-tag" style="cursor:pointer" onClick=${() => goTo('search', { interest: i.name })}>${i.name} <span style="opacity:.6">(${i.count})</span></span>
        `)}</div>
      </div></div>
    `}
    ${stats.top_cities?.length > 0 && html`
      <div class="hb-facets"><div class="hb-facet-group">
        <div class="hb-facet-label">${t('hobbies.topCities')}</div>
        <div class="hb-tags">${stats.top_cities.slice(0, 10).map(c => html`
          <span class="hb-tag" style="cursor:pointer" onClick=${() => goTo('search', { city: c.name })}>${c.name} <span style="opacity:.6">(${c.count})</span></span>
        `)}</div>
      </div></div>
    `}
    <div style="text-align:center;margin-top:32px;">
      <a class="hb-btn hb-btn-primary" style="margin-right:8px;" onClick=${() => goTo('search')}>${t('hobbies.searchPeople')}</a>
      <a class="hb-btn hb-btn-secondary" onClick=${() => goTo('join')}>${t('hobbies.joinDirectory')}</a>
    </div>
  `;
}

function SearchView({ goTo, initData }) {
  const [interest, setInterest] = useState(initData?.interest || '');
  const [city, setCity] = useState(initData?.city || '');
  const [area, setArea] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const doSearch = useCallback((pg) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (interest) params.set('interest', interest);
    if (city) params.set('city', city);
    if (area) params.set('area', area);
    params.set('page', String(pg));
    params.set('per_page', '20');

    apiFetch('/v1/catalogue/directory?' + params.toString())
      .then(d => { if (d.ok) { setResults(d.data); setPage(pg); } else setResults({ entries: [], total: 0, facets: { interests: [], cities: [] } }); })
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [interest, city, area]);

  useEffect(() => {
    if (initData?.interest || initData?.city) doSearch(1);
  }, []);

  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(1); } };
  const totalPages = results ? Math.ceil(results.total / 20) : 0;

  return html`
    <h1 class="hb-page-title">${t('hobbies.search.title')}</h1>
    <p class="hb-page-subtitle">${t('hobbies.search.subtitle')}</p>
    <div class="hb-card" style="margin-bottom:24px;">
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">
        <div class="hb-form-group" style="flex:1;min-width:200px;margin-bottom:0;">
          <label class="hb-form-label">${t('hobbies.search.interest')}</label>
          <input class="hb-form-input" value=${interest} onInput=${e => setInterest(e.target.value)} onKeyDown=${onKey} placeholder=${t('hobbies.search.interestPlaceholder')} />
        </div>
        <div class="hb-form-group" style="flex:1;min-width:150px;margin-bottom:0;">
          <label class="hb-form-label">${t('hobbies.search.city')}</label>
          <input class="hb-form-input" value=${city} onInput=${e => setCity(e.target.value)} onKeyDown=${onKey} placeholder=${t('hobbies.search.cityPlaceholder')} />
        </div>
        <div class="hb-form-group" style="flex:0;min-width:150px;margin-bottom:0;">
          <label class="hb-form-label">${t('hobbies.search.area')}</label>
          <input class="hb-form-input" value=${area} onInput=${e => setArea(e.target.value)} onKeyDown=${onKey} placeholder=${t('hobbies.search.areaPlaceholder')} />
        </div>
        <button class="hb-btn hb-btn-primary hb-btn-sm" onClick=${() => doSearch(1)}>${t('hobbies.search.btn')}</button>
      </div>
    </div>
    ${loading && html`<div style="color:var(--text-dim);text-align:center;padding:24px;">...</div>`}
    ${results && !loading && html`
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        ${(results.facets?.interests?.length > 0 || results.facets?.cities?.length > 0) && html`
          <div class="hb-facets" style="min-width:160px;flex:0 0 auto;">
            ${results.facets.interests?.length > 0 && html`
              <div class="hb-facet-group"><div class="hb-facet-label">${t('hobbies.search.interests')}</div>
                <div class="hb-facet-items">${results.facets.interests.slice(0, 15).map(i => html`
                  <a class="hb-facet-item" onClick=${() => { setInterest(i.name); doSearch(1); }}>${i.name} <span style="color:var(--text-muted);margin-left:4px">(${i.count})</span></a>
                `)}</div>
              </div>
            `}
            ${results.facets.cities?.length > 0 && html`
              <div class="hb-facet-group"><div class="hb-facet-label">${t('hobbies.search.cities')}</div>
                <div class="hb-facet-items">${results.facets.cities.slice(0, 10).map(c => html`
                  <a class="hb-facet-item" onClick=${() => { setCity(c.name); doSearch(1); }}>${c.name} <span style="color:var(--text-muted);margin-left:4px">(${c.count})</span></a>
                `)}</div>
              </div>
            `}
          </div>
        `}
        <div style="flex:1;min-width:0;">
          <div style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px;">
            ${results.total} ${t('hobbies.search.results')}
            ${interest && ` ${t('hobbies.search.forInterest')} "${interest}"`}
            ${city && ` ${t('hobbies.search.inCity')} ${city}`}
          </div>
          ${results.entries.length > 0 ? results.entries.map(entry => html`
            <div class="hb-card hb-card-link" onClick=${() => goTo('profile', entry.ghii)}>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                <span style="font-size:1.5rem;">${entry.avatar || '\uD83D\uDE0A'}</span>
                <div>
                  <div class="hb-card-title">${entry.displayName}</div>
                  ${(entry.city || entry.area) && html`<div class="hb-card-meta">${[entry.city, entry.area].filter(Boolean).join(', ')}</div>`}
                </div>
              </div>
              <div class="hb-tags">${(entry.interests || []).map(i => html`<span class="hb-tag">${i}</span>`)}</div>
            </div>
          `) : html`
            <div class="hb-empty">
              <div class="hb-empty-icon">\uD83D\uDD0D</div>
              <div class="hb-empty-text">${t('hobbies.search.noResults')} <a onClick=${() => goTo('join')} style="color:var(--accent);cursor:pointer;">${t('hobbies.search.joinLink')}</a>!</div>
            </div>
          `}
          ${totalPages > 1 && html`
            <div class="hb-pagination">
              ${page > 1 && html`<a onClick=${() => doSearch(page - 1)}>${t('hobbies.search.prev')}</a>`}
              ${Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => html`
                <a onClick=${() => doSearch(p)} class=${p === page ? 'active' : ''}>${p}</a>
              `)}
              ${page < totalPages && html`<a onClick=${() => doSearch(page + 1)}>${t('hobbies.search.next')}</a>`}
            </div>
          `}
        </div>
      </div>
    `}
  `;
}

function ProfileView({ goTo, ghii }) {
  const [entry, setEntry] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [flagResult, setFlagResult] = useState('');

  useEffect(() => {
    if (!ghii) return;
    apiFetch('/v1/catalogue/directory?per_page=10000')
      .then(d => {
        if (!d.ok) throw new Error();
        const found = d.data.entries.find(e => e.ghii === ghii);
        if (!found) { setNotFound(true); return; }
        return apiFetch('/v1/flags/summary/agent/' + encodeURIComponent(ghii))
          .then(fd => {
            if (fd.ok && fd.data && (fd.data.total_flags || 0) >= 5) setHidden(true);
            else setEntry(found);
          });
      })
      .catch(() => setError(true));
  }, [ghii]);

  const doFlag = () => {
    const reason = prompt(t('hobbies.profile.flagReason'));
    if (!reason) return;
    const validReasons = ['unreliable', 'inappropriate', 'illegal', 'spam', 'other'];
    const headers = getAuthHeaders();
    if (!headers) return;
    fetch(NODE_URL + '/v1/flags', {
      method: 'POST', headers,
      body: JSON.stringify({ target_type: 'agent', target_id: ghii, reason: validReasons.includes(reason) ? reason : 'other' })
    }).then(r => r.json())
      .then(d => setFlagResult(d.ok ? t('hobbies.profile.flagSent') : (d.error?.message || t('hobbies.profile.flagError'))))
      .catch(() => setFlagResult(t('hobbies.profile.networkError')));
  };

  if (error) return html`<div class="hb-alert hb-alert-error">${t('hobbies.profile.loadError')}</div>`;
  if (notFound) return html`<div class="hb-empty"><div class="hb-empty-icon">\uD83D\uDE15</div><div class="hb-empty-text">${t('hobbies.profile.notFound')}</div><a class="hb-btn hb-btn-secondary" style="margin-top:16px;" onClick=${() => goTo('search')}>${t('hobbies.profile.backToSearch')}</a></div>`;
  if (hidden) return html`<div class="hb-empty"><div class="hb-empty-icon">\uD83D\uDEAB</div><div class="hb-empty-text">${t('hobbies.profile.hidden')}</div><a class="hb-btn hb-btn-secondary" style="margin-top:16px;" onClick=${() => goTo('search')}>${t('hobbies.profile.backToSearch')}</a></div>`;
  if (!entry) return html`<div style="color:var(--text-dim);text-align:center;padding:24px;">...</div>`;

  const locStr = [entry.city, entry.area, entry.country].filter(Boolean).join(', ');

  return html`
    <div class="hb-profile-header">
      <span class="hb-profile-avatar">${entry.avatar || '\uD83D\uDE0A'}</span>
      <div>
        <div class="hb-profile-name">${entry.displayName}</div>
        <div class="hb-profile-ghii">${ghii}</div>
      </div>
    </div>
    ${entry.bio && html`<div class="hb-profile-section"><div class="hb-profile-section-label">${t('hobbies.profile.description')}</div><div class="hb-profile-bio">${entry.bio}</div></div>`}
    <div class="hb-profile-section">
      <div class="hb-profile-section-label">${t('hobbies.profile.interests')}</div>
      <div class="hb-tags">${(entry.interests || []).map(i => html`<span class="hb-tag">${i}</span>`)}</div>
    </div>
    ${locStr && html`<div class="hb-profile-section"><div class="hb-profile-section-label">${t('hobbies.profile.location')}</div><div class="hb-profile-detail">${locStr}</div></div>`}
    ${isLoggedIn() && html`
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06);">
        <button onClick=${doFlag} class="hb-btn hb-btn-danger hb-btn-sm">${t('hobbies.profile.flagBtn')}</button>
        ${flagResult && html`<div style="margin-top:8px;color:${flagResult === t('hobbies.profile.flagSent') ? 'var(--success)' : '#ef4444'}">${flagResult}</div>`}
      </div>
    `}
    <div style="margin-top:24px;"><a class="hb-btn hb-btn-secondary" onClick=${() => goTo('search')}>${t('hobbies.profile.backToSearch')}</a></div>
  `;
}

function JoinView({ goTo }) {
  const [status, setStatus] = useState('idle'); // idle | saving | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const formRef = useRef(null);

  if (!isLoggedIn()) {
    return html`
      <h1 class="hb-page-title">${t('hobbies.join.title')}</h1>
      <p class="hb-page-subtitle">${t('hobbies.join.subtitle')}</p>
      <div class="hb-alert hb-alert-error">${t('hobbies.join.authNotice')} <a href="/v1/portal" style="color:var(--accent);">${t('hobbies.join.authLink')}</a></div>
    `;
  }

  if (status === 'success') {
    return html`
      <h1 class="hb-page-title">${t('hobbies.join.title')}</h1>
      <div class="hb-card"><div class="hb-alert hb-alert-success">${t('hobbies.join.success')}</div>
        <a class="hb-btn hb-btn-primary" style="margin-top:12px;" onClick=${() => goTo('search')}>${t('hobbies.join.browseBtn')}</a>
      </div>
    `;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = formRef.current;
    const interests = form.querySelector('#hb-join-interests').value.split(',').map(s => s.trim()).filter(Boolean);
    const city = form.querySelector('#hb-join-city').value.trim();
    const country = form.querySelector('#hb-join-country').value.trim() || 'FI';
    const bio = form.querySelector('#hb-join-bio').value.trim();
    const availability = form.querySelector('#hb-join-availability').value;
    const seeking = form.querySelector('#hb-join-seeking').value.split(',').map(s => s.trim()).filter(Boolean);
    const notifyOptIn = form.querySelector('#hb-join-notifications').checked;

    if (interests.length === 0) { setErrorMsg(t('hobbies.join.needInterest')); return; }
    if (!city) { setErrorMsg(t('hobbies.join.needCity')); return; }

    setStatus('saving');
    setErrorMsg('');
    const headers = getAuthHeaders();
    const owner = getAuthInfo().owner;

    try {
      // Consent grants
      await fetch(NODE_URL + '/v1/consent', { method: 'POST', headers, body: JSON.stringify({ data_pattern: 'profile.**', recipient: '*', purpose: 'community-discovery', scope: 'federation' }) });
      if (notifyOptIn) {
        await fetch(NODE_URL + '/v1/consent', { method: 'POST', headers, body: JSON.stringify({ data_pattern: 'profile.' + owner + '.*', recipient: '*', purpose: 'match-notification', scope: 'federation' }) });
      }

      // Memory writes
      const memWrites = [
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(owner) + '.interests', { method: 'PUT', headers, body: JSON.stringify({ value: interests, visibility: 'public', tags: ['profile', 'interests'] }) }),
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(owner) + '.location', { method: 'PUT', headers, body: JSON.stringify({ value: { city, country }, visibility: 'public', tags: ['profile', 'location'] }) }),
      ];
      if (bio) memWrites.push(fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(owner) + '.bio', { method: 'PUT', headers, body: JSON.stringify({ value: bio, visibility: 'public', tags: ['profile', 'bio'] }) }));
      if (availability) memWrites.push(fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(owner) + '.availability', { method: 'PUT', headers, body: JSON.stringify({ value: availability, visibility: 'public', tags: ['profile', 'availability'] }) }));
      if (seeking.length > 0) memWrites.push(fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(owner) + '.seeking', { method: 'PUT', headers, body: JSON.stringify({ value: seeking, visibility: 'public', tags: ['profile', 'seeking'] }) }));

      const results = await Promise.all(memWrites);
      if (results.every(r => r.ok)) setStatus('success');
      else { setStatus('error'); setErrorMsg(t('hobbies.join.saveFailed')); }
    } catch (err) {
      setStatus('error'); setErrorMsg(t('hobbies.profile.networkError') + ' ' + err.message);
    }
  };

  return html`
    <h1 class="hb-page-title">${t('hobbies.join.title')}</h1>
    <p class="hb-page-subtitle">${t('hobbies.join.subtitle')}</p>
    <form ref=${formRef} class="hb-card" onSubmit=${onSubmit}>
      <div class="hb-form-group">
        <label class="hb-form-label">${t('hobbies.join.interests')}</label>
        <input class="hb-form-input" id="hb-join-interests" required placeholder=${t('hobbies.join.interestsPlaceholder')} />
        <div class="hb-form-hint">${t('hobbies.join.interestsHint')}</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="hb-form-group" style="flex:1;min-width:150px;">
          <label class="hb-form-label">${t('hobbies.join.city')}</label>
          <input class="hb-form-input" id="hb-join-city" required placeholder=${t('hobbies.join.cityPlaceholder')} />
        </div>
        <div class="hb-form-group" style="flex:0 0 100px;">
          <label class="hb-form-label">${t('hobbies.join.country')}</label>
          <input class="hb-form-input" id="hb-join-country" value="FI" placeholder="FI" />
        </div>
      </div>
      <div class="hb-form-group">
        <label class="hb-form-label">${t('hobbies.join.bio')}</label>
        <textarea class="hb-form-textarea" id="hb-join-bio" maxlength="500" placeholder=${t('hobbies.join.bioPlaceholder')}></textarea>
        <div class="hb-form-hint">${t('hobbies.join.bioHint')}</div>
      </div>
      <div class="hb-form-group">
        <label class="hb-form-label">${t('hobbies.join.availability')}</label>
        <select class="hb-form-select" id="hb-join-availability">
          <option value="">${t('hobbies.join.availNone')}</option>
          <option value="anytime">${t('hobbies.join.availAnytime')}</option>
          <option value="mornings">${t('hobbies.join.availMornings')}</option>
          <option value="evenings">${t('hobbies.join.availEvenings')}</option>
          <option value="weekends">${t('hobbies.join.availWeekends')}</option>
          <option value="evenings-weekends">${t('hobbies.join.availEveningsWeekends')}</option>
        </select>
      </div>
      <div class="hb-form-group">
        <label class="hb-form-label">${t('hobbies.join.seeking')}</label>
        <input class="hb-form-input" id="hb-join-seeking" placeholder=${t('hobbies.join.seekingPlaceholder')} />
        <div class="hb-form-hint">${t('hobbies.join.seekingHint')}</div>
      </div>
      <div style="margin-top:8px;margin-bottom:8px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:var(--text-dim);">
          <input type="checkbox" id="hb-join-consent" required />
          <span>${t('hobbies.join.consent')}</span>
        </label>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:var(--text-dim);">
          <input type="checkbox" id="hb-join-notifications" checked />
          <span>${t('hobbies.join.notifications')}</span>
        </label>
      </div>
      <button type="submit" class="hb-btn hb-btn-primary" disabled=${status === 'saving'}>${status === 'saving' ? t('hobbies.join.saving') : t('hobbies.join.submitBtn')}</button>
      ${errorMsg && html`<div style="margin-top:12px;color:#ef4444;">${errorMsg}</div>`}
    </form>
  `;
}

function MeView({ goTo }) {
  const [myEntry, setMyEntry] = useState(null);
  const [myGhii, setMyGhii] = useState(null);
  const [availability, setAvailability] = useState('');
  const [seeking, setSeeking] = useState([]);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ok | noGhii | notInDir | error
  const [saveMsg, setSaveMsg] = useState('');
  const editFormRef = useRef(null);

  useEffect(() => {
    if (!isLoggedIn()) { setStatus('noGhii'); return; }
    const info = getAuthInfo();
    const headers = { 'Authorization': 'Bearer ' + info.token };
    const username = info.owner;

    Promise.all([
      apiFetch('/v1/catalogue/directory?per_page=10000'),
      apiFetch('/v1/ghii/list?owner=' + encodeURIComponent(info.owner)),
    ]).then(([dirData, ghiiData]) => {
      if (!dirData.ok) throw new Error();
      let ghii = null;
      if (ghiiData.ok && ghiiData.data?.profiles?.length > 0) ghii = ghiiData.data.profiles[0].ghii;
      if (!ghii) { setStatus('noGhii'); return; }
      setMyGhii(ghii);

      const entry = dirData.data.entries.find(e => e.ghii === ghii);
      if (!entry) { setStatus('notInDir'); return; }
      setMyEntry(entry);

      // Load availability, seeking, consent
      return Promise.all([
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.availability', { headers }).then(r => r.json()).catch(() => ({})),
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.seeking', { headers }).then(r => r.json()).catch(() => ({})),
        fetch(NODE_URL + '/v1/consent', { headers }).then(r => r.json()).catch(() => ({})),
      ]).then(([avRes, skRes, conRes]) => {
        if (avRes?.ok && avRes.data?.value != null) {
          const av = avRes.data.value;
          setAvailability(typeof av === 'string' ? av : (av?.availability || ''));
        }
        if (skRes?.ok && skRes.data?.value != null) {
          const sk = skRes.data.value;
          setSeeking(Array.isArray(sk) ? sk : (sk?.items || []));
        }
        if (conRes?.ok && conRes.data) {
          const grants = Array.isArray(conRes.data) ? conRes.data : (conRes.data.grants || []);
          setNotifyEnabled(grants.some(g => g.purpose === 'match-notification' && g.status !== 'revoked'));
        }
        setStatus('ok');
      });
    }).catch(() => setStatus('error'));
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setSaveMsg(t('hobbies.me.saving'));
    const headers = getAuthHeaders();
    const username = getAuthInfo().owner;
    const form = editFormRef.current;
    const interests = form.querySelector('#hb-edit-interests').value.split(',').map(s => s.trim()).filter(Boolean);
    const city = form.querySelector('#hb-edit-city').value.trim();
    const country = form.querySelector('#hb-edit-country').value.trim() || 'FI';
    const bio = form.querySelector('#hb-edit-bio').value.trim();
    const av = form.querySelector('#hb-edit-availability').value;
    const sk = form.querySelector('#hb-edit-seeking').value.split(',').map(s => s.trim()).filter(Boolean);
    const notify = form.querySelector('#hb-edit-notifications').checked;

    try {
      const writes = [
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.interests', { method: 'PUT', headers, body: JSON.stringify({ value: interests, visibility: 'public', tags: ['profile', 'interests'] }) }),
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.location', { method: 'PUT', headers, body: JSON.stringify({ value: { city, country }, visibility: 'public', tags: ['profile', 'location'] }) }),
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.bio', { method: 'PUT', headers, body: JSON.stringify({ value: bio, visibility: 'public', tags: ['profile', 'bio'] }) }),
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.availability', { method: 'PUT', headers, body: JSON.stringify({ value: av, visibility: 'public', tags: ['profile', 'availability'] }) }),
        fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(username) + '.seeking', { method: 'PUT', headers, body: JSON.stringify({ value: sk, visibility: 'public', tags: ['profile', 'seeking'] }) }),
      ];

      // Handle notification consent toggle 
      const conRes = await fetch(NODE_URL + '/v1/consent', { headers: { 'Authorization': headers['Authorization'] } }).then(r => r.json()).catch(() => ({}));
      const grants = conRes?.ok ? (Array.isArray(conRes.data) ? conRes.data : (conRes.data?.grants || [])) : [];
      const existing = grants.find(g => g.purpose === 'match-notification' && g.status !== 'revoked');
      if (notify && !existing) {
        writes.push(fetch(NODE_URL + '/v1/consent', { method: 'POST', headers, body: JSON.stringify({ data_pattern: 'profile.' + username + '.*', recipient: '*', purpose: 'match-notification', scope: 'federation' }) }));
      } else if (!notify && existing) {
        writes.push(fetch(NODE_URL + '/v1/consent/' + existing.id, { method: 'DELETE', headers }));
      }

      const results = await Promise.all(writes);
      setSaveMsg(results.every(r => !r || r.ok) ? t('hobbies.me.saved') : t('hobbies.me.saveFailed'));
    } catch (err) {
      setSaveMsg(t('hobbies.profile.networkError') + ' ' + err.message);
    }
  };

  if (!isLoggedIn()) return html`<div class="hb-empty"><div class="hb-empty-icon">\uD83D\uDE15</div><div class="hb-empty-text">${t('hobbies.me.signInRequired')} <a href="/v1/portal" style="color:var(--accent);">${t('hobbies.me.registerFirst')}</a></div></div>`;
  if (status === 'loading') return html`<div style="color:var(--text-dim);text-align:center;padding:24px;">...</div>`;
  if (status === 'error') return html`<div class="hb-alert hb-alert-error">${t('hobbies.me.loadError')}</div>`;
  if (status === 'noGhii') return html`<div class="hb-empty"><div class="hb-empty-icon">\uD83D\uDE15</div><div class="hb-empty-text">${t('hobbies.me.noGhii')} <a href="/v1/portal" style="color:var(--accent);">${t('hobbies.me.registerFirst')}</a></div></div>`;
  if (status === 'notInDir') return html`<h1 class="hb-page-title">${t('hobbies.me.title')}</h1><div class="hb-card"><p style="color:var(--text-dim);">${t('hobbies.me.notInDirectory')}</p><a class="hb-btn hb-btn-primary" style="margin-top:12px;" onClick=${() => goTo('join')}>${t('hobbies.me.joinBtn')}</a></div>`;

  const locStr = [myEntry.city, myEntry.area, myEntry.country].filter(Boolean).join(', ');

  return html`
    <h1 class="hb-page-title">${t('hobbies.me.title')}</h1>
    <div class="hb-card">
      <div class="hb-profile-header">
        <span class="hb-profile-avatar">${myEntry.avatar || '\uD83D\uDE0A'}</span>
        <div>
          <div class="hb-profile-name">${myEntry.displayName}</div>
          <div class="hb-profile-ghii">${myGhii}</div>
        </div>
      </div>
      ${myEntry.bio && html`<div class="hb-profile-section"><div class="hb-profile-section-label">${t('hobbies.profile.description')}</div><div class="hb-profile-bio">${myEntry.bio}</div></div>`}
      <div class="hb-profile-section">
        <div class="hb-profile-section-label">${t('hobbies.profile.interests')}</div>
        <div class="hb-tags">${(myEntry.interests || []).length > 0 ? (myEntry.interests || []).map(i => html`<span class="hb-tag">${i}</span>`) : html`<span style="color:var(--text-muted);">${t('hobbies.me.notSet')}</span>`}</div>
      </div>
      ${locStr && html`<div class="hb-profile-section"><div class="hb-profile-section-label">${t('hobbies.profile.location')}</div><div class="hb-profile-detail">${locStr}</div></div>`}
      ${availability && html`<div class="hb-profile-section"><div class="hb-profile-section-label">${t('hobbies.profile.availability')}</div><div class="hb-profile-detail">${t('hobbies.availability.' + availability) || availability}</div></div>`}
      ${seeking.length > 0 && html`<div class="hb-profile-section"><div class="hb-profile-section-label">${t('hobbies.profile.seeking')}</div><div class="hb-tags">${seeking.map(s => html`<span class="hb-tag">${s}</span>`)}</div></div>`}
    </div>

    <h2 style="font-size:1rem;color:var(--text-bright);margin:24px 0 12px;">${t('hobbies.me.editTitle')}</h2>
    <form ref=${editFormRef} class="hb-card" onSubmit=${onSave}>
      <div class="hb-form-group"><label class="hb-form-label">${t('hobbies.profile.interests')}</label><input class="hb-form-input" id="hb-edit-interests" value=${(myEntry.interests || []).join(', ')} /><div class="hb-form-hint">${t('hobbies.join.interestsHint')}</div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="hb-form-group" style="flex:1;min-width:150px;"><label class="hb-form-label">${t('hobbies.search.city')}</label><input class="hb-form-input" id="hb-edit-city" value=${myEntry.city || ''} /></div>
        <div class="hb-form-group" style="flex:0 0 100px;"><label class="hb-form-label">${t('hobbies.join.country')}</label><input class="hb-form-input" id="hb-edit-country" value=${myEntry.country || 'FI'} /></div>
      </div>
      <div class="hb-form-group"><label class="hb-form-label">${t('hobbies.join.bio')}</label><textarea class="hb-form-textarea" id="hb-edit-bio" maxlength="500">${myEntry.bio || ''}</textarea></div>
      <div class="hb-form-group">
        <label class="hb-form-label">${t('hobbies.join.availability')}</label>
        <select class="hb-form-select" id="hb-edit-availability">
          <option value="" selected=${!availability}>${t('hobbies.join.availNone')}</option>
          <option value="anytime" selected=${availability === 'anytime'}>${t('hobbies.join.availAnytime')}</option>
          <option value="mornings" selected=${availability === 'mornings'}>${t('hobbies.join.availMornings')}</option>
          <option value="evenings" selected=${availability === 'evenings'}>${t('hobbies.join.availEvenings')}</option>
          <option value="weekends" selected=${availability === 'weekends'}>${t('hobbies.join.availWeekends')}</option>
          <option value="evenings-weekends" selected=${availability === 'evenings-weekends'}>${t('hobbies.join.availEveningsWeekends')}</option>
        </select>
      </div>
      <div class="hb-form-group"><label class="hb-form-label">${t('hobbies.join.seeking')}</label><input class="hb-form-input" id="hb-edit-seeking" value=${(seeking || []).join(', ')} /></div>
      <div style="margin-top:8px;margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:var(--text-dim);">
          <input type="checkbox" id="hb-edit-notifications" checked=${notifyEnabled} />
          <span>${t('hobbies.join.notifications')}</span>
        </label>
        <div class="hb-form-hint" style="margin-top:4px;">${t(notifyEnabled ? 'hobbies.me.notificationsOn' : 'hobbies.me.notificationsOff')}</div>
      </div>
      <button type="submit" class="hb-btn hb-btn-primary">${t('hobbies.me.saveBtn')}</button>
      ${saveMsg && html`<div style="margin-top:12px;color:${saveMsg === t('hobbies.me.saved') ? 'var(--success)' : '#ef4444'}">${saveMsg}</div>`}
    </form>
    <div style="margin-top:24px;"><a class="hb-btn hb-btn-secondary" onClick=${() => goTo('profile', myGhii)}>${t('hobbies.me.viewPublic')}</a></div>
  `;
}

function MatchesView({ goTo }) {
  const [matches, setMatches] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!isLoggedIn()) { setStatus('login'); return; }
    const info = getAuthInfo();
    const headers = { 'Authorization': 'Bearer ' + info.token };

    fetch(NODE_URL + '/v1/memory/profile.' + encodeURIComponent(info.owner) + '.interests', { headers })
      .then(r => r.json())
      .then(memData => {
        if (!memData.ok || !memData.data?.value || !Array.isArray(memData.data.value) || memData.data.value.length === 0) {
          setStatus('noInterests'); return;
        }
        const myInterests = memData.data.value;

        // Fetch directory for each interest
        return Promise.all(myInterests.map(interest =>
          apiFetch('/v1/catalogue/directory?interest=' + encodeURIComponent(interest) + '&per_page=200')
            .then(d => d.ok ? d.data.entries.map(e => ({ entry: e, matchedInterest: interest })) : [])
            .catch(() => [])
        )).then(results => {
          const matchMap = {};
          results.flat().forEach(item => {
            const ghii = item.entry.ghii;
            if (!matchMap[ghii]) matchMap[ghii] = { entry: item.entry, sharedInterests: [] };
            if (!matchMap[ghii].sharedInterests.includes(item.matchedInterest)) matchMap[ghii].sharedInterests.push(item.matchedInterest);
          });

          // Exclude self
          return apiFetch('/v1/ghii/list?owner=' + encodeURIComponent(info.owner)).then(ghiiData => {
            const myGhii = ghiiData.ok && ghiiData.data?.profiles?.length > 0 ? ghiiData.data.profiles[0].ghii : null;
            if (myGhii) delete matchMap[myGhii];

            const sorted = Object.values(matchMap).sort((a, b) => b.sharedInterests.length - a.sharedInterests.length);
            setMatches(sorted);
            setStatus('ok');
          });
        });
      })
      .catch(() => setStatus('error'));
  }, []);

  if (status === 'login') return html`<div class="hb-empty"><div class="hb-empty-icon">\uD83D\uDD12</div><div class="hb-empty-text">${t('hobbies.matches.loginRequired')} <a href="/v1/portal" style="color:var(--accent);">${t('hobbies.join.authLink')}</a></div></div>`;
  if (status === 'loading') return html`<h1 class="hb-page-title">${t('hobbies.matches.title')}</h1><p class="hb-page-subtitle">${t('hobbies.matches.subtitle')}</p><div style="color:var(--text-dim);text-align:center;padding:24px;">${t('hobbies.matches.loading')}</div>`;
  if (status === 'error') return html`<div class="hb-alert hb-alert-error">${t('hobbies.loadError')}</div>`;
  if (status === 'noInterests' || (status === 'ok' && matches?.length === 0)) return html`<h1 class="hb-page-title">${t('hobbies.matches.title')}</h1><div class="hb-empty"><div class="hb-empty-icon">${status === 'noInterests' ? '\uD83E\uDD37' : '\uD83D\uDE15'}</div><div class="hb-empty-text">${t('hobbies.matches.noMatches')} ${status === 'noInterests' ? html` <a onClick=${() => goTo('join')} style="color:var(--accent);cursor:pointer;">${t('hobbies.joinDirectory')}</a>` : ''}</div></div>`;

  return html`
    <h1 class="hb-page-title">${t('hobbies.matches.title')}</h1>
    <p class="hb-page-subtitle">${t('hobbies.matches.subtitle')}</p>
    ${matches.map(match => html`
      <div class="hb-card hb-card-link" onClick=${() => goTo('profile', match.entry.ghii)}>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <span style="font-size:1.5rem;">${match.entry.avatar || '\uD83D\uDE0A'}</span>
          <div style="flex:1;">
            <div class="hb-card-title">${match.entry.displayName}</div>
            ${(match.entry.city || match.entry.area) && html`<div class="hb-card-meta">${[match.entry.city, match.entry.area].filter(Boolean).join(', ')}</div>`}
          </div>
          <div style="text-align:right;">
            <span class="hb-tag hb-tag-shared" style="font-weight:600;">${match.sharedInterests.length} ${t('hobbies.matches.shared')}</span>
          </div>
        </div>
        <div class="hb-tags">${(match.entry.interests || []).map(i => html`<span class="hb-tag${match.sharedInterests.includes(i) ? ' hb-tag-shared' : ''}">${i}</span>`)}</div>
      </div>
    `)}
  `;
}

/* ── Main Hobbies View ────────────────────────── */

function HobbiesView({ navigate }) {
  const [view, setView] = useState('home');
  const [viewData, setViewData] = useState(null);
  const locale = getLocale();

  useEffect(() => { document.title = t('hobbies.title') + ' \u2014 AIMEAT'; }, []);

  const goTo = useCallback((name, data) => {
    setView(name);
    setViewData(data || null);
    window.scrollTo(0, 0);
  }, []);

  const renderView = () => {
    switch (view) {
      case 'home': return html`<${HomeView} goTo=${goTo} />`;
      case 'search': return html`<${SearchView} goTo=${goTo} initData=${viewData} />`;
      case 'profile': return html`<${ProfileView} goTo=${goTo} ghii=${viewData} />`;
      case 'join': return html`<${JoinView} goTo=${goTo} />`;
      case 'me': return html`<${MeView} goTo=${goTo} />`;
      case 'matches': return html`<${MatchesView} goTo=${goTo} />`;
      default: return html`<${HomeView} goTo=${goTo} />`;
    }
  };

  return html`
    <style>${HOBBIES_CSS}</style>
    <div class="hb-wrap">
      <nav class="hb-nav">
        <a class="hb-nav-brand" onClick=${() => goTo('home')}>${t('hobbies.nav.brand')}</a>
        <div class="hb-nav-links">
          <a onClick=${() => goTo('search')}>${t('hobbies.nav.search')}</a>
          <a onClick=${() => goTo('join')}>${t('hobbies.nav.join')}</a>
          <a onClick=${() => goTo('me')}>${t('hobbies.nav.me')}</a>
          ${isLoggedIn() && html`<a onClick=${() => goTo('matches')}>${t('hobbies.nav.matches')}</a>`}
          <a onClick=${() => navigate('/v1/portal')}>${t('hobbies.nav.portal')}</a>
          <div class="hb-lang-toggle">
            <button class="hb-lang-btn${locale === 'fi' ? ' active' : ''}" onClick=${() => switchLocale('fi')}>FI</button>
            <button class="hb-lang-btn${locale === 'en' ? ' active' : ''}" onClick=${() => switchLocale('en')}>EN</button>
          </div>
        </div>
      </nav>
      ${renderView()}
    </div>
  `;
}

export default HobbiesView;
