/**
 * @file services-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for publishing/managing services and browsing the catalogue.
 * @version-history
 *   v1.18.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a service name or description with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.18.0 -- 2026-09-26 -- Every part is a component that gets data (component plan, page group G4): the page frame
 *     (SettingsPage), the view tabs (Tabs bar), the list and its opening rows (List, Row, Panel), the details
 *     (Facts; a schema the Code block that scrolls after 200px, as main's did), the tags (Mark), the ways on
 *     (Action, Loud, Icon), the publish form (Card section, TextField, TextArea, Select, FormActions). The page
 *     writes no class.
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
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Tabs, TabPanel } from '/components/Tabs.js';
import { List, Row, Name, Desc, Doors, Panel } from '/components/List.js';
import { Facts } from '/components/Facts.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Action, Loud, Icon } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Card } from '/components/Card.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Space } from '/components/Layout.js';
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

/** A JSON schema as a compact preview: one Facts row, or none when the schema is empty. */
function schemaRow(schema, label) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return null;
  let preview;
  try { preview = JSON.stringify(schema, null, 2); } catch (err) { swallowed('services-tab', err); preview = String(schema); }
  return { k: label, v: html`<${Code} block scroll>${preview}<//>` };
}

/** Expandable service row used in both My Services and Catalogue */
function ServiceCard({ svc, expanded, onToggle, actions }) {
  const displayName = svc.display_name || svc.displayName || svc.name || '';
  const category = svc.category || '';
  const priceMorsels = svc.price_morsels ?? svc.pricing?.base_morsels ?? svc.pricing?.baseMorsels ?? 0;

  return html`
    <${Row} open=${expanded} onToggle=${onToggle}>
      <${Name}>${displayName}<//>
      <${Desc}>${svc.description || ''}${svc.owner ? html` │ ${svc.owner}` : ''}<//>
      <${Doors}>
        <${Marks}>
          ${category && html`<${Mark}>${category}<//>`}
          <${Mark}>${priceMorsels ? priceMorsels + ' ❤️' : t('profile.services.free')}<//>
        <//>
        <${Icon} small expanded=${!!expanded}>${expanded ? '▼' : '▶'}<//>
      <//>
      ${expanded && html`
        <${Panel} doors=${actions}>
          <${ServiceDetail} svc=${svc} />
        <//>`}
    <//>`;
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

  // A click inside the opened panel never folds the row: the Row ignores clicks in its Panel.
  if (loading) return html`<${Note} kind="loading">${t('common.loading')}<//>`;
  if (error_) return html`<${Note} kind="message" error>${error_}<//>`;

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

  return html`<${Facts} rows=${[
    description && { k: t('profile.services.descLabel'), v: description },
    providerGaii && { k: t('profile.services.provider'), v: providerGaii, mono: true },
    { k: t('profile.services.priceLabel'), v: `${priceMorsels} morsels${priceUnit ? ' / ' + priceUnit : ''}` },
    webhookUrl && { k: t('profile.services.webhookLabel'), v: webhookUrl, mono: true },
    estimatedTime && { k: t('profile.services.estTime'), v: `${estimatedTime}s` },
    tags.length > 0 && { k: 'Tags', v: html`<${Marks}>${tags.map(tag => html`<${Mark} key=${tag}>${tag}<//>`)}<//>` },
    schemaRow(inputSchema, 'Input schema'),
    schemaRow(outputSchema, 'Output schema'),
    createdAt && { k: 'Created', v: fmtDate(createdAt) },
  ]} />`;
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
    if (!myServices) return html`<${List} loading=${t('profile.services.loading')} />`;
    return html`
      <${Space} below="large"><${Loud} onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}<//><//>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      <${List} cols="name-desc-doors" empty=${t('profile.services.empty')}>
        ${myServices.map(s => {
          const svcId = s.id || s.action_id;
          return html`<${ServiceCard}
            key=${svcId}
            svc=${s}
            expanded=${!!expandedMine[svcId]}
            onToggle=${() => toggleMineExpand(svcId)}
            actions=${html`<${Action} small tone="danger" onClick=${() => unpublishService(svcId)}>${t('profile.delete')}<//>`}
          />`;
        })}
      <//>`;
  };

  const renderCatalogue = () => html`
    <${Space} below="large">
      <${Select} fit ariaLabel=${t('profile.services.categoryLabel')} value=${catFilter}
        onChange=${v => { setCatFilter(v); loadCatalogueData(v); }}
        placeholder=${t('profile.services.allCategories')} options=${SERVICE_CATEGORIES} />
    <//>
    ${!catalogue ? html`<${List} loading=${t('profile.services.loading')} />`
      : html`<${List} cols="name-desc-doors" empty=${t('profile.services.catalogueEmpty')}>
          ${catalogue.map(s => {
            const svcId = s.id || s.action_id;
            return html`<${ServiceCard}
              key=${svcId}
              svc=${s}
              expanded=${!!expandedCat[svcId]}
              onToggle=${() => toggleCatExpand(svcId)}
            />`;
          })}
        <//>`
    }`;

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAutomation'), t('profile.tabs.services')]}
      title=${t('profile.services.title')}
      desc=${t('profile.services.desc')}
      after=${html`<${ConfirmUI} />`}>
      <${Tabs} bar kind="view" value=${svcSubTab}
        onSelect=${(v) => { setSvcSubTab(v); if (v === 'catalogue' && !catalogue) loadCatalogueData(catFilter); }}
        items=${[
          { value: 'mine', label: t('profile.services.mine') },
          { value: 'catalogue', label: t('profile.services.catalogue') },
        ]} />
      <${TabPanel} value=${svcSubTab}>${svcSubTab === 'mine' ? renderMyServices() : renderCatalogue()}<//>
    <//>
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
    <${Card} tone="section">
      <${Fields}>
        <${TextField} label=${t('profile.services.nameLabel')} placeholder=${t('profile.services.namePlaceholder')} value=${name} onInput=${setName} />
        <${TextArea} label=${t('profile.services.descLabel')} rows=${3} placeholder=${t('profile.services.descPlaceholder')} value=${desc} onInput=${setDesc} />
        <${Select} label=${t('profile.services.categoryLabel')} value=${cat} onChange=${setCat} options=${SERVICE_CATEGORIES} />
        <${TextField} type="number" label=${t('profile.services.priceLabel')} value=${price} min="0" onInput=${setPrice} />
        <${Select} label=${t('profile.services.unitLabel')} value=${unit} onChange=${setUnit} options=${[
          ['call', t('profile.services.unitPerCall')], ['minute', t('profile.services.unitPerMinute')],
          ['token', t('profile.services.unitPerToken')], ['task', t('profile.services.unitPerTask')],
        ]} />
        <${TextField} label=${t('profile.services.webhookLabel')} placeholder=${t('profile.services.webhookPlaceholder')} value=${webhook} onInput=${setWebhook} />
      <//>
      <${FormActions}>
        <${Loud} onClick=${() => onPublish(name, desc, cat, price, unit, webhook)}>${t('profile.services.publishSaveBtn')}<//>
        <${Action} small onClick=${onCancel}>${t('profile.cancel')}<//>
      <//>
    <//>`;
}
