/**
 * @file public/views/appcat/sections/search.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Search" (features F328, route F197): whether this app can be found
 *   in a search engine, and what it says about itself when it is. OFF until its owner asks:
 *   publishing makes an app shareable by link, not findable. The state is the one the server computed
 *   (the owner's switch, the operator's block, the node's mode, the gates), read from the listing
 *   row; a gated or hidden app gets no switch, because a control that does nothing is worse than none.
 *   When on, "Change what it says" opens the three optional wording fields (empty ones come from the
 *   name, description and tags) and "What people will see" previews the result. Writes go through
 *   PATCH /v1/apps/{filename} { seo }, and the answer's state and note are what the person is told.
 *
 *   The old page read the row from the first page of the listing only (F229, the quirk F361); this
 *   one reads it from the page's whole listing, so an owner with more than 200 apps is not told
 *   "Could not read…". The shell draws the chapter line and the headline from `meta`; this is the body.
 * @structure meta · SearchSection({ d })
 * @usage const mod = await import('./sections/search.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (sections-c): the state line on the old grey for
 *     every state (the old page defined no tinted grounds), the door rows 10px apart, the wording
 *     editor as label.dtl-stat-label over .modal-input, the heading as its h4 and the preview as
 *     .dtl-seo-preview (SearchCard).
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's js/seo.js on components (appcat detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { SubHeading } from '/components/SubHeading.js';
import { SearchCard } from '/components/SearchPreview.js';
import { x } from '/views/appcat/i18n.js';
import { patchApp, errorText, noticeKind } from '/views/appcat/sections/app-write.js';

const html = htm.bind(h);

export const meta = { id: 'search', title: 'seo.title', show: (d) => !!(d && d.isOwnPublished) };

/** The one sentence that tells the owner where the app actually stands. */
function stateLine(state, blockReason) {
  if (state === 'on') return x('seo.stateOn');
  if (state === 'pending') return x('seo.statePending');
  if (state === 'blocked') return x('seo.stateBlocked') + (blockReason ? ' — ' + blockReason : '');
  if (state === 'hidden') return x('seo.stateHidden');
  if (state === 'gated') return x('seo.stateGated');
  return x('seo.stateOff');
}

/** The section's view of the row: what the server says now, and what the app says about itself. */
function fromRow(app) {
  const m = (app && app.manifest) || {};
  return {
    state: app.seo_state || 'off', seo: app.seo || {}, blockReason: app.operator_seo_block_reason || '',
    shot: app.screenshot_url || '', name: m.name || app.filename, description: m.description || '', tags: m.tags || [],
  };
}

function Wording({ d, data, busy, onSave }) {
  const s = data.seo || {};
  const [title, setTitle] = useState(s.title || '');
  const [desc, setDesc] = useState(s.description || '');
  const [keywords, setKeywords] = useState((s.keywords || []).join(', '));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields start over only for another app
  useEffect(() => { setTitle(s.title || ''); setDesc(s.description || ''); setKeywords((s.keywords || []).join(', ')); }, [d.ref]);
  const save = () => onSave({
    title: title.trim(), description: desc.trim(),
    keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
  });
  // The old page's editor: label.dtl-stat-label over .modal-input, the hint, and the one loud door in
  // its own row 10px apart (Fields plain chapter, Actions chapter apart).
  return html`
    <${Fields} plain chapter>
      <${TextField} label=${x('seo.fTitle')} value=${title} onInput=${setTitle} maxLength=${120} placeholder=${data.name} />
      <${TextArea} label=${x('seo.fDesc')} value=${desc} onInput=${setDesc} rows=${2} maxLength=${320} placeholder=${data.description} />
      <${TextField} label=${x('seo.fKeywords')} value=${keywords} onInput=${setKeywords} placeholder=${(data.tags || []).join(', ')} />
    <//>
    <${Note} kind="hint" chapter>${x('seo.wordingHint')}<//>
    <${Actions} chapter apart><${Loud} control disabled=${busy} onClick=${save}>${x('seo.save')}<//><//>`;
}

export default function SearchSection({ d }) {
  const [data, setData] = useState(() => (d.app ? fromRow(d.app) : null));
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(false);
  // Only another app starts over from the row: after a write the answer is newer than the row.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the app on purpose
  useEffect(() => { setData(d.app ? fromRow(d.app) : null); setBusy(false); setEditor(false); }, [d.ref]);

  if (!d.app && !data) return html`<${Note} kind="hint">${x('seo.loading')}<//>`;
  if (!data) return html`<${Note} kind="hint">${x('seo.loadFailed')}<//>`;

  const write = async (seo) => {
    if (busy) return;
    setBusy(true);
    try {
      // The answer carries the state AFTER the write, which is not always what was asked for: on a
      // node where the operator approves each request, switching on makes a request, and the note says so.
      const answer = await patchApp(d.filename, { seo });
      setData((cur) => ({ ...cur, state: (answer.seo && answer.seo.state) || cur.state, seo: answer.seo || cur.seo }));
      const said = answer.note || x('seo.saved');
      d.notice(said, noticeKind(said));
      d.reload?.();
    } catch (err) {
      const said = errorText(err, x('seo.saveFailed'));
      d.notice(said, noticeKind(said));
    }
    setBusy(false);
  };

  const on = !!(data.seo && data.seo.index === true);
  const gated = data.state === 'gated' || data.state === 'hidden';
  const title = (data.seo && data.seo.title) || data.name;
  const sentence = (data.seo && data.seo.description) || data.description;
  // The state line stands on the old page's grey whatever the state: the old page named tinted grounds
  // per state but defined none of them, so every state showed on the same grey.
  return html`
    <${Note} kind="hint" chapter>${x('seo.intro')}<//>
    <${Note} kind="state">${stateLine(data.state, data.blockReason)}<//>
    ${gated ? null : html`
      <${Actions} chapter apart>${on
        ? html`<${Action} small disabled=${busy} onClick=${() => write({ index: false })}>${x('seo.turnOff')}<//>`
        : html`<${Loud} control disabled=${busy} onClick=${() => write({ index: true })}>${x('seo.turnOn')}<//>`}<//>
      ${on ? html`
        <${Actions} chapter apart><${Action} small expanded=${editor} onClick=${() => setEditor(!editor)}>${x(editor ? 'seo.hideWording' : 'seo.editWording')}<//><//>
        ${editor ? html`<${Wording} d=${d} data=${data} busy=${busy} onSave=${write} />` : null}
        <${SubHeading} level=${4} part>${x('seo.previewTitle')}<//>
        <${SearchCard} image=${data.shot || undefined} noImage=${x('seo.noShot')} title=${title} desc=${sentence} />` : null}`}`;
}
