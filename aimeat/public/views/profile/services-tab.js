/**
 * @file services-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for publishing/managing services and browsing the catalogue.
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- A service's schema is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- A line that says a load or a save failed is the Form message in its error tone (.form-message--error); the error lines' own rules go (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- An opened service's details are the Facts (css/components/facts.css), a unification: the look most tabs use; a GAII and a webhook address are inline code, the tags a row of tags.
 *   v1.10.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.6.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS classes; i18n for unit options and detail labels
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { listMyServices, browse, publish, unpublish } from '/js/services/catalogue.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';

const SERVICE_CATEGORIES = ['language','translation','analysis','generation','coding','data','image','audio','video','search','utility','other'];

/** Fetch full detail for a single catalogue entry */
async function fetchServiceDetail(id) {
  const data = await apiGet('/v1/catalogue/' + encodeURIComponent(id));
  return data?.data || data || {};
}

/** Format a date string for display, in the reader's own format and clock. */
function fmtDate(s) {
  return s ? fmtDateTime(s) : null;
}

/** Render a JSON schema as a compact preview */
function SchemaPreview({ schema, label }) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return null;
  let preview;
  try { preview = JSON.stringify(schema, null, 2); } catch (err) { swallowed('services-tab', err); preview = String(schema); }
  return html`
    <span class="facts-k poster-label">${label}</span>
    <div class="facts-v"><pre class="code-block svc-detail-code">${preview}</pre></div>`;
}

/** Expandable service card used in both My Services and Catalogue */
function ServiceCard({ svc, expanded, onToggle, actions }) {
  const displayName = svc.display_name || svc.displayName || svc.name || '';
  const category = svc.category || '';
  const priceMorsels = svc.price_morsels ?? svc.pricing?.base_morsels ?? svc.pricing?.baseMorsels ?? 0;

  return html`
    <div class=${`listing-row svc-row ${expanded ? 'is-open' : ''}`} onClick=${(e) => { if (!e.target.closest?.('.listing-open')) onToggle(); }}>
      <div class="listing-name">${escHtml(displayName)}</div>
      <div class="listing-desc">${escHtml(svc.description || '')}${svc.owner ? html` │ ${escHtml(svc.owner)}` : ''}</div>
      <div class="listing-doors">
        <span class="poster-chips">
          ${category && html`<span class="poster-chip">${escHtml(category)}</span>`}
          <span class="poster-chip">${priceMorsels ? priceMorsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
        </span>
        <button type="button" class="poster-icon poster-icon--small">${expanded ? '\u25BC' : '\u25B6'}</button>
      </div>
      ${expanded && html`
        <div class="listing-open poster-box poster-box--raised">
          <${ServiceDetail} svc=${svc} />
          ${actions && html`<div class="og-doors listing-open-doors">${actions}</div>`}
        </div>`}
    </div>`;
}

/** Detail panel shown when a service card is expanded */
function ServiceDetail({ svc }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error_, setError] = useState(null);

  const svcId = svc.id || svc.action_id;

  useEffect(() => {
    if (!svcId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchServiceDetail(svcId).then(d => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    }).catch(err => {
      if (!cancelled) { setError(err.message || 'Failed to load details'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [svcId]);

  if (loading) return html`<div onClick=${e => e.stopPropagation()}><${LoadingLine} text=${t('common.loading')} /></div>`;
  if (error_) return html`<div onClick=${e => e.stopPropagation()}><div class="form-message form-message--error">${error_}</div></div>`;

  // Merge local svc data with fetched detail (detail may have more fields)
  const d = detail ? { ...svc, ...detail } : svc;

  const description = d.description || '';
  const webhookUrl = d.webhook_url || d.webhookUrl || '';
  const priceMorsels = d.price_morsels ?? d.pricing?.base_morsels ?? d.pricing?.baseMorsels ?? 0;
  const priceUnit = d.unit || d.pricing?.per_unit?.unit || '';
  const tags = d.tags || [];
  const inputSchema = d.input_schema || d.inputSchema || null;
  const outputSchema = d.output_schema || d.outputSchema || null;
  const createdAt = d.created_at || d.createdAt || '';
  const estimatedTime = d.estimated_time_seconds || d.estimatedTimeSeconds || null;
  const providerGaii = d.provider_gaii || d.providerGaii || '';

  return html`
    <div class="facts" onClick=${e => e.stopPropagation()}>
      ${description && html`
        <span class="facts-k poster-label">${t('profile.services.descLabel')}</span>
        <span class="facts-v">${escHtml(description)}</span>`}
      ${providerGaii && html`
        <span class="facts-k poster-label">${t('profile.services.provider')}</span>
        <span class="facts-v"><code class="code-inline">${escHtml(providerGaii)}</code></span>`}
      <span class="facts-k poster-label">${t('profile.services.priceLabel')}</span>
      <span class="facts-v">${priceMorsels} morsels${priceUnit ? ' / ' + priceUnit : ''}</span>
      ${webhookUrl && html`
        <span class="facts-k poster-label">${t('profile.services.webhookLabel')}</span>
        <span class="facts-v"><code class="code-inline">${escHtml(webhookUrl)}</code></span>`}
      ${estimatedTime && html`
        <span class="facts-k poster-label">${t('profile.services.estTime')}</span>
        <span class="facts-v">${estimatedTime}s</span>`}
      ${tags.length > 0 && html`
        <span class="facts-k poster-label">Tags</span>
        <div class="facts-v">
          <span class="poster-chips">
            ${tags.map(tag => html`<span class="poster-chip">${escHtml(tag)}</span>`)}
          </span>
        </div>`}
      <${SchemaPreview} schema=${inputSchema} label="Input schema" />
      <${SchemaPreview} schema=${outputSchema} label="Output schema" />
      ${createdAt && html`
        <span class="facts-k poster-label">Created</span>
        <span class="facts-v">${fmtDate(createdAt)}</span>`}
    </div>`;
}

export default function ServicesTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myServices, setMyServices] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [svcSubTab, setSvcSubTab] = useState('mine');
  const [catFilter, setCatFilter] = useState('');
  const [showPubForm, setShowPubForm] = useState(false);
  const [expandedMine, setExpandedMine] = useState({});
  const [expandedCat, setExpandedCat] = useState({});

  useEffect(() => {
    if (session) loadMyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Load my services once the session is available; loadMyData closes over session/onStats and is intentionally keyed to session.
  }, [session]);

  // Re-fetch on the live stream, like every sibling tab. A service published or withdrawn anywhere
  // else left this list showing the old one until a reload. Review item 7.6.
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !['actions', 'catalogue'].some(x => d.has(x))) return;
      if (session) loadMyData();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadMyData() {
    try {
      const list = await listMyServices(session.owner);
      setMyServices(list);
      onStats?.({ services: list.length });
    } catch (err) { swallowed('services-tab', err); setMyServices([]); }
  }

  async function loadCatalogueData(cat) {
    try {
      const list = await browse(cat || undefined);
      setCatalogue(list);
    } catch (err) { swallowed('services-tab', err); setCatalogue([]); }
  }

  async function publishService(name, desc, category, price, unit, webhook) {
    const resp = await publish(name, desc, category, price, unit, webhook);
    if (resp.ok !== false) { showToast(t('profile.services.published')); setShowPubForm(false); loadMyData(); }
    else showToast(t('profile.error'), true);
  }

  async function unpublishService(id) {
    confirm(t('profile.services.unpublishConfirm'), async () => {
      const resp = await unpublish(id);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.services.unpublished'));
      loadMyData();
    }, { danger: true });
  }

  function toggleMineExpand(id) {
    setExpandedMine(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleCatExpand(id) {
    setExpandedCat(prev => ({ ...prev, [id]: !prev[id] }));
  }

  const renderMyServices = () => {
    if (!myServices) return html`<${LoadingLine} text=${t('profile.services.loading')} />`;
    return html`
      <button class="poster-slab mb-1" onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}</button>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      ${myServices.length === 0
        ? html`<div class="poster-quiet">${t('profile.services.empty')}</div>`
        : html`<div class="listing listing--name-desc-doors">${myServices.map(s => {
            const svcId = s.id || s.action_id;
            return html`<${ServiceCard}
              svc=${s}
              expanded=${!!expandedMine[svcId]}
              onToggle=${() => toggleMineExpand(svcId)}
              actions=${html`<button class="poster-action poster-action--small poster-action--danger" onClick=${() => unpublishService(svcId)}>${t('profile.delete')}</button>`}
            />`;
          })}</div>`
      }`;
  };

  const renderCatalogue = () => html`
    <div class="action-bar">
      <select class="select-field pf-select-narrow" value=${catFilter} onChange=${e => { setCatFilter(e.target.value); loadCatalogueData(e.target.value); }}>
        <option value="">${t('profile.services.allCategories')}</option>
        ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
      </select>
    </div>
    ${!catalogue ? html`<${LoadingLine} text=${t('profile.services.loading')} />`
      : catalogue.length === 0 ? html`<div class="poster-quiet">${t('profile.services.catalogueEmpty')}</div>`
      : html`<div class="listing listing--name-desc-doors">${catalogue.map(s => {
          const svcId = s.id || s.action_id;
          return html`<${ServiceCard}
            svc=${s}
            expanded=${!!expandedCat[svcId]}
            onToggle=${() => toggleCatExpand(svcId)}
          />`;
        })}</div>`
    }`;

  return html`
    <div class="og mb-1">
      <div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuAutomation')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.services')}</span></div>
      <div class="og-mast"><div class="og-mast-words">
        <div class="og-title poster-page-title">${t('profile.services.title')}</div>
        <div class="og-desc">${t('profile.services.desc')}</div>
      </div></div>
    </div>
    <div class="sub-tabs poster-row--thing">
      <button class="poster-tab ${svcSubTab === 'mine' ? 'is-on' : ''}" onClick=${() => setSvcSubTab('mine')}>${t('profile.services.mine')}</button>
      <button class="poster-tab ${svcSubTab === 'catalogue' ? 'is-on' : ''}" onClick=${() => { setSvcSubTab('catalogue'); if (!catalogue) loadCatalogueData(catFilter); }}>${t('profile.services.catalogue')}</button>
    </div>
    ${svcSubTab === 'mine' ? renderMyServices() : renderCatalogue()}
    <${ConfirmUI} />
  `;
}

function PublishForm({ onPublish, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('language');
  const [price, setPrice] = useState('0');
  const [unit, setUnit] = useState('call');
  const [webhook, setWebhook] = useState('');
  return html`
    <div class="create-form poster-row--thing">
      <div class="form-row"><label class="poster-label">${t('profile.services.nameLabel')}</label><input class="og-input" placeholder=${t('profile.services.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label class="poster-label">${t('profile.services.descLabel')}</label><textarea class="og-textarea" rows="3" placeholder=${t('profile.services.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea></div>
      <div class="form-row"><label class="poster-label">${t('profile.services.categoryLabel')}</label>
        <select class="select-field" value=${cat} onChange=${e => setCat(e.target.value)}>
          ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      </div>
      <div class="form-row"><label class="poster-label">${t('profile.services.priceLabel')}</label><input type="number" class="og-input" value=${price} min="0" onInput=${e => setPrice(e.target.value)} /></div>
      <div class="form-row"><label class="poster-label">${t('profile.services.unitLabel')}</label>
        <select class="select-field" value=${unit} onChange=${e => setUnit(e.target.value)}>
          <option value="call">${t('profile.services.unitPerCall')}</option><option value="minute">${t('profile.services.unitPerMinute')}</option>
          <option value="token">${t('profile.services.unitPerToken')}</option><option value="task">${t('profile.services.unitPerTask')}</option>
        </select>
      </div>
      <div class="form-row"><label class="poster-label">${t('profile.services.webhookLabel')}</label><input class="og-input" placeholder=${t('profile.services.webhookPlaceholder')} value=${webhook} onInput=${e => setWebhook(e.target.value)} /></div>
      <div class="form-actions">
        <button class="poster-slab" onClick=${() => onPublish(name, desc, cat, price, unit, webhook)}>${t('profile.services.publishSaveBtn')}</button>
        <button class="poster-action poster-action--small" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}
