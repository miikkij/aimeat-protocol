import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listMyServices, browse, publish, unpublish } from '/js/services/catalogue.js';

const SERVICE_CATEGORIES = ['language','translation','analysis','generation','coding','data','image','audio','video','search','utility','other'];

export default function ServicesTab({ session, showToast, onStats }) {
  const [myServices, setMyServices] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [svcSubTab, setSvcSubTab] = useState('mine');
  const [catFilter, setCatFilter] = useState('');
  const [showPubForm, setShowPubForm] = useState(false);

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
    if (!confirm(t('profile.services.unpublishConfirm'))) return;
    const resp = await unpublish(id);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.services.unpublished'));
    loadMyData();
  }

  const renderMyServices = () => {
    if (!myServices) return html`<${Spinner} text=${t('profile.services.loading')} />`;
    return html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}</button>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      ${myServices.length === 0
        ? html`<div class="empty">${t('profile.services.empty')}</div>`
        : myServices.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name)}</div>
              <div>
                <span class="badge badge-info">${escHtml(s.category || '')}</span>
                <span class="badge badge-success" style="margin-left:.25rem">${s.price_morsels ? s.price_morsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(s.description || '')}</div>
            <button class="btn-danger" style="margin-top:.5rem" onClick=${() => unpublishService(s.id || s.action_id)}>${t('profile.delete')}</button>
          </div>
        `)
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
      : catalogue.map(s => html`
        <div class="card">
          <div class="card-header">
            <div class="card-title">${escHtml(s.display_name || s.name)}</div>
            <div>
              <span class="badge badge-info">${escHtml(s.category || '')}</span>
              <span class="badge badge-success" style="margin-left:.25rem">${s.price_morsels ? s.price_morsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
            </div>
          </div>
          <div class="card-subtitle">${escHtml(s.description || '')} \u2502 ${escHtml(s.owner || '')}</div>
        </div>
      `)
    }`;

  return html`
    <div class="section-title">${t('profile.services.title')}</div>
    <div class="section-desc">${t('profile.services.desc')}</div>
    <div class="sub-tabs">
      <button class="sub-tab ${svcSubTab === 'mine' ? 'active' : ''}" onClick=${() => setSvcSubTab('mine')}>${t('profile.services.mine')}</button>
      <button class="sub-tab ${svcSubTab === 'catalogue' ? 'active' : ''}" onClick=${() => { setSvcSubTab('catalogue'); if (!catalogue) loadCatalogueData(catFilter); }}>${t('profile.services.catalogue')}</button>
    </div>
    ${svcSubTab === 'mine' ? renderMyServices() : renderCatalogue()}
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
