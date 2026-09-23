/**
 * @file discovery-tab.identity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 04 of the admin Discovery page: the name, the sentence and the picture a
 *   search result and a shared link show, as underline fields beside the two previews. The previews
 *   render from the SERVED values, so an operator sees the effect of what they saved rather than
 *   the text they typed; a field they are editing shows in the field alone until it is saved.
 *
 * @structure IdentityField · Preview · DiscoveryIdentity({ status, onChanged }) — the seven fields, Save, the two previews
 * @usage <${DiscoveryIdentity} status=${status} onChanged=${load} />
 * @version-history
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared component set: the seven settings as shared
 *     fields (their hints show while a field is in use or filled, as everywhere), the two previews
 *     as shared boxes; no sheet of its own.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face). The fields and the
 *     previews lived in discovery-tab.js before.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useToast, Toast } from './shared.js';
import { Section, Columns, Stack, Text, Action, Field, Surface } from '/components/poster-parts.js';
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

/** One identity setting as a shared field; its hint shows while the field is in use or filled. */
function IdentityField({ field, value, onInput }) {
  const label = S('identity.f_' + field.key);
  if (field.type === 'textarea' || field.type === 'lines') {
    const text = field.type === 'lines' ? (value || []).join('\n') : value;
    const hint = field.type === 'textarea'
      ? `${S('identity.h_' + field.key)} ${S('identity.chars', { n: String(value || '').length })}`
      : S('identity.h_' + field.key);
    return html`<${Field} type="textarea" rows=${3} label=${label} value=${text} hint=${hint}
      spellCheck=${field.type === 'lines' ? false : undefined} onInput=${e => onInput(e.target.value)} />`;
  }
  return html`<${Field} label=${label} value=${value} spellCheck=${false} passwordManager=${false}
    placeholder=${S('identity.p_' + field.key)} hint=${S('identity.h_' + field.key)}
    onInput=${e => onInput(e.target.value)} />`;
}

/** What a search result and a shared link look like right now, from the served values. */
function Preview({ identity, host }) {
  return html`
    <${Stack}>
      <${Text} kind="label">${S('identity.serp')}<//>
      <${Surface} kind="box">
        <${Stack} density="compact">
          <${Text} kind="mono" tone="muted">${identity.organization_url}<//>
          <${Text} kind="heading" size="small" tone="coral">${identity.site_name}<//>
          <${Text} tone="muted">${identity.site_description}<//>
        <//>
      <//>
      <${Text} kind="label">${S('identity.card')}<//>
      <${Surface} kind="box" density="flush">
        ${identity.og_image
          ? html`<img src=${identity.og_image} alt="" loading="lazy" width="100%" />`
          : html`<${Surface} kind="plain" tone="ink"><${Text} kind="caption">${S('noImage')}<//><//>`}
        <${Surface} kind="plain" density="compact">
          <${Stack} density="compact">
            <strong>${identity.site_name}</strong>
            <${Text} tone="muted">${identity.site_description}<//>
            <${Text} kind="mono" tone="muted">${host}<//>
          <//>
        <//>
      <//>
    <//>`;
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
    <${Section} id="adm-disc-04" title=${S('identity.title')} count="04" description=${S('identity.lead')}
      actions=${dirty ? html`<${Action} onClick=${() => setEdits({})}>${S('identity.discard')}<//>` : null}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Columns} layout="leading" collapse=${900} density="roomy">
        <${Stack} density="roomy">
          ${FIELDS.filter(f => !f.pair).slice(0, 3).map(field => html`<${IdentityField} key=${field.path} field=${field} value=${current(field)} onInput=${v => edit(field, v)} />`)}
          <${Columns} layout="equal" collapse=${560}>
            <${IdentityField} field=${pairA} value=${current(pairA)} onInput=${v => edit(pairA, v)} />
            <${IdentityField} field=${pairB} value=${current(pairB)} onInput=${v => edit(pairB, v)} />
          <//>
          ${FIELDS.filter(f => !f.pair).slice(3).map(field => html`<${IdentityField} key=${field.path} field=${field} value=${current(field)} onInput=${v => edit(field, v)} />`)}
          <${Stack} direction="wrap" align="center">
            <${Action} disabled=${saving || !dirty} onClick=${save}>${S('identity.save')}<//>
          <//>
        <//>
        <${Preview} identity=${status.identity} host=${host} />
      <//>
    <//>`;
}
