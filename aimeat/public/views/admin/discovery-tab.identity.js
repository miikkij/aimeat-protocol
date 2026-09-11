/**
 * @file discovery-tab.identity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 04 of the admin Discovery page: the name, the sentence and the picture a
 *   search result and a shared link show, as underline fields beside the two previews. The previews
 *   render from the SERVED values, so an operator sees the effect of what they saved rather than
 *   the text they typed; a field they are editing shows in the field alone until it is saved.
 *
 * @structure DiscoveryIdentity({ status, onChanged }) — the seven fields, Save, the two previews
 * @usage <${DiscoveryIdentity} status=${status} onChanged=${load} />
 * @version-history
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face). The fields and the
 *     previews lived in discovery-tab.js before.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useToast, Toast } from './shared.js';
import * as adminService from '/js/services/admin.js';

const S = (key, params) => t('dashboard.seo.' + key, params);

/** The `seo.*` settings this section edits, in the order an operator meets them. */
const FIELDS = [
  { path: 'seo.site_name',         key: 'siteName',        type: 'text',     from: (i) => i.site_name },
  { path: 'seo.site_description',  key: 'siteDescription', type: 'textarea', from: (i) => i.site_description },
  { path: 'seo.og_image',          key: 'ogImage',         type: 'mono',     from: (i) => i.og_image },
  { path: 'seo.organization_name', key: 'orgName',         type: 'text',     from: (i) => i.organization_name, pair: 'a' },
  { path: 'seo.organization_url',  key: 'orgUrl',          type: 'mono',     from: (i) => i.organization_url,  pair: 'b' },
  { path: 'seo.same_as',           key: 'sameAs',          type: 'lines',    from: (i) => i.same_as },
  { path: 'seo.twitter_site',      key: 'twitterSite',     type: 'text',     from: (i) => i.twitter_site || '' },
];

function Field({ field, value, onInput }) {
  const label = html`<div class="adm-disc-lbl">${S('identity.f_' + field.key)}</div>`;
  const hint = html`<p class="adm-disc-note">${S('identity.h_' + field.key)}</p>`;
  if (field.type === 'textarea' || field.type === 'lines') {
    const text = field.type === 'lines' ? (value || []).join('\n') : value;
    return html`<div>${label}
      <textarea class="adm-disc-box-fld ${field.type === 'lines' ? 'adm-disc-box-fld--mono' : ''}" rows="3" value=${text}
        onInput=${e => onInput(e.target.value)} />
      ${field.type === 'textarea' ? html`<p class="adm-disc-note">${S('identity.h_' + field.key)} ${S('identity.chars', { n: String(value || '').length })}</p>` : hint}
    </div>`;
  }
  return html`<div>${label}
    <div class="adm-disc-fld ${field.type === 'mono' ? 'adm-disc-fld--mono' : ''}">
      <input type="text" value=${value} spellcheck="false" placeholder=${S('identity.p_' + field.key)} onInput=${e => onInput(e.target.value)} />
    </div>
    ${hint}
  </div>`;
}

/** What a search result and a shared link look like right now, from the served values. */
function Preview({ identity, host }) {
  return html`
    <div>
      <div class="adm-disc-lbl">${S('identity.serp')}</div>
      <div class="adm-disc-frame">
        <div class="adm-disc-serp-url">${identity.organization_url}</div>
        <div class="adm-disc-serp-title">${identity.site_name}</div>
        <div class="adm-disc-serp-desc">${identity.site_description}</div>
      </div>
      <div class="adm-disc-lbl">${S('identity.card')}</div>
      <div class="adm-disc-frame adm-disc-frame--card">
        ${identity.og_image
          ? html`<img class="adm-disc-card-img" src=${identity.og_image} alt="" loading="lazy" />`
          : html`<div class="adm-disc-card-img adm-disc-card-img--empty">${S('noImage')}</div>`}
        <div class="adm-disc-card-body">
          <div class="adm-disc-card-title">${identity.site_name}</div>
          <div class="adm-disc-serp-desc">${identity.site_description}</div>
          <div class="adm-disc-card-host">${host}</div>
        </div>
      </div>
    </div>`;
}

export function DiscoveryIdentity({ status, onChanged }) {
  // Only the fields the operator has actually touched, so an unedited field is never resaved.
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();
  const dirty = Object.keys(edits).length > 0;

  const current = (field) => edits[field.path] !== undefined ? edits[field.path] : (field.from(status.identity) ?? '');
  const edit = (field, raw) => setEdits(prev => ({
    ...prev,
    [field.path]: field.type === 'lines'
      ? String(raw).split('\n').map(s => s.trim()).filter(Boolean)
      : raw,
  }));

  const save = useCallback(async () => {
    const changes = Object.entries(edits).map(([path, value]) => ({ path, value }));
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await adminService.saveConfig(changes);
      setEdits({});
      showSuccess(S('identity.saved'));
      await onChanged();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [edits, onChanged, showSuccess, showError]);

  const host = status.sitemap.url.replace(/^https?:\/\//, '').replace(/\/sitemap\.xml$/, '');
  const pairA = FIELDS.find(f => f.pair === 'a');
  const pairB = FIELDS.find(f => f.pair === 'b');

  return html`
    <section class="og-sec" id="adm-disc-04">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div class="og-sec-h"><h2>${S('identity.title')}<small>04</small></h2>
        <div class="og-doors">
          ${dirty ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => setEdits({})}>${S('identity.discard')}</button>` : null}
        </div></div>
      <p class="adm-disc-lead">${S('identity.lead')}</p>
      <div class="adm-disc-identity">
        <div class="adm-disc-fields">
          ${FIELDS.filter(f => !f.pair).slice(0, 3).map(field => html`<${Field} key=${field.path} field=${field} value=${current(field)} onInput=${v => edit(field, v)} />`)}
          <div class="adm-disc-pair">
            <${Field} field=${pairA} value=${current(pairA)} onInput=${v => edit(pairA, v)} />
            <${Field} field=${pairB} value=${current(pairB)} onInput=${v => edit(pairB, v)} />
          </div>
          ${FIELDS.filter(f => !f.pair).slice(3).map(field => html`<${Field} key=${field.path} field=${field} value=${current(field)} onInput=${v => edit(field, v)} />`)}
          <div class="adm-disc-acts">
            <button type="button" class="og-slab" disabled=${saving || !dirty} onClick=${save}>${S('identity.save')}</button>
          </div>
        </div>
        <${Preview} identity=${status.identity} host=${host} />
      </div>
    </section>`;
}
