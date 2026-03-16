import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { listMyServices, browse, publish, unpublish } from '/js/services/catalogue.js';
import { apiGet } from '/js/api.js';

const SERVICE_CATEGORIES = ['language','translation','analysis','generation','coding','data','image','audio','video','search','utility','other'];

/** Fetch full detail for a single catalogue entry */
async function fetchServiceDetail(id) {
  const data = await apiGet('/v1/catalogue/' + encodeURIComponent(id));
  return data?.data || data || {};
}

/** Format a date string for display */
function fmtDate(s) {
  if (!s) return null;
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

/** Render a JSON schema as a compact preview */
function SchemaPreview({ schema, label }) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return null;
  let preview;
  try { preview = JSON.stringify(schema, null, 2); } catch { preview = String(schema); }
  return html`
    <div class="svc-detail-row">
      <span class="svc-detail-label">${label}</span>
      <pre class="svc-detail-code">${preview}</pre>
    </div>`;
}

/** Expandable service card used in both My Services and Catalogue */
function ServiceCard({ svc, expanded, onToggle, actions }) {
  const displayName = svc.display_name || svc.displayName || svc.name || '';
  const category = svc.category || '';
  const priceMorsels = svc.price_morsels ?? svc.pricing?.base_morsels ?? svc.pricing?.baseMorsels ?? 0;
  const priceUnit = svc.unit || svc.pricing?.per_unit?.unit || '';

  return html`
    <div class="card ${expanded ? 'svc-card-expanded' : ''}" style="cursor:pointer" onClick=${onToggle}>
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="svc-expand-icon">${expanded ? '\u25BC' : '\u25B6'}</span>
          <div class="card-title">${escHtml(displayName)}</div>
        </div>
        <div>
          ${category && html`<span class="badge badge-info">${escHtml(category)}</span>`}
          <span class="badge badge-success" style="margin-left:.25rem">${priceMorsels ? priceMorsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
        </div>
      </div>
      <div class="card-subtitle">${escHtml(svc.description || '')}${svc.owner ? html` \u2502 ${escHtml(svc.owner)}` : ''}</div>
      ${expanded && html`<${ServiceDetail} svc=${svc} />`}
      ${expanded && actions && html`<div class="svc-detail-actions" onClick=${e => e.stopPropagation()}>${actions}</div>`}
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

  if (loading) return html`<div class="svc-detail" onClick=${e => e.stopPropagation()}><${Spinner} text="Loading details..." /></div>`;
  if (error_) return html`<div class="svc-detail" onClick=${e => e.stopPropagation()}><div class="svc-detail-error">${error_}</div></div>`;

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
    <div class="svc-detail" onClick=${e => e.stopPropagation()}>
      ${description && html`
        <div class="svc-detail-row">
          <span class="svc-detail-label">${t('profile.services.descLabel')}</span>
          <span class="svc-detail-value">${escHtml(description)}</span>
        </div>`}
      ${providerGaii && html`
        <div class="svc-detail-row">
          <span class="svc-detail-label">Provider</span>
          <span class="svc-detail-value mono">${escHtml(providerGaii)}</span>
        </div>`}
      <div class="svc-detail-row">
        <span class="svc-detail-label">${t('profile.services.priceLabel')}</span>
        <span class="svc-detail-value">${priceMorsels} morsels${priceUnit ? ' / ' + priceUnit : ''}</span>
      </div>
      ${webhookUrl && html`
        <div class="svc-detail-row">
          <span class="svc-detail-label">${t('profile.services.webhookLabel')}</span>
          <span class="svc-detail-value mono">${escHtml(webhookUrl)}</span>
        </div>`}
      ${estimatedTime && html`
        <div class="svc-detail-row">
          <span class="svc-detail-label">Est. time</span>
          <span class="svc-detail-value">${estimatedTime}s</span>
        </div>`}
      ${tags.length > 0 && html`
        <div class="svc-detail-row">
          <span class="svc-detail-label">Tags</span>
          <div class="svc-detail-tags">
            ${tags.map(tag => html`<span class="badge badge-outline">${escHtml(tag)}</span>`)}
          </div>
        </div>`}
      <${SchemaPreview} schema=${inputSchema} label="Input schema" />
      <${SchemaPreview} schema=${outputSchema} label="Output schema" />
      ${createdAt && html`
        <div class="svc-detail-row">
          <span class="svc-detail-label">Created</span>
          <span class="svc-detail-value">${fmtDate(createdAt)}</span>
        </div>`}
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
  }, [session]);

  async function loadMyData() {
    try {
      const list = await listMyServices(session.owner);
      setMyServices(list);
      onStats?.({ services: list.length });
    } catch { setMyServices([]); }
  }

  async function loadCatalogueData(cat) {
    try {
      const list = await browse(cat || undefined);
      setCatalogue(list);
    } catch { setCatalogue([]); }
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
    if (!myServices) return html`<${Spinner} text=${t('profile.services.loading')} />`;
    return html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}</button>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      ${myServices.length === 0
        ? html`<div class="empty">${t('profile.services.empty')}</div>`
        : myServices.map(s => {
            const svcId = s.id || s.action_id;
            return html`<${ServiceCard}
              svc=${s}
              expanded=${!!expandedMine[svcId]}
              onToggle=${() => toggleMineExpand(svcId)}
              actions=${html`<button class="btn-danger" onClick=${() => unpublishService(svcId)}>${t('profile.delete')}</button>`}
            />`;
          })
      }`;
  };

  const renderCatalogue = () => html`
    <div class="action-bar">
      <select class="input-field" style="max-width:200px" value=${catFilter} onChange=${e => { setCatFilter(e.target.value); loadCatalogueData(e.target.value); }}>
        <option value="">${t('profile.services.allCategories')}</option>
        ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
      </select>
    </div>
    ${!catalogue ? html`<${Spinner} text=${t('profile.services.loading')} />`
      : catalogue.length === 0 ? html`<div class="empty">${t('profile.services.catalogueEmpty')}</div>`
      : catalogue.map(s => {
          const svcId = s.id || s.action_id;
          return html`<${ServiceCard}
            svc=${s}
            expanded=${!!expandedCat[svcId]}
            onToggle=${() => toggleCatExpand(svcId)}
          />`;
        })
    }`;

  return html`
    <div class="section-title">${t('profile.services.title')}</div>
    <div class="section-desc">${t('profile.services.desc')}</div>
    <div class="sub-tabs">
      <button class="sub-tab ${svcSubTab === 'mine' ? 'active' : ''}" onClick=${() => setSvcSubTab('mine')}>${t('profile.services.mine')}</button>
      <button class="sub-tab ${svcSubTab === 'catalogue' ? 'active' : ''}" onClick=${() => { setSvcSubTab('catalogue'); if (!catalogue) loadCatalogueData(catFilter); }}>${t('profile.services.catalogue')}</button>
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
    <div class="create-form">
      <div class="form-row"><label>${t('profile.services.nameLabel')}</label><input class="input-field" placeholder=${t('profile.services.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.services.descLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.services.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.services.categoryLabel')}</label>
        <select class="input-field" value=${cat} onChange=${e => setCat(e.target.value)}>
          ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      </div>
      <div class="form-row"><label>${t('profile.services.priceLabel')}</label><input type="number" class="input-field" value=${price} min="0" onInput=${e => setPrice(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.services.unitLabel')}</label>
        <select class="input-field" value=${unit} onChange=${e => setUnit(e.target.value)}>
          <option value="call">Per call</option><option value="minute">Per minute</option>
          <option value="token">Per token</option><option value="task">Per task</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.services.webhookLabel')}</label><input class="input-field" placeholder=${t('profile.services.webhookPlaceholder')} value=${webhook} onInput=${e => setWebhook(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onPublish(name, desc, cat, price, unit, webhook)}>${t('profile.services.publishSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}
