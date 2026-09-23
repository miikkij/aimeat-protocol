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
 *   - FieldRow / Head / openJson: the pieces both views share
 * @usage Imported by memory-tab.js; not mounted on its own.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: the trail is Crumbs, the key the title in the
 *     mono heading face (as written, not in capitals), the value a code
 *     Surface, the history the shared Table, every field a KeyValue, the six audiences list rows
 *     with their count as the mark, the delete the page's one loud action in the danger tone.
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
import { dt, DataTable } from './shared.js';
import { Section, Columns, Stack, KeyValue, ListRow, Crumbs, Surface, Action, Text } from '/components/poster-parts.js';

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

/** One field of the record. `empty` is what an absent value says, and it is never blank. */
function FieldRow({ name, value, empty, note }) {
  const bare = value === null || value === undefined || value === '';
  return html`
    <${KeyValue} label=${name} value=${html`<${Stack} density="compact">
      ${bare
        ? html`<${Text} tone="muted">${empty || S('notSet')}<//>`
        : value}
      ${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}
    <//>`} />`;
}

/** A small heading over a block, with a quiet reading at its right. */
function Head({ label, note }) {
  return html`<${Stack} direction="horizontal" align="between">
    <${Text} kind="label">${label}<//>${note && html`<${Text} kind="mono" tone="muted">${note}<//>`}
  <//>`;
}

/** ONE RECORD, whole. */
export function Record({ rec, onBack, onDelete, onRestore, busy, graceDays }) {
  const pretty = useMemo(() => openJson(rec.value), [rec.value]);
  const origins = rec.allowed_origins && rec.allowed_origins.length ? rec.allowed_origins.join(' · ') : null;

  return html`
    <${Stack}>
      <${Crumbs} items=${[{ label: S('crumbAll'), onClick: onBack }, { label: rec.owner_gaii }]} />

      <${Stack} density="compact">
        <${Text} kind="label">${S('recordEyebrow')}<//>
        <${Text} kind="heading" face="mono" size=${rec.key.length > 40 ? 'small' : 'normal'}>${rec.key}<//>
        <${Text} tone="muted">${S('recordLead')}<//>
      <//>

      <${Columns} collapse=${900}>
        <${Stack}>
          <${Head} label=${S('valueLabel')}
            note=${size(rec.byte_size) + (typeof rec.value === 'string' ? ' · ' + S('valueIsString') : '')} />
          <${Surface} kind="code" height="tall">${pretty}<//>

          ${rec.history?.length > 0 && html`
            <${Head} label=${S('historyLabel')} note=${S('historyCount', { n: rec.history.length })} />
            <${DataTable} headers=${[]} rows=${rec.history.map(v => [
              { text: 'v' + v.version, mono: true },
              { text: dt(v.recorded_at), mono: true },
              v.actor || S('noActor'),
              { text: size(v.byte_size), align: 'end' },
            ])} />`}
        <//>

        <${Stack}>
          <${Head} label=${S('everyField')} />
          <div>
            <${FieldRow} name="ownerGaii" value=${rec.owner_gaii} />
            <${FieldRow} name="visibility" value=${rec.visibility} note=${S('vis_' + rec.visibility)} />
            <${FieldRow} name="groupId" value=${rec.group_id} />
            <${FieldRow} name="workspaceRef" value=${rec.workspace_ref} />
            <${FieldRow} name="allowedOrigins" value=${origins} note=${origins ? null : S('noOriginLimit')} />
            <${FieldRow} name="tags" value=${rec.tags?.length ? rec.tags.join(' · ') : null} empty=${S('noTags')} />
            <${FieldRow} name="version" value=${String(rec.version)} />
            <${FieldRow} name="trackable" value=${String(!!rec.trackable)} note=${rec.trackable ? S('trackableYes') : S('trackableNo')} />
            <${FieldRow} name="byteSize" value=${size(rec.byte_size)} />
            <${FieldRow} name="ttlHours" value=${rec.ttl_hours} note=${rec.ttl_hours ? null : S('neverExpires')} />
            <${FieldRow} name="flagCount" value=${String(rec.flag_count ?? 0)} />
            <${FieldRow} name="aiProvenanceId" value=${rec.ai_provenance_id} empty=${S('notStated')} />
            <${FieldRow} name="archived" value=${String(!!rec.archived)} />
            <${FieldRow} name="archivedAt" value=${rec.archived_at} empty="—" />
            <${FieldRow} name="archivedBy" value=${rec.archived_by} empty="—" />
            <${FieldRow} name="archivedRoot" value=${rec.archived_root} empty="—" />
            <${FieldRow} name="createdAt" value=${rec.created_at} />
            <${FieldRow} name="updatedAt" value=${rec.updated_at} />
          </div>

          ${!rec.ai_provenance_id && html`
            <${Surface} kind="aside">
              <${Text}><strong>${S('provenanceHeading')}</strong> ${S('provenanceBody')}<//>
            <//>`}

          <${Stack} direction="horizontal">
            <${Action} kind="primary" tone="danger" disabled=${busy} onClick=${onDelete}>${S('deleteBtn')}<//>
          <//>
          <${Text} kind="caption" tone="muted">${S('deleteNote', { days: graceDays ?? 7 })}<//>
          ${onRestore && html`
            <${Stack} direction="horizontal">
              <${Action} disabled=${busy} onClick=${onRestore}>${S('restoreBtn')}<//>
            <//>`}
        <//>
      <//>
    <//>`;
}

/** WHO CAN READ WHAT — every record sorted by how far it reaches, widest first. */
export function Reach({ counts, total, originCount, onPick, onBack }) {
  return html`
    <${Stack}>
      <${Crumbs} items=${[{ label: S('crumbAll'), onClick: onBack }, { label: S('reachCrumb') }]} />

      <${Text} kind="label">${S('reachEyebrow')}<//>
      <${Section} title=${S('reachTitle')} description=${S('reachLead')}>
        <div>
          ${REACH.map(v => {
            const n = counts?.[v] ?? 0;
            return html`
              <${ListRow} key=${v} muted=${n === 0} name=${S('vis_' + v)} detail=${S('visNote_' + v)} detailKind="text"
                mark=${html`<${Text} kind="number" size="small">${n}<//>`}
                value=${v}
                actions=${n > 0
                  ? html`<${Action} kind="text" onClick=${() => onPick(v)}>${S('listThem')}<//>`
                  : html`<${Text} kind="caption" tone="muted">${S('none')}<//>`} />`;
          })}
        </div>

        <${Stack} density="compact">
          <${Text} kind="label">${S('originsLabel')}<//>
          <${Stack} direction="horizontal" align="center" density="compact">
            <${Text} kind="number" size="small">${originCount ?? 0}<//>
            <${Text} kind="mono" tone="muted">${S('ofTotal', { n: total ?? 0 })}<//>
          <//>
          <${Text} tone="muted">${S('originsBody')}<//>
        <//>
      <//>
    <//>`;
}
