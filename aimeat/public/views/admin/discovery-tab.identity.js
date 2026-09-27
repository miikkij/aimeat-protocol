/**
 * @file discovery-tab.identity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 04 of the admin Discovery page: the name, the sentence and the picture a
 *   search result and a shared link show, as fields beside the two previews. The previews render
 *   from the SERVED values, so an operator sees the effect of what they saved rather than the text
 *   they typed; a field they are editing shows in the field alone until it is saved.
 *
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure DiscoveryIdentity({ status, onChanged }) — the seven fields, Save, the two previews
 * @usage <${DiscoveryIdentity} status=${status} onChanged=${load} />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): TextField and TextArea for the
 *     fields, Fields for the pair, the library's SearchResult and ShareCard for the previews, Loud
 *     and Action for the buttons, Beside for the two columns.
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
import { Section } from '/components/Section.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { SearchResult, ShareCard } from '/components/SearchPreview.js';
import { Beside, Stack } from '/components/Layout.js';
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

function SeoField({ field, value, onInput }) {
  const label = S('identity.f_' + field.key);
  if (field.type === 'textarea' || field.type === 'lines') {
    const text = field.type === 'lines' ? (value || []).join('\n') : value;
    return html`<${TextArea} label=${label} rows=${3} code=${field.type === 'lines'} value=${text}
      hint=${field.type === 'textarea'
        ? `${S('identity.h_' + field.key)} ${S('identity.chars', { n: String(value || '').length })}`
        : S('identity.h_' + field.key)}
      onInput=${onInput} />`;
  }
  return html`<${TextField} label=${label} code=${field.type === 'mono'} value=${value} spellCheck=${false}
    placeholder=${S('identity.p_' + field.key)} hint=${S('identity.h_' + field.key)} onInput=${onInput} />`;
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
  const identity = status.identity;

  return html`
    <${Section} id="adm-disc-04" num="04" title=${S('identity.title')}
      doors=${dirty ? html`<${Action} small soft onClick=${() => setEdits({})}>${S('identity.discard')}<//>` : null}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="lead">${S('identity.lead')}<//>
      <${Beside} wide side=${html`
        <${SearchResult} label=${S('identity.serp')} url=${identity.organization_url} title=${identity.site_name} desc=${identity.site_description} />
        <${ShareCard} label=${S('identity.card')} image=${identity.og_image} noImage=${S('noImage')}
          title=${identity.site_name} desc=${identity.site_description} host=${host} />`}>
        <${Stack} gap="large">
          ${FIELDS.filter(f => !f.pair).slice(0, 3).map(field => html`<${SeoField} key=${field.path} field=${field} value=${current(field)} onInput=${v => edit(field, v)} />`)}
          <${Fields} cols=${2}>
            <${SeoField} field=${pairA} value=${current(pairA)} onInput=${v => edit(pairA, v)} />
            <${SeoField} field=${pairB} value=${current(pairB)} onInput=${v => edit(pairB, v)} />
          <//>
          ${FIELDS.filter(f => !f.pair).slice(3).map(field => html`<${SeoField} key=${field.path} field=${field} value=${current(field)} onInput=${v => edit(field, v)} />`)}
          <${FormActions}>
            <${Loud} control disabled=${saving || !dirty} onClick=${save}>${S('identity.save')}<//>
          <//>
        <//>
      <//>
    <//>`;
}
