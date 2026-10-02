/**
 * @file public/views/appcat/sections/about.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "About" (features F315, F316, F124): read, the description in the page language and
 *   the facts (Category, Tags, Source, Size, Added, Uses extensions, Forked from); edited in place
 *   (the slab's Edit, or the ✏️ in the toolbar), the app's name, its English and Finnish descriptions
 *   with the AI translation between them, the icon and the tags. Save renames and describes the app
 *   on the node (PATCH /v1/apps/{filename} { name, description, descriptions }; no new version, the
 *   link stays), the canonical description the English one, else the Finnish.
 *
 *   Two things kept as the old page did them: "Added" is the moment this page opened the app, not
 *   when it was published (F315), and the icon and the tags live only in this page session until the
 *   next publish (F316): the node is not told.
 * @structure meta (with doors) · AboutSection({ d })
 * @usage loaded by the detail view: import('./sections/about.js')
 * @version-history
 *   v1.1.0 — 2026-10-02 — A fact says who answers ?format=md: the app's own extension action
 *     (manifest.formatMd, from aimeat-format-md) or the node's stored page and converted HTML.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder A): the old catalogue's detail.js aboutHtml,
 *     detailAboutEdit/Cancel/Save and detailTranslateDesc.
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { apiPatch } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { dateTime } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { translateText } from '/views/appcat/ai-calls.js';
import { setSessionEdit } from '/views/appcat/detail-state.js';
import { fmtSize } from '/views/appcat/detail-head.js';

const html = htm.bind(h);

/** The translation line's tone: grey while it works or says a plain thing, green when done, coral on a failure. */
const REPORT_TONE = { ok: 'ok', err: 'refused' };

export const meta = {
  id: 'about',
  title: 'detail.about',
  show: () => true,
  // The Edit door on the slab, while the editor is shut.
  doors: (d) => (d.aboutEditing ? null : html`<${Action} small onClick=${() => d.editAbout(true)}>${x('detail.editDetails')}<//>`),
};

/** The editor: name, two descriptions and their translation, icon, tags. */
function Editor({ d }) {
  const m = d.meta;
  const descs = m.descriptions || {};
  const [name, setName] = useState(m.name || '');
  const [en, setEn] = useState(descs.en || m.description || '');
  const [fi, setFi] = useState(descs.fi || '');
  const [icon, setIcon] = useState(m.icon || '');
  const [tags, setTags] = useState((m.tags || []).join(', '));
  const [tr, setTr] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  const enRef = useRef(null);

  // The editor opens with the name chosen, ready to be typed over (F175).
  useEffect(() => { const el = nameRef.current; if (el) { el.focus(); el.select(); } }, []);

  async function translate(src, dst) {
    const text = (src === 'en' ? en : fi).trim();
    if (!text) { setTr({ text: x('detail.trNeedSource'), tone: '' }); return; }
    if (!getSession()) { setTr({ text: x('detail.aiLoginNeeded'), tone: '' }); return; }
    setTr({ text: x('detail.translating'), tone: 'busy' });
    try {
      const out = await translateText(text, src, dst);
      if (!out) { setTr({ text: '✘ ' + x('detail.trEmpty'), tone: 'err' }); return; }
      if (dst === 'fi') setFi(out); else setEn(out);
      setTr({ text: '✔ ' + x('detail.trDone'), tone: 'ok' });
    } catch (err) {
      setTr({ text: '✘ ' + (err.message || x('detail.trFailed')), tone: 'err' });
    }
  }

  async function save() {
    const newName = name.trim();
    const enDesc = en.trim();
    const fiDesc = fi.trim();
    const descriptions = {};
    if (enDesc) descriptions.en = enDesc;
    if (fiDesc) descriptions.fi = fiDesc;
    const description = enDesc || fiDesc || '';
    const newTags = tags.split(',').map((s) => s.trim()).filter(Boolean);
    if (!newName) { d.notice(x('detail.nameRequired'), 'error'); nameRef.current?.focus(); return; }
    if (d.published && !description) { d.notice(x('detail.descRequired'), 'error'); enRef.current?.focus(); return; }
    if (!getSession()) { d.notice(x('common.loginRequired'), 'error'); return; }
    setSaving(true);
    try {
      await apiPatch('/v1/apps/' + encodeURIComponent(d.filename), { name: newName, description, descriptions });
      // The icon and the tags stay in this page session only, as the old page kept them (F316).
      setSessionEdit(d.ref, { name: newName, description, descriptions, icon: icon.trim(), tags: newTags });
      d.editAbout(false);
      d.reload();
    } catch (err) {
      d.notice(x('common.failed', { msg: err.message || String(err) }), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <${Fields} plain chapter spaced>
      <${TextField} label=${x('detail.nameLabel')} inputRef=${nameRef} value=${name} onInput=${setName} maxLength=${120} />
      <${TextArea} label=${x('detail.descEn')} inputRef=${enRef} rows=${3} value=${en} onInput=${setEn} maxLength=${2000} />
      <${TextArea} label=${x('detail.descFi')} rows=${3} value=${fi} onInput=${setFi} maxLength=${2000} />
    <//>
    <${Actions} chapter>
      <${Action} small onClick=${() => translate('en', 'fi')}>${x('detail.translateEnFi')}<//>
      <${Action} small onClick=${() => translate('fi', 'en')}>${x('detail.translateFiEn')}<//>
    <//>
    <${Note} kind="report" chapter keep tone=${REPORT_TONE[tr?.tone] || 'busy'}>${tr ? tr.text : ''}<//>
    <${Fields} plain chapter spaced>
      <${TextField} label=${x('detail.iconLabel')} value=${icon} onInput=${setIcon} maxLength=${4} size="mark" />
      <${TextField} label=${x('detail.tagsLabel')} value=${tags} onInput=${setTags} placeholder="tools, productivity" />
    <//>
    <${Note} kind="quiet" chapter>${x('detail.renameHint')}<//>
    <${Actions} chapter>
      <${Loud} control disabled=${saving} onClick=${save}>${x('detail.saveDetails')}<//>
      <${Action} small onClick=${() => d.editAbout(false)}>${x('detail.cancelEdit')}<//>
    <//>`;
}

export default function AboutSection({ d }) {
  if (d.aboutEditing) return html`<${Editor} d=${d} />`;
  const m = d.meta;
  const shown = (m.descriptions && m.descriptions[d.lang]) || m.description || '';
  const bytes = d.work.b64 ? Math.round(d.work.b64.length * 0.75) : 0;
  const f = m.forkedFrom;
  const fmd = (d.manifest && d.manifest.formatMd) || m.formatMd;
  const rows = [
    { k: x('detail.category'), v: m.category || 'utility' },
    { k: x('detail.tags'), v: m.tags && m.tags.length ? m.tags.join(', ') : '—' },
    { k: x('detail.sourceLabel'), v: 'AIMEAT' },
    { k: x('detail.size'), v: bytes ? fmtSize(bytes) : '—' },
    // "Added" is when this page opened the app, as the old page counted it (F315).
    { k: x('detail.created'), v: d.work.shotAt ? dateTime(d.work.shotAt) : '—' },
    { k: x('detail.usesCortex'), v: m.usesCortex && m.usesCortex.length ? m.usesCortex.join(', ') : '—' },
    f && f.owner && f.filename ? { k: x('detail.forkedFrom'), v: f.owner + '/' + f.filename + (f.version ? ' v' + f.version : '') } : null,
    // Who answers ?format=md: the app's own extension action (aimeat-format-md), or the node's fallback.
    { k: x('detail.formatMd'), v: fmd ? x('detail.formatMdApp', { extension: fmd.extension, action: fmd.action }) : x('detail.formatMdNode') },
  ];
  return html`
    ${shown ? html`<${Note} kind="lead" chapter>${shown}<//>` : null}
    <${Facts} tiles rows=${rows} />`;
}
