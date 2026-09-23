/**
 * @file services-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for publishing/managing services and browsing the catalogue.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: the page is a Page with the trail, the two
 *     lists are tabs, a service is a ListRow that opens in place (its details as KeyValue rows, a
 *     schema as a code Surface), the publish form is Fields. No own CSS. The price no longer
 *     carries a heart emoji; it reads "n morsels", the words the detail row already used.
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
import { useConfirm } from '/components/Modal.js';
import { Page, Stack, ListRow, KeyValue, Field, Action, Chip, Text, Surface } from '/components/poster-parts.js';
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
  return html`<${KeyValue} label=${label} value=${html`<${Surface} kind="code" density="compact">${preview}<//>`} />`;
}

/** Expandable service row used in both My Services and Catalogue */
function ServiceCard({ svc, expanded, onToggle, actions }) {
  const displayName = svc.display_name || svc.displayName || svc.name || '';
  const category = svc.category || '';
  const priceMorsels = svc.price_morsels ?? svc.pricing?.base_morsels ?? svc.pricing?.baseMorsels ?? 0;

  return html`<${ListRow} name=${escHtml(displayName)} onOpen=${onToggle} selected=${expanded} arrow=${true}
    detail=${html`${escHtml(svc.description || '')}${svc.owner ? html` │ ${escHtml(svc.owner)}` : ''}`} detailKind="text"
    value=${html`<${Stack} direction="wrap" density="compact" align="end">
      ${category && html`<${Chip}>${escHtml(category)}<//>`}
      <${Chip} tone="sun">${priceMorsels ? priceMorsels + ' morsels' : t('profile.services.free')}<//>
    <//>`}>
    ${expanded && html`<${Stack}>
      <${ServiceDetail} svc=${svc} />
      ${actions && html`<${Stack} direction="horizontal" align="start">${actions}<//>`}
    <//>`}
  <//>`;
}

/** Detail panel shown when a service row is opened */
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

  if (loading) return html`<${Text} tone="muted">${t('common.loading')}<//>`;
  if (error_) return html`<${Text} tone="danger">${error_}<//>`;

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

  return html`<${Stack} density="compact">
    ${description && html`<${KeyValue} label=${t('profile.services.descLabel')} value=${escHtml(description)} />`}
    ${providerGaii && html`<${KeyValue} label=${t('profile.services.provider')} value=${escHtml(providerGaii)} mono=${true} />`}
    <${KeyValue} label=${t('profile.services.priceLabel')} value=${`${priceMorsels} morsels${priceUnit ? ' / ' + priceUnit : ''}`} />
    ${webhookUrl && html`<${KeyValue} label=${t('profile.services.webhookLabel')} value=${escHtml(webhookUrl)} mono=${true} />`}
    ${estimatedTime && html`<${KeyValue} label=${t('profile.services.estTime')} value=${`${estimatedTime}s`} />`}
    ${tags.length > 0 && html`<${KeyValue} label="Tags" value=${html`<${Stack} direction="wrap" density="compact">${tags.map(tag => html`<${Chip} key=${tag} tone="muted">${escHtml(tag)}<//>`)}<//>`} />`}
    <${SchemaPreview} schema=${inputSchema} label="Input schema" />
    <${SchemaPreview} schema=${outputSchema} label="Output schema" />
    ${createdAt && html`<${KeyValue} label="Created" value=${fmtDate(createdAt)} />`}
  <//>`;
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
    if (!myServices) return html`<${Text} tone="muted">${t('profile.services.loading')}<//>`;
    return html`<${Stack}>
      <${Stack} direction="horizontal" align="start"><${Action} kind="primary" onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}<//><//>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      ${myServices.length === 0
        ? html`<${Surface} kind="aside"><${Text} tone="muted">${t('profile.services.empty')}<//><//>`
        : html`<${Stack} density="compact">${myServices.map(s => {
            const svcId = s.id || s.action_id;
            return html`<${ServiceCard} key=${svcId}
              svc=${s}
              expanded=${!!expandedMine[svcId]}
              onToggle=${() => toggleMineExpand(svcId)}
              actions=${html`<${Action} onClick=${() => unpublishService(svcId)}>${t('profile.delete')}<//>`}
            />`;
          })}<//>`
      }
    <//>`;
  };

  const renderCatalogue = () => html`<${Stack}>
    <${Field} type="select" value=${catFilter} onChange=${e => { setCatFilter(e.target.value); loadCatalogueData(e.target.value); }}
      options=${[{ value: '', label: t('profile.services.allCategories') }, ...SERVICE_CATEGORIES.map(c => ({ value: c, label: c }))]} />
    ${!catalogue ? html`<${Text} tone="muted">${t('profile.services.loading')}<//>`
      : catalogue.length === 0 ? html`<${Surface} kind="aside"><${Text} tone="muted">${t('profile.services.catalogueEmpty')}<//><//>`
      : html`<${Stack} density="compact">${catalogue.map(s => {
          const svcId = s.id || s.action_id;
          return html`<${ServiceCard} key=${svcId}
            svc=${s}
            expanded=${!!expandedCat[svcId]}
            onToggle=${() => toggleCatExpand(svcId)}
          />`;
        })}<//>`
    }
  <//>`;

  return html`<${Page} width="wide" title=${t('profile.services.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuAutomation') }, { label: t('profile.services.title') }]}>
    <${Stack}>
      <${Text} kind="lead">${t('profile.services.desc')}<//>
      <${Stack} direction="wrap" density="compact" role="tablist" label=${t('profile.services.title')}>
        <${Action} kind="tab" semantics="tab" selected=${svcSubTab === 'mine'} onClick=${() => setSvcSubTab('mine')}>${t('profile.services.mine')}<//>
        <${Action} kind="tab" semantics="tab" selected=${svcSubTab === 'catalogue'} onClick=${() => { setSvcSubTab('catalogue'); if (!catalogue) loadCatalogueData(catFilter); }}>${t('profile.services.catalogue')}<//>
      <//>
      ${svcSubTab === 'mine' ? renderMyServices() : renderCatalogue()}
    <//>
    <${ConfirmUI} />
  <//>`;
}

function PublishForm({ onPublish, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('language');
  const [price, setPrice] = useState('0');
  const [unit, setUnit] = useState('call');
  const [webhook, setWebhook] = useState('');
  return html`<${Surface} kind="box"><${Stack}>
    <${Field} label=${t('profile.services.nameLabel')} placeholder=${t('profile.services.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} />
    <${Field} type="textarea" rows="3" label=${t('profile.services.descLabel')} placeholder=${t('profile.services.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)} />
    <${Field} type="select" label=${t('profile.services.categoryLabel')} value=${cat} onChange=${e => setCat(e.target.value)}
      options=${SERVICE_CATEGORIES.map(c => ({ value: c, label: c }))} />
    <${Field} type="number" label=${t('profile.services.priceLabel')} value=${price} min="0" onInput=${e => setPrice(e.target.value)} />
    <${Field} type="select" label=${t('profile.services.unitLabel')} value=${unit} onChange=${e => setUnit(e.target.value)}
      options=${[{ value: 'call', label: t('profile.services.unitPerCall') }, { value: 'minute', label: t('profile.services.unitPerMinute') },
        { value: 'token', label: t('profile.services.unitPerToken') }, { value: 'task', label: t('profile.services.unitPerTask') }]} />
    <${Field} label=${t('profile.services.webhookLabel')} placeholder=${t('profile.services.webhookPlaceholder')} value=${webhook} onInput=${e => setWebhook(e.target.value)} />
    <${Stack} direction="horizontal" align="start">
      <${Action} kind="primary" onClick=${() => onPublish(name, desc, cat, price, unit, webhook)}>${t('profile.services.publishSaveBtn')}<//>
      <${Action} onClick=${onCancel}>${t('profile.cancel')}<//>
    <//>
  <//><//>`;
}
