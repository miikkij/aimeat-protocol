/**
 * @file public/views/appcat/sections/legal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Legal pages" (features F330–F331, routes F199, F216): the app answers
 *   for what it does, not the node, so the pages are the app's own: terms, privacy notice, imprint,
 *   refunds and withdrawal, accessibility statement, cookies, support. Each is written here as Markdown
 *   or HTML, or linked to where it already lives, and served at /terms, /privacy and so on under the
 *   app's own address. An aside says the server's readiness reason and how many pages are missing;
 *   then one row per kind in a fixed order: its name, "Recommended" when the server recommends it, its
 *   state (format and date with "Open →", "Missing" in coral, or "Not written"), the server's why, and
 *   Write or Edit and Remove. The editor opens inside the row. Writes are PATCH /v1/apps/{filename}
 *   { legal: { kind: { format, content } | null } }; after one the legal state and the audit log are
 *   read again (legal-state.js), which also redraws the masthead's chip.
 *
 *   Remove asks with appcat's own question dialog, in the old words. The old page asked with the
 *   browser's native confirm here (the quirk in F330, the one place besides fork that did); the words
 *   and the answer are the same. The shell draws the chapter line and the headline from `meta`.
 * @structure meta · LegalSection({ d }) · Editor({ d, kind, doc, isNew, busy, onSave, onCancel })
 * @usage const mod = await import('./sections/legal.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (sections-c): the rows as .lg-row (List tone pages),
 *     the recommendation as the heavy tag, the state as typewriter words, "Open →" as the ink word, the
 *     editor as .lg-editor (Fields plain column, TextArea page, no autofocus), the aside and the grey
 *     lines as the old page's; Remove asks without the danger tone, so OK has the focus as the
 *     browser's question gave it.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's legal half of js/legal.js on components (appcat
 *     detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { TextArea } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { x } from '/views/appcat/i18n.js';
import { patchApp, dateText, errorText, noticeKind } from '/views/appcat/sections/app-write.js';
import { useLegal, reloadLegal, KINDS } from '/views/appcat/sections/legal-state.js';

const html = htm.bind(h);
const FORMATS = ['markdown', 'html', 'url'];

export const meta = { id: 'legal', title: 'legal.title', show: (d) => !!(d && d.isOwnPublished) };

/**
 * The editor inside a row: the format with its hint, the page, and the acts (the old .lg-editor: one
 * column 10px apart; the page in the framed typewriter box, 14 rows; nothing takes the focus).
 */
function Editor({ kind, doc, isNew, busy, onSave, onCancel }) {
  const [format, setFormat] = useState(doc ? doc.format : 'markdown');
  const [content, setContent] = useState(doc ? doc.content : '');
  return html`<${Fields} plain column>
    <${Select} label=${x('legal.formatLabel')} value=${format} onChange=${setFormat}
      options=${FORMATS.map((f) => [f, x('legal.format.' + f)])} hint=${x('legal.hint.' + format)} />
    <${TextArea} page label=${x('legal.contentLabel')} rows=${14} value=${content} onInput=${setContent}
      spellCheck=${true} placeholder=${x('legal.placeholder.' + kind)} />
    <${Actions} chapter>
      <${Loud} control disabled=${busy} onClick=${() => onSave(format, content)}>${x('legal.save')}<//>
      <${Action} small disabled=${busy} onClick=${onCancel}>${x('legal.cancel')}<//>
    <//>
    ${isNew ? html`<${Note} kind="hint" chapter>${x('legal.aiHint')}<//>` : null}
  <//>`;
}

export default function LegalSection({ d }) {
  const st = useLegal(d);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEditing(null); setBusy(false); }, [d.ref]);

  if (!st || st.legal.state === 'loading') return html`<${Note} kind="hint" chapter>${x('legal.loading')}<//>`;
  const data = st.legal.data;
  if (st.legal.state === 'error' || !data) return html`<${Note} kind="hint" chapter>${x('legal.loadFailed')}<//>`;

  const write = async (legal) => {
    setBusy(true);
    try {
      const answer = await patchApp(d.filename, { legal });
      const said = answer.note || x('legal.saved');
      d.notice(said, noticeKind(said));
      setEditing(null);
      // Re-read: the answer carries the state, the editor needs the documents too.
      reloadLegal(d.owner, d.filename);
    } catch (err) {
      const said = errorText(err, x('legal.saveFailed'));
      d.notice(said, noticeKind(said));
    }
    setBusy(false);
  };
  const save = (kind, format, content) => {
    if (busy) return;
    if (!String(content || '').trim()) { d.notice(x('legal.empty'), noticeKind(x('legal.empty'))); return; }
    write({ [kind]: { format, content } });
  };
  const remove = async (kind) => {
    if (busy) return;
    // The page's own question, as every other act of the page asks, with OK in the focus as the
    // browser's question had it (so not the danger tone, which gives Cancel the focus).
    if (!(await confirmAsk(x('legal.removeConfirm')))) return;
    write({ [kind]: null });
  };

  const r = data.readiness || { missing: [], recommended: [], reason: '' };
  const missing = r.missing || [];
  const recommended = r.recommended || [];
  const rows = KINDS.map((kind) => {
    const info = (data.kinds && data.kinds[kind]) || { why: '' };
    const page = data.legal && data.legal[kind];
    const link = (data.links || []).find((l) => l.kind === kind) || null;
    let state;
    if (page) {
      state = html` <${Mark} kind="word" tone="ink">${x('legal.format.' + page.format)} · ${dateText(page.updatedAt)}<//>${link
        ? html` <${Action} tone="inline" small href=${link.href} newTab>${x('legal.open')} →<//>` : null}`;
    } else if (missing.includes(kind)) {
      state = html` <${Mark} kind="word" tone="notice">${x('legal.missing')}<//>`;
    } else {
      state = html` <${Mark} kind="word">${x('legal.none')}<//>`;
    }
    const open = editing === kind;
    const doc = (data.documents && data.documents[kind]) || null;
    return html`<${Row} key=${kind} below=${open ? html`<${Editor} kind=${kind} doc=${doc} isNew=${!page} busy=${busy}
        onSave=${(f, c) => save(kind, f, c)} onCancel=${() => setEditing(null)} />` : null}>
      <${Name} tag=${recommended.includes(kind) ? html`<${Mark} tone="heavy">${x('legal.recommended')}<//>` : null} after=${state} desc=${info.why}>${x('legal.kind.' + kind)}<//>
      <${Doors}>${open ? null : html`
        <${Action} small disabled=${busy} onClick=${() => setEditing(kind)}>${x(page ? 'legal.edit' : 'legal.write')}<//>
        ${page ? html`<${Action} small disabled=${busy} onClick=${() => remove(kind)}>${x('legal.remove')}<//>` : null}`}<//>
    <//>`;
  });

  return html`
    <${Note} kind="hint" chapter>${x('legal.intro')}<//>
    <${Note} kind="aside" chapter>${r.reason} ${missing.length ? x('legal.readinessMissing', { n: missing.length }) : x('legal.readinessOk')}<//>
    <${List} tone="pages" cols="name-doors">${rows}<//>`;
}
