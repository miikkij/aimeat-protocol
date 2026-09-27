/**
 * @file public/views/admin/memory-tab.record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two views of the admin Memory page that are not the finder: one record shown
 *   whole, and the reach view that sorts every record by how far it can be read.
 *
 *   WHY A RECORD IS SHOWN WHOLE. These are other people's records, and an operator looking at one is
 *   answering a question about somebody's own knowledge. A page that shows nine of the twenty fields
 *   decides for them which nine mattered — and the eleven the old listing dropped were the ones that
 *   say who can reach the record and where its value came from. So every field is here, and an empty
 *   one says it is empty rather than being left out.
 *
 * @structure
 *   - Record({ rec, onBack, onDelete, onRestore, busy }): the value, every field, the two writes
 *   - Reach({ counts, rows, onPick, onOpen }): the six audiences, widest first
 *   - field / readWord / openJson: the pieces both views share
 * @usage Imported by memory-tab.js; not mounted on its own.
 * @version-history
 *   v1.2.0 — 2026-09-27 — On the library components (page group G5): the crumb is the Crumb, the
 *     head the PageHead (the record's key as a key), the value and its versions beside every field
 *     (Beside), the value a Code block that scrolls, the versions a List, every field a Facts row (an
 *     empty one grey, with the words that say it is empty), the provenance note the aside, the
 *     delete the loud action; the reach a List (an audience nobody is in faded) and the origins
 *     count a Figure. The file writes no class and no style.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 -- 2026-09-13 -- Compose record and audience row boundaries from poster.css.
 *   v1.0.0 — 2026-09-12 — Initial, with the page rebuilt around the question.
 */
import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt } from './shared.js';
import { Crumb } from '/components/Crumb.js';
import { PageHead } from '/components/PageHead.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Cell, Num, When, Who, Doors } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Code, Label } from '/components/Mark.js';
import { Figure } from '/components/Figure.js';
import { Note } from '/components/Note.js';
import { Beside, Stack, Row as Line } from '/components/Layout.js';

const S = (key, params) => t('admin.mem.' + key, params);

/** Every audience a record can have, widest reach FIRST — the order a mistake costs most in. */
export const REACH = ['public', 'members', 'workspace', 'group', 'owner', 'private'];

/** Bytes as a person reads them. */
export function size(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' kB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * A value opened for reading.
 *
 * A great many records store a STRING whose contents are JSON — the Design Book parts among them —
 * and JSON.stringify on a string pretty-prints nothing, so the old panel showed one escaped line
 * running off the side. Parse first, then print.
 */
export function openJson(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return v; }   // a plain string is already readable
  }
  try { return JSON.stringify(v, null, 2); } catch { return String(value); }
}

/**
 * One field of the record, as a Facts row. `empty` is what an absent value says, and it is never blank.
 * @param {any} name @param {any} value @param {{ empty?: any, note?: any }} [opts]
 */
function field(name, value, { empty, note } = {}) {
  const bare = value === null || value === undefined || value === '';
  return { k: name, key: name, v: bare ? (empty || S('notSet')) : value, mono: !bare, missing: bare, sub: note || undefined };
}

/** A part's heading line: its label on the left, a reading on the right. */
function Head({ label, reading }) {
  return html`<${Line} justify="between" wrap below="small">
    <${Label}>${label}<//>
    ${reading ? html`<${Note} kind="meta" inline mono>${reading}<//>` : null}
  <//>`;
}

/** ONE RECORD, whole. */
export function Record({ rec, onBack, onDelete, onRestore, busy, graceDays }) {
  const pretty = useMemo(() => openJson(rec.value), [rec.value]);
  const origins = rec.allowed_origins && rec.allowed_origins.length ? rec.allowed_origins.join(' · ') : null;

  const fields = html`
    <${Stack} gap="large">
      <${Stack} gap="none">
        <${Head} label=${S('everyField')} />
        <${Facts} rows=${[
          field('ownerGaii', rec.owner_gaii),
          field('visibility', rec.visibility, { note: S('vis_' + rec.visibility) }),
          field('groupId', rec.group_id),
          field('workspaceRef', rec.workspace_ref),
          field('allowedOrigins', origins, { note: origins ? null : S('noOriginLimit') }),
          field('tags', rec.tags?.length ? rec.tags.join(' · ') : null, { empty: S('noTags') }),
          field('version', String(rec.version)),
          field('trackable', String(!!rec.trackable), { note: rec.trackable ? S('trackableYes') : S('trackableNo') }),
          field('byteSize', size(rec.byte_size)),
          field('ttlHours', rec.ttl_hours, { note: rec.ttl_hours ? null : S('neverExpires') }),
          field('flagCount', String(rec.flag_count ?? 0)),
          field('aiProvenanceId', rec.ai_provenance_id, { empty: S('notStated') }),
          field('archived', String(!!rec.archived)),
          field('archivedAt', rec.archived_at, { empty: '—' }),
          field('archivedBy', rec.archived_by, { empty: '—' }),
          field('archivedRoot', rec.archived_root, { empty: '—' }),
          field('createdAt', rec.created_at),
          field('updatedAt', rec.updated_at),
        ]} />
      <//>

      ${!rec.ai_provenance_id && html`
        <${Note} kind="aside"><b>${S('provenanceHeading')}</b> ${S('provenanceBody')}<//>`}

      <${Stack} gap="small">
        <${Actions}>
          <${Loud} disabled=${busy} onClick=${onDelete}>${S('deleteBtn')}<//>
        <//>
        <${Note}>${S('deleteNote', { days: graceDays ?? 7 })}<//>
        ${onRestore && html`
          <${Actions}>
            <${Action} small disabled=${busy} onClick=${onRestore}>${S('restoreBtn')}<//>
          <//>`}
      <//>
    <//>`;

  return html`
    <${Crumb} steps=${[{ label: S('crumbAll'), onClick: onBack }, rec.owner_gaii]} />
    <${PageHead} label=${S('recordEyebrow')} title=${rec.key} asKey desc=${S('recordLead')} />

    <${Beside} wide side=${fields} above="large">
      <${Head} label=${S('valueLabel')} reading=${`${size(rec.byte_size)}${typeof rec.value === 'string' ? ' · ' + S('valueIsString') : ''}`} />
      <${Code} block scroll="page">${pretty}<//>

      ${rec.history?.length > 0 && html`
        <${Stack} above="large">
          <${Head} label=${S('historyLabel')} reading=${S('historyCount', { n: rec.history.length })} />
          <${List} cols="tag-when-who-n" dense>
            ${rec.history.map(v => html`
              <${Row} key=${v.version}>
                <${Cell} code>v${v.version}<//>
                <${When}>${dt(v.recorded_at)}<//>
                <${Who}>${v.actor || S('noActor')}<//>
                <${Num} quiet>${size(v.byte_size)}<//>
              <//>`)}
          <//>
        <//>`}
    <//>`;
}

/** WHO CAN READ WHAT — every record sorted by how far it reaches, widest first. */
export function Reach({ counts, total, originCount, onPick, onBack }) {
  return html`
    <${Crumb} steps=${[{ label: S('crumbAll'), onClick: onBack }, S('reachCrumb')]} />
    <${PageHead} label=${S('reachEyebrow')} title=${S('reachTitle')} desc=${S('reachLead')} />

    <${List} cols="tag-n-name-doors">
      ${REACH.map(v => {
        const n = counts?.[v] ?? 0;
        return html`
          <${Row} key=${v} faded=${n === 0}>
            <${Cell} sign>${v}<//>
            <${Num}><${Figure} small n=${n} /><//>
            <${Name} desc=${S('visNote_' + v)}>${S('vis_' + v)}<//>
            <${Doors}>
              ${n > 0
                ? html`<${Action} small onClick=${() => onPick(v)}>${S('listThem')}<//>`
                : html`<${Note} kind="meta" inline>${S('none')}<//>`}
            <//>
          <//>`;
      })}
    <//>

    <${Stack} above="section">
      <${Head} label=${S('originsLabel')} />
      <${Figure} large n=${originCount ?? 0} sub=${S('ofTotal', { n: total ?? 0 })} />
      <${Note}>${S('originsBody')}<//>
    <//>`;
}
